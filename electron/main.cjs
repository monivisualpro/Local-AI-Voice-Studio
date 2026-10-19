// electron/main.cjs - Electron Main Process for Local AI Voice Studio
const { app, BrowserWindow, ipcMain, shell, dialog, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const modelManager = require('./modelManager.cjs');
const { RuntimeManager } = require('./runtimeManager.cjs');
const downloadEngine = require('./downloadEngine.cjs');
const dataLocations = require('./dataLocations.cjs');
const dubRunner = require('./dubRunner.cjs');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const nodeNet = require('net');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

/* ---- identity + data folder -------------------------------------------------------------------------------
 * The app was renamed. Electron derives its data folder from the app name, so without this a renamed app would start
 * with EMPTY data (models, voices, history look gone). An existing folder of an older name is therefore kept.
 */
const APP_NAME = 'Local AI Voice Studio';
app.setName(APP_NAME);
(() => {
  try {
    const base = app.getPath('appData');
    const fresh = path.join(base, APP_NAME);
    const legacy = ['Local AI TTS Workstation', 'Local AI TTS Studio', 'local-ai-tts-studio']
      .map((n) => path.join(base, n)).find((p) => fs.existsSync(p));
    app.setPath('userData', fs.existsSync(fresh) || !legacy ? fresh : legacy);
  } catch { /* keep Electron's default */ }
})();

/** The Windows installer asks where to keep the big files (models, Python environments) and leaves this note next to the app. */
function seedDataFolderFromInstaller() {
  try {
    const userData = app.getPath('userData');
    if (fs.existsSync(path.join(userData, 'models.config.json'))) return; // already configured: never override the user
    const note = path.join(path.dirname(process.execPath), 'install-config.ini');
    if (!fs.existsSync(note)) return;
    const m = /^dataDir=(.+)$/m.exec(fs.readFileSync(note, 'utf8'));
    const dir = m && m[1].trim();
    if (!dir) return;
    modelManager.writeConfig(userData, { storagePath: path.join(dir, 'models'), runtimePath: path.join(dir, 'runtime') });
  } catch { /* fall back to the default folders */ }
}

let mainWindow = null;

function createWindow() {
  const iconFile = [path.join(app.getAppPath(), 'dist', 'icon.png'), path.join(app.getAppPath(), 'public', 'icon.png')].find((f) => fs.existsSync(f));
  mainWindow = new BrowserWindow({
    ...(iconFile ? { icon: iconFile } : {}),
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Local AI Voice Studio',
    backgroundColor: '#080A0F',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      // Enables WebGPU and high-performance neural compute in Electron
      experimentalFeatures: true,
    },
    frame: true,
    autoHideMenuBar: true,
    show: false,
  });

  // Optimize window presentation (prevent white flash on startup)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle external links safely in system default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:3000');
    // Open DevTools in dev mode:
    // mainWindow.webContents.openDevTools();
  } else {
    // In production .exe, load the bundled Vite static files from dist/
    const indexPath = path.join(__dirname, '../dist/index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers for Local Hardware & File Operations
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Local TTS Models Storage Directory',
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('select-audio-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Audio Files', extensions: ['wav', 'mp3', 'm4a', 'flac', 'ogg'] },
    ],
    title: 'Select Reference Audio Sample',
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

/* ===========================================================================
 * Real model management (Hugging Face downloads -> disk)
 * All state is derived from the filesystem; nothing is simulated.
 * ======================================================================== */

const activeDownloads = new Map(); // modelId -> AbortController

function getUserDataDir() {
  return app.getPath('userData');
}

function getConfig() {
  const cfg = modelManager.readConfig(getUserDataDir());
  try {
    fs.mkdirSync(cfg.storagePath, { recursive: true });
  } catch {
    /* the path may be on a disconnected drive - reported by the renderer */
  }
  return cfg;
}

function publicConfig(cfg) {
  return {
    storagePath: cfg.storagePath,
    runtimePath: cfg.runtimePath || path.join(getUserDataDir(), 'runtime'),
    defaultStoragePath: modelManager.defaultConfig(getUserDataDir()).storagePath,
    revision: cfg.revision || 'main',
    hasToken: Boolean(cfg.hfToken),
    downloadLimitBps: Number(cfg.downloadLimitBps) || 0,
  };
}

ipcMain.handle('models:get-config', () => publicConfig(getConfig()));

ipcMain.handle('models:set-config', (_event, patch) => {
  const safe = {};
  if (patch && typeof patch.storagePath === 'string' && patch.storagePath.trim()) {
    safe.storagePath = patch.storagePath.trim();
  }
  if (patch && typeof patch.hfToken === 'string') {
    safe.hfToken = patch.hfToken.trim();
  }
  if (patch && typeof patch.downloadLimitBps === 'number' && patch.downloadLimitBps >= 0) {
    safe.downloadLimitBps = Math.round(patch.downloadLimitBps);
  }
  if (patch && typeof patch.revision === 'string' && patch.revision.trim()) {
    safe.revision = patch.revision.trim();
  }
  return publicConfig(modelManager.writeConfig(getUserDataDir(), safe));
});

ipcMain.handle('models:choose-storage-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select the model storage directory',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return publicConfig(modelManager.writeConfig(getUserDataDir(), { storagePath: result.filePaths[0] }));
});

ipcMain.handle('models:pick-model-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select a local model folder (config.json + weights)',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('models:list-installed', () => modelManager.listInstalled(getConfig().storagePath));

ipcMain.handle('models:verify', (_event, modelId) =>
  modelManager.verifyModel(getConfig().storagePath, String(modelId || ''))
);

ipcMain.handle('models:inspect-folder', (_event, folderPath) =>
  modelManager.inspectFolder(String(folderPath || ''))
);

ipcMain.handle('models:delete', async (_event, modelId) => {
  const id = String(modelId || '');
  const controller = activeDownloads.get(id);
  if (controller) controller.abort();
  return modelManager.deleteModel(getConfig().storagePath, id);
});

ipcMain.handle('models:download', async (event, payload) => {
  const modelId = String((payload && payload.modelId) || '');
  const repo = String((payload && payload.repo) || '');
  if (!modelId || !repo) {
    return { ok: false, error: 'modelId and repo are required' };
  }
  if (activeDownloads.has(modelId)) {
    return { ok: false, error: 'A download for this model is already running' };
  }
  if (folderMoveRunning) return { ok: false, error: 'Your models/environments are being moved to a new folder. Wait until that finishes.' };

  const cfg = getConfig();
  const controller = new AbortController();
  activeDownloads.set(modelId, controller);
  const sender = event.sender;

  try {
    const manifest = await modelManager.downloadModel({
      modelsRoot: cfg.storagePath,
      modelId,
      repo,
      revision: (payload && payload.revision) || cfg.revision || 'main',
      token: cfg.hfToken || undefined,
      files: payload && Array.isArray(payload.files) ? payload.files : undefined,
      include: payload && Array.isArray(payload.include) ? payload.include : undefined,
      extraRepos: payload && Array.isArray(payload.extraRepos) ? payload.extraRepos : undefined,
      maxBytesPerSec: Number(cfg.downloadLimitBps) || 0,
      signal: controller.signal,
      onProgress: (progress) => {
        if (sender && !sender.isDestroyed()) {
          sender.send('models:download-progress', progress);
        }
      },
    });
    return { ok: true, manifest };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  } finally {
    activeDownloads.delete(modelId);
  }
});

ipcMain.handle('models:cancel-download', (_event, modelId) => {
  const id = String(modelId || '');
  const controller = activeDownloads.get(id);
  if (!controller) return { cancelled: false };
  controller.abort();
  activeDownloads.delete(id);
  return { cancelled: true };
});

/* ---- Where everything lives, and moving big folders (models, environments) to another drive ---- */
let folderMoveRunning = false;

function installFolder() {
  return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
}

ipcMain.handle('storage:info', async () => {
  const cfg = getConfig();
  const defaults = modelManager.defaultConfig(getUserDataDir());
  const free = async (dir) => {
    try {
      let probe = path.resolve(dir);
      while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
      const st = await fs.promises.statfs(probe);
      return { freeBytes: Number(st.bavail) * Number(st.bsize), totalBytes: Number(st.blocks) * Number(st.bsize) };
    } catch { return { freeBytes: 0, totalBytes: 0 }; }
  };
  const voices = path.join(getUserDataDir(), 'voice-library');
  return {
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
    installFolder: installFolder(),
    userData: getUserDataDir(),
    models: { path: cfg.storagePath, defaultPath: defaults.storagePath, ...(await free(cfg.storagePath)) },
    environments: { path: runtimeRoot(), defaultPath: defaults.runtimePath, ...(await free(runtimeRoot())) },
    voices: { path: voices },
    moving: folderMoveRunning,
  };
});

ipcMain.handle('storage:size', async (_event, kind) => {
  const dir = kind === 'environments' ? runtimeRoot() : kind === 'voices' ? path.join(getUserDataDir(), 'voice-library') : getConfig().storagePath;
  return dataLocations.folderSize(dir, 6000);
});

ipcMain.handle('storage:pick-folder', async (_event, title) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: String(title || 'Select a folder'),
  });
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
});

ipcMain.handle('storage:open', (_event, kind) => {
  const dir = kind === 'install' ? installFolder()
    : kind === 'environments' ? runtimeRoot()
    : kind === 'voices' ? path.join(getUserDataDir(), 'voice-library')
    : kind === 'userData' ? getUserDataDir()
    : getConfig().storagePath;
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return true;
});

/**
 * payload: { kind: 'models' | 'environments', folder: string, move: boolean }
 *   move = true : move everything that is downloaded into the new folder (safe: verified before the old copy is removed)
 *   move = false: just start using the new folder (for example one that already holds your models)
 */
ipcMain.handle('storage:move', async (event, payload) => {
  const kind = payload && payload.kind === 'environments' ? 'environments' : 'models';
  const picked = String((payload && payload.folder) || '').trim();
  const doMove = Boolean(payload && payload.move);
  if (!picked) return { ok: false, error: 'No folder selected.' };
  if (folderMoveRunning) return { ok: false, error: 'Another move is already running.' };
  if (activeDownloads.size) return { ok: false, error: 'A model download is running. Pause or finish it first, then move the folder.' };
  if (runtimeMgr && runtimeMgr.job) return { ok: false, error: 'An environment install is running. Pause or finish it first, then move the folder.' };
  if (tts.inFlight > 0) return { ok: false, error: 'Speech is being generated right now. Wait until it finishes.' };

  folderMoveRunning = true;
  const send = (data) => { try { event.sender.send('storage:progress', { kind, ...data }); } catch { /* window closed */ } };
  try {
    stopTtsBackend(); // it holds model files and the Python environment open (Windows would refuse to move them)
    const cfg = getConfig();
    const current = kind === 'models' ? cfg.storagePath : runtimeRoot();
    const subfolder = kind === 'models' ? 'models' : 'runtime';
    const dest = doMove ? await dataLocations.resolveDestination(picked, subfolder) : path.resolve(picked);

    let result = { moved: false, method: 'none', bytes: 0, files: 0, dest };
    if (doMove) {
      send({ phase: 'moving', done: 0, total: 0 });
      result = await dataLocations.moveFolder(current, dest, { onProgress: (p) => send({ phase: 'moving', ...p }) });
      if (kind === 'environments') {
        send({ phase: 'repairing' });
        await dataLocations.repairVenvPaths(path.join(dest, 'envs'), current, dest);
      }
    } else {
      fs.mkdirSync(dest, { recursive: true });
    }

    const next = modelManager.writeConfig(getUserDataDir(), kind === 'models' ? { storagePath: dest } : { runtimePath: dest });
    if (kind === 'environments') runtimeMgr = null;
    send({ phase: 'done' });
    return { ok: true, folder: dest, method: result.method, bytes: result.bytes, config: publicConfig(next) };
  } catch (e) {
    send({ phase: 'error' });
    return { ok: false, error: e && e.message ? e.message : String(e), code: e && e.code };
  } finally {
    folderMoveRunning = false;
  }
});

// ---- Voice library files: every downloaded/uploaded voice also lives as a real file the user can find ----
const voiceFiles = require('./voiceFiles.cjs').createVoiceFiles(() => path.join(app.getPath('userData'), 'voice-library'), shell);
ipcMain.handle('voices:save-file', (_event, payload) => voiceFiles.saveFile(payload));
ipcMain.handle('voices:reveal', (_event, target) => voiceFiles.reveal(target));
ipcMain.handle('voices:read-file', (_event, target) => voiceFiles.readFile(target));
ipcMain.handle('voices:exists', (_event, target) => voiceFiles.exists(target));
ipcMain.handle('voices:delete-file', (_event, target) => voiceFiles.deleteFile(target));
ipcMain.handle('voices:open-folder', () => voiceFiles.openFolder());

ipcMain.handle('shell:show-in-folder', (_event, target) => {
  const p = String(target || '');
  if (!p) return false;
  if (fs.existsSync(p)) {
    shell.showItemInFolder(p);
    return true;
  }
  const dir = path.dirname(p);
  if (fs.existsSync(dir)) {
    shell.openPath(dir);
    return true;
  }
  return false;
});


/* ===========================================================================
 * Real speech synthesis: local Python (Kokoro) backend on 127.0.0.1
 * The downloaded weights are actually loaded and run by backend/server.py.
 * ======================================================================== */

const BACKEND_VERSION = 1; // must match "version" in backend/server.py /health
const START_TIMEOUT_MS = 20 * 60 * 1000; // first launch loads torch + weights (a 3B model on CPU is slow): be generous
let idleMinutes = Number(process.env.TTS_IDLE_MINUTES || 10); // 0 disables idle-stop

const tts = {
  proc: null,
  port: 0,
  modelDir: null,
  adapter: null,
  starting: null, // Promise while a start is in flight (prevents double spawn)
  inFlight: 0,
  idleTimer: null,
  log: '',
};

function backendDir() {
  // Packaged: resources/backend (electron-builder extraResources). Dev: ./backend
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '..', 'backend');
}

function backendScript() {
  return path.join(backendDir(), 'server.py');
}

function emitTtsProgress(message, extra) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tts:progress', { message, ...(extra || {}) });
  }
}

function pythonCandidates() {
  const list = [];
  if (process.env.TTS_PYTHON) list.push([process.env.TTS_PYTHON, []]);
  if (process.platform === 'win32') {
    list.push(['python', []], ['py', ['-3']], ['python3', []]);
  } else {
    list.push(['python3', []], ['python', []]);
  }
  return list;
}

/* ---- network: honour the system proxy (Node's fetch ignores it) ---- */
let networkProxy = '';
async function configureNetwork() {
  try {
    const verdict = String(await session.defaultSession.resolveProxy('https://huggingface.co')).split(';')[0].trim();
    const m = /^(PROXY|HTTPS|HTTP)\s+(\S+)$/i.exec(verdict);
    if (m) {
      // A proxy is configured: use Chromium's network stack (proxy, PAC, system certificates).
      downloadEngine.setFetch((url, init) => net.fetch(url, init));
      networkProxy = `http://${m[2]}`;
      if (runtimeMgr) runtimeMgr.proxy = networkProxy;
    }
  } catch {
    /* keep the default (direct) networking */
  }
}

ipcMain.handle('network:check', () => downloadEngine.checkConnectivity());

/* ---- managed runtime (portable Python + one private env per model family) ---- */
let runtimeMgr = null;
function runtimeRoot() {
  return getConfig().runtimePath || path.join(app.getPath('userData'), 'runtime');
}
function runtime() {
  if (runtimeMgr && path.resolve(runtimeMgr.root) !== path.resolve(runtimeRoot())) runtimeMgr = null; // folder was changed
  if (runtimeMgr) runtimeMgr.maxBytesPerSec = Number(getConfig().downloadLimitBps) || 0;
  if (!runtimeMgr) {
    runtimeMgr = new RuntimeManager({
      root: runtimeRoot(),
      backendDir: backendDir(),
      maxBytesPerSec: Number(getConfig().downloadLimitBps) || 0,
      proxy: networkProxy,
      emit: (evt) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('runtime:progress', evt);
      },
    });
  }
  return runtimeMgr;
}

/** Interpreter for an adapter: its managed private env first, else a system Python (advanced users). */
function pythonFor(adapter) {
  const managed = runtime().enginePython(adapter);
  if (managed) return { cmd: managed, args: [], managed: true };
  return findPython();
}

/** First interpreter that really runs (the Windows Store "python" stub does not). */
function findPython() {
  for (const [cmd, args] of pythonCandidates()) {
    try {
      const r = spawnSync(cmd, [...args, '--version'], { windowsHide: true, timeout: 8000 });
      if (r.status === 0) return { cmd, args };
    } catch {
      /* try next */
    }
  }
  return null;
}

function setupInfo() {
  return {
    backendDir: backendDir(),
    requirementsPath: path.join(backendDir(), 'requirements'),
    commands: [],
  };
}

function failure(code, error) {
  return { ok: false, code, error, setup: setupInfo() };
}

function clearIdleTimer() {
  if (tts.idleTimer) {
    clearTimeout(tts.idleTimer);
    tts.idleTimer = null;
  }
}

function stopTtsBackend() {
  clearIdleTimer();
  if (tts.proc) {
    try { tts.proc.kill(); } catch { /* already gone */ }
  }
  tts.proc = null;
  tts.port = 0;
  tts.modelDir = null;
  tts.adapter = null;
}

function scheduleIdleStop() {
  clearIdleTimer();
  if (!idleMinutes || idleMinutes <= 0 || !tts.proc) return;
  tts.idleTimer = setTimeout(() => {
    if (tts.inFlight === 0) {
      stopTtsBackend();
      emitTtsProgress('Speech engine stopped after being idle (memory released). It restarts on the next request.', { idle: true });
    }
  }, idleMinutes * 60 * 1000);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = nodeNet.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function ttsHealth(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    if (!res.ok) return null;
    const h = await res.json();
    return h && h.version === BACKEND_VERSION ? h : null; // only accept OUR backend
  } catch {
    return null;
  }
}

/** Drops HTTP access-log lines so error messages contain only useful text. */
function cleanLog(text) {
  return String(text || '').split(/\r?\n/).filter((l) => l.trim() && !/^\[tts\] "(GET|POST) /.test(l) && !/^\[tts-progress\]/.test(l)).join('\n');
}

function classifyLog(text) {
  if (/FileNotFoundError/.test(text) && /re-download|is missing from the|not found in|No .*(weight|checkpoint|voice) file|No F5-TTS checkpoint/i.test(text)) return 'model-incomplete';
  return /ModuleNotFoundError|No module named|ImportError/i.test(text) ? 'deps-missing' : 'backend-crashed';
}

const PORT_CONFLICT_RE =
  /EADDRINUSE|Address already in use|Only one usage of each socket address|WinError 10048|Errno 98|Errno 48/i;
const MAX_START_ATTEMPTS = 3;

/** One start attempt. Returns { portConflict: true } when the port was stolen after we reserved it. */
async function attemptStart(modelDir, python, adapter) {
  let port;
  try {
    port = await findFreePort(); // OS-assigned: never collides with another app / stale instance
  } catch (err) {
    return failure('backend-crashed', 'Could not reserve a local port: ' + err.message);
  }

  tts.log = '';
  const child = spawn(
    python.cmd,
    [
      ...python.args,
      backendScript(),
      '--model-dir', modelDir,
      '--adapter', adapter,
      '--port', String(port),
      '--parent-pid', String(process.pid), // backend exits by itself if Electron dies
      '--max-idle-minutes', '60',           // absolute self-stop, defense in depth
    ],
    {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    }
  );
  tts.proc = child;
  tts.port = port;
  tts.modelDir = modelDir;
  tts.adapter = adapter;

  let exited = false;
  let exitCode = null;
  const onData = (d) => {
    const text = d.toString();
    tts.log = (tts.log + text).slice(-6000);
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\[tts-progress\]\s*(.+)$/);
      if (m) emitTtsProgress(m[1]);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (err) => { tts.log += '\n' + err.message; exited = true; });
  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
    if (tts.proc === child) { tts.proc = null; tts.port = 0; tts.modelDir = null; tts.adapter = null; }
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const h = await ttsHealth(port);
    if (h) {
      if (h.loaded) {
        emitTtsProgress('Speech engine ready.', { ready: true });
        return { ok: true, health: h };
      }
      if (h.error) {
        // loading finished with an error (missing packages, bad weights, ...)
        stopTtsBackend();
        return failure(classifyLog(h.error), cleanLog(h.error + '\n' + tts.log));
      }
      // else: still loading the model - keep waiting
    } else if (exited) {
      const log = tts.log.trim() || `Python exited with code ${exitCode}`;
      const res = failure(classifyLog(log), log);
      if (PORT_CONFLICT_RE.test(log)) res.portConflict = true;
      return res;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  stopTtsBackend();
  return failure(
    'timeout',
    `The speech engine is still not ready after ${Math.round(START_TIMEOUT_MS / 60000)} minutes.\n` + tts.log.trim()
  );
}

async function startTtsBackend(modelDir, adapter) {
  const python = pythonFor(adapter);
  if (!python) {
    return failure(
      'python-missing',
      'The voice engine for this model is not installed yet. Press "Set up automatically" - it downloads everything needed (Python, PyTorch for your GPU, and the model libraries) and can be paused and resumed.'
    );
  }

  emitTtsProgress('Starting speech engine...');
  let result;
  for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt++) {
    result = await attemptStart(modelDir, python, adapter);
    if (result.ok || !result.portConflict) return result;

    // Another process grabbed the reserved port between reserve and bind: try again.
    const note = `Port was taken by another process - retrying (${attempt}/${MAX_START_ATTEMPTS})`;
    console.warn('[tts] ' + note);
    emitTtsProgress(note);
    stopTtsBackend();
  }
  result.error = `Could not obtain a free local port after ${MAX_START_ATTEMPTS} attempts.\n` + result.error;
  return result;
}

async function ensureTtsBackend(modelDir, adapter) {
  if (tts.starting) return tts.starting; // another request is already starting it
  if (tts.proc && tts.modelDir === modelDir && tts.adapter === adapter) {
    const h = await ttsHealth(tts.port);
    if (h && h.loaded) return { ok: true, health: h };
  }
  stopTtsBackend();
  tts.starting = startTtsBackend(modelDir, adapter).finally(() => { tts.starting = null; });
  return tts.starting;
}

/**
 * Minimal JSON/binary HTTP call to the local backend. Unlike fetch() it has NO built-in timeout:
 * Node's fetch gives up after 5 minutes without response headers, which is shorter than one long segment
 * takes on a CPU - the request "failed" while Python kept computing, and the next request then ran in parallel.
 */
function backendRequest(port, method, urlPath, body, job) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method, agent: false,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    if (job) job.req = req;
    if (data) req.write(data);
    req.end();
  });
}

const synthJobs = new Map(); // requestId -> { cancelled, req, onCancel }

function cancelledResult() {
  return { ok: false, cancelled: true, code: 'cancelled', error: 'Stopped.' };
}

/** Tells the user (every second) that the engine is really working: device, audio produced so far, elapsed time. */
function startLiveStatus(port, job) {
  let lastSteps = -1;
  let lastChange = Date.now();
  const timer = setInterval(async () => {
    const h = await ttsHealth(port);
    if (!h || !h.busy || job.cancelled) return;
    if (h.steps !== lastSteps) { lastSteps = h.steps; lastChange = Date.now(); }
    const device = String(h.device || 'cpu').toUpperCase().replace('CUDA', 'GPU');
    const stalled = (Date.now() - lastChange) / 1000;
    const base = `Generating on ${device}: ${h.audioSeconds || 0} s of audio so far, ${Math.round(h.elapsed || 0)} s elapsed`;
    emitTtsProgress(stalled > 90 ? `${base}. No new audio for ${Math.round(stalled)} s - still working (a slow CPU needs longer).` : base,
      { generating: true, device: h.device, steps: h.steps, elapsed: h.elapsed, audioSeconds: h.audioSeconds });
  }, 1000);
  return () => clearInterval(timer);
}

ipcMain.handle('tts:synthesize', async (_event, payload) => {
  clearIdleTimer();
  tts.inFlight += 1;
  const requestId = String((payload && payload.requestId) || `r${Date.now()}${Math.random()}`);
  const job = { cancelled: false, req: null, onCancel: null };
  synthJobs.set(requestId, job);
  let stopLive = () => {};
  try {
    const modelId = String((payload && payload.modelId) || '');
    const modelDir = payload && payload.modelDir
      ? String(payload.modelDir)
      : path.join(getConfig().storagePath, modelId);
    if (!modelId && !(payload && payload.modelDir)) return failure('other', 'modelId is required');

    const adapter = String((payload && payload.adapter) || 'kokoro');
    // Stop must work while the model is still loading, too.
    const cancelWait = new Promise((resolve) => { job.onCancel = () => resolve({ cancelled: true }); });
    const ready = await Promise.race([ensureTtsBackend(modelDir, adapter), cancelWait]);
    if (job.cancelled || ready.cancelled) return cancelledResult();
    if (!ready.ok) return ready;

    stopLive = startLiveStatus(tts.port, job);
    const res = await backendRequest(tts.port, 'POST', '/synthesize', {
      text: payload.text,
      voice: payload.voice,
      speed: payload.speed,
      lang: payload.lang,
      gender: payload.gender,
      instruct: payload.instruct,
      temperature: payload.temperature,
      compact_silence: payload.compactSilence,
      exaggeration: payload.exaggeration,
      ref_text: payload.referenceText,
      ref_audio_b64: payload.referenceWav ? Buffer.from(payload.referenceWav).toString('base64') : undefined,
    }, job);
    if (job.cancelled) return cancelledResult();
    if (res.status === 499) return cancelledResult();
    if (res.status !== 200) {
      let msg = `Backend error ${res.status}`;
      let userError = false;
      try { const j = JSON.parse(res.body.toString('utf8')); msg = j.error || msg; userError = Boolean(j.userError); } catch { /* keep default */ }
      const r = failure('other', msg);
      r.userError = userError;
      return r;
    }
    return { ok: true, wav: new Uint8Array(res.body), device: ready.health && ready.health.device };
  } catch (err) {
    if (job.cancelled) return cancelledResult();
    // The backend process died while generating (out of memory, driver reset...): say so instead of "socket hang up".
    if (!tts.proc) {
      return failure('backend-crashed', 'The speech engine stopped unexpectedly while generating (often out of GPU/RAM memory).\n' + cleanLog(tts.log));
    }
    return failure('other', err && err.message ? err.message : String(err));
  } finally {
    stopLive();
    synthJobs.delete(requestId);
    tts.inFlight -= 1;
    scheduleIdleStop();
  }
});

/** Stop button: ends the running generation at once (all of them when no id is given). */
ipcMain.handle('tts:cancel', async (_event, requestId) => {
  const jobs = requestId && synthJobs.has(String(requestId)) ? [synthJobs.get(String(requestId))] : [...synthJobs.values()];
  if (!jobs.length) return { ok: true, cancelled: 0 };
  for (const job of jobs) {
    job.cancelled = true;
    if (job.onCancel) job.onCancel();
    if (job.req) { try { job.req.destroy(); } catch { /* already closed */ } }
  }
  const port = tts.port;
  if (port) {
    try { await backendRequest(port, 'POST', '/cancel', {}); } catch { /* backend busy loading or gone */ }
    // Safety net: if the engine is still busy a few seconds later (e.g. a model that cannot be interrupted), restart it.
    const proc = tts.proc;
    setTimeout(async () => {
      const h = tts.proc === proc ? await ttsHealth(port) : null;
      if (h && h.busy) {
        stopTtsBackend();
        emitTtsProgress('The speech engine did not stop in time and was restarted (it reloads on the next generation).');
      }
    }, 8000);
  }
  return { ok: true, cancelled: jobs.length };
});

ipcMain.handle('tts:status', async () => {
  const h = tts.port ? await ttsHealth(tts.port) : null;
  return { running: Boolean(h), health: h, idleMinutes };
});

ipcMain.handle('tts:set-idle-minutes', (_event, minutes) => {
  const n = Number(minutes);
  idleMinutes = Number.isFinite(n) && n >= 0 ? n : idleMinutes;
  scheduleIdleStop();
  return idleMinutes;
});

ipcMain.handle('tts:setup-info', () => setupInfo());

ipcMain.handle('tts:open-backend-folder', () => {
  const dir = backendDir();
  if (fs.existsSync(dir)) {
    shell.openPath(dir);
    return true;
  }
  return false;
});

/* ---- runtime installer IPC (Python, PyTorch/CUDA build, model libraries) ---- */
ipcMain.handle('runtime:status', () => runtime().status());

ipcMain.handle('runtime:install', async (_event, payload) => {
  const adapter = String((payload && payload.adapter) || '');
  if (folderMoveRunning) throw new Error('Your models/environments are being moved to a new folder. Wait until that finishes.');
  stopTtsBackend(); // release files/RAM so the environment can be (re)built safely
  return runtime().install(adapter, {
    torchTag: (payload && payload.torchTag) || 'auto',
    force: Boolean(payload && payload.force),
  });
});

ipcMain.handle('runtime:pause', () => ({ paused: runtime().pause() }));
ipcMain.handle('runtime:cancel', (_event, opts) => runtime().cancel({ discard: Boolean(opts && opts.discard) }));
ipcMain.handle('runtime:remove', async (_event, adapter) => {
  stopTtsBackend();
  return runtime().remove(String(adapter || ''));
});
ipcMain.handle('runtime:remove-env', async (_event, envId) => {
  stopTtsBackend();
  return runtime().removeEnv(String(envId || ''));
});
ipcMain.handle('runtime:open-folder', () => {
  const dir = runtime().root;
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return true;
});

/* ---- Dubbing: runs backend/dub/worker.py stages (decode, separate+transcribe, translate, assemble, mux) ---- */
const dubJobsDir = () => path.join(getUserDataDir(), 'dub-jobs');
let dubAbort = null;

function dubJobDir(jobId) {
  const dir = path.join(dubJobsDir(), dubRunner.safeJobId(jobId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle('dub:pick-media', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose the audio or video to dub',
    properties: ['openFile'],
    filters: [
      { name: 'Audio or video', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma', 'mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

ipcMain.handle('dub:status', () => {
  const py = runtime().enginePython('dub');
  const root = getConfig().storagePath;
  const have = (id) => fs.existsSync(path.join(root, id, 'config.json'));
  return { environmentReady: Boolean(py), models: Object.fromEntries(['whisper-large-v3-turbo-ct2', 'whisper-small-ct2', 'nllb-200-distilled-600m'].map((id) => [id, have(id)])) };
});

/** payload: { jobId, stage, args } - args depend on the stage (see below). Progress goes to 'dub:progress'. */
ipcMain.handle('dub:run', async (event, payload) => {
  if (folderMoveRunning) return { ok: false, error: 'A folder move is running. Wait until it finishes.' };
  if (dubAbort) return { ok: false, error: 'Another dubbing step is already running.' };
  const stage = String((payload && payload.stage) || '');
  const a = (payload && payload.args) || {};
  const jobId = dubRunner.safeJobId(payload && payload.jobId);
  const work = dubJobDir(jobId);
  const py = runtime().enginePython('dub');
  if (!py) return { ok: false, code: 'env-missing', error: 'The Dubbing environment is not installed yet. Open Settings -> Environments and install "Dubbing", or press the install button on the Dubbing page.' };
  const modelsRoot = getConfig().storagePath;
  const modelPath = (id) => {
    const dir = path.join(modelsRoot, String(id || ''));
    return fs.existsSync(path.join(dir, 'config.json')) ? dir : null;
  };
  const script = path.join(backendDir(), 'dub', 'worker.py');
  let args;
  if (stage === 'prepare') {
    if (!a.input) return { ok: false, error: 'No file selected.' };
    args = ['prepare', '--input', String(a.input), '--work', work];
  } else if (stage === 'analyze') {
    const asr = modelPath(a.asrModel);
    if (!asr) return { ok: false, code: 'model-missing', error: 'The speech recognition model is not downloaded. Open Models and download it.' };
    args = ['analyze', '--work', work, '--asr-model', asr, '--language', String(a.language || 'auto'), '--separate', a.separate ? '1' : '0', '--speakers', String(a.speakers || 'auto').replace(/[^a-z0-9]/gi, '')];
  } else if (stage === 'translate') {
    const mt = modelPath(a.mtModel);
    if (!mt) return { ok: false, code: 'model-missing', error: 'The translation model is not downloaded. Open Models and download "NLLB-200".' };
    const segFile = path.join(work, 'segments_in.json');
    fs.writeFileSync(segFile, JSON.stringify(a.segments || []), 'utf8');
    args = ['translate', '--work', work, '--mt-model', mt, '--src', String(a.src || 'english'), '--tgt', String(a.tgt || 'hindi'), '--segments', segFile, '--candidates', String(Math.max(1, Math.min(6, Number(a.candidates) || 3)))];
  } else if (stage === 'assemble') {
    const planFile = path.join(work, 'plan.json');
    const plan = { ...(a.plan || {}), output: path.join(work, 'dubbed.wav') };
    for (const s of plan.segments || []) if (!dubRunner.insideDir(work, s.wav)) return { ok: false, error: 'Invalid segment file.' };
    if (plan.background && !dubRunner.insideDir(work, plan.background)) return { ok: false, error: 'Invalid background file.' };
    fs.writeFileSync(planFile, JSON.stringify(plan), 'utf8');
    args = ['assemble', '--work', work, '--plan', planFile];
  } else if (stage === 'selftest') {
    // never fails because a model is missing: the worker reports it as a failed check
    args = ['selftest', '--work', work, '--asr-model', modelPath(a.asrModel) || '', '--mt-model', modelPath(a.mtModel) || '', '--separation', a.separation ? '1' : '0'];
  } else if (stage === 'mux') {
    if (!a.video) return { ok: false, error: 'No video.' };
    args = ['mux', '--video', String(a.video), '--audio', path.join(work, 'dubbed.wav'), '--output', path.join(work, 'dubbed_video.mp4')];
  } else {
    return { ok: false, error: `Unknown dubbing step "${stage}".` };
  }

  dubAbort = new AbortController();
  const env = { TORCH_HOME: path.join(runtimeRoot(), 'torch-cache'), HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
  if (stage === 'selftest' && a.separation) { delete env.HF_HUB_OFFLINE; delete env.TRANSFORMERS_OFFLINE; }
  if (networkProxy) { env.HTTPS_PROXY = networkProxy; env.HTTP_PROXY = networkProxy; }
  if (stage === 'analyze' && a.separate) { delete env.HF_HUB_OFFLINE; delete env.TRANSFORMERS_OFFLINE; } // Demucs downloads its weights once
  try {
    const res = await dubRunner.runWorker({
      python: py, script, args, env, cwd: backendDir(), signal: dubAbort.signal,
      onEvent: (evt) => { try { event.sender.send('dub:progress', { jobId, ...evt }); } catch { /* window closed */ } },
    });
    return res.ok ? { ok: true, workDir: work, ...res.result } : res;
  } finally {
    dubAbort = null;
  }
});

ipcMain.handle('dub:cancel', () => { if (dubAbort) dubAbort.abort(); return true; });

ipcMain.handle('dub:write-file', async (_event, payload) => {
  const work = dubJobDir(payload && payload.jobId);
  const name = String((payload && payload.name) || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!name || !payload.bytes || !payload.bytes.length) return { ok: false, error: 'Nothing to write.' };
  const file = path.join(work, name);
  await fs.promises.writeFile(file, Buffer.from(payload.bytes));
  return { ok: true, path: file };
});

ipcMain.handle('dub:read-file', async (_event, target) => {
  const p = String(target || '');
  if (!dubRunner.insideDir(dubJobsDir(), p) || !fs.existsSync(p)) return null;
  return new Uint8Array(await fs.promises.readFile(p));
});

ipcMain.handle('dub:save-output', async (_event, payload) => {
  const src = String((payload && payload.path) || '');
  if (!dubRunner.insideDir(dubJobsDir(), src) || !fs.existsSync(src) || !mainWindow) return { ok: false, error: 'File not found.' };
  const ext = path.extname(src).slice(1) || 'wav';
  const r = await dialog.showSaveDialog(mainWindow, {
    title: 'Save the dubbed file',
    defaultPath: String(payload.suggestedName || `dubbed.${ext}`),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
  await fs.promises.copyFile(src, r.filePath);
  shell.showItemInFolder(r.filePath);
  return { ok: true, path: r.filePath };
});

ipcMain.handle('dub:clean', async (_event, jobId) => {
  await fs.promises.rm(path.join(dubJobsDir(), dubRunner.safeJobId(jobId)), { recursive: true, force: true });
  return true;
});

ipcMain.handle('dub:install-env', async () => {
  if (folderMoveRunning) throw new Error('A folder move is running. Wait until it finishes.');
  stopTtsBackend();
  return runtime().install('dub', { torchTag: 'auto', force: false });
});

app.on('before-quit', stopTtsBackend);

app.whenReady().then(async () => {
  seedDataFolderFromInstaller();
  await configureNetwork();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
