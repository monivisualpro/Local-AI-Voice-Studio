'use strict';
// End-to-end runtime install with REAL network: portable Python + venv + pip resolve + engine download + offline install.
const fs = require('fs'), os = require('os'), path = require('path');
const fixtureBackend = require('./fixture-backend.cjs')();
const { RuntimeManager, pickTorchTag, cudaFromDriver } = require('../electron/runtimeManager.cjs');

const root = path.join(os.tmpdir(), 'rt-e2e-' + process.pid);
const events = [];
const mgr = new RuntimeManager({
  root, backendDir: fixtureBackend,
  specs: { testeng: { label: 'Test engine', modules: ['soundfile', 'numpy', 'tqdm'], torchTags: ['cpu'] } },
  emit: (e) => events.push(e),
});
let ok = true;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };

(async () => {
  // pure logic checks first
  check('driver 581 -> CUDA 13', cudaFromDriver('581.42') === 13.0);
  check('driver 552 -> CUDA 12.4 (too old for cu126)', cudaFromDriver('552.1') === 12.4);
  const gpu = (o) => ({ name: 'RTX', driver: '580', memoryMB: 8000, computeCap: 8.6, maxCuda: 13.0, ...o });
  const spec = { torchTags: ['cu130', 'cu126', 'cpu'] };
  check('modern GPU -> cu130', pickTorchTag({ gpu: gpu(), spec }).tag === 'cu130');
  check('driver only CUDA 12.6 -> cu126', pickTorchTag({ gpu: gpu({ maxCuda: 12.6 }), spec }).tag === 'cu126');
  check('old driver -> CPU + update hint', (() => { const p = pickTorchTag({ gpu: gpu({ maxCuda: 11.8 }), spec }); return p.tag === 'cpu' && p.needsDriverUpdate; })());
  check('Pascal GPU (cc 6.1) avoids cu130', pickTorchTag({ gpu: gpu({ computeCap: 6.1 }), spec }).tag === 'cu126');
  check('no GPU -> CPU', pickTorchTag({ gpu: null, spec }).tag === 'cpu');
  check('chatterbox on Blackwell (cc 12) -> CPU fallback', pickTorchTag({ gpu: gpu({ computeCap: 12.0 }), spec: { torchTags: ['cu126', 'cpu'], maxComputeCap: 9.0 } }).tag === 'cpu');

  const before = await mgr.status();
  check('status: nothing installed initially', !before.pythonReady && !before.engines.testeng.ready);

  const t0 = Date.now();
  const res = await mgr.install('testeng', { torchTag: 'default' });
  console.log(`install took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  check('install succeeded', res.ok === true, res.error || '');
  const after = await mgr.status();
  check('portable Python present', after.pythonReady, after.pythonVersion || '');
  check('engine env registered ready', after.engines.testeng.ready === true);
  check('python from private env exists', !!mgr.enginePython('testeng'));
  const last = events.filter((e) => e.type === 'progress').pop();
  check('progress reached 100 %', last && last.overallPercent === 100, `${events.length} events`);
  check('SHA-256 verified Python download used', events.some((e) => /Python/.test(e.message || '')));
  check('wheel cache cleaned after success', !fs.existsSync(mgr.wheelsDir(res.envId)));
  check('model registered in an environment', !!res.envId && mgr.envOf('testeng') === res.envId, res.envId);

  // second install = no-op
  const again = await mgr.install('testeng', {});
  check('re-install is a fast no-op', again.ok && again.upToDate === true);

  // run something with the private env
  const { spawnSync } = require('child_process');
  const r = spawnSync(mgr.enginePython('testeng'), ['-c', 'import soundfile, numpy, tqdm; print("imports-ok", numpy.__version__)'], { encoding: 'utf8' });
  check('packages really importable from the private env', /imports-ok/.test(r.stdout), r.stdout.trim() + r.stderr.trim().slice(0, 100));
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
