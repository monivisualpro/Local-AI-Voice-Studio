'use strict';
// Real-network test of SHARED environments: compatible models attach to an existing environment
// (only missing packages download); a model needing different versions gets its own.
const fs = require('fs'), os = require('os'), path = require('path');
const { RuntimeManager, mergeRequirements } = require('../electron/runtimeManager.cjs');

const backend = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-bk-'));
fs.mkdirSync(path.join(backend, 'requirements'));
const reqs = {
  a: 'requests==2.31.0\ntqdm\n',            // first model: creates the shared environment
  b: 'requests\ncolorama\n',                 // compatible: requests 2.31.0 already satisfies it
  c: 'requests==2.32.3\n',                   // needs a DIFFERENT requests version -> own environment
  d: 'rich\nrequests\n',                     // compatible with the shared environment again
};
for (const [k, v] of Object.entries(reqs)) fs.writeFileSync(path.join(backend, 'requirements', `${k}.txt`), v);
fs.copyFileSync(path.join(__dirname, '..', 'backend', 'check_env.py'), path.join(backend, 'check_env.py'));

const root = path.join(os.tmpdir(), 'rt-shared-' + process.pid);
const events = [];
const spec = (label, modules) => ({ label, modules, torchTags: ['cpu'] });
const mgr = new RuntimeManager({
  root, backendDir: backend, emit: (e) => events.push(e),
  specs: { a: spec('Model A', ['requests', 'tqdm']), b: spec('Model B', ['requests', 'colorama']), c: spec('Model C', ['requests']), d: spec('Model D', ['rich', 'requests']) },
});
let ok = true;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };
const lastFinish = () => events.filter((e) => e.type === 'finished').pop();
const dlTotal = () => { const p = events.filter((e) => e.type === 'progress' && e.totalBytes).pop(); return p ? p.totalBytes : 0; };

(async () => {
  // merge logic
  const merged = mergeRequirements(['torch\nnumpy\nkokoro>=0.9.4\n', 'torch\ntorchaudio\nnumpy>=1.26\ntransformers>=4.57,<5\n']);
  check('requirement merge: duplicates combined, specifiers joined', /^torch$/m.test(merged) && /^numpy>=1\.26$/m.test(merged) && merged.match(/^torch$/gm).length === 1);

  let r = await mgr.install('a', { torchTag: 'default' });
  check('A installs and creates a new environment', r.ok && r.shared === false, r.error || r.envId);
  const envA = r.envId;
  let sizeA = dlTotal();

  events.length = 0;
  r = await mgr.install('b', { torchTag: 'default' });
  check('B (compatible) is ADDED to the same environment', r.ok && r.envId === envA && r.shared === true, `env ${r.envId}`);
  const prog = events.filter((e) => e.type === 'progress' && e.reuse).pop();
  check('B reuses already-installed packages', prog && prog.reuse.packagesAlreadyThere > 5 && prog.reuse.packagesToAdd <= 2, prog && JSON.stringify(prog.reuse));
  check('B downloaded far less than A', dlTotal() < sizeA * 0.5, `A ${(sizeA / 1e3).toFixed(0)} KB vs B ${(dlTotal() / 1e3).toFixed(0)} KB`);
  check('B names who it shares with', prog && prog.sharedWith.includes('Model A'));

  events.length = 0;
  r = await mgr.install('c', { torchTag: 'default' });
  check('C (needs requests 2.32.3, A has 2.31.0) gets its OWN environment', r.ok && r.envId !== envA && r.shared === false, `env ${r.envId}`);
  const envC = r.envId;
  const logTxt = fs.readFileSync(path.join(root, 'logs', 'c.log'), 'utf8');
  check('conflict was detected and logged with the exact packages', /not compatible with env-a:.*requests/.test(logTxt), (logTxt.match(/not compatible[^\n]*/) || [''])[0].slice(0, 90));

  r = await mgr.install('d', { torchTag: 'default' });
  check('D (compatible again) joins the FIRST shared environment', r.ok && r.envId === envA && r.shared === true, `env ${r.envId}`);

  await mgr.status(); await new Promise((r) => setTimeout(r, 1500));
  const st = await mgr.status();
  const byId = Object.fromEntries(st.envs.map((e) => [e.id, e.adapters.slice().sort().join('+')]));
  check('status lists exactly two environments: A+B+D and C', Object.keys(byId).length === 2 && byId[envA] === 'a+b+d' && byId[envC] === 'c', JSON.stringify(byId));
  check('each model reports its environment and who it shares with', st.engines.b.envId === envA && st.engines.b.sharedWith.sort().join() === 'Model A,Model D' && st.engines.c.sharedWith.length === 0);
  check('environment size reported', st.envs.every((e) => e.sizeBytes > 1e6), st.envs.map((e) => `${e.id}=${(e.sizeBytes / 1e6).toFixed(0)}MB`).join(' '));

  // everything really works side by side
  const { spawnSync } = require('child_process');
  const py = mgr.enginePython('a');
  const t = spawnSync(py, ['-c', 'import requests, tqdm, colorama, rich; print("ok", requests.__version__)'], { encoding: 'utf8' });
  check('models in the shared env import together; versions untouched', /ok 2\.31\.0/.test(t.stdout), t.stdout.trim() + t.stderr.trim().slice(0, 80));
  const pc = spawnSync(mgr.enginePython('c'), ['-c', 'import requests; print(requests.__version__)'], { encoding: 'utf8' });
  check('C really has its own requests version', pc.stdout.trim() === '2.32.3', pc.stdout.trim());

  // removing one model keeps the shared libraries for the others
  const rb = await mgr.remove('b');
  check('removing B keeps the shared environment (A and D still use it)', rb.removedEnvironment === false && fs.existsSync(mgr.envDir(envA)) && mgr.enginePython('a') && !mgr.enginePython('b'));
  await mgr.remove('a'); const rd = await mgr.remove('d');
  check('removing the LAST model deletes the environment', rd.removedEnvironment === true && !fs.existsSync(mgr.envDir(envA)));
  check('unrelated environment untouched', fs.existsSync(mgr.envDir(envC)) && !!mgr.enginePython('c'));
  check('delete-environment works', (await mgr.removeEnv(envC)) === true && !fs.existsSync(mgr.envDir(envC)));

  // environments made by older versions (one folder per model) are adopted
  const legacyRoot = path.join(os.tmpdir(), 'rt-legacy-' + process.pid);
  fs.mkdirSync(path.join(legacyRoot, 'envs', 'kokoro'), { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, 'envs', 'kokoro', '.tts-env.json'), JSON.stringify({ adapter: 'kokoro', torchTag: 'cpu', requirementsHash: 'x' }));
  const old = new RuntimeManager({ root: legacyRoot, backendDir: backend, specs: { kokoro: spec('Kokoro', ['x']) } });
  check('environment from an older version is adopted', old.envOf('kokoro') === 'kokoro');

  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(legacyRoot, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
