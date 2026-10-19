'use strict';
// Loads the REAL electron/main.cjs against a mock "electron" and calls the IPC handlers the UI uses.
const Module = require('module'), fs = require('fs'), os = require('os'), path = require('path');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ud-'));
const handlers = new Map(); const sent = [];
const noop = () => undefined;
const deep = (base = {}) => new Proxy(base, { get: (t, k) => (k in t ? t[k] : (k === 'then' ? undefined : deep(function () {}))), apply: () => deep(function () {}) });
let pickedFolder = null; let exposed = null; const invoked = new Set();
const win = { webContents: { send: noop, on: noop, setWindowOpenHandler: noop, openDevTools: noop, session: deep() }, loadURL: noop, loadFile: noop, on: noop, once: noop, show: noop, isDestroyed: () => false, setMenu: noop };
const electron = {
  app: { getPath: (n) => (n === 'userData' ? userData : os.tmpdir()), getName: () => 'test', getVersion: () => '0', isPackaged: false,
    whenReady: () => new Promise(() => {}), on: noop, once: noop, quit: noop, requestSingleInstanceLock: () => true, commandLine: { appendSwitch: noop }, setAppUserModelId: noop },
  BrowserWindow: Object.assign(function () { return win; }, { getAllWindows: () => [] }),
  ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on: noop },
  dialog: { showOpenDialog: async () => ({ canceled: !pickedFolder, filePaths: pickedFolder ? [pickedFolder] : [] }), showSaveDialog: async () => ({ canceled: true }), showErrorBox: noop },
  shell: { openPath: async () => '', showItemInFolder: noop, openExternal: noop },
  contextBridge: { exposeInMainWorld: (n, o) => { exposed = o; } }, ipcRenderer: { invoke: (c) => { invoked.add(c); return Promise.resolve(); }, on: noop, removeListener: noop, send: noop },
  session: deep(), net: { fetch: (...a) => fetch(...a) }, Menu: deep(), screen: deep(), powerSaveBlocker: deep(), nativeTheme: deep(), globalShortcut: deep(), Tray: function () {},
};
const orig = Module._load;
Module._load = function (req, ...r) { return req === 'electron' ? electron : orig.call(this, req, ...r); };
let ok = true;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + String(x).slice(0, 200) : ''}`); if (!c) ok = false; };
const call = (ch, ...a) => { const h = handlers.get(ch); if (!h) throw new Error('no handler ' + ch); return h({ sender: { send: (c, d) => sent.push([c, d]) } }, ...a); };

(async () => {
  try { require('../electron/main.cjs'); } catch (e) { check('main.cjs loads against mock electron', false, e.stack); process.exit(1); }
  check('main.cjs loads against mock electron', true);
  const need = ['storage:info', 'storage:size', 'storage:pick-folder', 'storage:open', 'storage:move', 'dub:status', 'dub:run', 'dub:install-env', 'dub:pick-media', 'models:get-config', 'models:set-config', 'runtime:status', 'runtime:install'];
  check('all handlers registered', need.every((c) => handlers.has(c)), need.filter((c) => !handlers.has(c)).join(','));

  // ---- every channel the preload (renderer) calls has a handler in main, and vice versa for the public API
  require('../electron/preload.cjs');
  for (const f of Object.values(exposed)) if (f && typeof f === 'object') for (const [n, fn] of Object.entries(f)) if (typeof fn === 'function' && !/^on/.test(n)) { try { fn({}); } catch { /* arg errors do not matter here */ } }
  for (const fn of Object.values(exposed)) if (typeof fn === 'function') { try { fn({}); } catch { /* ignore */ } }
  const unhandled = [...invoked].filter((c) => !handlers.has(c));
  check(`all ${invoked.size} channels used by the preload have a handler in main`, unhandled.length === 0, unhandled.join(', '));

  // ---- storage:info
  let info = await call('storage:info');
  check('storage:info returns real folders', info.models.path === path.join(userData, 'models') && info.environments.path === path.join(userData, 'runtime') && info.models.freeBytes > 0, JSON.stringify(info.models));

  // ---- move models (same drive, with real files)
  const modelsDir = info.models.path;
  fs.mkdirSync(path.join(modelsDir, 'kokoro'), { recursive: true }); fs.writeFileSync(path.join(modelsDir, 'kokoro', 'model.pth'), Buffer.alloc(5000, 7));
  const target = path.join(os.tmpdir(), 'newhome-' + Date.now());
  let r = await call('storage:move', { kind: 'models', folder: target, move: true });
  check('move models: ok', r.ok === true, r.error);
  check('move models: files are at the new place', fs.existsSync(path.join(r.folder || target, 'kokoro', 'model.pth')), r.folder);
  info = await call('storage:info');
  check('config now points at the new folder', info.models.path === (r.folder || target), info.models.path);
  check('models:get-config agrees', (await call('models:get-config')).storagePath === info.models.path);

  // ---- picker + "use without moving"
  pickedFolder = path.join(os.tmpdir(), 'picked-' + Date.now()); fs.mkdirSync(pickedFolder);
  r = await call('storage:move', { kind: 'models', folder: pickedFolder, move: false });
  check('use-without-moving switches the folder', r.ok && (await call('storage:info')).models.path === path.resolve(pickedFolder), r.error);

  // ---- move environments
  const envRoot = (await call('storage:info')).environments.path;
  fs.mkdirSync(path.join(envRoot, 'envs', 'env-a'), { recursive: true });
  fs.writeFileSync(path.join(envRoot, 'envs', 'env-a', 'pyvenv.cfg'), `home = ${path.join(envRoot, 'python')}\n`);
  const envTarget = path.join(os.tmpdir(), 'envhome-' + Date.now());
  r = await call('storage:move', { kind: 'environments', folder: envTarget, move: true });
  check('move environments: ok', r.ok === true, r.error);
  const cfg = fs.readFileSync(path.join(r.folder, 'envs', 'env-a', 'pyvenv.cfg'), 'utf8');
  check('environments: paths inside were repaired', cfg.includes(r.folder) && !cfg.includes(envRoot), cfg);
  check('environments: runtime manager uses the new root', (await call('runtime:status')) && (await call('storage:info')).environments.path === r.folder);

  // ---- dubbing status / run guards
  const st = await call('dub:status');
  check('dub:status works', st && st.environmentReady === false && 'whisper-small-ct2' in st.models, JSON.stringify(st));
  const run = await call('dub:run', { jobId: 'a', stage: 'prepare', args: { input: '/x.wav' } });
  check('dub:run without environment gives an actionable message', run.ok === false && run.code === 'env-missing' && /install/i.test(run.error), run.error);

  console.log(ok ? '\nALL MAIN IPC CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
})();
