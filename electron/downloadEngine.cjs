'use strict';
/**
 * electron/downloadEngine.cjs
 * ---------------------------------------------------------------------------
 * Fast, resumable, multi-connection downloader (download-manager style).
 *
 *  - Splits every file into chunks and pulls them over several parallel HTTP
 *    Range connections (default 8 per file, 16 total) -> much faster than one
 *    stream whenever the server/CDN limits per-connection speed.
 *  - Progress is persisted next to the partial file (<dest>.part + <dest>.part.state)
 *    every second, so a pause, crash, power loss or app restart resumes from
 *    where it stopped - never from zero.
 *  - Per-chunk retry with backoff, stall detection, expired-link recovery.
 *  - Optional SHA-256 verification and free-disk-space pre-check.
 *  - Optional global speed limit.
 *
 * No electron dependency: runs (and is self-tested) with plain Node >= 20.
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MiB = 1024 * 1024;

let fetchImpl = (url, init) => fetch(url, init);
/** Lets the host app supply its own fetch (Electron: net.fetch, which honours system proxies). */
function setFetch(fn) {
  fetchImpl = typeof fn === 'function' ? fn : (url, init) => fetch(url, init);
}
let activeRequests = 0;

const UA = 'local-ai-voice-studio/1.0';

const DEFAULTS = {
  connectionsPerFile: 8,
  maxConnections: 16, // shared by all files of one downloadAll()
  fileConcurrency: 6,
  minChunk: 4 * MiB,
  maxChunk: 32 * MiB,
  retries: 8,
  stallMs: 20000,
  flushMs: 1000,
  progressMs: 200,
  maxBytesPerSec: 0, // 0 = unlimited
};

/* ------------------------------ small helpers ---------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Semaphore {
  constructor(n) {
    this.n = n;
    this.q = [];
  }
  async acquire() {
    if (this.n > 0) {
      this.n -= 1;
      return;
    }
    await new Promise((resolve) => this.q.push(resolve));
  }
  release() {
    const next = this.q.shift();
    if (next) next();
    else this.n += 1;
  }
}

/** Global token-bucket speed limiter (bytes/second). */
class RateLimiter {
  constructor(bps) {
    this.bps = bps;
    this.allowance = bps;
    this.last = Date.now();
  }
  async take(bytes) {
    if (!this.bps) return;
    for (;;) {
      const now = Date.now();
      this.allowance = Math.min(this.bps, this.allowance + ((now - this.last) / 1000) * this.bps);
      this.last = now;
      if (this.allowance >= bytes || this.allowance >= this.bps) {
        this.allowance -= bytes;
        return;
      }
      await sleep(Math.max(5, ((bytes - this.allowance) / this.bps) * 1000));
    }
  }
}

/** Rolling-window speed meter. */
class SpeedMeter {
  constructor(windowMs = 4000) {
    this.windowMs = windowMs;
    this.samples = [];
  }
  add(bytes) {
    const now = Date.now();
    this.samples.push([now, bytes]);
    this.trim(now);
  }
  trim(now) {
    while (this.samples.length && now - this.samples[0][0] > this.windowMs) this.samples.shift();
  }
  bytesPerSec() {
    const now = Date.now();
    this.trim(now);
    if (!this.samples.length) return 0;
    const total = this.samples.reduce((s, x) => s + x[1], 0);
    const span = Math.max(1000, now - this.samples[0][0]);
    return total / (span / 1000);
  }
}

function httpError(status, url) {
  const err = new Error(`HTTP ${status} for ${url}`);
  err.status = status;
  err.fatal = status === 401 || status === 403 || status === 404 || status === 410 || status === 416;
  return err;
}

/** Turns low-level network failures into something a person can act on. */
function explainNetworkError(err) {
  const code = (err && (err.code || (err.cause && err.cause.code))) || '';
  const text = String((err && err.message) || err || '');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'cannot find the server (DNS). Check your internet connection, VPN or proxy.';
  if (code === 'ECONNREFUSED') return 'the server refused the connection. A firewall, VPN or proxy may be blocking it.';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'the connection timed out. The network is very slow or blocked.';
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'the connection was reset (unstable network, VPN or antivirus).';
  if (/CERT|SSL|TLS|self.signed|unable to verify/i.test(String(code) + text)) return 'a TLS/certificate problem (an antivirus, proxy or school/work network may be inspecting traffic).';
  if (/stalled/i.test(text)) return 'the download stalled (no data for 20 seconds).';
  return text || 'unknown network error';
}

function abortError(message = 'Download paused') {
  const err = new Error(message);
  err.name = 'AbortError';
  err.aborted = true;
  return err;
}

async function exists(p) {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function freeBytes(dir) {
  try {
    let probe = dir;
    while (!(await exists(probe))) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    const s = await fsp.statfs(probe);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return Infinity; // unknown -> do not block
  }
}

async function atomicWriteJson(file, obj) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj), 'utf8');
  await fsp.rename(tmp, file);
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function sha256File(file, signal, onBytes) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file, { highWaterMark: 4 * MiB });
  for await (const chunk of stream) {
    if (signal && signal.aborted) {
      stream.destroy();
      throw abortError('Verification cancelled');
    }
    hash.update(chunk);
    if (onBytes) onBytes(chunk.length);
  }
  return hash.digest('hex');
}

async function renameWithRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      const transient = err && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES');
      if (!transient || i >= 12) throw err;
      await sleep(250 * (i + 1));
    }
  }
}

/* -------------------------------- probing -------------------------------- */

/** Learns the total size and whether the server supports Range requests. */
async function probe(url, { headers = {}, signal } = {}) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': UA, 'Accept-Encoding': 'identity', ...headers, Range: 'bytes=0-0' },
    redirect: 'follow',
    signal,
  });
  let size = 0;
  let ranges = false;
  if (res.status === 206) {
    const m = /bytes\s+\d+-\d+\/(\d+)/i.exec(res.headers.get('content-range') || '');
    size = m ? Number(m[1]) : 0;
    ranges = size > 0;
  } else if (res.ok) {
    size = Number(res.headers.get('content-length')) || 0;
  } else {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    throw httpError(res.status, url);
  }
  const etag = res.headers.get('etag') || res.headers.get('x-linked-etag') || '';
  try { await res.body?.cancel(); } catch { /* ignore */ }
  return { size, ranges, etag };
}

/** probe() with retries: a dropped connection during the size check must not fail the file. */
async function probeWithRetry(url, { headers = {}, signal, retries = 6 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await probe(url, { headers, signal });
    } catch (err) {
      if (signal && signal.aborted) throw abortError();
      if (err && err.fatal) throw err;
      attempt += 1;
      if (attempt > retries) throw new Error(`Cannot reach ${new URL(url).host}: ${explainNetworkError(err)}`);
      await sleep(Math.min(6000, 300 * 2 ** (attempt - 1)));
    }
  }
}

/* ------------------------------ single file ------------------------------ */

function pickChunkSize(size, o) {
  const target = Math.ceil(size / (o.connectionsPerFile * 4));
  return Math.max(o.minChunk, Math.min(o.maxChunk, target));
}

/**
 * Download one file.
 * job: { url, dest, size?, sha256?, headers?, name? }
 * ctx: { signal, semaphore, limiter, meter, opts, onProgress, onBytes }
 * Returns { skipped, bytes, resumedBytes }
 */
async function downloadFile(job, ctx = {}) {
  const o = { ...DEFAULTS, ...(ctx.opts || {}) };
  const signal = ctx.signal;
  const semaphore = ctx.semaphore || new Semaphore(o.maxConnections);
  const limiter = ctx.limiter || new RateLimiter(o.maxBytesPerSec);
  const meter = ctx.meter || new SpeedMeter();
  const headers = job.headers || {};
  const dest = job.dest;
  const part = `${dest}.part`;
  const statePath = `${dest}.part.state`;
  const name = job.name || path.basename(dest);

  await fsp.mkdir(path.dirname(dest), { recursive: true });

  // Already complete?
  if (await exists(dest)) {
    const st = await fsp.stat(dest);
    if (!job.size || st.size === job.size) {
      if (ctx.onBytes) ctx.onBytes(0, { skipped: true, bytes: st.size });
      return { skipped: true, bytes: st.size, resumedBytes: st.size };
    }
  }

  if (signal && signal.aborted) throw abortError();
  const info = ctx.probeInfo || (await probeWithRetry(job.url, { headers, signal }));
  const size = info.size || job.size || 0;

  const emit = (extra) => {
    if (ctx.onProgress) ctx.onProgress({ name, total: size, ...extra });
  };

  /* ---- servers without Range (or unknown size): plain single stream ---- */
  if (!info.ranges || !size) {
    return singleStream({ job, ctx, o, name, size, part, dest, headers, signal, meter, limiter, emit });
  }

  /* ---- free space pre-check --------------------------------------------- */
  let state = await readJson(statePath);
  const partExists = await exists(part);
  const validState =
    state &&
    state.version === 1 &&
    state.size === size &&
    Array.isArray(state.done) &&
    (!state.etag || !info.etag || state.etag === info.etag) &&
    partExists;

  if (!validState) {
    state = { version: 1, url: job.url, size, etag: info.etag || '', chunk: pickChunkSize(size, o), done: [] };
    state.done = new Array(Math.ceil(size / state.chunk)).fill(0);
    await fsp.rm(part, { force: true });
  }
  const chunk = state.chunk;
  const chunkCount = state.done.length;
  const chunkLen = (i) => Math.min(size, (i + 1) * chunk) - i * chunk;

  const alreadyBytes = state.done.reduce((s, x) => s + x, 0);
  const need = size - alreadyBytes;
  const free = await freeBytes(path.dirname(dest));
  if (free < need + 64 * MiB) {
    const err = new Error(
      `Not enough free disk space for ${name}: need about ${Math.ceil(need / MiB)} MB, only ${Math.floor(free / MiB)} MB free.`
    );
    err.code = 'ENOSPC_PRECHECK';
    err.fatal = true;
    throw err;
  }

  const fh = await fsp.open(part, validState ? 'r+' : 'w+');
  if (!validState) await fh.truncate(size);

  const fileMeter = new SpeedMeter();
  let doneBytes = alreadyBytes;
  let dirty = !validState;
  if (ctx.onBytes && alreadyBytes > 0) ctx.onBytes(alreadyBytes, { resumed: true });
  emit({ phase: 'downloading', done: doneBytes, resumedBytes: alreadyBytes });

  const flush = async () => {
    if (!dirty) return;
    dirty = false;
    try {
      await fh.datasync();
      await atomicWriteJson(statePath, state);
    } catch {
      dirty = true;
    }
  };
  await flush();
  const flusher = setInterval(() => { void flush(); }, o.flushMs);

  const internal = new AbortController();
  const onExternalAbort = () => internal.abort();
  if (signal) signal.addEventListener('abort', onExternalAbort, { once: true });
  let fatalError = null;

  /* ---- one chunk with retry --------------------------------------------- */
  const pullChunk = async (i) => {
    const cStart = i * chunk;
    const cEnd = cStart + chunkLen(i) - 1;
    let attempt = 0;
    for (;;) {
      if (internal.signal.aborted) throw abortError();
      const from = cStart + state.done[i];
      if (from > cEnd) return;

      const ac = new AbortController();
      const relay = () => ac.abort();
      internal.signal.addEventListener('abort', relay, { once: true });
      let stallTimer = null;
      const armStall = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => ac.abort(new Error('stalled')), o.stallMs);
      };
      let progressed = 0;
      let counted = false;
      try {
        armStall();
        activeRequests += 1;
        counted = true;
        const res = await fetchImpl(job.url, {
          headers: { 'User-Agent': UA, 'Accept-Encoding': 'identity', ...headers, Range: `bytes=${from}-${cEnd}` },
          redirect: 'follow',
          signal: ac.signal,
        });
        if (res.status !== 206) {
          try { await res.body?.cancel(); } catch { /* ignore */ }
          if (res.status === 200) {
            const e = new Error('Server stopped honouring Range requests');
            e.fatal = true;
            throw e;
          }
          throw httpError(res.status, job.url);
        }
        const reader = res.body.getReader();
        let pos = from;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          armStall();
          let buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
          if (pos + buf.length - 1 > cEnd) buf = buf.subarray(0, cEnd - pos + 1); // never overrun
          await limiter.take(buf.length);
          await fh.write(buf, 0, buf.length, pos);
          pos += buf.length;
          state.done[i] += buf.length;
          doneBytes += buf.length;
          progressed += buf.length;
          dirty = true;
          meter.add(buf.length);
          fileMeter.add(buf.length);
          if (ctx.onBytes) ctx.onBytes(buf.length, {});
          if (pos > cEnd) break;
        }
        try { await reader.cancel(); } catch { /* ignore */ }
        if (state.done[i] < chunkLen(i)) throw new Error('Connection closed early');
        return;
      } catch (err) {
        if (internal.signal.aborted) throw abortError();
        if (err && (err.code === 'ENOSPC' || err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'EROFS')) {
          const e = new Error(err.code === 'ENOSPC'
            ? `The disk is full while saving ${name}. Free some space and press Resume - nothing downloaded so far is lost.`
            : `Cannot write to the download folder (${err.code}). Check folder permissions or antivirus settings.`);
          e.fatal = true;
          throw e;
        }
        if (err && err.fatal) throw err;
        if (progressed > 0) attempt = 0; // still making progress -> keep going
        attempt += 1;
        if (attempt > o.retries) {
          const e = new Error(`${name}: giving up after ${o.retries} retries - ${explainNetworkError(err)}`);
          e.cause = err;
          throw e;
        }
        let wait = Math.min(8000, 400 * 2 ** (attempt - 1)) + Math.random() * 250;
        if (err && err.status === 429) wait = Math.max(wait, 3000);
        await sleep(wait);
      } finally {
        clearTimeout(stallTimer);
        if (counted) activeRequests -= 1;
        internal.signal.removeEventListener('abort', relay);
      }
    }
  };

  /* ---- worker pool over remaining chunks -------------------------------- */
  const queue = [];
  for (let i = 0; i < chunkCount; i++) if (state.done[i] < chunkLen(i)) queue.push(i);

  const progressTimer = setInterval(() => {
    emit({
      phase: 'downloading',
      done: doneBytes,
      speed: meter.bytesPerSec(),
      fileSpeed: fileMeter.bytesPerSec(),
      resumedBytes: alreadyBytes,
    });
  }, o.progressMs);

  const worker = async () => {
    while (queue.length && !internal.signal.aborted) {
      const i = queue.shift();
      await semaphore.acquire();
      try {
        await pullChunk(i);
      } finally {
        semaphore.release();
      }
    }
  };

  try {
    const workers = [];
    for (let w = 0; w < Math.min(o.connectionsPerFile, queue.length || 1); w++) {
      workers.push(
        worker().catch((err) => {
          if (!fatalError && !(err && err.aborted)) {
            fatalError = err;
            internal.abort();
          }
          if (err && err.aborted) return;
          throw err;
        })
      );
    }
    const results = await Promise.allSettled(workers);
    if (fatalError) throw fatalError;
    if (signal && signal.aborted) throw abortError();
    const rejected = results.find((r) => r.status === 'rejected' && !(r.reason && r.reason.aborted));
    if (rejected) throw rejected.reason;
  } finally {
    clearInterval(progressTimer);
    clearInterval(flusher);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
    await flush(); // persist progress on pause / error / finish
    try { await fh.close(); } catch { /* already closed */ }
  }

  if (state.done.some((d, i) => d < chunkLen(i))) throw abortError('Download incomplete');

  /* ---- verify + finalize -------------------------------------------------- */
  if (job.sha256) {
    let hashed = 0;
    const t = setInterval(() => emit({ phase: 'verifying', done: hashed }), o.progressMs);
    let actual;
    try {
      actual = await sha256File(part, signal, (n) => { hashed += n; });
    } finally {
      clearInterval(t);
    }
    if (actual.toLowerCase() !== String(job.sha256).toLowerCase()) {
      await fsp.rm(part, { force: true });
      await fsp.rm(statePath, { force: true });
      const err = new Error(`Checksum mismatch for ${name}: the file was corrupted. Retry to download it again.`);
      err.code = 'HASH_MISMATCH';
      throw err;
    }
  }
  await fsp.rm(dest, { force: true });
  await renameWithRetry(part, dest);
  await fsp.rm(statePath, { force: true });
  emit({ phase: 'done', done: size });
  return { skipped: false, bytes: size, resumedBytes: alreadyBytes };
}

/** Fallback for servers without Range support: one stream, restart on failure. */
async function singleStream({ job, ctx, o, name, size, part, dest, headers, signal, meter, limiter, emit }) {
  let attempt = 0;
  for (;;) {
    if (signal && signal.aborted) throw abortError();
    const ac = new AbortController();
    const relay = () => ac.abort();
    if (signal) signal.addEventListener('abort', relay, { once: true });
    let stallTimer = null;
    const armStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => ac.abort(new Error('stalled')), o.stallMs);
    };
    let got = 0;
    try {
      armStall();
      const res = await fetchImpl(job.url, {
        headers: { 'User-Agent': UA, 'Accept-Encoding': 'identity', ...headers },
        redirect: 'follow',
        signal: ac.signal,
      });
      if (!res.ok) throw httpError(res.status, job.url);
      const out = fs.createWriteStream(part, { flags: 'w' });
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          armStall();
          await limiter.take(value.byteLength);
          if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
          got += value.byteLength;
          meter.add(value.byteLength);
          if (ctx.onBytes) ctx.onBytes(value.byteLength, {});
          emit({ phase: 'downloading', done: got, speed: meter.bytesPerSec() });
        }
      } finally {
        await new Promise((r) => out.end(r));
      }
      if (size && got !== size) throw new Error(`Incomplete download (${got} of ${size} bytes)`);
      if (job.sha256) {
        const actual = await sha256File(part, signal);
        if (actual.toLowerCase() !== String(job.sha256).toLowerCase()) {
          await fsp.rm(part, { force: true });
          const err = new Error(`Checksum mismatch for ${name}`);
          err.code = 'HASH_MISMATCH';
          err.fatal = true;
          throw err;
        }
      }
      await fsp.rm(dest, { force: true });
      await renameWithRetry(part, dest);
      emit({ phase: 'done', done: got });
      return { skipped: false, bytes: got, resumedBytes: 0 };
    } catch (err) {
      if (signal && signal.aborted) throw abortError();
      if (err && err.fatal) throw err;
      attempt += 1;
      if (attempt > o.retries) throw new Error(`${name}: ${explainNetworkError(err)}`);
      await sleep(Math.min(8000, 400 * 2 ** (attempt - 1)));
    } finally {
      clearTimeout(stallTimer);
      if (signal) signal.removeEventListener('abort', relay);
    }
  }
}

/* --------------------------- many files at once -------------------------- */

/**
 * Download a list of files with shared connection budget and aggregated progress.
 * jobs: [{ url, dest, size?, sha256?, headers?, name? }]
 * options: { signal, onProgress(p), ...DEFAULTS overrides }
 * onProgress payload:
 *   { totalBytes, doneBytes, speed, etaSeconds, percent, files:[{name,done,total,status}], resumedBytes }
 */
async function downloadAll(jobs, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const signal = options.signal;
  const semaphore = new Semaphore(o.maxConnections);
  const limiter = new RateLimiter(o.maxBytesPerSec);
  const meter = new SpeedMeter();

  // 1) probe everything first so totals are exact from the start
  const infos = new Array(jobs.length);
  let cursor = 0;
  let probed = 0;
  const probers = Array.from({ length: Math.min(8, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const idx = cursor++;
      const job = jobs[idx];
      try {
        if (await exists(job.dest)) {
          const st = await fsp.stat(job.dest);
          if (!job.size || st.size === job.size) {
            infos[idx] = { size: st.size, ranges: false, complete: true };
            continue;
          }
        }
        infos[idx] = await probeWithRetry(job.url, { headers: job.headers || {}, signal });
      } catch (err) {
        if (job.size) infos[idx] = { size: job.size, ranges: false, probeFailed: true, error: err };
        else throw err;
      } finally {
        probed += 1;
        if (options.onPhase) options.onPhase('probing', { done: probed, total: jobs.length });
      }
    }
  });
  await Promise.all(probers);

  if (options.onPhase) options.onPhase('probed', { files: jobs.length });
  const files = jobs.map((job, i) => ({
    name: job.name || path.basename(job.dest),
    done: infos[i].complete ? infos[i].size : 0,
    total: infos[i].size || job.size || 0,
    status: infos[i].complete ? 'done' : 'waiting',
  }));
  const totalBytes = files.reduce((s, f) => s + f.total, 0);
  if (options.beforeStart) {
    let remainingBytes = 0;
    for (let i = 0; i < jobs.length; i++) {
      if (files[i].status === 'done') continue;
      remainingBytes += Math.max(0, files[i].total - (await partialBytes(jobs[i].dest)));
    }
    await options.beforeStart({ totalBytes, remainingBytes });
  }
  let resumedBytes = 0;
  const startedAt = Date.now();
  let lastEmit = 0;

  const doneNow = () => files.reduce((s, f) => s + f.done, 0);
  const emit = (force) => {
    const now = Date.now();
    if (!force && now - lastEmit < o.progressMs) return;
    lastEmit = now;
    const done = doneNow();
    const speed = meter.bytesPerSec();
    const remaining = Math.max(0, totalBytes - done);
    if (options.onProgress) {
      options.onProgress({
        totalBytes,
        doneBytes: done,
        percent: totalBytes ? Math.min(100, (done / totalBytes) * 100) : 0,
        speed,
        etaSeconds: speed > 1024 ? remaining / speed : null,
        elapsedSeconds: (now - startedAt) / 1000,
        resumedBytes,
        connections: activeRequests,
        files: files.map((f) => ({ ...f })),
      });
    }
  };
  emit(true);

  // 2) run with limited file concurrency
  let next = 0;
  let firstError = null;
  const internal = new AbortController();
  if (signal) signal.addEventListener('abort', () => internal.abort(), { once: true });

  const runOne = async () => {
    while (next < jobs.length && !internal.signal.aborted) {
      const idx = next++;
      const job = jobs[idx];
      const f = files[idx];
      if (f.status === 'done') continue;
      f.status = 'downloading';
      try {
        const result = await downloadFile(job, {
          opts: o,
          signal: internal.signal,
          semaphore,
          limiter,
          meter,
          probeInfo: infos[idx].probeFailed ? undefined : infos[idx],
          onBytes: (n, meta) => {
            if (meta && meta.resumed) {
              f.done += n;
              resumedBytes += n;
            } else if (meta && meta.skipped) {
              f.done = meta.bytes;
            } else {
              f.done += n;
            }
            emit(false);
          },
          onProgress: (p) => {
            if (p.phase === 'verifying') f.status = 'verifying';
            else if (p.phase === 'downloading') f.status = 'downloading';
            if (p.total) f.total = p.total;
            if (typeof p.fileSpeed === 'number') f.speed = p.fileSpeed;
          },
        });
        f.status = 'done';
        f.done = f.total || result.bytes;
        emit(true);
      } catch (err) {
        f.status = err && err.aborted ? 'paused' : 'error';
        if (!(err && err.aborted) && !firstError) {
          firstError = err;
          internal.abort(); // stop siblings; partials stay on disk for resume
        }
        if (err && err.aborted) return;
        throw err;
      }
    }
  };

  const heartbeat = setInterval(() => emit(true), 500);
  const runners = Array.from({ length: Math.min(o.fileConcurrency, jobs.length) }, () => runOne().catch(() => {}));
  try {
    await Promise.all(runners);
  } finally {
    clearInterval(heartbeat);
  }
  emit(true);
  if (firstError) throw firstError;
  if (signal && signal.aborted) throw abortError();
  return { totalBytes, files };
}

/**
 * Quick "can this computer reach the download servers?" check, with a plain-language reason
 * for every failure (DNS, firewall, proxy, certificate...).
 */
async function checkConnectivity(hosts, timeoutMs = 8000) {
  const list = hosts || [
    { name: 'Hugging Face (models)', url: 'https://huggingface.co/' },
    { name: 'PyPI (Python packages)', url: 'https://pypi.org/simple/pip/' },
    { name: 'PyPI files', url: 'https://files.pythonhosted.org/' },
    { name: 'PyTorch', url: 'https://download.pytorch.org/whl/cpu/' },
    { name: 'GitHub (portable Python)', url: 'https://github.com/' },
  ];
  return Promise.all(list.map(async (h) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetchImpl(h.url, { method: 'GET', headers: { 'User-Agent': UA, Range: 'bytes=0-0' }, redirect: 'follow', signal: ac.signal });
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return { name: h.name, host: new URL(h.url).host, ok: res.status < 500, status: res.status, ms: Date.now() - t0 };
    } catch (err) {
      return { name: h.name, host: new URL(h.url).host, ok: false, ms: Date.now() - t0,
        error: ac.signal.aborted ? 'no answer within 8 seconds (blocked or very slow network)' : explainNetworkError(err) };
    } finally {
      clearTimeout(timer);
    }
  }));
}

/** Bytes already on disk for a partially downloaded file (for "resume" UIs). */
async function partialBytes(dest) {
  const st = await readJson(`${dest}.part.state`);
  if (!st || !Array.isArray(st.done)) return 0;
  return st.done.reduce((s, x) => s + x, 0);
}

module.exports = {
  DEFAULTS,
  setFetch,
  fetch: (url, init) => fetchImpl(url, init),
  checkConnectivity,
  explainNetworkError,
  downloadFile,
  downloadAll,
  partialBytes,
  probe,
  sha256File,
  abortError,
  freeBytes,
};
