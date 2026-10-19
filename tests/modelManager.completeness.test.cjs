'use strict';
// Reproduces the reported failure (big weights present, speech_tokenizer folder missing) and proves repair works.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const files = {
  'config.json': Buffer.from('{"model_type":"qwen3_tts"}'),
  'model.safetensors': crypto.randomBytes(6 * 1024 * 1024),
  'tokenizer_config.json': Buffer.from('{}'),
  'speech_tokenizer/config.json': Buffer.from('{"a":1}'),
  'speech_tokenizer/model.safetensors': crypto.randomBytes(3 * 1024 * 1024),
  'README.md': Buffer.from('skip'),
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let served = 0, treeCalls = 0;
const names = Object.keys(files);

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/api/models/acme/qwen/tree/main') {
    treeCalls += 1;
    // real Hugging Face paginates: serve 2 entries per page with a Link header, plus directory entries
    const q = new URL(req.url, 'http://x').searchParams;
    const start = Number(q.get('cursor') || 0);
    const all = [{ type: 'directory', path: 'speech_tokenizer' }, ...names.map((p) => ({ type: 'file', path: p, size: files[p].length, ...(files[p].length > 1e6 ? { lfs: { oid: sha(files[p]) } } : {}) }))];
    const page = all.slice(start, start + 3);
    const h = { 'Content-Type': 'application/json' };
    if (start + 3 < all.length) h.Link = `</api/models/acme/qwen/tree/main?recursive=true&cursor=${start + 3}>; rel="next"`;
    res.writeHead(200, h); return res.end(JSON.stringify(page));
  }
  const m = /^\/acme\/qwen\/resolve\/main\/(.+)$/.exec(u);
  if (m && files[m[1]]) {
    const b = files[m[1]]; let s = 0, e = b.length - 1, st = 200;
    const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (r) { s = +r[1]; e = r[2] ? Math.min(+r[2], b.length - 1) : e; st = 206; }
    const h = { 'Content-Length': e - s + 1, 'Accept-Ranges': 'bytes' };
    if (st === 206) h['Content-Range'] = `bytes ${s}-${e}/${b.length}`;
    res.writeHead(st, h); served += e - s + 1; return res.end(b.subarray(s, e + 1));
  }
  res.writeHead(404); res.end();
});

server.listen(0, '127.0.0.1', async () => {
  process.env.HF_ENDPOINT = `http://127.0.0.1:${server.address().port}`;
  const mm = require('../electron/modelManager.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-'));
  const id = 'qwen3-tts-0.6b-base';
  const dir = path.join(root, id);
  let ok = true;
  const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };

  // --- the user's situation: weights + config exist, speech_tokenizer folder is absent
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), files['config.json']);
  fs.writeFileSync(path.join(dir, 'model.safetensors'), files['model.safetensors']);
  let info = (await mm.listInstalled(root))[id];
  check('weights present but speech_tokenizer missing -> NOT complete', info.hasWeights === true && info.complete === false, info.missing.join(', '));
  check('missing list names the exact parts', info.missing.includes('speech_tokenizer/config.json') && info.missing.includes('speech_tokenizer/*.safetensors'));
  let v = await mm.verifyModel(root, id);
  check('Verify now reports the problem (was "ok" before)', v.ok === false && v.missing.length >= 2);

  // --- an unfinished download (.part) also counts as incomplete
  fs.mkdirSync(path.join(dir, 'speech_tokenizer'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'speech_tokenizer', 'model.safetensors.part'), Buffer.alloc(100));
  fs.writeFileSync(path.join(dir, 'speech_tokenizer', 'config.json'), files['speech_tokenizer/config.json']);
  info = (await mm.listInstalled(root))[id];
  check('a leftover .part file marks the model incomplete', info.complete === false && info.missing.some((m) => /model\.safetensors \(download not finished\)/.test(m)), info.missing.join(' | '));
  fs.rmSync(path.join(dir, 'speech_tokenizer', 'model.safetensors.part'));

  // --- repair = the normal download, which keeps finished files and fetches only what is missing
  const before = served;
  let last;
  await mm.downloadModel({ modelsRoot: root, modelId: id, repo: 'acme/qwen', onProgress: (p) => { last = p; } });
  const fetched = served - before;
  check('repair downloaded ONLY the missing parts (not the 6 MB weights again)', fetched < 3.2 * 1024 * 1024 + 20000 && fetched > 3 * 1024 * 1024, `${(fetched / 1048576).toFixed(2)} MB fetched`);
  check('paginated repository listing was followed (3 pages)', treeCalls >= 3, `${treeCalls} listing requests`);
  info = (await mm.listInstalled(root))[id];
  check('model is complete after repair', info.complete === true && info.missing.length === 0);
  check('speech_tokenizer files byte-identical', Buffer.compare(fs.readFileSync(path.join(dir, 'speech_tokenizer', 'model.safetensors')), files['speech_tokenizer/model.safetensors']) === 0);
  check('Verify ok again', (await mm.verifyModel(root, id)).ok === true);

  // --- a model with no requirement entry keeps the old behaviour (weights are enough)
  const other = path.join(root, 'custom-model'); fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'w.safetensors'), Buffer.alloc(100));
  check('unknown/imported model: weights alone are enough', (await mm.listInstalled(root))['custom-model'].complete === true);

  // --- every shipped model has requirements, and the include filters never hide a required file
  const reg = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'modelRegistry.ts'), 'utf8');
  const ids = [...reg.matchAll(/\n    id: '([^']+)'/g)].map((m) => m[1]);
  check('every model in the registry has a required-files list', ids.every((i) => mm.REQUIRED_FILES[i]), ids.filter((i) => !mm.REQUIRED_FILES[i]).join(',') || `${ids.length} models`);

  server.close(); fs.rmSync(root, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
});
