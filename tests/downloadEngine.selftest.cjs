'use strict';
// Run: node tests/downloadEngine.selftest.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const engine = require('../electron/downloadEngine.cjs');
const { listen, makeData } = require('./dl-server.cjs');

const MiB = 1024 * 1024;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  - ' + extra : ''}`);
  if (!ok) failed += 1;
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (f) => sha(fs.readFileSync(f));

async function main() {
  const data = makeData(48 * MiB);
  const expected = sha(data);

  /* 1. speed: parallel segments vs a single throttled stream */
  {
    const srv = await listen({ data, perConnBps: 6 * MiB });
    const t0 = Date.now();
    await engine.downloadFile({ url: srv.url, dest: path.join(tmp, 'single.bin'), sha256: expected },
      { opts: { connectionsPerFile: 1 } });
    const tSingle = (Date.now() - t0) / 1000;
    const t1 = Date.now();
    await engine.downloadFile({ url: srv.url, dest: path.join(tmp, 'multi.bin'), sha256: expected },
      { opts: { connectionsPerFile: 8 } });
    const tMulti = (Date.now() - t1) / 1000;
    check('hash verified (1 connection)', fileSha(path.join(tmp, 'single.bin')) === expected);
    check('hash verified (8 connections)', fileSha(path.join(tmp, 'multi.bin')) === expected);
    check('8 connections much faster than 1 on a per-connection-limited server',
      tMulti < tSingle * 0.5, `1 conn: ${tSingle.toFixed(1)}s, 8 conn: ${tMulti.toFixed(1)}s, parallel seen: ${srv.stats.maxParallel}`);
    srv.close();
  }

  /* 2. pause at ~40 % then resume: must NOT restart from zero */
  {
    const srv = await listen({ data, perConnBps: 4 * MiB });
    const dest = path.join(tmp, 'resume.bin');
    const ac = new AbortController();
    let pausedAt = 0;
    try {
      await engine.downloadFile({ url: srv.url, dest, sha256: expected }, {
        signal: ac.signal,
        onProgress: (p) => { if (p.done > data.length * 0.4 && !ac.signal.aborted) { pausedAt = p.done; ac.abort(); } },
      });
      check('pause interrupts the download', false);
    } catch (e) {
      check('pause interrupts the download', e.aborted === true, e.message);
    }
    check('partial file + state persisted', fs.existsSync(dest + '.part') && fs.existsSync(dest + '.part.state'));
    const had = await engine.partialBytes(dest);
    check('state remembers progress', had > data.length * 0.3, `${(had / MiB).toFixed(1)} MiB saved`);
    const before = srv.stats.bytesServed;
    const r = await engine.downloadFile({ url: srv.url, dest, sha256: expected }, {});
    const servedOnResume = srv.stats.bytesServed - before;
    check('resumed file is byte-identical', fileSha(dest) === expected);
    check('resume reused earlier bytes (did not restart from zero)', r.resumedBytes > data.length * 0.3,
      `reused ${(r.resumedBytes / MiB).toFixed(1)} MiB, re-downloaded ${(servedOnResume / MiB).toFixed(1)} of ${(data.length / MiB).toFixed(0)} MiB`);
    check('resume transferred clearly less than a full download', servedOnResume < data.length * 0.75);
    check('state files cleaned up', !fs.existsSync(dest + '.part') && !fs.existsSync(dest + '.part.state'));
    srv.close();
  }

  /* 3. hard crash (SIGKILL of the whole process) then resume */
  {
    const srv = await listen({ data, perConnBps: 1 * MiB });
    const dest = path.join(tmp, 'crash.bin');
    const child = spawn(process.execPath, ['-e', `
      const e=require(${JSON.stringify(path.resolve(__dirname, '../electron/downloadEngine.cjs'))});
      e.downloadFile({url:${JSON.stringify(srv.url)},dest:${JSON.stringify(dest)}},{});
    `], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 2800));
    child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 300));
    const had = await engine.partialBytes(dest);
    check('progress survived a hard kill', had > 4 * MiB, `${(had / MiB).toFixed(1)} MiB on disk`);
    const before = srv.stats.bytesServed;
    await engine.downloadFile({ url: srv.url, dest, sha256: expected }, {});
    check('file complete and correct after crash-resume', fileSha(dest) === expected);
    check('crash-resume did not re-download everything', srv.stats.bytesServed - before < data.length * 0.95,
      `${((srv.stats.bytesServed - before) / MiB).toFixed(1)} MiB re-fetched`);
    srv.close();
  }

  /* 4. flaky connections (35 % of requests dropped mid-body) */
  {
    const srv = await listen({ data, perConnBps: 20 * MiB, failRate: 0.35 });
    const dest = path.join(tmp, 'flaky.bin');
    await engine.downloadFile({ url: srv.url, dest, sha256: expected }, { opts: { retries: 30 } });
    check('completes correctly despite dropped connections', fileSha(dest) === expected);
    srv.close();
  }

  /* 5. server without Range support -> single-stream fallback */
  {
    const srv = await listen({ data: data.subarray(0, 8 * MiB), noRange: true });
    const dest = path.join(tmp, 'norange.bin');
    await engine.downloadFile({ url: srv.url, dest, sha256: sha(data.subarray(0, 8 * MiB)) }, {});
    check('fallback works without Range', fileSha(dest) === sha(data.subarray(0, 8 * MiB)));
    srv.close();
  }

  /* 6. redirects are followed */
  {
    const srv = await listen({ data: data.subarray(0, 12 * MiB), redirect: true });
    const dest = path.join(tmp, 'redir.bin');
    await engine.downloadFile({ url: srv.url, dest }, {});
    check('HTTP redirects followed', fileSha(dest) === sha(data.subarray(0, 12 * MiB)));
    srv.close();
  }

  /* 7. wrong checksum is rejected and partials are discarded */
  {
    const srv = await listen({ data: data.subarray(0, 6 * MiB) });
    const dest = path.join(tmp, 'bad.bin');
    let code = '';
    try { await engine.downloadFile({ url: srv.url, dest, sha256: 'deadbeef' }, {}); } catch (e) { code = e.code; }
    check('checksum mismatch detected', code === 'HASH_MISMATCH');
    check('corrupt file not left behind', !fs.existsSync(dest));
    srv.close();
  }

  /* 8. many files, aggregated progress, speed limit */
  {
    const small = makeData(3 * MiB);
    const srv = await listen({ data: small });
    const jobs = [1, 2, 3, 4].map((i) => ({ url: srv.url, dest: path.join(tmp, `many${i}.bin`), sha256: sha(small) }));
    let last;
    const t0 = Date.now();
    await engine.downloadAll(jobs, { onProgress: (p) => { last = p; }, maxBytesPerSec: 6 * MiB });
    const secs = (Date.now() - t0) / 1000;
    check('downloadAll finishes all files', jobs.every((j) => fileSha(j.dest) === sha(small)));
    check('aggregated progress reaches 100 %', last && Math.round(last.percent) === 100, `total ${(last.totalBytes / MiB).toFixed(0)} MiB`);
    check('speed limiter respected (12 MiB at 6 MiB/s with 1 s burst takes ~1 s, unlimited ~0.1 s)', secs > 0.8, `${secs.toFixed(1)}s`);
    srv.close();
  }

  /* 9. 404 / 403 fail fast with a clear message (no long retry loops) */
  {
    const http = require('http');
    const bad = http.createServer((q, r) => { r.writeHead(q.url === '/gone' ? 404 : 403); r.end(); });
    await new Promise((r) => bad.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${bad.address().port}`;
    for (const [p, code] of [['/gone', 404], ['/denied', 403]]) {
      const t = Date.now();
      let msg = '';
      try { await engine.downloadFile({ url: base + p, dest: path.join(tmp, 'e' + code) }, {}); } catch (e) { msg = e.message; }
      check(`HTTP ${code} fails fast`, msg.includes(String(code)) && Date.now() - t < 2500, `${Date.now() - t} ms: ${msg.slice(0, 60)}`);
    }
    bad.close();
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll download-engine checks passed');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
