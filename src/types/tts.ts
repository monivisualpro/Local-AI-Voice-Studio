export interface ModelCapability {
  tts: boolean;
  customVoice: boolean;
  referenceVoice: boolean;
  voiceDesign: boolean;
  streaming: boolean;
  speed: boolean;
  pitch: boolean;
  emotion: boolean;
  instruction: boolean;
  temperature: boolean;
  pause: boolean;
  volume: boolean;
}

export type AdapterType = 
  | 'qwen3' 
  | 'chatterbox' 
  | 'kokoro' 
  | 'f5tts' 
  | 'parler' 
  | 'xtts' 
  | 'svara' 
  | 'sooktam' 
  | 'urdu-tortoise' 
  | 'dub' 
  | 'generic';

export type ComputeDevice = 'auto' | 'cpu' | 'cuda';

export type ModelCategory = 
  | 'all'
  | 'recommended'
  | 'lightweight'
  | 'voice-cloning'
  | 'multilingual'
  | 'voice-design'
  | 'high-quality'
  | 'cpu-friendly'
  | 'gpu-optimized'
  | 'installed';

export interface TTSModel {
  id: string;
  name: string;
  repo: string;
  adapter: AdapterType;
  version: string;
  parameterSize: string;
  downloadSize: string;
  downloadSizeBytes: number;
  installedSize: string;
  license: string;
  languages: string[];
  capabilities: ModelCapability;
  cpu: boolean;
  cuda: boolean;
  recommendedVRAM: number; // in GB
  recommendedRAM: number; // in GB
  categories: ModelCategory[];
  /** What the model is for. Missing = a speech (TTS) model. Dubbing helpers are not shown in the Studio. */
  kind?: 'tts' | 'asr' | 'translation';
  isInstalled: boolean;
  isDownloading?: boolean;
  downloadProgress?: number; // 0-100
  downloadSpeed?: string;
  downloadedMB?: number;
  totalMB?: number;
  isLoaded?: boolean;
  description: string;
  hfUrl: string;
  source: 'huggingface' | 'local';
  revision?: string;
  /** Only download repo files matching these patterns (e.g. 'F5TTS_v1_Base/*'). */
  downloadInclude?: string[];
  /** Extra Hugging Face repos downloaded into a sub-folder of the model (e.g. a separate tokenizer). */
  extraRepos?: { repo: string; subdir: string; include?: string[]; revision?: string }[];
  /** The repository is gated: the user must accept its terms on Hugging Face and add a token in Settings. */
  gated?: boolean;
  /** Downloaded files are missing/unfinished: pressing Download finishes the job (finished files are kept). */
  needsRepair?: boolean;
  repairMissing?: string[];
  downloadEta?: string;
  downloadVerifying?: boolean;
  /** Extra info shown when the model needs its own Python environment. */
  runtimeNote?: string;

  /* ---- real on-disk state (desktop app) ---------------------------------- */
  /** Bytes actually present on disk, measured from the filesystem. */
  installedBytes?: number;
  /** True once the on-disk files have been verified for this model. */
  diskVerified?: boolean;
  /** Where the install flag came from: the real disk scan or the demo preview. */
  installSource?: 'disk' | 'demo';
  /** Set when the last download attempt failed (shown in the UI). */
  downloadError?: string;
  /** Set when loading the model failed (e.g. weights missing on disk). */
  loadError?: string;
  /** Live download details coming from the desktop model manager. */
  currentFile?: string;
  downloadFileIndex?: number;
  downloadFileCount?: number;
  /** True while a download is intentionally paused (partial .part files kept for resume). */
  isPaused?: boolean;
  /** Facts captured when a local folder was inspected. */
  localRuntime?: string;
  localWarnings?: string[];
  localFileCount?: number;
}

export interface HardwareInfo {
  gpuName: string;
  vramGB: number;
  vramUsedGB: number;
  cpuName: string;
  cpuCores: number;
  ramGB: number;
  ramUsedGB: number;
  tier: 1 | 2 | 3 | 4 | 5;
  activeDevice: 'cpu' | 'cuda';
  computeSetting: ComputeDevice;
  engineStatus: 'Ready' | 'Busy' | 'Unloaded' | 'Error';
  cudaAvailable: boolean;
}

export interface ReferenceFolder {
  id: string;
  name: string;
  description: string;
  color?: string; // Hex or theme color for folder visual identification
  createdAt: number;
  isDefault?: boolean;
}

export interface ReferenceAudioItem {
  id: string;
  name: string;
  language: string; // e.g. "English", "Spanish", "French", "Japanese", "German", "Hindi", "Mandarin", "Italian", "Hindi", "Urdu"
  accent: string; // e.g. "US General", "British RP", "Australian", "Scottish", "Spanish Castilian", "French Parisian", "Tokyo Japanese", "Indian English"
  folderId: string; // Reference folder ID
  folderName: string;
  size: number; // bytes
  duration: number; // seconds
  url: string; // playable audio url
  referenceText?: string; // transcript for alignment
  speakerGender?: 'male' | 'female' | 'neutral';
  timbreDescription?: string; // acoustic notes
  tags?: string[];
  createdAt: number;
  isBuiltIn?: boolean;
  downloadUrl?: string; // Remote download URL for on-demand downloading
  isDownloaded?: boolean; // True once downloaded locally to storage
  downloadProgress?: number; // 0-100 download progress percentage
  localPath?: string; // real file on disk (desktop app): <app data>/voice-library/<id>.<ext>
  /** True when the audio of one of the user's own voices cannot be found any more (saved by an old version). */
  audioMissing?: boolean;
}

export interface ModelRecommendation {
  modelId: string;
  suitability: 'optimal' | 'compatible' | 'heavy' | 'unsupported';
  score: number; // 0-100 match percentage
  badgeText: string;
  primaryReason: string;
  details: string;
  realtimeFactor: string; // e.g. "14.5x Realtime"
  memoryHeadroomGB: number;
}

export interface SystemHardwareAnalysis {
  gpuName: string;
  vramGB: number;
  vramUsedGB: number;
  cpuName: string;
  cpuCores: number;
  ramGB: number;
  ramUsedGB: number;
  tier: 1 | 2 | 3 | 4 | 5;
  activeDevice: 'cpu' | 'cuda';
  computeSetting: ComputeDevice;
  engineStatus: 'Ready' | 'Busy' | 'Unloaded' | 'Error';
  cudaAvailable: boolean;
  tierSummary: string; // e.g. "Workstation Grade Neural Rig"
  topRecommendedModelId: string;
  speedRecommendedModelId: string;
  qualityRecommendedModelId: string;
  modelEvaluations: Record<string, ModelRecommendation>;
}

export interface Voice {
  id: string;
  name: string;
  category: 'preset' | 'reference' | 'design';
  gender?: 'male' | 'female' | 'neutral';
  language: string;
  modelCompatibility: string[]; // ['*'] for all
  description: string;
  audioSampleUrl?: string;
  stylePrompt?: string;
  isCustom?: boolean;
  referenceFile?: {
    name: string;
    size: number;
    duration: number;
    url: string;
    referenceText?: string;
  };
}

export interface GenerationChunk {
  id: string;
  index: number;
  text: string;
  wordCount: number;
  /** Last piece of its paragraph: the joiner leaves a longer pause after it. */
  paragraphEnd?: boolean;
  status: 'waiting' | 'generating' | 'completed' | 'failed';
  progress: number;
  audioBuffer?: AudioBuffer;
  audioUrl?: string;
  duration?: number;
  error?: string;
}

export interface GenerationSettings {
  speed: number; // 0.5 - 2.0 (default 1.0)
  pitch: number; // -12 to +12 semitones (default 0)
  emotion: string; // 'neutral' | 'warm' | 'excited' | 'dramatic' | 'whisper' | 'authoritative'
  instruction: string; // e.g. "Speak calmly, warmly and naturally."
  temperature: number; // 0.1 - 1.0 (default 0.7)
  pauseDurationMs: number; // 100 - 800ms
  volume: number; // 0 - 100
}

export interface GenerationHistoryItem {
  id: string;
  timestamp: number;
  projectName?: string;
  modelId: string;
  modelName: string;
  voiceId: string;
  voiceName: string;
  language: string;
  script: string;
  duration: number;
  audioUrl: string;
  device: string;
  fileSizeBytes: number;
  settings: GenerationSettings;
}

export interface StudioProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  modelId: string;
  voiceId: string;
  language: string;
  script: string;
  settings: GenerationSettings;
  referenceAudio?: {
    name: string;
    size: number;
    duration: number;
    url: string;
    text?: string;
  };
  lastGeneratedAudioUrl?: string;
  lastGeneratedDuration?: number;
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  modelStoragePath: string;
  computeDevice: ComputeDevice;
  selectedGpuIndex: number;
  cpuThreads: number | 'auto';
  ramLimitGB: number | 'auto';
  autoUnloadInactive: boolean;
  /** Minutes of inactivity before the local speech engine unloads; 0 = never. */
  idleUnloadMinutes?: number;
  lowMemoryMode: boolean;
  sampleRate: 24000 | 44100 | 48000;
  exportFormat: 'wav' | 'mp3';
  normalizeAudio: boolean;
  trimSilence: boolean;
  firstRunCompleted: boolean;
}

/** True for models that speak (everything except the dubbing helpers: speech recognition, translation). */
export const isSpeechModel = (m: { kind?: string }): boolean => !m.kind || m.kind === 'tts';
