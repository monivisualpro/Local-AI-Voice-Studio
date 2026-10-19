/**
 * Desktop bridge - typed access to the Electron main-process model manager.
 *
 * When the UI runs inside the packaged desktop app the bridge performs REAL
 * filesystem work (Hugging Face downloads, on-disk verification, folder
 * inspection). When the UI runs in a plain browser (`npm run dev` in a tab or
 * the AI Studio preview) `DesktopBridge.available` is false and callers fall
 * back to the in-memory demo behaviour.
 */

export interface ModelStorageConfig {
  storagePath: string;
  defaultStoragePath: string;
  revision: string;
  hasToken: boolean;
  /** Download speed cap in bytes/second (0 = unlimited). */
  downloadLimitBps?: number;
}

export interface InstalledModelInfo {
  modelId: string;
  path: string;
  bytes: number;
  fileCount: number;
  hasConfig: boolean;
  hasWeights: boolean;
  weightFileCount: number;
  hasTokenizer: boolean;
  installedAt: string | null;
  manifestComplete: boolean;
  /** false when required files are missing or a download was left unfinished */
  complete?: boolean;
  missing?: string[];
}

export interface VerifiedModelInfo {
  modelId: string;
  path: string;
  ok: boolean;
  bytes: number;
  fileCount: number;
  hasConfig: boolean;
  hasWeights: boolean;
  weightFileCount: number;
  manifestPresent: boolean;
  recordedFileCount: number;
  missing: string[];
  sizeMismatch: { path: string; expected: number; actual: number }[];
}

export interface DownloadProgress {
  modelId: string;
  status: 'downloading' | 'complete' | 'error' | 'paused';
  currentFile: string;
  fileIndex: number;
  fileCount: number;
  totalBytes: number;
  downloadedBytes: number;
  percent: number;
  speedMBps: number;
  speedBps?: number;
  etaSeconds?: number | null;
  resumedBytes?: number;
  verifying?: boolean;
  error?: string;
}

export interface LocalFolderInspection {
  valid: boolean;
  path: string;
  adapter: string;
  runtime: string;
  fileCount: number;
  totalBytes: number;
  totalSizeLabel: string;
  hasConfig: boolean;
  hasWeights: boolean;
  hasTokenizer: boolean;
  configSummary: {
    modelType: string | null;
    architectures: string[];
    hiddenSize: number | null;
    layers: number | null;
    sampleRate: number | null;
    vocabSize: number | null;
  } | null;
  weightFileCount: number;
  weights: { relPath: string; size: number }[];
  tokenizerFiles: string[];
  parameterCount: number | null;
  parameterSizeLabel: string | null;
  warnings: string[];
}

export interface DownloadResult {
  ok: boolean;
  error?: string;
  manifest?: { bytes: number; fileCount: number; completedAt: string };
}

export type TtsErrorCode =
  | 'python-missing'
  | 'deps-missing'
  | 'backend-crashed'
  | 'timeout'
  | 'model-incomplete'
  | 'cancelled'
  | 'other';

export interface TtsSetupInfo {
  backendDir: string;
  requirementsPath: string;
  commands: string[];
}

export interface TtsProgress {
  message: string;
  ready?: boolean;
  idle?: boolean;
  installing?: boolean;
  installed?: boolean;
  /** Sent every second while a segment is being generated. */
  generating?: boolean;
  device?: string;
  audioSeconds?: number;
  elapsed?: number;
}

export interface RuntimeStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'paused' | 'error';
  percent: number;
  detail: string;
}

export interface RuntimeProgress {
  type?: 'progress' | 'finished';
  adapter: string;
  state: 'running' | 'paused' | 'done' | 'error' | 'cancelled';
  message: string;
  error: string | null;
  overallPercent: number;
  speed: number;
  etaSeconds: number | null;
  downloadedBytes: number;
  totalBytes: number;
  resumedBytes: number;
  envId?: string | null;
  envLabel?: string | null;
  sharedWith?: string[];
  reuse?: { packagesAlreadyThere: number; packagesToAdd: number } | null;
  connections?: number;
  avgSpeed?: number;
  peakSpeed?: number;
  elapsedSeconds?: number;
  logTail?: string[];
  torch?: { tag: string; device: string; note: string; needsDriverUpdate?: boolean } | null;
  steps: RuntimeStep[];
  files: { name: string; done: number; total: number; status: string; speed?: number }[];
}

export interface RuntimeEngineStatus {
  label: string;
  ready: boolean;
  envId: string | null;
  envLabel: string | null;
  sharedWith: string[];
  needsUpdate: boolean;
  installedTorchTag: string | null;
  plannedTorchTag: string;
  device: string;
  note: string;
  needsDriverUpdate: boolean;
  torch: { version?: string; cuda?: boolean; device?: string; error?: string } | null;
}

export interface RuntimeEnvStatus {
  id: string;
  label: string;
  adapters: string[];
  adapterLabels: string[];
  torchTag: string;
  torch: { version?: string; cuda?: boolean; device?: string } | null;
  sizeBytes: number | null;
  ready: boolean;
}

export interface RuntimeStatus {
  platform: string;
  arch: string;
  root: string;
  freeBytes: number | null;
  pythonReady: boolean;
  pythonVersion: string | null;
  gpu: { name: string; driver: string; memoryMB: number; computeCap: number | null; maxCuda: number } | null;
  vcRuntime: { required: boolean; installed: boolean };
  engines: Record<string, RuntimeEngineStatus>;
  envs: RuntimeEnvStatus[];
  proxy?: string;
  running: RuntimeProgress | null;
}

export interface ConnectivityResult { name: string; host: string; ok: boolean; status?: number; ms: number; error?: string }

interface ElectronRuntimeApi {
  status: () => Promise<RuntimeStatus>;
  install: (payload: { adapter: string; torchTag?: string; force?: boolean }) => Promise<{ ok: boolean; paused?: boolean; cancelled?: boolean; upToDate?: boolean; error?: string }>;
  pause: () => Promise<{ paused: boolean }>;
  cancel: (opts?: { discard?: boolean }) => Promise<boolean>;
  remove: (adapter: string) => Promise<{ removedEnvironment: boolean } | boolean>;
  removeEnv: (envId: string) => Promise<boolean>;
  openFolder: () => Promise<boolean>;
  onProgress: (callback: (p: RuntimeProgress) => void) => () => void;
}

export interface SynthesizePayload {
  /** Lets the Stop button address this exact request. */
  requestId?: string;
  /** Studio: shorten long silent gaps / trim dead air inside a segment. */
  compactSilence?: boolean;
  modelId: string;
  modelDir?: string;
  adapter?: string;
  text: string;
  voice?: string;
  speed?: number;
  lang?: string;
  /** Persona gender (male/female/neutral): lets engines pick a matching speaker. */
  gender?: string;
  /** Voice / style description (Qwen3 VoiceDesign, Parler). */
  instruct?: string;
  /** Sampling temperature (0.1 - 1.0) for engines that sample. */
  temperature?: number;
  /** Chatterbox emotion exaggeration (0 - 1). */
  exaggeration?: number;
  /** Reference clip as WAV bytes (voice cloning) + its transcript. */
  referenceWav?: Uint8Array;
  referenceText?: string;
}

export interface SynthesizeResult {
  ok: boolean;
  wav?: Uint8Array;
  cancelled?: boolean;
  device?: string;
  error?: string;
  code?: TtsErrorCode;
  setup?: TtsSetupInfo;
}

interface ElectronTtsApi {
  synthesize: (payload: SynthesizePayload) => Promise<SynthesizeResult>;
  cancel?: (requestId?: string) => Promise<{ ok: boolean; cancelled?: number }>;
  status: () => Promise<{ running: boolean }>;
  setIdleMinutes?: (minutes: number) => Promise<number>;
  setupInfo?: () => Promise<TtsSetupInfo>;
  openBackendFolder?: () => Promise<boolean>;
  onProgress?: (callback: (p: TtsProgress) => void) => () => void;
}

interface ElectronModelApi {
  getConfig: () => Promise<ModelStorageConfig>;
  setConfig: (patch: { storagePath?: string; hfToken?: string; revision?: string; downloadLimitBps?: number }) => Promise<ModelStorageConfig>;
  chooseStorageFolder: () => Promise<ModelStorageConfig | null>;
  pickModelFolder: () => Promise<string | null>;
  listInstalled: () => Promise<Record<string, InstalledModelInfo>>;
  verify: (modelId: string) => Promise<VerifiedModelInfo>;
  inspectFolder: (folderPath: string) => Promise<LocalFolderInspection>;
  download: (payload: { modelId: string; repo: string; revision?: string; files?: { path: string; size: number }[]; include?: string[]; extraRepos?: { repo: string; subdir: string; include?: string[]; revision?: string }[] }) => Promise<DownloadResult>;
  cancelDownload: (modelId: string) => Promise<{ cancelled: boolean }>;
  remove: (modelId: string) => Promise<{ modelId: string; deleted: boolean }>;
  showInFolder: (target: string) => Promise<boolean>;
  onProgress: (callback: (progress: DownloadProgress) => void) => () => void;
}

export interface DubProgress { jobId: string; stage: string; pct: number; message?: string }
export interface DubSegment { id: number; start: number; end: number; text: string; avg_logprob?: number | null; speaker?: string }
export interface DubSpeaker { id: string; count: number; seconds: number; shared?: boolean; reference: { path: string; text: string; duration: number } }
export interface DubRunResult {
  ok: boolean; error?: string; code?: string; cancelled?: boolean; workDir?: string;
  // prepare
  duration?: number; hasVideo?: boolean; source?: string;
  // analyze
  language?: string; languageProbability?: number; segments?: DubSegment[]; background?: string | null; vocals?: string; device?: string;
  reference?: { path: string; text: string; duration: number }; speakers?: DubSpeaker[];
  // translate
  translations?: string[]; alternatives?: string[][];
  // assemble / mux
  output?: string; overflow?: number; shifted?: number; sped?: number;
  timeline?: { index: number; start: number; tempo: number; duration: number; shifted: boolean; early?: boolean; overflow: boolean; drift?: number; slotStart?: number; slotEnd?: number; natural?: number }[];
  extended?: number;
  // selftest
  checks?: { name: string; ok: boolean; detail: string; seconds: number }[]; allOk?: boolean;
}
export interface ElectronDubApi {
  pickMedia: () => Promise<string | null>;
  status: () => Promise<{ environmentReady: boolean; models: Record<string, boolean> }>;
  run: (payload: { jobId: string; stage: 'prepare' | 'analyze' | 'translate' | 'assemble' | 'mux' | 'selftest'; args: Record<string, unknown> }) => Promise<DubRunResult>;
  cancel: () => Promise<boolean>;
  writeFile: (payload: { jobId: string; name: string; bytes: Uint8Array }) => Promise<{ ok: boolean; path?: string; error?: string }>;
  readFile: (target: string) => Promise<Uint8Array | null>;
  saveOutput: (payload: { path: string; suggestedName?: string }) => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>;
  clean: (jobId: string) => Promise<boolean>;
  installEnv: () => Promise<{ ok: boolean; error?: string }>;
  onProgress: (cb: (p: DubProgress) => void) => () => void;
}

export interface StorageInfo {
  portable: boolean;
  installFolder: string;
  userData: string;
  models: { path: string; defaultPath: string; freeBytes: number; totalBytes: number };
  environments: { path: string; defaultPath: string; freeBytes: number; totalBytes: number };
  voices: { path: string };
  moving: boolean;
}
export interface StorageProgress { kind: 'models' | 'environments'; phase: 'moving' | 'repairing' | 'done' | 'error'; done?: number; total?: number }
export interface ElectronStorageApi {
  info: () => Promise<StorageInfo>;
  size: (kind: 'models' | 'environments' | 'voices') => Promise<{ bytes: number; partial: boolean }>;
  pickFolder: (title?: string) => Promise<string | null>;
  open: (kind: 'install' | 'models' | 'environments' | 'voices' | 'userData') => Promise<boolean>;
  move: (payload: { kind: 'models' | 'environments'; folder: string; move: boolean }) => Promise<{ ok: boolean; folder?: string; method?: string; bytes?: number; error?: string; code?: string }>;
  onProgress: (cb: (p: StorageProgress) => void) => () => void;
}

export interface ElectronVoiceApi {
  saveFile: (payload: { id: string; ext: string; bytes: Uint8Array }) => Promise<{ ok: boolean; path?: string; error?: string }>;
  reveal: (target: string) => Promise<{ ok: boolean; error?: string }>;
  exists: (target: string) => Promise<boolean>;
  readFile?: (target: string) => Promise<{ ok: boolean; bytes?: Uint8Array; error?: string }>;
  deleteFile: (target: string) => Promise<{ ok: boolean; error?: string }>;
  openFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>;
}

declare global {
  interface Window {
    electronAPI?: {
      isDesktop?: boolean;
      getVersion?: () => Promise<string>;
      selectFolder?: () => Promise<string | null>;
      selectAudioFile?: () => Promise<string | null>;
      models?: ElectronModelApi;
      voices?: ElectronVoiceApi;
      storage?: ElectronStorageApi;
      dub?: ElectronDubApi;
      tts?: ElectronTtsApi;
      runtime?: ElectronRuntimeApi;
      network?: { check: () => Promise<ConnectivityResult[]> };
    };
  }
}

function modelApi(): ElectronModelApi | undefined {
  if (typeof window === 'undefined') return undefined;
  const api = window.electronAPI;
  if (!api || !api.isDesktop || !api.models) return undefined;
  return typeof api.models.download === 'function' ? api.models : undefined;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

const runtimeApi = (): ElectronRuntimeApi | undefined =>
  typeof window !== 'undefined' ? window.electronAPI?.runtime : undefined;

export const dubApi = (): ElectronDubApi | undefined =>
  typeof window !== 'undefined' && window.electronAPI?.isDesktop ? window.electronAPI.dub : undefined;

export const storageApi = (): ElectronStorageApi | undefined =>
  typeof window !== 'undefined' && window.electronAPI?.isDesktop ? window.electronAPI.storage : undefined;

export const voiceFilesApi = (): ElectronVoiceApi | undefined =>
  typeof window !== 'undefined' && window.electronAPI?.isDesktop ? window.electronAPI.voices : undefined;

export const DesktopBridge = {
  get runtimeAvailable(): boolean {
    return Boolean(runtimeApi());
  },
  checkConnectivity: async (): Promise<ConnectivityResult[]> => {
    try { return (await window.electronAPI?.network?.check()) ?? []; } catch { return []; }
  },
  runtimeStatus: async (): Promise<RuntimeStatus | null> => {
    try { return (await runtimeApi()?.status()) ?? null; } catch { return null; }
  },
  runtimeInstall: async (adapter: string, opts: { torchTag?: string; force?: boolean } = {}) => {
    const api = runtimeApi();
    if (!api) return { ok: false, error: 'The installer is only available in the desktop app.' };
    try { return await api.install({ adapter, ...opts }); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  },
  runtimePause: async () => { try { return (await runtimeApi()?.pause())?.paused ?? false; } catch { return false; } },
  runtimeCancel: async (discard = false) => { try { return (await runtimeApi()?.cancel({ discard })) ?? false; } catch { return false; } },
  runtimeRemove: async (adapter: string) => { try { return (await runtimeApi()?.remove(adapter)) ?? false; } catch { return false; } },
  runtimeRemoveEnv: async (envId: string) => { try { return (await runtimeApi()?.removeEnv(envId)) ?? false; } catch { return false; } },
  runtimeOpenFolder: async () => { try { return (await runtimeApi()?.openFolder()) ?? false; } catch { return false; } },
  onRuntimeProgress: (cb: (p: RuntimeProgress) => void): (() => void) => runtimeApi()?.onProgress(cb) ?? (() => undefined),

  /** True when the Electron shell exposes the real speech-synthesis backend. */
  get ttsAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean(window.electronAPI?.tts?.synthesize);
  },

  /** Live engine status lines (startup stages, pip output). Returns an unsubscribe fn. */
  onTtsProgress(callback: (p: TtsProgress) => void): () => void {
    const api = typeof window !== 'undefined' ? window.electronAPI?.tts : undefined;
    if (!api || !api.onProgress) return () => undefined;
    return api.onProgress(callback);
  },

  async openBackendFolder(): Promise<boolean> {
    const api = typeof window !== 'undefined' ? window.electronAPI?.tts : undefined;
    if (!api || !api.openBackendFolder) return false;
    try {
      return await api.openBackendFolder();
    } catch {
      return false;
    }
  },

  /** 0 disables idle-stop; otherwise the engine unloads after N idle minutes. */
  async setTtsIdleMinutes(minutes: number): Promise<void> {
    const api = typeof window !== 'undefined' ? window.electronAPI?.tts : undefined;
    try {
      await api?.setIdleMinutes?.(minutes);
    } catch {
      /* non-fatal */
    }
  },

  /** Runs the downloaded model on the local Python backend. Returns WAV bytes. */
  async synthesize(payload: SynthesizePayload): Promise<SynthesizeResult> {
    const api = typeof window !== 'undefined' ? window.electronAPI?.tts : undefined;
    if (!api) return { ok: false, error: 'Speech engine is only available in the desktop app.' };
    try {
      return await api.synthesize(payload);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /** Stop button: ends the running generation on the engine at once (it frees the GPU/CPU within a moment). */
  async cancelSynthesis(requestId?: string): Promise<void> {
    const api = typeof window !== 'undefined' ? window.electronAPI?.tts : undefined;
    try { await api?.cancel?.(requestId); } catch { /* nothing running */ }
  },

  /** True when running inside the Electron shell with the model manager wired. */
  get available(): boolean {
    return Boolean(modelApi());
  },

  /** True when a download was paused on purpose (vs cancelled/failed). */
  isPausedDownload: (model: { isPaused?: boolean; isDownloading?: boolean }): boolean =>
    Boolean(model.isPaused && !model.isDownloading),

  formatBytes,

  async getConfig(): Promise<ModelStorageConfig | null> {
    const api = modelApi();
    if (!api) return null;
    try {
      return await api.getConfig();
    } catch {
      return null;
    }
  },

  async setConfig(patch: { storagePath?: string; hfToken?: string; revision?: string; downloadLimitBps?: number }): Promise<ModelStorageConfig | null> {
    const api = modelApi();
    if (!api) return null;
    try {
      return await api.setConfig(patch);
    } catch {
      return null;
    }
  },

  async chooseStorageFolder(): Promise<ModelStorageConfig | null> {
    const api = modelApi();
    if (!api) return null;
    try {
      return await api.chooseStorageFolder();
    } catch {
      return null;
    }
  },

  /** Native folder picker used by the "Add local model" dialog. */
  async pickModelFolder(): Promise<string | null> {
    const api = modelApi();
    if (!api) return null;
    try {
      return await api.pickModelFolder();
    } catch {
      return null;
    }
  },

  async listInstalled(): Promise<Record<string, InstalledModelInfo> | null> {
    const api = modelApi();
    if (!api) return null;
    try {
      return await api.listInstalled();
    } catch {
      return null;
    }
  },

  async verify(modelId: string): Promise<VerifiedModelInfo | null> {
    const api = modelApi();
    if (!api) return null;
    try {
      return await api.verify(modelId);
    } catch {
      return null;
    }
  },

  async inspectFolder(folderPath: string): Promise<LocalFolderInspection | null> {
    const api = modelApi();
    if (!api) return null;
    try {
      return await api.inspectFolder(folderPath);
    } catch {
      return null;
    }
  },

  async download(payload: {
    modelId: string;
    repo: string;
    revision?: string;
    files?: { path: string; size: number }[];
    include?: string[];
    extraRepos?: { repo: string; subdir: string; include?: string[]; revision?: string }[];
  }): Promise<DownloadResult> {
    const api = modelApi();
    if (!api) return { ok: false, error: 'Desktop model manager is not available in this environment.' };
    try {
      return await api.download(payload);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async cancelDownload(modelId: string): Promise<boolean> {
    const api = modelApi();
    if (!api) return false;
    try {
      const result = await api.cancelDownload(modelId);
      return Boolean(result && result.cancelled);
    } catch {
      return false;
    }
  },

  async remove(modelId: string): Promise<boolean> {
    const api = modelApi();
    if (!api) return false;
    try {
      const result = await api.remove(modelId);
      return Boolean(result && result.deleted);
    } catch {
      return false;
    }
  },

  /** Locates the downloaded model folder in the OS file explorer (desktop only). */
  async locateModelFolder(modelId: string): Promise<boolean> {
    const api = modelApi();
    if (!api) return false;
    const configured = await this.getConfig().catch(() => null);
    const root = configured?.storagePath || '';
    // InstalledModelInfo.path is the source of truth; fall back to storagePath/modelId.
    const installed = await this.listInstalled().catch(() => null);
    const target =
      (installed && installed[modelId] && installed[modelId].path) ||
      (root ? `${root.replace(/[\\/]+$/, '')}/${modelId}` : modelId);
    try {
      return await api.showInFolder(target);
    } catch {
      return false;
    }
  },

  async showInFolder(target: string): Promise<boolean> {
    const api = modelApi();
    if (!api) return false;
    try {
      return await api.showInFolder(target);
    } catch {
      return false;
    }
  },

  /** Subscribes to live download progress. Returns an unsubscribe function. */
  onProgress(callback: (progress: DownloadProgress) => void): () => void {
    const api = modelApi();
    if (!api) return () => undefined;
    return api.onProgress(callback);
  },
};
