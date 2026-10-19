'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const fixtureBackend = require('./fixture-backend.cjs')();
const { RuntimeManager } = require('../electron/runtimeManager.cjs');
const root = path.join(os.tmpdir(), 'rt-resume-' + process.pid);
let mgr, paused = false, ok = true;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };
const make = (emit) => new RuntimeManager({ root, backendDir: fixtureBackend, emit,
  specs: { testeng: { label: 'Test engine', modules: ['soundfile', 'numpy', 'tqdm'], torchTags: ['cpu'] } } });

(async () => {
  mgr = make((e) => {
    if (e.type === 'progress' && !paused) {
      const s = e.steps.find((x) => x.id === 'python');
      if (s && s.status === 'running' && s.percent > 25) { paused = true; mgr.pause(); }
    }
  });
  const r1 = await mgr.install('testeng', { torchTag: 'default' });
  check('first run paused (not failed)', r1.paused === true && !r1.error, JSON.stringify(r1));
  const dl = path.join(root, 'downloads');
  const partial = fs.existsSync(dl) ? fs.readdirSync(dl).filter((f) => f.endsWith('.state')) : [];
  check('partial Python download kept on disk', partial.length === 1, partial.join(','));
  const state = JSON.parse(fs.readFileSync(path.join(dl, partial[0]), 'utf8'));
  const saved = state.done.reduce((a, b) => a + b, 0);
  check('progress saved in state file', saved > 3e6, `${(saved / 1e6).toFixed(1)} MB saved`);

  // "app restart": brand-new manager object, then resume
  let resumedSeen = 0;
  const mgr2 = make(() => {});
  const ev = []; mgr2.emitFn = (e) => ev.push(e);
  const r2 = await mgr2.install('testeng', { torchTag: 'default' });
  check('resume after restart completes the install', r2.ok === true, r2.error || '');
  check('Python archive removed after unpack', fs.readdirSync(dl).length === 0);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
