'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { runWorker, insideDir, safeJobId } = require('../electron/dubRunner.cjs');
const { execFileSync } = require('child_process');
const PY = (() => { for (const c of ['python3', 'python']) { try { execFileSync(c, ['--version']); return c; } catch { /* next */ } } return null; })();
let ok = true;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'));
  const w = (name, code) => { const f = path.join(dir, name); fs.writeFileSync(f, code); return f; };
  const good = w('good.py', 'import json,sys\nprint("noise from a library")\nprint(json.dumps({"event":"progress","stage":"x","pct":40,"message":"half"}))\nprint(json.dumps({"event":"result","value":"मूल्य","n":3}, ensure_ascii=False))\n');
  const bad = w('bad.py', 'import json,sys\nprint(json.dumps({"event":"error","message":"No speech was found in this file."}))\nsys.exit(1)\n');
  const crash = w('crash.py', 'import nothing_here_xyz\n');
  const die = w('die.py', 'import sys\nsys.stderr.write("boom\\n")\nsys.exit(3)\n');
  const slow = w('slow.py', 'import time,json\nprint(json.dumps({"event":"progress","stage":"s","pct":1}),flush=True)\ntime.sleep(30)\n');

  const events = [];
  let r = await runWorker({ python: PY, script: good, onEvent: (e) => events.push(e) });
  check('result is returned (unicode intact), library noise ignored', r.ok && r.result.value === 'मूल्य' && r.result.n === 3);
  check('progress events are streamed', events.length === 1 && events[0].pct === 40 && events[0].message === 'half');
  r = await runWorker({ python: PY, script: bad });
  check('worker error message is passed to the user', !r.ok && r.error === 'No speech was found in this file.');
  r = await runWorker({ python: PY, script: crash });
  check('missing Python package gives a Repair hint', !r.ok && /nothing_here_xyz/.test(r.error) && /Repair/.test(r.error), r.error);
  r = await runWorker({ python: PY, script: die });
  check('silent crash reports exit code and stderr', !r.ok && /exit code 3/.test(r.error) && /boom/.test(r.error), r.error);
  r = await runWorker({ python: path.join(dir, 'no-such-python'), script: good });
  check('missing Python executable is a clear error, no exception', !r.ok && /Could not start Python/.test(r.error));
  const ac = new AbortController();
  const p = runWorker({ python: PY, script: slow, signal: ac.signal, onEvent: () => setTimeout(() => ac.abort(), 50) });
  const t0 = Date.now(); r = await p;
  check('cancel kills the worker quickly', !r.ok && r.cancelled === true && Date.now() - t0 < 5000, `${Date.now() - t0} ms`);

  check('job folder guard accepts inside, refuses outside and ../', insideDir(dir, path.join(dir, 'a', 'b.wav')) && !insideDir(dir, path.join(dir, '..', 'x.wav')) && !insideDir(dir, '/etc/passwd'));
  check('job ids are sanitized', safeJobId('../../evil id') === 'evilid' && safeJobId('') .startsWith('job'));
  console.log(ok ? '\nALL DUB RUNNER CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
})();
