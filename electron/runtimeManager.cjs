'use strict';
/**
 * electron/runtimeManager.cjs
 * ---------------------------------------------------------------------------
 * One-click, resumable installation of everything a voice model needs:
 *
 *   1. (Windows) Microsoft Visual C++ runtime - required by PyTorch
 *   2. Portable Python 3.11 (python-build-standalone) - no system Python needed
 *   3. A private virtual environment PER MODEL FAMILY (their version pins conflict)
 *   4. The right PyTorch build for the user's GPU (CUDA 13 / CUDA 12.6 / CPU)
 *   5. All packages, downloaded by our multi-connection resumable engine
 *      (pip only resolves + installs from the local wheel cache)
 *   6. Verification (imports + torch/CUDA report)
 *
 * The NVIDIA driver cannot be installed silently - it is detected and, if too
 * old, the UI tells the user (PyTorch wheels bundle the CUDA runtime itself,
 * so no separate CUDA Toolkit is needed).
 *
 * No electron dependency: testable with plain Node.
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const engine = require('./downloadEngine.cjs');

const GiB = 1024 ** 3;
const PBS_BASE = 'https://github.com/astral-sh/python-build-standalone/releases/download';
const PBS_LATEST = 'https://raw.githubusercontent.com/astral-sh/python-build-standalone/latest-release/latest-release.json';
const PYTHON_SERIES = '3.11';

/** Pinned fallback (verified SHA-256s) used when the "latest release" lookup fails. */
const PBS_PINNED = {
  tag: '20260929',
  files: {
    'x86_64-pc-windows-msvc': ['cpython-3.11.16+20260929-x86_64-pc-windows-msvc-install_only.tar.gz', 'fe8c767e9d9b19f6780b8a843fe68f6c52c4e9771b1d4db3b4af4d8883d49530'],
    'aarch64-pc-windows-msvc': ['cpython-3.11.16+20260929-aarch64-pc-windows-msvc-install_only.tar.gz', 'af46d6af03d348603a6b6cac3cb26a559b6172a9932770e846baa7b9393ca5df'],
    'x86_64-unknown-linux-gnu': ['cpython-3.11.16+20260929-x86_64-unknown-linux-gnu-install_only.tar.gz', 'fbbfd0f2253996486455f44a28c09ac7e2df534b8a4835408d17c99d185b80ec'],
    'aarch64-apple-darwin': ['cpython-3.11.16+20260929-aarch64-apple-darwin-install_only.tar.gz', 'ed30a8c85d48b8d51dd11cc9acb63ef407786fac3ff77f211dd7768a926ae73f'],
    'x86_64-apple-darwin': ['cpython-3.11.16+20260929-x86_64-apple-darwin-install_only.tar.gz', '1c1b5da6c23a10cdbedcae9de1b00a340187d39605ea945390e921e2086e2e11'],
  },
};

/**
 * Models SHARE environments whenever their libraries are compatible (PyTorch/CUDA and the common
 * packages are installed once). A model whose libraries need different versions gets its own
 * environment. The decision is made at install time with pip's real resolver, so it adapts as the
 * packages change. As of writing (real resolver results):
 *   - Kokoro + Qwen3-TTS + XTTS + F5-TTS can share one environment (transformers 4.57.3);
 *   - Chatterbox pins torch==2.6.0 + transformers==5.2.0, Parler pins transformers==4.46.1,
 *     so each of those needs its own.
 * `modules` are IMPORTED during verification (not just looked up), so a half-working install
 * is never reported as ready.
 */
const ENGINE_SPECS = {
  kokoro:     { label: 'Kokoro 82M',   modules: ['kokoro', 'soundfile'],                torchTags: ['cu130', 'cu126', 'cpu'] },
  qwen3:      { label: 'Qwen3-TTS',    modules: ['qwen_tts', 'soundfile'],              torchTags: ['cu130', 'cu126', 'cpu'] },
  // torch==2.6.0 has no CUDA 13 build and no Blackwell (RTX 50) kernels -> CPU there
  chatterbox: { label: 'Chatterbox',   modules: ['chatterbox.tts', 'soundfile'],        torchTags: ['cu126', 'cpu'], maxComputeCap: 9.0 },
  f5tts:      { label: 'F5-TTS',       modules: ['f5_tts.api', 'soundfile'],            torchTags: ['cu130', 'cu126', 'cpu'] },
  xtts:       { label: 'XTTS-v2',      modules: ['TTS.tts.models.xtts', 'soundfile'],   torchTags: ['cu130', 'cu126', 'cpu'] },
  // Svara-TTS: Llama-3.2-3B + SNAC codec (transformers 4.46+), compatible with the shared group.
  svara:      { label: 'Svara-TTS',    modules: ['snac', 'transformers', 'soundfile'], torchTags: ['cu130', 'cu126', 'cpu'] },
  // Sooktam-2 ships its own patched f5_tts and pins torch==2.6.0 + transformers==4.41.2 (own environment).
  sooktam:    { label: 'Sooktam-2',    modules: ['transformers', 'soundfile', 'vocos', 'x_transformers', 'indic_nlp_library'], torchTags: ['cu126', 'cpu'], maxComputeCap: 9.0 },
  // Urdu Tortoise: tortoise-tts 3.0.0 pins transformers==4.31.0 (own environment).
  'urdu-tortoise': { label: 'Urdu Tortoise TTS', modules: ['tortoise.api', 'soundfile'], torchTags: ['cu130', 'cu126', 'cpu'] },
  // Dubbing: Whisper (faster-whisper) + NLLB translation + Demucs voice/music separation + ffmpeg.
  // demucs/torchaudio need torch 2.6-era APIs, so no CUDA 13 build is offered.
  dub:        { label: 'Dubbing (speech recognition, translation, separation)', modules: ['faster_whisper', 'transformers', 'demucs', 'imageio_ffmpeg', 'soundfile'], torchTags: ['cu126', 'cpu'], maxComputeCap: 9.0 },
  parler:     { label: 'Parler-TTS',   modules: ['parler_tts', 'soundfile'],            torchTags: ['cu130', 'cu126', 'cpu'] },
};

const TAG_RANK = { cpu: 0, cu126: 1, cu130: 2 };

/* --------------------------------- utils --------------------------------- */

const normName = (n) => String(n || '').toLowerCase().replace(/[-_.]+/g, '-');

/**
 * Merges several requirement files into one: lines for the same package are combined
 * (extras united, version specifiers joined) so pip never sees "double requirement" errors.
 */
function mergeRequirements(texts) {
  const byName = new Map();
  const passthrough = [];
  for (const text of texts) {
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.split(' #')[0].trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('-') || /[:@/]/.test(line.split(/[<>=!~;]/)[0])) { if (!passthrough.includes(line)) passthrough.push(line); continue; }
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*([^;]*)(;.*)?$/.exec(line);
      if (!m) { if (!passthrough.includes(line)) passthrough.push(line); continue; }
      const key = normName(m[1]);
      const entry = byName.get(key) || { name: m[1], extras: new Set(), specs: new Set(), marker: m[4] || '' };
      if (m[2]) m[2].slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => entry.extras.add(x));
      (m[3] || '').split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => entry.specs.add(x));
      byName.set(key, entry);
    }
  }
  const lines = [...byName.values()].map((e) => `${e.name}${e.extras.size ? `[${[...e.extras].join(',')}]` : ''}${e.specs.size ? [...e.specs].join(',') : ''}${e.marker}`);
  return [...passthrough, ...lines].join('\n') + '\n';
}

/** Short, readable reason from pip's output (drops the huge "(from versions: ...)" lists). */
function summarizePipError(out) {
  const lines = String(out).split(/\r?\n/).map((l) => l.replace(/\(from versions:[^)]*\)/g, '').replace(/^ERROR:\s*/, '').trim()).filter(Boolean);
  const picks = lines.filter((l) => /could not find a version|no matching distribution|cannot install|conflict|depends on|requires|resolutionimpossible|double requirement/i.test(l));
  const text = (picks.length ? picks : lines.slice(-3)).slice(0, 3).join(' | ');
  return text.length > 260 ? text.slice(0, 257) + '...' : text;
}

function envLetter(n) { return String.fromCharCode(65 + (n % 26)); }

const isWin = () => process.platform === 'win32';

function platformTriple() {
  const { platform, arch } = process;
  if (platform === 'win32') return arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  if (platform === 'darwin') return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  return arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchText(url, signal, timeoutMs = 20000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const relay = () => ac.abort();
  if (signal) signal.addEventListener('abort', relay, { once: true });
  try {
    const res = await engine.fetch(url, { headers: { 'User-Agent': 'local-ai-voice-studio' }, redirect: 'follow', signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', relay);
  }
}

/** Runs a command; streams output lines; kills the process when `signal` aborts. */
function run(cmd, args, { cwd, env, signal, onLine, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_INPUT: '1', ...(env || {}) } });
    } catch (err) {
      return reject(err);
    }
    const feed = (d) => {
      const text = d.toString();
      out = (out + text).slice(-12000);
      if (onLine) for (const line of text.split(/\r?\n/)) if (line.trim()) onLine(line);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    const kill = () => { try { child.kill(); } catch { /* gone */ } };
    if (signal) {
      if (signal.aborted) kill();
      else signal.addEventListener('abort', kill, { once: true });
    }
    const timer = timeoutMs ? setTimeout(kill, timeoutMs) : null;
    child.on('error', (err) => { if (timer) clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', kill);
      if (signal && signal.aborted) return reject(engine.abortError());
      resolve({ code, out });
    });
  });
}

/* ------------------------------ GPU / PyTorch ---------------------------- */

function versionNum(v) {
  const m = /^(\d+)(?:\.(\d+))?/.exec(String(v || ''));
  return m ? Number(m[1]) + Number(m[2] || 0) / 100 : 0;
}

/** Maps an NVIDIA driver version to the newest CUDA it supports (fallback when nvidia-smi does not say). */
function cudaFromDriver(driver) {
  const major = Number(String(driver || '').split('.')[0]);
  if (major >= 580) return 13.0;
  if (major >= 570) return 12.8;
  if (major >= 560) return 12.6;
  if (major >= 550) return 12.4;
  if (major >= 525) return 12.0;
  return 0;
}

let gpuCache = null;
function detectGpu(runner = spawnSync) {
  // nvidia-smi is slow on some machines and spawnSync blocks the app: look once, remember for 5 minutes.
  if (runner === spawnSync && gpuCache && Date.now() - gpuCache.at < 5 * 60 * 1000) return gpuCache.value;
  const value = detectGpuUncached(runner);
  if (runner === spawnSync) gpuCache = { at: Date.now(), value };
  return value;
}

function detectGpuUncached(runner = spawnSync) {
  const tryRun = (args) => {
    try {
      const r = runner('nvidia-smi', args, { encoding: 'utf8', timeout: 4000, windowsHide: true });
      return r && r.status === 0 ? String(r.stdout || '') : null;
    } catch {
      return null;
    }
  };
  let csv = tryRun(['--query-gpu=name,driver_version,memory.total,compute_cap', '--format=csv,noheader,nounits']);
  let hasCap = true;
  if (!csv) {
    csv = tryRun(['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits']);
    hasCap = false;
  }
  if (!csv) return null;
  const first = csv.split(/\r?\n/).find((l) => l.trim());
  if (!first) return null;
  const parts = first.split(',').map((s) => s.trim());
  const plain = tryRun([]) || '';
  const m = /CUDA Version:\s*([\d.]+)/.exec(plain);
  return {
    name: parts[0],
    driver: parts[1],
    memoryMB: Number(parts[2]) || 0,
    computeCap: hasCap ? Number(parts[3]) || null : null,
    maxCuda: m ? versionNum(m[1]) : cudaFromDriver(parts[1]),
    count: csv.split(/\r?\n/).filter((l) => l.trim()).length,
  };
}

/**
 * Chooses the PyTorch wheel flavour. Returns { tag, device, note, needsDriverUpdate }.
 * tag: 'cu130' | 'cu126' | 'cpu' | 'default' (macOS).
 */
function pickTorchTag({ gpu, platform = process.platform, spec = {}, override }) {
  const allowed = spec.torchTags || ['cu130', 'cu126', 'cpu'];
  if (override && override !== 'auto') {
    return { tag: override, device: override === 'cpu' ? 'CPU' : 'GPU (manual)', note: 'Manually selected PyTorch build.' };
  }
  if (platform === 'darwin') return { tag: 'default', device: 'Apple Silicon / CPU', note: 'macOS uses the standard PyTorch build (MPS acceleration when available).' };
  if (!gpu) return { tag: 'cpu', device: 'CPU', note: 'No NVIDIA GPU detected - installing the CPU build (works everywhere, slower).' };

  const cc = gpu.computeCap || 8.0;
  let tag = null;
  if (gpu.maxCuda >= 13.0 && cc >= 7.5) tag = 'cu130';
  else if (gpu.maxCuda >= 12.6) tag = 'cu126';
  if (!tag) {
    return {
      tag: 'cpu', device: 'CPU', needsDriverUpdate: true,
      note: `Your NVIDIA driver (${gpu.driver}) is too old for current PyTorch GPU builds. Update it from nvidia.com/drivers to use ${gpu.name}; installing the CPU build for now.`,
    };
  }
  if (!allowed.includes(tag)) {
    const lower = allowed.filter((t) => t !== 'cpu' && TAG_RANK[t] <= TAG_RANK[tag]).sort((a, b) => TAG_RANK[b] - TAG_RANK[a]);
    tag = lower[0] || 'cpu';
  }
  if (tag !== 'cpu' && spec.maxComputeCap && cc > spec.maxComputeCap) {
    return { tag: 'cpu', device: 'CPU', note: `This model pins an older PyTorch that has no kernels for ${gpu.name} (compute ${cc}); it will run on the CPU. Other models can still use your GPU.` };
  }
  return { tag, device: `${gpu.name} (${tag})`, note: `NVIDIA ${gpu.name}, driver ${gpu.driver}: installing PyTorch ${tag}. The CUDA runtime is bundled - no separate CUDA Toolkit needed.` };
}

/* --------------------------------- manager ------------------------------- */

class RuntimeManager {
  /**
   * @param {object} o
   * @param {string} o.root        runtime folder (e.g. <userData>/runtime)
   * @param {string} o.backendDir  folder containing requirements/*.txt and check_env.py
   * @param {(evt:object)=>void} [o.emit]
   * @param {object} [o.specs]     override engine table (tests)
   */
  constructor({ root, backendDir, emit, specs, maxBytesPerSec = 0, proxy = '' }) {
    this.proxy = proxy;
    this.root = root;
    this.backendDir = backendDir;
    this.emitFn = emit || (() => {});
    this.specs = specs || ENGINE_SPECS;
    this.maxBytesPerSec = maxBytesPerSec;
    this.job = null;
    this.lastEmit = 0;
    this.sizeCache = new Map();
  }

  /* ---- paths ---- */
  get pythonDir() { return path.join(this.root, 'python'); }
  get basePython() { return isWin() ? path.join(this.pythonDir, 'python.exe') : path.join(this.pythonDir, 'bin', 'python3'); }
  get indexPath() { return path.join(this.root, 'envs.json'); }
  envDir(envId) { return path.join(this.root, 'envs', envId); }
  enginePythonPath(envId) { return isWin() ? path.join(this.envDir(envId), 'Scripts', 'python.exe') : path.join(this.envDir(envId), 'bin', 'python'); }
  wheelsDir(envId) { return path.join(this.root, 'wheels', envId); }
  statePath(envId) { return path.join(this.envDir(envId), '.tts-env.json'); }
  logPath(adapter) { return path.join(this.root, 'logs', `${adapter}.log`); }
  requirementsFile(adapter) { return path.join(this.backendDir, 'requirements', `${adapter}.txt`); }

  /* ---- environment registry (which model lives in which shared environment) ---- */

  /**
   * envs.json: { version, envs: { [id]: { torchTag, adapters: [..] } }, pending: { [adapter]: { envId } } }
   * Environments made by older versions (one folder per model) are adopted automatically.
   */
  loadIndex() {
    let index = null;
    try { index = JSON.parse(fs.readFileSync(this.indexPath, 'utf8')); } catch { /* first run or legacy */ }
    if (!index || index.version !== 2) {
      index = { version: 2, envs: {}, pending: {} };
      try {
        for (const dir of fs.readdirSync(path.join(this.root, 'envs'))) {
          const sp = path.join(this.root, 'envs', dir, '.tts-env.json');
          if (!fs.existsSync(sp)) continue;
          const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
          if (st && st.adapter) index.envs[dir] = { torchTag: st.torchTag || 'cpu', adapters: [st.adapter], legacy: true };
        }
      } catch { /* nothing to adopt */ }
      if (Object.keys(index.envs).length) this.saveIndex(index);
    }
    index.envs = index.envs || {};
    index.pending = index.pending || {};
    return index;
  }

  saveIndex(index) {
    fs.mkdirSync(this.root, { recursive: true });
    const tmp = `${this.indexPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(index, null, 2), 'utf8');
    fs.renameSync(tmp, this.indexPath);
  }

  envOf(adapter, index = this.loadIndex()) {
    return Object.keys(index.envs).find((id) => (index.envs[id].adapters || []).includes(adapter)) || null;
  }

  envLabel(envId, index = this.loadIndex()) {
    const env = index.envs[envId];
    if (env && env.legacy && env.adapters.length === 1) return this.specs[env.adapters[0]] ? this.specs[env.adapters[0]].label + ' environment' : envId;
    const keys = Object.keys(index.envs);
    const n = keys.indexOf(envId);
    return `Environment ${envLetter(n < 0 ? keys.length : n)}`;
  }

  readState(envId) {
    try { return JSON.parse(fs.readFileSync(this.statePath(envId), 'utf8')); } catch { return null; }
  }

  adapterHash(state, adapter) {
    if (!state) return undefined;
    if (state.adapters && state.adapters[adapter]) return state.adapters[adapter].requirementsHash;
    return state.adapter === adapter ? state.requirementsHash : undefined; // environment made by an older version
  }

  /** Python to run the backend for `adapter`, or null when it is not installed yet. */
  enginePython(adapter) {
    const index = this.loadIndex();
    const envId = this.envOf(adapter, index);
    if (!envId) return null;
    const p = this.enginePythonPath(envId);
    return fs.existsSync(p) && this.readState(envId) ? p : null;
  }

  async requirementsHash(adapter) {
    try {
      return crypto.createHash('sha1').update(await fsp.readFile(this.requirementsFile(adapter))).digest('hex').slice(0, 16);
    } catch {
      return '';
    }
  }

  async dirSize(dir, deadline) {
    let total = 0;
    const walk = async (d) => {
      if (Date.now() > deadline) return;
      let entries;
      try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
      await Promise.all(entries.map(async (e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile()) { try { const size = (await fsp.stat(p)).size; total += size; } catch { /* vanished */ } }
      }));
    };
    await walk(dir);
    return Date.now() > deadline ? null : total;
  }

  /** Size of an environment, remembered for 2 minutes; null while it is still being measured. */
  async envSize(envId) {
    const hit = this.sizeCache.get(envId);
    if (hit && Date.now() - hit.at < 120000) return hit.bytes;
    const measuring = this.dirSize(this.envDir(envId), Date.now() + 60000).then((bytes) => {
      if (bytes != null) this.sizeCache.set(envId, { at: Date.now(), bytes });
      return bytes;
    });
    return Promise.race([measuring, new Promise((r) => setTimeout(() => r(null), 1200))]);
  }

  /* ---- status ---- */
  async status() {
    const gpu = detectGpu();
    const index = this.loadIndex();
    let pythonVersion = null;
    if (await exists(this.basePython)) {
      const r = spawnSync(this.basePython, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
      if (r.status === 0) pythonVersion = String(r.stdout || r.stderr).trim().replace(/^Python\s+/i, '');
    }

    const envs = [];
    for (const [id, env] of Object.entries(index.envs)) {
      const st = this.readState(id);
      envs.push({
        id,
        label: this.envLabel(id, index),
        adapters: env.adapters,
        adapterLabels: env.adapters.map((a) => (this.specs[a] ? this.specs[a].label : a)),
        torchTag: env.torchTag,
        torch: st && st.torch ? st.torch : null,
        sizeBytes: await this.envSize(id),
        ready: Boolean(st) && (await exists(this.enginePythonPath(id))),
      });
    }

    const engines = {};
    for (const [adapter, spec] of Object.entries(this.specs)) {
      const envId = this.envOf(adapter, index);
      const st = envId ? this.readState(envId) : null;
      const ready = Boolean(st) && (await exists(this.enginePythonPath(envId)));
      const currentHash = await this.requirementsHash(adapter);
      const pick = pickTorchTag({ gpu, spec });
      const mates = envId ? index.envs[envId].adapters.filter((a) => a !== adapter) : [];
      engines[adapter] = {
        label: spec.label,
        ready,
        envId,
        envLabel: envId ? this.envLabel(envId, index) : null,
        sharedWith: mates.map((a) => (this.specs[a] ? this.specs[a].label : a)),
        needsUpdate: ready && this.adapterHash(st, adapter) !== currentHash,
        torch: st && st.torch ? st.torch : null,
        installedTorchTag: envId ? index.envs[envId].torchTag : null,
        plannedTorchTag: pick.tag,
        device: pick.device,
        note: pick.note,
        needsDriverUpdate: Boolean(pick.needsDriverUpdate),
      };
    }
    let vc = { required: isWin(), installed: true };
    if (isWin()) vc.installed = await this.hasVcRuntime();
    let free = null;
    try {
      const st = await fsp.statfs(await this.nearestExisting(this.root));
      free = Number(st.bavail) * Number(st.bsize);
    } catch { /* unknown */ }
    return {
      platform: process.platform,
      arch: process.arch,
      root: this.root,
      freeBytes: free,
      pythonReady: Boolean(pythonVersion),
      pythonVersion,
      gpu,
      vcRuntime: vc,
      engines,
      envs,
      proxy: this.proxy || '',
      running: this.job ? this.snapshot() : null,
    };
  }

  async nearestExisting(p) {
    let cur = p;
    while (!(await exists(cur))) {
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    return cur;
  }

  async hasVcRuntime() {
    if (!isWin()) return true;
    try {
      const arch = process.arch === 'arm64' ? 'ARM64' : 'x64';
      const r = spawnSync('reg', ['query', `HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\${arch}`, '/v', 'Installed'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
      return r.status === 0 && /0x1/.test(String(r.stdout));
    } catch {
      return false;
    }
  }

  /* ---- job plumbing ---- */
  snapshot() {
    const j = this.job;
    if (!j) return null;
    const totalW = j.steps.reduce((s, x) => s + x.weight, 0) || 1;
    const overall = j.steps.reduce((s, x) => s + x.weight * (x.status === 'done' || x.status === 'skipped' ? 100 : x.percent || 0), 0) / totalW;
    return {
      adapter: j.adapter,
      state: j.state,
      message: j.message,
      error: j.error || null,
      overallPercent: Math.min(100, Math.round(overall * 10) / 10),
      speed: j.speed || 0,
      etaSeconds: j.eta == null ? null : Math.round(j.eta),
      downloadedBytes: j.downloaded || 0,
      totalBytes: j.total || 0,
      resumedBytes: j.resumed || 0,
      torch: j.torchPick || null,
      envId: j.envId || null,
      envLabel: j.envLabel || null,
      sharedWith: j.sharedWith || [],
      reuse: j.reuse || null,
      connections: j.connections || 0,
      avgSpeed: j.avgSpeed || 0,
      peakSpeed: j.peakSpeed || 0,
      elapsedSeconds: Math.round((Date.now() - j.startedAt) / 1000),
      logTail: (j.logTail || []).slice(-6),
      steps: j.steps.map(({ id, label, status, percent, detail }) => ({ id, label, status, percent: Math.round(percent || 0), detail: detail || '' })),
      files: (j.files || []).slice(0, 14),
    };
  }

  push(force = false) {
    const now = Date.now();
    if (!force && now - this.lastEmit < 150) return;
    this.lastEmit = now;
    this.emitFn({ type: 'progress', ...this.snapshot() });
  }

  setStep(id, patch, force = false) {
    const s = this.job.steps.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
    if (patch.detail) this.job.message = patch.detail;
    this.push(force);
  }

  async log(adapter, line) {
    try {
      await fsp.mkdir(path.dirname(this.logPath(adapter)), { recursive: true });
      await fsp.appendFile(this.logPath(adapter), `[${new Date().toISOString()}] ${line}\n`);
    } catch { /* logging must never break an install */ }
  }

  /** Remembers the last pip lines (shown in the UI so a slow step never looks frozen) and logs them. */

  noteLine(adapter, tag, line) {
    const clean = String(line).replace(/\u001b\[[0-9;]*m/g, '').trim();
    if (!clean) return;
    this.log(adapter, `${tag}: ${clean}`);
    if (this.job) {
      this.job.logTail.push(clean.slice(0, 220));
      if (this.job.logTail.length > 30) this.job.logTail.shift();
    }
  }

  /** Runs `fn` while refreshing the step text once a second with the elapsed time. */

  async withHeartbeat(stepId, baseText, fn) {
    const started = Date.now();
    const tick = () => {
      const s = this.job && this.job.steps.find((x) => x.id === stepId);
      if (!s || s.status !== 'running') return;
      const secs = Math.round((Date.now() - started) / 1000);
      this.setStep(stepId, { detail: `${typeof baseText === 'function' ? baseText() : baseText} - ${secs}s` });
    };
    const timer = setInterval(tick, 1000);
    try {
      return await fn();
    } finally {
      clearInterval(timer);
    }
  }

  /**
   * pip older than 26 downloads every package IN FULL during --dry-run (we measured 3.1 GB for
   * the Qwen3 set: minutes of silent, non-resumable downloading). Current pip fetches metadata
   * only (16 MB, 15 s). So the environment's pip is upgraded first.
   */

  /**
   * pip older than 26 downloads every package IN FULL during --dry-run (we measured 3.1 GB for
   * the Qwen3 set). Current pip fetches metadata only (16 MB, 15 s). So pip is upgraded first.
   */
  async ensureModernPip(adapter, stepId, signal, py) {
    let major = 0;
    try {
      const r = await run(py, ['-c', 'import pip;print(pip.__version__)'], { signal, timeoutMs: 30000 });
      major = parseInt(r.out.trim(), 10) || 0;
    } catch (err) {
      if (err && err.aborted) throw err;
    }
    if (major >= 26) return;
    this.setStep(stepId, { detail: 'Updating pip (the package installer)...' }, true);
    const r = await run(py, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
      signal, env: this.netEnv(), timeoutMs: 180000, onLine: (l) => this.noteLine(adapter, 'pip-upgrade', l),
    });
    if (r.code !== 0) await this.log(adapter, `pip upgrade failed (exit ${r.code}); continuing with bundled pip`);
  }

  netEnv() {
    const env = {};
    if (this.proxy) {
      env.HTTPS_PROXY = this.proxy;
      env.HTTP_PROXY = this.proxy;
      env.PIP_PROXY = this.proxy;
    }
    return env;
  }

  pause() {
    if (this.job && this.job.controller) {
      this.job.pausing = true;
      this.job.controller.abort();
      return true;
    }
    return false;
  }

  async cancel({ discard = false } = {}) {
    const adapter = this.job ? this.job.adapter : null;
    if (this.job && this.job.controller) {
      this.job.discard = discard;
      this.job.controller.abort();
    }
    const envId = this.job ? this.job.envId : null;
    if (discard && envId) await fsp.rm(this.wheelsDir(envId), { recursive: true, force: true });
    return true;
  }


  /* ---- install ---- */
  async install(adapter, { torchTag = 'auto', force = false } = {}) {
    const spec = this.specs[adapter];
    if (!spec) return { ok: false, error: `No runtime is defined for "${adapter}".` };
    if (this.job) return { ok: false, error: 'An installation is already running.' };

    const controller = new AbortController();
    const gpu = detectGpu();
    const pick = pickTorchTag({ gpu, spec, override: torchTag });
    const needVc = isWin() && !(await this.hasVcRuntime());
    const pythonReady = await exists(this.basePython);

    this.job = {
      adapter, controller, state: 'running', message: 'Starting...', torchPick: pick, files: [], startedAt: Date.now(), logTail: [],
      steps: [
        { id: 'vc', label: 'Microsoft Visual C++ runtime', weight: 4, status: needVc ? 'pending' : 'skipped' },
        { id: 'python', label: `Portable Python ${PYTHON_SERIES} (shared by all models)`, weight: 14, status: pythonReady ? 'skipped' : 'pending' },
        { id: 'resolve', label: 'Find a compatible environment and see what is missing', weight: 10, status: 'pending' },
        { id: 'download', label: 'Download only the missing packages (fast, resumable)', weight: 56, status: 'pending' },
        { id: 'install', label: 'Install packages', weight: 12, status: 'pending' },
        { id: 'verify', label: 'Verify everything works', weight: 4, status: 'pending' },
      ],
    };
    this.push(true);
    await this.log(adapter, `install start: adapter=${adapter} torch=${pick.tag} force=${force}`);

    const signal = controller.signal;
    try {
      const reqHash = await this.requirementsHash(adapter);
      const index = this.loadIndex();
      const existing = this.envOf(adapter, index);
      if (!force && existing) {
        const st = this.readState(existing);
        if (st && this.adapterHash(st, adapter) === reqHash && (await exists(this.enginePythonPath(existing)))) {
          this.job.envId = existing;
          this.job.envLabel = this.envLabel(existing, index);
          for (const s of this.job.steps) s.status = 'done';
          this.job.state = 'done';
          this.job.message = `${spec.label} is already installed and up to date.`;
          this.push(true);
          return this.finish({ ok: true, upToDate: true });
        }
      }

      if (needVc) await this.stepVcRuntime(signal);
      if (!pythonReady) await this.stepPython(signal);

      const plan = await this.stepChooseEnvironment(adapter, spec, pick, gpu, reqHash, signal);
      await this.stepDownload(plan.envId, plan.wheels, signal);
      await this.withHeartbeat('install', 'Installing packages', () => this.stepInstall(adapter, plan, signal));
      const torchInfo = await this.stepVerify(adapter, spec, plan, reqHash, signal);

      await fsp.rm(this.wheelsDir(plan.envId), { recursive: true, force: true }); // free the disk
      this.job.state = 'done';
      this.job.message = `${spec.label} is ready${plan.shared ? ` (added to the shared ${this.job.envLabel}; PyTorch and common libraries were reused)` : ''}.${torchInfo && torchInfo.cuda ? ' GPU acceleration is available.' : ''}`;
      this.push(true);
      return this.finish({ ok: true, torch: torchInfo, envId: plan.envId, shared: plan.shared });
    } catch (err) {
      if (err && err.aborted) {
        const discarded = this.job.discard;
        this.job.state = discarded ? 'cancelled' : 'paused';
        this.job.message = discarded ? 'Cancelled.' : 'Paused - your progress is saved. Press Resume to continue where it stopped.';
        for (const s of this.job.steps) if (s.status === 'running') s.status = 'paused';
        this.push(true);
        await this.log(adapter, this.job.state);
        return this.finish({ ok: false, paused: !discarded, cancelled: discarded });
      }
      const message = err && err.message ? err.message : String(err);
      this.job.state = 'error';
      this.job.error = message;
      this.job.message = message;
      for (const s of this.job.steps) if (s.status === 'running') s.status = 'error';
      this.push(true);
      await this.log(adapter, `ERROR: ${message}`);
      return this.finish({ ok: false, error: message });
    }
  }

  finish(result) {
    const snap = this.snapshot();
    this.emitFn({ type: 'finished', ...snap, result });
    this.job = null;
    return result;
  }

  /* ---- steps ---- */
  async stepVcRuntime(signal) {
    this.setStep('vc', { status: 'running', percent: 0, detail: 'Downloading Microsoft Visual C++ runtime...' }, true);
    const file = process.arch === 'arm64' ? 'vc_redist.arm64.exe' : 'vc_redist.x64.exe';
    const dest = path.join(this.root, 'downloads', file);
    await engine.downloadFile({ url: `https://aka.ms/vs/17/release/${file}`, dest, name: file }, {
      signal,
      onProgress: (p) => this.setStep('vc', { percent: p.total ? (p.done / p.total) * 90 : 0 }),
    });
    this.setStep('vc', { percent: 92, detail: 'Installing Visual C++ runtime (Windows may ask for permission)...' }, true);
    const r = await run(dest, ['/install', '/quiet', '/norestart'], { signal });
    // 0 ok, 1638 newer version present, 3010 ok but restart recommended
    if (![0, 1638, 3010].includes(r.code)) {
      throw new Error(`The Visual C++ runtime installer failed (code ${r.code}). Install it manually from https://aka.ms/vs/17/release/${file} and try again.`);
    }
    await fsp.rm(dest, { force: true });
    this.setStep('vc', { status: 'done', percent: 100, detail: r.code === 3010 ? 'Installed (a restart may be needed).' : 'Installed.' }, true);
  }

  async resolvePythonAsset(signal) {
    const triple = platformTriple();
    try {
      const latest = JSON.parse(await fetchText(PBS_LATEST, signal));
      const sums = await fetchText(`${latest.asset_url_prefix}/SHA256SUMS`, signal);
      const re = new RegExp(`^([0-9a-f]{64})\\s+(cpython-${PYTHON_SERIES.replace('.', '\\.')}\\.(\\d+)\\+${latest.tag}-${triple}-install_only\\.tar\\.gz)$`, 'm');
      const lines = sums.split(/\r?\n/).map((l) => re.exec(l)).filter(Boolean).sort((a, b) => Number(b[3]) - Number(a[3]));
      if (lines.length) {
        const [, sha, name] = lines[0];
        return { url: `${latest.asset_url_prefix}/${encodeURIComponent(name)}`, name, sha256: sha, source: 'latest' };
      }
    } catch (err) {
      if (err && err.aborted) throw err;
      /* fall through to the pinned release */
    }
    const pinned = PBS_PINNED.files[triple];
    if (!pinned) throw new Error(`No portable Python build is available for this platform (${triple}).`);
    return { url: `${PBS_BASE}/${PBS_PINNED.tag}/${encodeURIComponent(pinned[0])}`, name: pinned[0], sha256: pinned[1], source: 'pinned' };
  }

  async stepPython(signal) {
    this.setStep('python', { status: 'running', percent: 0, detail: 'Finding the portable Python build...' }, true);
    const asset = await this.resolvePythonAsset(signal);
    const archive = path.join(this.root, 'downloads', asset.name);
    this.setStep('python', { detail: `Downloading Python (${asset.name})...` }, true);
    await engine.downloadFile({ url: asset.url, dest: archive, sha256: asset.sha256, name: asset.name }, {
      signal,
      opts: { maxBytesPerSec: this.maxBytesPerSec },
      onProgress: (p) => {
        this.job.speed = p.speed || this.job.speed;
        this.setStep('python', { percent: p.total ? (p.done / p.total) * 85 : 0, detail: p.phase === 'verifying' ? 'Verifying download...' : `Downloading Python ${p.total ? Math.round((p.done / p.total) * 100) : 0}%` });
      },
    });
    this.setStep('python', { percent: 88, detail: 'Unpacking Python...' }, true);
    const tmp = path.join(this.root, '_extract');
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(tmp, { recursive: true });
    const r = await run('tar', ['-xzf', archive, '-C', tmp], { signal });
    if (r.code !== 0) throw new Error(`Could not unpack Python (tar exit ${r.code}). ${r.out.slice(-300)}`);
    await fsp.rm(this.pythonDir, { recursive: true, force: true });
    await fsp.rename(path.join(tmp, 'python'), this.pythonDir);
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.rm(archive, { force: true });
    const check = await run(this.basePython, ['--version'], { signal });
    if (check.code !== 0) throw new Error(`The unpacked Python does not start: ${check.out.slice(-300)}`);
    this.setStep('python', { status: 'done', percent: 100, detail: `Python ${check.out.trim().replace(/^Python\s+/i, '')} ready.` }, true);
  }

  pipIndexArgs(pick) {
    return pick.tag && pick.tag !== 'default' ? ['--extra-index-url', `https://download.pytorch.org/whl/${pick.tag}`] : [];
  }


  /** Creates an empty environment with a modern pip. */
  async createEnv(adapter, envId, signal) {
    await fsp.rm(this.envDir(envId), { recursive: true, force: true });
    const r = await run(this.basePython, ['-m', 'venv', this.envDir(envId)], { signal });
    if (r.code !== 0) throw new Error(`Could not create the environment: ${r.out.slice(-400)}`);
    await this.ensureModernPip(adapter, 'resolve', signal, this.enginePythonPath(envId));
  }

  async listInstalled(py, signal) {
    const r = await run(py, ['-m', 'pip', 'list', '--format=json', '--disable-pip-version-check'], { signal, timeoutMs: 60000 });
    const map = new Map();
    try { for (const p of JSON.parse(r.out.slice(r.out.indexOf('[')))) map.set(normName(p.name), p.version); } catch { /* empty env */ }
    return map;
  }

  nextEnvId(index) {
    for (let i = 0; i < 26; i++) {
      const id = `env-${String.fromCharCode(97 + i)}`;
      if (!index.envs[id] && !fs.existsSync(this.envDir(id))) return id;
    }
    return `env-${Date.now()}`;
  }

  /**
   * Asks pip's real resolver what installing `adapter` into `envId` would do.
   * Compatible = it resolves AND it would not change any package that is already installed
   * (that would break the models living there). Returns { ok, wheels, reused, conflicts }.
   */
  async planInEnv(adapter, envId, tag, index, signal) {
    const py = this.enginePythonPath(envId);
    const wdir = this.wheelsDir(envId);
    await fsp.mkdir(wdir, { recursive: true });
    await this.ensureModernPip(adapter, 'resolve', signal, py);

    const members = (index.envs[envId] ? index.envs[envId].adapters : []).filter((a) => a !== adapter);
    const texts = [];
    for (const a of [...members, adapter]) { try { texts.push(await fsp.readFile(this.requirementsFile(a), 'utf8')); } catch { /* missing file */ } }
    const reqFile = path.join(wdir, 'requirements.txt');
    await fsp.writeFile(reqFile, mergeRequirements(texts), 'utf8');

    const installed = await this.listInstalled(py, signal);
    const report = path.join(wdir, 'report.json');
    await fsp.rm(report, { force: true });
    const args = ['-m', 'pip', 'install', '--dry-run', '--progress-bar', 'raw', '--report', report, '-r', reqFile, ...this.pipIndexArgs({ tag })];

    let seen = 0;
    let current = 'Contacting the package servers';
    let rawBytes = 0, rawTotal = 0, rawLast = { t: Date.now(), b: 0 }, rawSpeed = 0;
    const started = Date.now();
    const text = () => (rawTotal > 0
      ? `pip is fetching a large file itself: ${(rawBytes / 1048576).toFixed(0)} of ${(rawTotal / 1048576).toFixed(0)} MB${rawSpeed > 0 ? ` at ${(rawSpeed / 1048576).toFixed(1)} MB/s` : ''}`
      : `${current} (${seen} packages checked)`);
    const r = await this.withHeartbeat('resolve', text, () => run(py, args, {
      signal, cwd: wdir, env: this.netEnv(), timeoutMs: 20 * 60 * 1000,
      onLine: (l) => {
        this.noteLine(adapter, 'resolve', l);
        const raw = /^Progress (\d+) of (\d+)/.exec(l);
        if (raw) {
          rawBytes = Number(raw[1]); rawTotal = Number(raw[2]);
          const now = Date.now();
          if (now - rawLast.t >= 1000) { rawSpeed = ((rawBytes - rawLast.b) / (now - rawLast.t)) * 1000; rawLast = { t: now, b: rawBytes }; }
          this.job.speed = rawSpeed;
          return;
        }
        rawTotal = 0;
        const collecting = /^Collecting ([^\s<>=!;\[]+)/.exec(l);
        if (collecting) { seen += 1; current = `Checking ${collecting[1]}`; }
        const dl = /^Downloading (\S+)/.exec(l);
        if (dl) current = `Reading ${dl[1].replace(/\.metadata$/, '')}`;
        const secs = (Date.now() - started) / 1000;
        this.setStep('resolve', { percent: Math.min(92, 5 + 87 * (1 - Math.exp(-secs / 40))) });
      },
    }));
    this.job.speed = 0;
    if (r.code === null) {
      throw new Error('Working out the package list took more than 20 minutes and was stopped. Check your internet connection (or proxy/VPN) and press Resume.');
    }
    if (r.code !== 0) {
      return { ok: false, conflicts: [summarizePipError(r.out) || `pip could not combine the requirements (exit ${r.code})`] };
    }

    const data = JSON.parse(await fsp.readFile(report, 'utf8'));
    const wheels = [];
    const conflicts = [];
    for (const item of data.install || []) {
      const info = item.download_info || {};
      const url = info.url || '';
      const name = item.metadata.name;
      const version = item.metadata.version;
      const have = installed.get(normName(name));
      if (have && have !== version) conflicts.push(`${name} ${have} -> ${version}`);
      if (!url || url.startsWith('file:')) continue;
      const hash = (info.archive_info && info.archive_info.hashes && info.archive_info.hashes.sha256) ||
        (info.archive_info && info.archive_info.hash && info.archive_info.hash.replace(/^sha256=/, '')) || undefined;
      const file = decodeURIComponent(path.posix.basename(new URL(url).pathname));
      wheels.push({ name, version, url, sha256: hash, file, isWheel: file.endsWith('.whl') });
    }
    if (conflicts.length) return { ok: false, conflicts, reqFile };
    return { ok: true, wheels, reqFile, reused: installed.size };
  }

  /**
   * Chooses where `adapter` lives: an existing environment it is compatible with (PyTorch,
   * CUDA libraries and common packages are reused, only missing packages download) or a new
   * one when its libraries need different versions.
   */
  async stepChooseEnvironment(adapter, spec, pick, gpu, reqHash, signal) {
    this.setStep('resolve', { status: 'running', percent: 3, detail: 'Looking at the environments already installed...' }, true);
    const index = this.loadIndex();
    const wantTag = pick.tag;

    let candidates = [];
    const pending = index.pending[adapter];
    if (pending && (await exists(this.enginePythonPath(pending.envId)))) {
      candidates = [pending.envId]; // resuming an interrupted install: keep the same decision
    } else {
      candidates = Object.keys(index.envs).filter((id) => {
        const env = index.envs[id];
        const st = this.readState(id);
        return st && env.torchTag === wantTag && !env.legacy;
      });
      // environments made by older versions hold one model each: they can be shared too
      for (const id of Object.keys(index.envs)) {
        const env = index.envs[id];
        if (env.legacy && env.torchTag === wantTag && this.readState(id) && !candidates.includes(id)) candidates.push(id);
      }
    }

    for (const envId of candidates) {
      const label = this.envLabel(envId, index);
      this.setStep('resolve', { detail: `Checking whether ${spec.label} fits into ${label}...` }, true);
      const plan = await this.planInEnv(adapter, envId, index.envs[envId].torchTag, index, signal);
      if (plan.ok) {
        index.pending[adapter] = { envId };
        this.saveIndex(index);
        const mates = index.envs[envId].adapters.filter((a) => a !== adapter).map((a) => (this.specs[a] ? this.specs[a].label : a));
        Object.assign(this.job, { envId, envLabel: label, sharedWith: mates, reuse: { packagesAlreadyThere: plan.reused, packagesToAdd: plan.wheels.length } });
        await this.log(adapter, `shared environment ${envId}: reusing ${plan.reused} packages, adding ${plan.wheels.length}`);
        this.setStep('resolve', { status: 'done', percent: 100, detail: `Fits into ${label} (shared with ${mates.join(', ') || 'nobody yet'}). ${plan.reused} packages are reused; ${plan.wheels.length} to add.` }, true);
        return { envId, wheels: plan.wheels, reqFile: plan.reqFile, shared: mates.length > 0, tag: index.envs[envId].torchTag };
      }
      await this.log(adapter, `not compatible with ${envId}: ${plan.conflicts.join('; ')}`);
      this.setStep('resolve', { detail: `${spec.label} needs different library versions than ${label} (${plan.conflicts[0].slice(0, 110)}). It gets its own environment.` }, true);
    }

    // No compatible environment: make a new one for this model (and anything compatible later).
    const envId = (pending && pending.envId && !index.envs[pending.envId]) ? pending.envId : this.nextEnvId(index);
    index.pending[adapter] = { envId };
    this.saveIndex(index);
    const label = `Environment ${envLetter(Object.keys(index.envs).length)}`;
    this.setStep('resolve', { detail: `Creating ${label} for ${spec.label}...`, percent: 10 }, true);
    if (!(await exists(this.enginePythonPath(envId)))) await this.createEnv(adapter, envId, signal);
    const plan = await this.planInEnv(adapter, envId, wantTag, { ...index, envs: { ...index.envs, [envId]: { torchTag: wantTag, adapters: [] } } }, signal);
    if (!plan.ok) {
      throw new Error(`Could not work out a compatible set of packages for ${spec.label}: ${plan.conflicts.join(' | ')}`);
    }
    Object.assign(this.job, { envId, envLabel: label, sharedWith: [], reuse: { packagesAlreadyThere: 0, packagesToAdd: plan.wheels.length } });
    this.setStep('resolve', { status: 'done', percent: 100, detail: `${plan.wheels.length} packages for ${label}.` }, true);
    return { envId, wheels: plan.wheels, reqFile: plan.reqFile, shared: false, tag: wantTag, fresh: true };
  }

  async stepDownload(envId, wheels, signal) {
    if (!wheels.length) {
      this.setStep('download', { status: 'done', percent: 100, detail: 'Nothing to download.' }, true);
      return;
    }
    this.setStep('download', { status: 'running', percent: 0, detail: `Connecting to the servers for ${wheels.length} files...` }, true);
    const wdir = this.wheelsDir(envId);
    const jobs = wheels.map((w) => ({ url: w.url, dest: path.join(wdir, w.file), sha256: w.sha256, name: w.file }));
    await engine.downloadAll(jobs, {
      signal,
      maxBytesPerSec: this.maxBytesPerSec,
      connectionsPerFile: 8,
      maxConnections: 16,
      fileConcurrency: 8,
      onPhase: (phase, info) => {
        if (phase === 'probing') this.setStep('download', { detail: `Checking ${info.done} of ${info.total} files on the servers...`, percent: 0 });
      },
      beforeStart: async ({ totalBytes, remainingBytes }) => {
        const free = (await engine.freeBytes(wdir));
        const need = remainingBytes * 2 + 1 * GiB; // wheels + their installed copy + headroom
        this.job.total = totalBytes;
        if (free < need) {
          const err = new Error(`Not enough free disk space: about ${(need / GiB).toFixed(1)} GB needed (downloads + installed files), only ${(free / GiB).toFixed(1)} GB free. Free some space and press Resume.`);
          err.fatal = true;
          throw err;
        }
      },
      onProgress: (p) => {
        const j = this.job;
        j.speed = p.speed;
        j.eta = p.etaSeconds;
        j.downloaded = p.doneBytes;
        j.total = p.totalBytes;
        j.resumed = p.resumedBytes;
        j.connections = p.connections || 0;
        j.peakSpeed = Math.max(j.peakSpeed || 0, p.speed || 0);
        j.avgSpeed = p.elapsedSeconds > 1 ? (p.doneBytes - p.resumedBytes) / p.elapsedSeconds : 0;
        j.files = p.files.filter((f) => f.status !== 'waiting').map((f) => ({ name: f.name, done: f.done, total: f.total, status: f.status, speed: Math.round(f.speed || 0) })).sort((a, b) => (a.status === 'done') - (b.status === 'done'));
        this.setStep('download', { percent: p.percent, detail: `${(p.doneBytes / GiB).toFixed(2)} of ${(p.totalBytes / GiB).toFixed(2)} GB${p.resumedBytes ? ` (resumed with ${(p.resumedBytes / GiB).toFixed(2)} GB already saved)` : ''}` });
      },
    });
    this.setStep('download', { status: 'done', percent: 100, detail: 'All packages downloaded and verified.' }, true);
    this.job.speed = 0;
    this.job.eta = null;
  }


  async stepInstall(adapter, plan, signal) {
    const py = this.enginePythonPath(plan.envId);
    const wdir = this.wheelsDir(plan.envId);
    this.setStep('install', { status: 'running', percent: 5, detail: 'Installing downloaded packages...' }, true);
    const onLine = (l) => {
      this.noteLine(adapter, 'pip', l);
      if (/Installing collected packages/i.test(l)) this.setStep('install', { percent: 40, detail: 'Installing packages...' });
      else if (/Successfully installed/i.test(l)) this.setStep('install', { percent: 70, detail: 'Packages installed.' });
    };
    const local = plan.wheels.filter((w) => w.isWheel).map((w) => `${w.name}==${w.version}`);
    for (let i = 0; i < local.length; i += 60) {
      const batch = local.slice(i, i + 60);
      const r = await run(py, ['-m', 'pip', 'install', '--no-deps', '--no-index', '--find-links', wdir, '--no-warn-script-location', ...batch], { signal, onLine, env: this.netEnv() });
      if (r.code !== 0) throw new Error(`Installing the downloaded packages failed (pip exit ${r.code}). ${r.out.split(/\r?\n/).filter(Boolean).slice(-6).join(' | ')}`);
    }
    // Finish anything that had no wheel (source-only packages) using normal pip.
    this.setStep('install', { percent: 75, detail: 'Finishing remaining packages...' }, true);
    const r2 = await run(py, ['-m', 'pip', 'install', '--no-warn-script-location', '-r', plan.reqFile, ...this.pipIndexArgs({ tag: plan.tag })], { signal, onLine, env: this.netEnv() });
    if (r2.code !== 0) throw new Error(`Finishing the installation failed (pip exit ${r2.code}). ${r2.out.split(/\r?\n/).filter(Boolean).slice(-6).join(' | ')}`);
    this.setStep('install', { status: 'done', percent: 100, detail: 'Packages installed.' }, true);
  }

  /** Imports the model's libraries for real, and the other models already living in this environment. */
  async stepVerify(adapter, spec, plan, reqHash, signal) {
    this.setStep('verify', { status: 'running', percent: 20, detail: 'Checking that everything imports (first check can take a moment)...' }, true);
    const index = this.loadIndex();
    const py = this.enginePythonPath(plan.envId);
    const mates = (index.envs[plan.envId] ? index.envs[plan.envId].adapters : []).filter((a) => a !== adapter);
    const modules = [...new Set([...spec.modules, ...mates.flatMap((a) => (this.specs[a] ? this.specs[a].modules : []))])];
    const r = await run(py, [path.join(this.backendDir, 'check_env.py'), modules.join(',')], { signal, timeoutMs: 240000 });
    let info = null;
    try { info = JSON.parse(r.out.trim().split(/\r?\n/).filter(Boolean).pop()); } catch { /* handled below */ }
    if (!info) throw new Error(`The environment check failed to run: ${r.out.slice(-400)}`);
    if (!info.ok) {
      const failed = Object.entries(info.modules || {}).filter(([, v]) => !v).map(([k]) => `${k}${info.errors && info.errors[k] ? ` (${info.errors[k]})` : ''}`);
      const torchProblem = info.torch && info.torch.error ? ` PyTorch problem: ${info.torch.error}` : '';
      throw new Error(`Installed, but not usable yet${failed.length ? `: cannot load ${failed.join('; ')}` : ''}.${torchProblem}`);
    }

    const state = this.readState(plan.envId) || { adapters: {} };
    state.adapters = state.adapters || {};
    if (state.adapter && !state.adapters[state.adapter]) state.adapters[state.adapter] = { requirementsHash: state.requirementsHash }; // adopt old state
    delete state.adapter; delete state.requirementsHash;
    state.adapters[adapter] = { requirementsHash: reqHash, installedAt: new Date().toISOString() };
    Object.assign(state, { envId: plan.envId, torchTag: plan.tag, torch: info.torch, python: info.python });
    await fsp.writeFile(this.statePath(plan.envId), JSON.stringify(state, null, 2), 'utf8');

    const idx = this.loadIndex();
    const env = idx.envs[plan.envId] || { torchTag: plan.tag, adapters: [] };
    delete env.legacy;
    env.torchTag = plan.tag;
    if (!env.adapters.includes(adapter)) env.adapters.push(adapter);
    idx.envs[plan.envId] = env;
    delete idx.pending[adapter];
    // an adapter lives in exactly one environment
    for (const [id, e] of Object.entries(idx.envs)) if (id !== plan.envId) e.adapters = e.adapters.filter((a) => a !== adapter);
    this.saveIndex(idx);
    this.sizeCache.delete(plan.envId);

    this.setStep('verify', { status: 'done', percent: 100, detail: info.torch ? `PyTorch ${info.torch.version} - ${info.torch.cuda ? 'GPU ready (' + info.torch.device + ')' : 'CPU mode'}` : 'Ready.' }, true);
    return info.torch;
  }

  /**
   * Removes a model. Its libraries may be needed by the other models in the same environment, so
   * the environment is only deleted when its last model is removed.
   */
  async remove(adapter) {
    const idx = this.loadIndex();
    const envId = this.envOf(adapter, idx);
    delete idx.pending[adapter];
    if (!envId) { this.saveIndex(idx); return { removedEnvironment: false }; }
    idx.envs[envId].adapters = idx.envs[envId].adapters.filter((a) => a !== adapter);
    const st = this.readState(envId);
    if (st && st.adapters) { delete st.adapters[adapter]; try { await fsp.writeFile(this.statePath(envId), JSON.stringify(st, null, 2), 'utf8'); } catch { /* ignore */ } }
    let removedEnvironment = false;
    if (idx.envs[envId].adapters.length === 0) {
      await fsp.rm(this.envDir(envId), { recursive: true, force: true });
      delete idx.envs[envId];
      removedEnvironment = true;
    }
    await fsp.rm(this.wheelsDir(envId), { recursive: true, force: true });
    this.saveIndex(idx);
    this.sizeCache.delete(envId);
    return { removedEnvironment };
  }

  /** Deletes a whole environment and every model in it (frees the most disk space). */
  async removeEnv(envId) {
    const idx = this.loadIndex();
    if (!idx.envs[envId]) return false;
    delete idx.envs[envId];
    for (const a of Object.keys(idx.pending)) if (idx.pending[a].envId === envId) delete idx.pending[a];
    this.saveIndex(idx);
    await fsp.rm(this.envDir(envId), { recursive: true, force: true });
    await fsp.rm(this.wheelsDir(envId), { recursive: true, force: true });
    this.sizeCache.delete(envId);
    return true;
  }
}

module.exports = { RuntimeManager, ENGINE_SPECS, detectGpu, pickTorchTag, cudaFromDriver, platformTriple, PBS_PINNED, mergeRequirements };
