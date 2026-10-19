'use strict';
// Proves: (1) the Indic Parler-TTS model downloads its own files AND the Flan-T5 description tokenizer from a second
// repository into description_tokenizer/, (2) it only counts as installed when both tokenizers exist,
// (3) a gated repository without a token produces a plain-language, actionable error.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const indic = {
  'config.json': Buffer.from('{"model_type":"parler_tts","text_encoder":{"_name_or_path":"google/flan-t5-large"}}'),
  'generation_config.json': Buffer.from('{}'),
  'model.safetensors': crypto.randomBytes(2 * 1024 * 1024),
  'preprocessor_config.json': Buffer.from('{}'),
  'special_tokens_map.json': Buffer.from('{}'),
  'tokenizer.json': Buffer.from('{"version":"1.0"}'),
  'tokenizer.model': crypto.randomBytes(2048),
  'tokenizer_config.json': Buffer.from('{}'),
  'README.md': Buffer.from('skip'),
};
const flan = {
  'tokenizer.json': Buffer.from('{"version":"1.0","t5":true}'),
  'tokenizer_config.json': Buffer.from('{}'),
  'special_tokens_map.json': Buffer.from('{}'),
  'spiece.model': crypto.randomBytes(4096),
  'config.json': Buffer.from('{}'),
  'pytorch_model.bin': crypto.randomBytes(1024 * 1024), // must NOT be downloaded
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const repos = { 'ai4bharat/indic-parler-tts': indic, 'google/flan-t5-large': flan };
let gatedAuthSeen = null;

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let m = /^\/api\/models\/(.+)\/tree\/main$/.exec(u);
  if (m && repos[m[1]]) {
    const files = repos[m[1]];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(Object.keys(files).map((p) => ({ type: 'file', path: p, size: files[p].length, ...(files[p].length > 1e6 ? { lfs: { oid: sha(files[p]) } } : {}) }))));
  }
  m = /^\/(ai4bharat\/indic-parler-tts|google\/flan-t5-large)\/resolve\/main\/(.+)$/.exec(u);
  if (m && repos[m[1]][m[2]]) {
    if (m[1].startsWith('ai4bharat')) {                      // gated: needs a token
      gatedAuthSeen = req.headers.authorization || null;
      if (req.headers.authorization !== 'Bearer hf_test') { res.writeHead(403); return res.end('gated'); }
    }
    const b = repos[m[1]][m[2]]; let s = 0, e = b.length - 1, st = 200;
    const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (r) { s = +r[1]; e = r[2] ? Math.min(+r[2], b.length - 1) : e; st = 206; }
    const h = { 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes' };
    if (st === 206) h['Content-Range'] = `bytes ${s}-${e}/${b.length}`;
    res.writeHead(st, h); return res.end(b.subarray(s, e + 1));
  }
  res.writeHead(404); res.end();
});

server.listen(0, '127.0.0.1', async () => {
  process.env.HF_ENDPOINT = `http://127.0.0.1:${server.address().port}`;
  const mm = require('../electron/modelManager.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'indic-'));
  const id = 'indic-parler-tts';
  let ok = true;
  const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };
  const opts = {
    modelsRoot: root, modelId: id, repo: 'ai4bharat/indic-parler-tts',
    include: ['config.json', 'generation_config.json', 'model.safetensors', 'preprocessor_config.json', 'special_tokens_map.json', 'tokenizer.json', 'tokenizer.model', 'tokenizer_config.json'],
    extraRepos: [{ repo: 'google/flan-t5-large', subdir: 'description_tokenizer', include: ['tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'spiece.model', 'config.json'] }],
  };

  // 1. gated repo, no token -> actionable message
  let msg = '';
  try { await mm.downloadModel(opts); } catch (e) { msg = e.message; }
  check('gated download without token explains what to do', /gated/i.test(msg) && /token/i.test(msg) && /accept/i.test(msg), msg.slice(0, 120));

  // 2. with a token everything downloads, including the second repository
  fs.rmSync(path.join(root, id), { recursive: true, force: true });
  await mm.downloadModel({ ...opts, token: 'hf_test' });
  const dir = path.join(root, id);
  check('token is sent as a Bearer header', gatedAuthSeen === 'Bearer hf_test');
  check('model files downloaded', fs.existsSync(path.join(dir, 'model.safetensors')) && fs.existsSync(path.join(dir, 'tokenizer.json')) && fs.existsSync(path.join(dir, 'tokenizer.model')));
  check('Flan-T5 description tokenizer downloaded into description_tokenizer/', fs.existsSync(path.join(dir, 'description_tokenizer', 'spiece.model')) && fs.existsSync(path.join(dir, 'description_tokenizer', 'tokenizer.json')));
  check('unneeded Flan-T5 weights are NOT downloaded', !fs.existsSync(path.join(dir, 'description_tokenizer', 'pytorch_model.bin')));
  check('README is skipped', !fs.existsSync(path.join(dir, 'README.md')));
  let info = (await mm.listInstalled(root))[id];
  check('model counts as installed/complete', info && info.hasWeights && info.complete !== false, info && info.missing && info.missing.join(','));

  // 3. delete only the description tokenizer -> incomplete again, and the missing parts are named
  fs.rmSync(path.join(dir, 'description_tokenizer'), { recursive: true, force: true });
  info = (await mm.listInstalled(root))[id];
  check('without the description tokenizer the model is INCOMPLETE', info.complete === false && info.missing.some((x) => /description_tokenizer/.test(x)), info.missing.join(', '));

  // 4. repair downloads only what is missing
  await mm.downloadModel({ ...opts, token: 'hf_test' });
  info = (await mm.listInstalled(root))[id];
  check('repair restores the description tokenizer', info.complete !== false && fs.existsSync(path.join(dir, 'description_tokenizer', 'spiece.model')));

  server.close();
  console.log(ok ? '\nALL INDIC PARLER DOWNLOAD CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
});
