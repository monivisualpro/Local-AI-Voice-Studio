// electron/preload.cjs - Secure IPC Bridge between Electron & Web UI
const { contextBridge, ipcRenderer } = require('electron');

const DOWNLOAD_PROGRESS_CHANNEL = 'models:download-progress';

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,

  // --- app level helpers ---------------------------------------------------
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),

  // --- real speech synthesis (local Python backend) ------------------------
  tts: {
    /** { modelId, modelDir?, text, voice?, speed?, lang? } -> { ok, wav?: Uint8Array, error? } */
    synthesize: (payload) => ipcRenderer.invoke('tts:synthesize', payload),
    /** Stops the running generation immediately (optionally only the one with this requestId). */
    cancel: (requestId) => ipcRenderer.invoke('tts:cancel', requestId),
    status: () => ipcRenderer.invoke('tts:status'),
    setIdleMinutes: (minutes) => ipcRenderer.invoke('tts:set-idle-minutes', minutes),
    setupInfo: () => ipcRenderer.invoke('tts:setup-info'),
    openBackendFolder: () => ipcRenderer.invoke('tts:open-backend-folder'),
    /** Live engine status lines (startup stages, pip output). Returns unsubscribe. */
    onProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('tts:progress', listener);
      return () => ipcRenderer.removeListener('tts:progress', listener);
    },
  },

  // --- connectivity diagnostics
  network: { check: () => ipcRenderer.invoke('network:check') },

  // --- runtime installer: portable Python, PyTorch (CPU/CUDA), model libraries --
  runtime: {
    status: () => ipcRenderer.invoke('runtime:status'),
    install: (payload) => ipcRenderer.invoke('runtime:install', payload),
    pause: () => ipcRenderer.invoke('runtime:pause'),
    cancel: (opts) => ipcRenderer.invoke('runtime:cancel', opts),
    remove: (adapter) => ipcRenderer.invoke('runtime:remove', adapter),
    removeEnv: (envId) => ipcRenderer.invoke('runtime:remove-env', envId),
    openFolder: () => ipcRenderer.invoke('runtime:open-folder'),
    onProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('runtime:progress', listener);
      return () => ipcRenderer.removeListener('runtime:progress', listener);
    },
  },

  // --- where things live + moving folders ----------------------------------------
  storage: {
    info: () => ipcRenderer.invoke('storage:info'),
    size: (kind) => ipcRenderer.invoke('storage:size', kind),
    pickFolder: (title) => ipcRenderer.invoke('storage:pick-folder', title),
    open: (kind) => ipcRenderer.invoke('storage:open', kind),
    move: (payload) => ipcRenderer.invoke('storage:move', payload),
    onProgress: (cb) => {
      const listener = (_e, data) => cb(data);
      ipcRenderer.on('storage:progress', listener);
      return () => ipcRenderer.removeListener('storage:progress', listener);
    },
  },

  // --- dubbing ---------------------------------------------------------------------
  dub: {
    pickMedia: () => ipcRenderer.invoke('dub:pick-media'),
    status: () => ipcRenderer.invoke('dub:status'),
    run: (payload) => ipcRenderer.invoke('dub:run', payload),
    cancel: () => ipcRenderer.invoke('dub:cancel'),
    writeFile: (payload) => ipcRenderer.invoke('dub:write-file', payload),
    readFile: (target) => ipcRenderer.invoke('dub:read-file', target),
    saveOutput: (payload) => ipcRenderer.invoke('dub:save-output', payload),
    clean: (jobId) => ipcRenderer.invoke('dub:clean', jobId),
    installEnv: () => ipcRenderer.invoke('dub:install-env'),
    onProgress: (cb) => {
      const listener = (_e, data) => cb(data);
      ipcRenderer.on('dub:progress', listener);
      return () => ipcRenderer.removeListener('dub:progress', listener);
    },
  },

  // --- voice library files on disk ---------------------------------------------
  voices: {
    saveFile: (payload) => ipcRenderer.invoke('voices:save-file', payload),
    reveal: (target) => ipcRenderer.invoke('voices:reveal', target),
    exists: (target) => ipcRenderer.invoke('voices:exists', target),
    readFile: (target) => ipcRenderer.invoke('voices:read-file', target),
    deleteFile: (target) => ipcRenderer.invoke('voices:delete-file', target),
    openFolder: () => ipcRenderer.invoke('voices:open-folder'),
  },

  // --- real model management (downloads + on-disk state) -------------------
  models: {
    /** { storagePath, defaultStoragePath, revision, hasToken } */
    getConfig: () => ipcRenderer.invoke('models:get-config'),
    /** patch: { storagePath?, hfToken?, revision? } */
    setConfig: (patch) => ipcRenderer.invoke('models:set-config', patch),
    chooseStorageFolder: () => ipcRenderer.invoke('models:choose-storage-folder'),
    pickModelFolder: () => ipcRenderer.invoke('models:pick-model-folder'),
    /** { [modelId]: { bytes, fileCount, hasWeights, installedAt, ... } } */
    listInstalled: () => ipcRenderer.invoke('models:list-installed'),
    verify: (modelId) => ipcRenderer.invoke('models:verify', modelId),
    inspectFolder: (folderPath) => ipcRenderer.invoke('models:inspect-folder', folderPath),
    /** { modelId, repo, revision?, files? } -> { ok, manifest?, error? } */
    download: (payload) => ipcRenderer.invoke('models:download', payload),
    cancelDownload: (modelId) => ipcRenderer.invoke('models:cancel-download', modelId),
    remove: (modelId) => ipcRenderer.invoke('models:delete', modelId),
    showInFolder: (target) => ipcRenderer.invoke('shell:show-in-folder', target),
    /** Subscribe to live download progress. Returns an unsubscribe function. */
    onProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on(DOWNLOAD_PROGRESS_CHANNEL, listener);
      return () => ipcRenderer.removeListener(DOWNLOAD_PROGRESS_CHANNEL, listener);
    },
  },
});
