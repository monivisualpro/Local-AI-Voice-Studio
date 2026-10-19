'use strict';
// A repository's file layout differs from what we expected (NLLB has only pytorch_model.bin on its main branch):
// the download must still work, never fetch the same weights twice, and fail BEFORE downloading if a required file is absent.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const small = (s) => Buffer.from(s);
const mk = (extra) => ({ 'config.json': small('{"model_type":"m2m_100"}'), 'sentencepiece.bpe.model': crypto.randomBytes(3000), 'tokenizer.json': small('{}'), 'tokenizer_config.json': small('{}'), 'special_tokens_map.json': small('{}'), 'generation_config.json': small('{}'), 'README.md': small('x'), ...extra });
const repos = {
  'org/bin-only': mk({ 'pytorch_model.bin': crypto.randomBytes(400000) }),
  'org/both': mk({ 'model.safetensors': crypto.randomBytes(300000), 'pytorch_model.bin': crypto.randomBytes(400000) }),
  'org/no-spm': (() => { const r = mk({ 'pytorch_model.bin': crypto.randomBytes(1000) }); delete r['sentencepiece.bpe.model']; return r; })(),
};
const hits = [];
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let m = /^\/api\/models\/(.+)\/tree\/main$/.exec(u);
  if (m && repos[m[1]]) { const f = repos[m[1]]; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(Object.keys(f).map((p) => ({ type: 'file', path: p, size: f[p].length })))); }
  m = /^\/(org\/[^/]+)\/resolve\/main\/(.+)$/.exec(u);
  if (m && repos[m[1]] && repos[m[1]][m[2]]) {
    hits.push(`${m[1]}:${m[2]}`);
    const b = repos[m[1]][m[2]]; let s = 0, e = b.length - 1, st = 200; const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (r) { s = +r[1]; e = r[2] ? Math.min(+r[2], b.length - 1) : e; st = 206; }
    const h = { 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes' }; if (st === 206) h['Content-Range'] = `bytes ${s}-${e}/${b.length}`;
    res.writeHead(st, h); return res.end(b.subarray(s, e + 1));
  }
  res.writeHead(404); res.end();
});
server.listen(0, '127.0.0.1', async () => {
  process.env.HF_ENDPOINT = `http://127.0.0.1:${server.address().port}`;
  const mm = require('../electron/modelManager.cjs');
  let ok = true;
  const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };
  const include = ['config.json', 'generation_config.json', 'model.safetensors', 'pytorch_model.bin', 'sentencepiece.bpe.model', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json'];
  const id = 'nllb-200-distilled-600m';
  const run = async (repo) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lay-')); hits.length = 0; let err = null; try { await mm.downloadModel({ modelsRoot: root, modelId: id, repo, include }); } catch (e) { err = e; } return { root, err, info: (await mm.listInstalled(root))[id] }; };

  let r = await run('org/bin-only');
  check('repo with ONLY pytorch_model.bin (like NLLB on main) downloads', !r.err && fs.existsSync(path.join(r.root, id, 'pytorch_model.bin')), r.err && r.err.message);
  check('...and counts as a complete model', r.info && r.info.hasWeights && r.info.complete !== false, r.info && (r.info.missing || []).join(','));

  r = await run('org/both');
  check('repo with both formats: safetensors only', fs.existsSync(path.join(r.root, id, 'model.safetensors')) && !fs.existsSync(path.join(r.root, id, 'pytorch_model.bin')));
  check('...the pickled .bin was never even requested', !hits.some((h) => h.endsWith('pytorch_model.bin')), hits.join(' '));
  check('...complete', r.info && r.info.complete !== false);

  r = await run('org/no-spm');
  check('missing required file: clear error naming it', r.err && /sentencepiece\.bpe\.model/.test(r.err.message) && /Nothing was downloaded/.test(r.err.message), r.err && r.err.message.slice(0, 120));
  check('...and NOTHING was downloaded (checked before the big files)', hits.length === 0, hits.join(' '));

  server.close();
  console.log(ok ? '\nALL LAYOUT CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
});
