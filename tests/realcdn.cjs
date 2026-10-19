'use strict';
// Real-network check: big wheel from the PyPI CDN, SHA-256 verified against the published hash.
const fs = require('fs'), os = require('os'), path = require('path');
const engine = require('../electron/downloadEngine.cjs');
const URL_ = 'https://files.pythonhosted.org/packages/5c/ba/791cffd048fe5b044e620df55267e3e95c0e6e07d50b41e377c03dfc910f/nvidia_cudnn_cu13-9.24.0.43-py3-none-manylinux_2_27_x86_64.whl';
const SHA = '71f181cd810e90f9b6023b01186fe82d13d65f0ec098581ee201d39fad769e4b';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-'));
(async () => {
  for (const conns of [1, 8]) {
    const dest = path.join(dir, `w${conns}.whl`);
    let peak = 0, maxConn = 0, t0 = Date.now(), verifyStart = 0;
    await engine.downloadAll([{ url: URL_, dest, sha256: SHA }], {
      connectionsPerFile: conns, maxConnections: conns,
      onProgress: (p) => { peak = Math.max(peak, p.speed); maxConn = Math.max(maxConn, p.connections || 0); },
    });
    const secs = (Date.now() - t0) / 1000, size = fs.statSync(dest).size;
    console.log(`${conns} connection(s): ${(size / 1048576).toFixed(0)} MB in ${secs.toFixed(1)}s incl. SHA-256 verify | peak ${(peak / 1048576).toFixed(1)} MB/s | max parallel requests seen: ${maxConn} | verified OK`);
    fs.rmSync(dest);
  }
  // resume on the real CDN
  const dest = path.join(dir, 'resume.whl'); const ac = new AbortController();
  try { await engine.downloadFile({ url: URL_, dest, sha256: SHA }, { signal: ac.signal, onProgress: (p) => { if (p.done > 150e6) ac.abort(); } }); } catch (e) { if (!e.aborted) throw e; }
  const saved = await engine.partialBytes(dest);
  const r = await engine.downloadFile({ url: URL_, dest, sha256: SHA }, {});
  console.log(`resume on real CDN: paused with ${(saved / 1048576).toFixed(0)} MB saved -> resumed run reused ${(r.resumedBytes / 1048576).toFixed(0)} MB, hash verified OK`);
  console.log('error text for a dead host:', await engine.downloadFile({ url: 'https://no-such-host.invalid/x.bin', dest: path.join(dir, 'x') }, { opts: { retries: 1 } }).catch((e) => e.message));
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
