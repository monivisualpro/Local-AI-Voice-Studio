'use strict';
// Realistic install (~150 MB of packages, ~60 files) with the SAME flow the app uses. Checks the "stuck at Work out the packages" bug.
const fs = require('fs'), os = require('os'), path = require('path');
const { RuntimeManager } = require('../electron/runtimeManager.cjs');
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'pipcache-'));
process.env.PIP_CACHE_DIR = cache;
const backend = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
fs.mkdirSync(path.join(backend, 'requirements'));
fs.writeFileSync(path.join(backend, 'requirements', 'big.txt'), 'librosa\nscipy\nscikit-learn\nsoundfile\nnumpy\n');
fs.copyFileSync(path.join(__dirname, '..', 'backend', 'check_env.py'), path.join(backend, 'check_env.py'));
const dirSize = (d) => { let t = 0; for (const f of fs.readdirSync(d, { recursive: true, withFileTypes: true })) if (f.isFile()) { try { t += fs.statSync(path.join(f.parentPath || f.path, f.name)).size; } catch {} } return t; };

const root = path.join(os.tmpdir(), 'rt-real-' + process.pid);
const ev = [];
const mgr = new RuntimeManager({ root, backendDir: backend, emit: (e) => ev.push({ t: Date.now(), ...e }),
  specs: { big: { label: 'Big test', modules: ['librosa', 'scipy', 'sklearn', 'soundfile'], torchTags: ['cpu'] } } });
let ok = true; const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };

(async () => {
  let cacheAtDownloadStart = -1;
  const origSet = mgr.setStep.bind(mgr);
  mgr.setStep = (id, patch, force) => { if (id === 'download' && patch.status === 'running' && cacheAtDownloadStart < 0) cacheAtDownloadStart = dirSize(cache); return origSet(id, patch, force); };
  const t0 = Date.now();
  const res = await mgr.install('big', { torchTag: 'default' });
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  check('install succeeded', res.ok, res.error || '');
  const prog = ev.filter((e) => e.type === 'progress');
  const resolveEvents = prog.filter((e) => e.steps.find((s) => s.id === 'resolve' && s.status === 'running'));
  check('resolve step reported live activity', resolveEvents.length >= 3, `${resolveEvents.length} updates`);
  check('resolve step counted packages as pip worked', resolveEvents.some((e) => /\((?:[1-9]\d*) packages checked\)/.test(e.steps.find((s) => s.id === 'resolve').detail)));
  const sample = resolveEvents[resolveEvents.length - 1];
  console.log('   last resolve text:', sample && sample.steps.find((s) => s.id === 'resolve').detail);
  check('pip did NOT bulk-download packages while resolving', cacheAtDownloadStart < 40 * 1048576, `pip cache was ${(cacheAtDownloadStart / 1048576).toFixed(1)} MB when downloads began`);
  const dl = prog.filter((e) => e.steps.find((s) => s.id === 'download' && s.status === 'running') && e.totalBytes);
  const peak = Math.max(0, ...dl.map((e) => e.speed));
  check('download step reported speed + connections', dl.length > 0 && peak > 0 && dl.some((e) => e.connections > 0), `peak ${(peak / 1048576).toFixed(1)} MB/s, ${Math.max(0, ...dl.map((e) => e.connections))} connections, ${dl.length ? (dl[dl.length - 1].totalBytes / 1048576).toFixed(0) : 0} MB total`);
  check('log tail captured for diagnosing slow steps', prog.some((e) => e.logTail && e.logTail.length));
  const st = await mgr.status();
  check('environment ready + importable', st.engines.big.ready);
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(cache, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
