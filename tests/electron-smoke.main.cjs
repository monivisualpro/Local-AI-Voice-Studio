'use strict';
// Boots the REAL Electron app (electron/main.cjs) and exercises it from inside the renderer.
// Run: (python3 -m http.server 3000 --bind 127.0.0.1 -d dist &) ; xvfb-run -a electron --no-sandbox tests/electron-smoke.main.cjs
const { app, BrowserWindow } = require('electron');
const os = require('os'), path = require('path'), fs = require('fs');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-ud-')));
require('../electron/main.cjs');

let ok = true;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 80 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; await sleep(250); }
  if (!win) { console.log('FAIL  no window created'); process.exit(1); }
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 3) console.log('   [renderer error]', msg.slice(0, 200)); });
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
  await sleep(2500);
  const js = (code) => win.webContents.executeJavaScript(code, true);

  try {
    // 1. UI mounted and preload bridge present
    check('React UI mounted', await js(`document.getElementById('root') && document.getElementById('root').children.length > 0`));
    const api = await js(`Object.keys(window.electronAPI || {}).sort().join(',')`);
    check('preload exposes tts, runtime, network, models', ['network', 'runtime', 'tts', 'models'].every((k) => api.includes(k)), api);

    // 2. runtime:status over IPC
    const st = await js(`window.electronAPI.runtime.status()`);
    check('runtime:status returns all 6 engines', st && Object.keys(st.engines).sort().join() === 'chatterbox,f5tts,kokoro,parler,qwen3,xtts', st && Object.keys(st.engines).join());
    check('status: nothing installed, no environments, platform reported', st.pythonReady === false && Array.isArray(st.envs) && st.envs.length === 0 && st.platform === process.platform, `gpu=${JSON.stringify(st.gpu)} free=${Math.round((st.freeBytes || 0) / 1e9)}GB`);

    // 3. connectivity diagnostic through Electron's network stack
    const net = await js(`window.electronAPI.network.check()`);
    check('network:check ran for 5 hosts', Array.isArray(net) && net.length === 5, net.map((r) => `${r.host}:${r.ok ? 'ok' : r.error}`).join(' | '));

    // 4. synthesize with no engine installed -> structured, actionable error (never fake audio)
    const syn = await js(`window.electronAPI.tts.synthesize({ modelId: 'qwen3-tts-0.6b-base', adapter: 'qwen3', text: 'hello' })`);
    check('synthesize without installed engine fails with a clear code', syn.ok === false && ['python-missing', 'deps-missing', 'backend-crashed'].includes(syn.code), `${syn.code}: ${String(syn.error).split('\n').pop().slice(0, 90)}`);
    check('error carries setup info for the UI panel', !!(syn.setup && syn.setup.backendDir));

    // 5. real pause/resume of an install via IPC events
    await js(`window.__evs = []; window.__off = window.electronAPI.runtime.onProgress((p) => window.__evs.push(p)); 0`);
    await js(`window.__inst = window.electronAPI.runtime.install({ adapter: 'kokoro', torchTag: 'cpu' }); 0`);
    let pythonPct = 0;
    for (let i = 0; i < 300 && pythonPct < 6; i++) { await sleep(100); pythonPct = await js(`(() => { const e = window.__evs[window.__evs.length - 1]; const s = e && e.steps.find((x) => x.id === 'python'); return s ? s.percent : 0; })()`); }
    check('install progress events arrive in the renderer', (await js(`window.__evs.length`)) > 3, `python step ${pythonPct}%`);
    const pr = await js(`window.electronAPI.runtime.pause()`);
    const res = await js(`window.__inst`);
    check('pause stops the install and keeps progress', pr.paused === true && res.paused === true, JSON.stringify(res));
    const last = await js(`window.__evs[window.__evs.length - 1]`);
    check('final event says paused with a resume hint', last && last.state === 'paused' && /Resume/i.test(last.message), last && last.message);
    const partials = fs.existsSync(path.join(app.getPath('userData'), 'runtime', 'downloads')) ? fs.readdirSync(path.join(app.getPath('userData'), 'runtime', 'downloads')) : [];
    check('download progress kept on disk (partial + state file, or the finished archive)', partials.some((f) => f.endsWith('.part.state') || f.endsWith('.tar.gz')), partials.join(', ').slice(0, 80));

    // 6. Settings screen renders the installer UI
    await js(`(() => { const b = [...document.querySelectorAll('button, a, div')].find((e) => /^\\s*Settings\\s*$/.test(e.textContent || '') && e.children.length < 3); if (b) b.click(); })()`);
    await sleep(1200);
    const text = await js(`document.body.innerText`);
    check('Settings shows Voice Engines & Dependencies', /Voice Engines/.test(text) && /Download speed limit/.test(text));
    await js(`document.querySelectorAll('details').forEach((d) => (d.open = true))`);
    await sleep(1500);
    const text2 = await js(`document.body.innerText`);
    check('installer panel renders (Set up automatically / Test connection)', /Set up automatically|Resume|Re-check/.test(text2) && /Test connection/.test(text2));
  } catch (e) {
    check('smoke test ran without exceptions', false, e && e.message);
  }
  console.log(ok ? '\nELECTRON SMOKE TEST PASSED' : '\nELECTRON SMOKE TEST FAILED');
  process.exit(ok ? 0 : 1);
});
