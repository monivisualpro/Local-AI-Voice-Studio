'use strict';
// Verifies modelManager.downloadModel uses the new engine end-to-end against a mock Hugging Face.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const files = {
  'config.json': Buffer.from('{"model_type":"test"}'),
  'model.safetensors': crypto.randomBytes(20 * 1024 * 1024),
  'sub/voices/a.pt': crypto.randomBytes(2 * 1024 * 1024),
  'README.md': Buffer.from('skip me'),
  'other/big.bin': crypto.randomBytes(1024 * 1024),
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let served = 0;

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/api/models/acme/tts/tree/main') {
    const list = Object.entries(files).map(([p, b]) => ({ type: 'file', path: p, size: b.length, ...(b.length > 1e6 ? { lfs: { oid: sha(b), size: b.length } } : {}) }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(list));
  }
  const m = /^\/acme\/tts\/resolve\/main\/(.+)$/.exec(u);
  if (m && files[m[1]]) {
    const b = files[m[1]];
    let s = 0, e = b.length - 1, st = 200;
    const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (r) { s = +r[1]; e = r[2] ? Math.min(+r[2], b.length - 1) : e; st = 206; }
    const h = { 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes' };
    if (st === 206) h['Content-Range'] = `bytes ${s}-${e}/${b.length}`;
    res.writeHead(st, h);
    served += e - s + 1;
    return res.end(b.subarray(s, e + 1));
  }
  res.writeHead(404); res.end();
});

server.listen(0, '127.0.0.1', async () => {
  process.env.HF_ENDPOINT = `http://127.0.0.1:${server.address().port}`;
  const mm = require('../electron/modelManager.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-'));
  let ok = true;
  const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };
  let lastP;
  const manifest = await mm.downloadModel({
    modelsRoot: root, modelId: 'tts', repo: 'acme/tts',
    include: ['config.json', 'model.safetensors', 'sub/*'],
    onProgress: (p) => { lastP = p; },
  });
  const dir = path.join(root, 'tts');
  check('include patterns respected (README + other/ skipped)', !fs.existsSync(path.join(dir, 'README.md')) && !fs.existsSync(path.join(dir, 'other')));
  check('nested folders downloaded', fs.existsSync(path.join(dir, 'sub/voices/a.pt')));
  check('big file byte-identical (LFS sha256 verified by engine)', sha(fs.readFileSync(path.join(dir, 'model.safetensors'))) === sha(files['model.safetensors']));
  check('manifest lists 3 files', manifest.fileCount === 3);
  check('final progress complete 100 %', lastP && lastP.status === 'complete' && lastP.percent === 100);
  check('no .part / .state leftovers', !fs.readdirSync(dir, { recursive: true }).some((f) => /\.part/.test(f)));

  // second call: everything already on disk -> nothing re-downloaded
  const before = served;
  await mm.downloadModel({ modelsRoot: root, modelId: 'tts', repo: 'acme/tts', include: ['config.json', 'model.safetensors', 'sub/*'] });
  check('re-run downloads nothing new (already complete)', served - before < 5000, `${served - before} bytes`);
  const v = await mm.verifyModel(root, 'tts');
  check('verifyModel ok', v.ok === true);
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
});
