import { TTSModel, AdapterType, ModelCategory } from '../types/tts';
import { HardwareDetector } from './hardwareDetector';
import {
  DesktopBridge,
  formatBytes,
  type DownloadProgress,
  type InstalledModelInfo,
} from './desktopBridge';

import { formatSpeed } from '../utils/format';

function formatEta(sec?: number | null): string | undefined {
  if (sec == null || !isFinite(sec) || sec <= 0) return undefined;
  if (sec < 60) return `${Math.round(sec)}s left`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s left`;
  return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m left`;
}

export const INITIAL_MODELS: TTSModel[] = [
  {
    id: 'qwen3-tts-0.6b-base',
    name: 'Qwen3-TTS 0.6B Base',
    repo: 'Qwen/Qwen3-TTS-12Hz-0.6B-Base',
    adapter: 'qwen3',
    version: 'v1.2.0',
    parameterSize: '0.6B',
    downloadSize: '980 MB',
    downloadSizeBytes: 1027604480,
    installedSize: '1.02 GB',
    license: 'Apache-2.0',
    languages: ['English', 'Chinese', 'Japanese', 'Korean', 'German', 'French', 'Spanish', 'Italian', 'Portuguese', 'Russian'],
    categories: ['recommended', 'voice-cloning', 'multilingual', 'gpu-optimized'],
    capabilities: {
      tts: true,
      customVoice: true,
      referenceVoice: true,
      voiceDesign: false,
      streaming: true,
      speed: true,
      pitch: true,
      emotion: true,
      instruction: false,
      temperature: true,
      pause: true,
      volume: true,
    },
    cpu: true,
    cuda: true,
    recommendedVRAM: 4.0,
    recommendedRAM: 8.0,
    isInstalled: false,
    isLoaded: false,
    description: 'Lightweight foundation model featuring 12Hz speech tokenization. Exceptional cross-lingual zero-shot voice cloning with low memory footprint.',
    hfUrl: 'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base',
    source: 'huggingface',
    revision: 'main (a8f941c)',
  },
  {
    id: 'kokoro-82m',
    name: 'Kokoro 82M Ultra-Lightweight',
    repo: 'hexgrad/Kokoro-82M',
    adapter: 'kokoro',
    version: 'v0.19',
    parameterSize: '82M',
    downloadSize: '86 MB',
    downloadSizeBytes: 90177536,
    installedSize: '95 MB',
    license: 'Apache-2.0',
    languages: ['English', 'Japanese', 'Chinese', 'Spanish', 'French', 'Italian', 'Hindi'],
    categories: ['recommended', 'lightweight', 'cpu-friendly', 'multilingual'],
    capabilities: {
      tts: true,
      customVoice: true,
      referenceVoice: false,
      voiceDesign: false,
      streaming: true,
      speed: true,
      pitch: true,
      emotion: false,
      instruction: false,
      temperature: true,
      pause: true,
      volume: true,
    },
    cpu: true,
    cuda: true,
    recommendedVRAM: 1.0,
    recommendedRAM: 2.0,
    isInstalled: false,
    isLoaded: false,
    description: 'Sub-centisecond latency speech generator under 100MB. Exceptional prosody and naturalness on low-tier laptops and CPU-only systems.',
    hfUrl: 'https://huggingface.co/hexgrad/Kokoro-82M',
    source: 'huggingface',
    revision: 'main (92c4b12)',
  },
  {
    id: 'qwen3-tts-1.7b-voicedesign',
    name: 'Qwen3-TTS 1.7B VoiceDesign',
    repo: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
    adapter: 'qwen3',
    version: 'v1.2.0',
    parameterSize: '1.7B',
    downloadSize: '2.85 GB',
    downloadSizeBytes: 3060164608,
    installedSize: '3.10 GB',
    license: 'Apache-2.0',
    languages: ['English', 'Chinese', 'Japanese', 'Korean', 'German', 'French', 'Spanish', 'Italian'],
    categories: ['voice-design', 'high-quality', 'voice-cloning', 'gpu-optimized'],
    capabilities: {
      tts: true,
      customVoice: true,
      referenceVoice: false,
      voiceDesign: true,
      streaming: true,
      speed: true,
      pitch: true,
      emotion: true,
      instruction: true,
      temperature: true,
      pause: true,
      volume: true,
    },
    cpu: true,
    cuda: true,
    recommendedVRAM: 8.0,
    recommendedRAM: 16.0,
    isInstalled: false,
    isLoaded: false,
    description: 'Flagship open-weights model capable of prompting voice design via natural language descriptions, granular prosodic instruction, and high-fidelity vocal nuance.',
    hfUrl: 'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
    source: 'huggingface',
    revision: 'main (7c1b29a)',
  },
  {
    id: 'f5-tts-base',
    name: 'F5-TTS Flow Matching',
    repo: 'SWivid/F5-TTS',
    adapter: 'f5tts',
    version: 'v1.0.0',
    parameterSize: '350M',
    downloadSize: '720 MB',
    downloadSizeBytes: 754974720,
    installedSize: '790 MB',
    license: 'MIT',
    languages: ['English', 'Chinese'],
    categories: ['voice-cloning', 'recommended', 'high-quality'],
    capabilities: {
      tts: true,
      customVoice: true,
      referenceVoice: true,
      voiceDesign: false,
      streaming: true,
      speed: true,
      pitch: false,
      emotion: true,
      instruction: false,
      temperature: true,
      pause: true,
      volume: true,
    },
    cpu: true,
    cuda: true,
    recommendedVRAM: 4.0,
    recommendedRAM: 8.0,
    isInstalled: false,
    isLoaded: false,
    description: 'Non-autoregressive speech generation with Flow Matching. Seamless 0-shot cloning with acoustic inpainting and realistic breath dynamics.',
    hfUrl: 'https://huggingface.co/SWivid/F5-TTS',
    downloadInclude: ['F5TTS_v1_Base/*'],
    source: 'huggingface',
    revision: 'main (5f939e0)',
  },
  {
    id: 'chatterbox-tts-fast',
    name: 'Chatterbox TTS Ultra-Fast',
    repo: 'ResembleAI/chatterbox',
    adapter: 'chatterbox',
    version: 'v0.9.4',
    parameterSize: '0.3B',
    downloadSize: '420 MB',
    downloadSizeBytes: 440401920,
    installedSize: '460 MB',
    license: 'MIT',
    languages: ['English'],
    categories: ['lightweight', 'cpu-friendly'],
    capabilities: {
      tts: true,
      customVoice: true,
      referenceVoice: true,
      voiceDesign: false,
      streaming: true,
      speed: true,
      pitch: false,
      emotion: true,
      instruction: false,
      temperature: false,
      pause: true,
      volume: true,
    },
    cpu: true,
    cuda: true,
    recommendedVRAM: 2.0,
    recommendedRAM: 4.0,
    isInstalled: false,
    isLoaded: false,
    description: 'Sub-50ms latency speech generator optimized for real-time conversation and CPU-only devices. Pure English acoustic focus.',
    hfUrl: 'https://huggingface.co/ResembleAI/chatterbox',
    downloadInclude: ['ve.safetensors', 't3_cfg.safetensors', 's3gen.safetensors', 'tokenizer.json', 'conds.pt', 'config.json'],
    source: 'huggingface',
    revision: 'main',
  },
  {
    id: 'parler-tts-mini',
    name: 'Parler-TTS Mini Prompt-Driven',
    repo: 'parler-tts/parler-tts-mini-v1',
    adapter: 'parler',
    version: 'v1.0',
    parameterSize: '880M',
    downloadSize: '1.58 GB',
    downloadSizeBytes: 1696614400,
    installedSize: '1.75 GB',
    license: 'Apache-2.0',
    languages: ['English'],
    categories: ['voice-design', 'recommended'],
    capabilities: {
      tts: true,
      customVoice: true,
      referenceVoice: false,
      voiceDesign: true,
      streaming: true,
      speed: true,
      pitch: true,
      emotion: true,
      instruction: true,
      temperature: true,
      pause: true,
      volume: true,
    },
    cpu: true,
    cuda: true,
    recommendedVRAM: 4.0,
    recommendedRAM: 8.0,
    isInstalled: false,
    isLoaded: false,
    description: 'Controlled via natural language voice prompts (e.g. "Jon\'s voice is slightly distant, reading with calm cadence in a slightly hollow room").',
    hfUrl: 'https://huggingface.co/parler-tts/parler-tts-mini-v1',
    source: 'huggingface',
    revision: 'main (a902bf8)',
  },
  {
    id: 'indic-parler-tts',
    name: 'Indic Parler-TTS (21 Indian languages)',
    repo: 'ai4bharat/indic-parler-tts',
    adapter: 'parler',
    version: 'v1.0',
    parameterSize: '0.9B',
    downloadSize: '3.8 GB',
    downloadSizeBytes: 4080000000, // model.safetensors 3.75 GB + tokenizers
    installedSize: '3.9 GB',
    license: 'Apache-2.0 (gated: accept the terms on Hugging Face)',
    languages: ['Hindi', 'English', 'Bengali', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Marathi', 'Gujarati', 'Odia',
      'Assamese', 'Urdu', 'Nepali', 'Sanskrit', 'Maithili', 'Konkani', 'Dogri', 'Bodo', 'Manipuri', 'Santali', 'Sindhi'],
    categories: ['multilingual', 'voice-design', 'high-quality', 'recommended'],
    capabilities: {
      tts: true,
      customVoice: true,
      referenceVoice: false,
      voiceDesign: true,
      streaming: false,
      speed: false,
      pitch: false,
      emotion: true,
      instruction: true,
      temperature: true,
      pause: true,
      volume: true,
    },
    cpu: true,
    cuda: true,
    recommendedVRAM: 6.0,
    recommendedRAM: 12.0,
    isInstalled: false,
    isLoaded: false,
    description: 'AI4Bharat + Hugging Face model for 20 Indian languages and English. The language follows the script you type; the voice is chosen by name (e.g. "Divya", "Rohit") and a text description. Uses two tokenizers (Indic prompt tokenizer + Flan-T5 description tokenizer), both downloaded automatically. Gated (but free): accept the terms on its Hugging Face page, then paste a free token in Settings -> Hugging Face access token. No voice cloning.',
    hfUrl: 'https://huggingface.co/ai4bharat/indic-parler-tts',
    downloadInclude: ['config.json', 'generation_config.json', 'model.safetensors', 'preprocessor_config.json',
      'special_tokens_map.json', 'tokenizer.json', 'tokenizer.model', 'tokenizer_config.json'],
    extraRepos: [{
      repo: 'google/flan-t5-large',
      subdir: 'description_tokenizer',
      include: ['tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'spiece.model', 'config.json'],
    }],
    gated: true,
    source: 'huggingface',
    revision: 'main',
  },
  {
    id: 'svara-tts-v1',
    name: 'Svara-TTS (19 Indian languages)',
    repo: 'kenpath/svara-tts-v1',
    adapter: 'svara',
    version: 'v1.0.0',
    parameterSize: '3B',
    downloadSize: '~13 GB',
    downloadSizeBytes: 13400000000, // estimate: 3B parameters stored as float32 + SNAC codec
    installedSize: '~13 GB',
    license: 'Apache-2.0',
    languages: ['Hindi', 'Bengali', 'Marathi', 'Telugu', 'Kannada', 'Bhojpuri', 'Magahi', 'Chhattisgarhi', 'Maithili',
      'Assamese', 'Bodo', 'Dogri', 'Gujarati', 'Malayalam', 'Punjabi', 'Tamil', 'Nepali', 'Sanskrit', 'Indian English'],
    categories: ['multilingual', 'high-quality', 'recommended'],
    capabilities: {
      tts: true,
      customVoice: true,
      referenceVoice: false,
      voiceDesign: false,
      streaming: false,
      speed: false,
      pitch: false,
      emotion: true,
      instruction: false,
      temperature: true,
      pause: true,
      volume: true,
    },
    cpu: true,
    cuda: true,
    recommendedVRAM: 8.0,
    recommendedRAM: 16.0,
    isInstalled: false,
    isLoaded: false,
    description: 'Kenpath Orpheus-style 3B model with 38 built-in voices (a male and a female for each of 19 languages). Pick the language and the persona gender; the matching "Hindi (Female)"-style speaker is chosen automatically. End a sentence with <happy>, <sad>, <anger>, <fear> or <clear> for style. The SNAC audio codec downloads with the model. Needs a GPU for comfortable speed.',
    hfUrl: 'https://huggingface.co/kenpath/svara-tts-v1',
    downloadInclude: ['config.json', 'generation_config.json', '*.safetensors', 'model.safetensors.index.json',
      'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'adapter_config.json'],
    extraRepos: [{
      repo: 'hubertsiuzdak/snac_24khz',
      subdir: 'snac_24khz',
      include: ['config.json', 'pytorch_model.bin'],
    }],
    source: 'huggingface',
    revision: 'main',
  },
  {
    id: 'sooktam-2',
    name: 'Sooktam-2 (BharatGen, 12 Indian languages)',
    repo: 'bharatgenai/sooktam2',
    adapter: 'sooktam',
    version: 'v2',
    parameterSize: '~330M',
    downloadSize: '6.7 GB',
    downloadSizeBytes: 7216000000,
    installedSize: '6.8 GB',
    license: 'BharatGen non-commercial license',
    languages: ['Hindi', 'Marathi', 'Gujarati', 'Tamil', 'Telugu', 'Kannada', 'Bengali', 'Malayalam', 'Odia', 'Urdu', 'Punjabi', 'Indian English'],
    categories: ['voice-cloning', 'multilingual', 'high-quality'],
    capabilities: {
      tts: true,
      customVoice: true,
      referenceVoice: true,
      voiceDesign: false,
      streaming: false,
      speed: false,
      pitch: false,
      emotion: true,
      instruction: false,
      temperature: true,
      pause: true,
      volume: true,
    },
    cpu: true,
    cuda: true,
    recommendedVRAM: 6.0,
    recommendedRAM: 12.0,
    isInstalled: false,
    isLoaded: false,
    description: 'BharatGen F5-TTS-based model for 12 Indian languages with voice cloning. Add a 3-10 second reference clip AND type what it says (in the same language); without a clip it uses the sample voice that ships with the model. Runs in its own environment (torch 2.6 / transformers 4.41). Non-commercial licence.',
    hfUrl: 'https://huggingface.co/bharatgenai/sooktam2',
    source: 'huggingface',
    revision: 'main',
  },
  {
    id: 'urdu-tts-tortoise',
    name: 'Urdu TTS (Tortoise, AhmedHanzala)',
    repo: 'zohann/urdu-tts',
    adapter: 'urdu-tortoise',
    version: 'multispeaker',
    parameterSize: '~0.4B',
    downloadSize: '~4.3 GB',
    downloadSizeBytes: 4600000000, // estimate: 1.72 GB fine-tuned model + stock Tortoise diffusion/CLVP/vocoder
    installedSize: '~4.3 GB',
    license: 'MIT',
    languages: ['Urdu', 'English'],
    categories: ['voice-cloning', 'high-quality'],
    capabilities: {
      tts: true,
      customVoice: true,
      referenceVoice: true,
      voiceDesign: false,
      streaming: false,
      speed: false,
      pitch: false,
      emotion: false,
      instruction: false,
      temperature: true,
      pause: true,
      volume: true,
    },
    cpu: true,
    cuda: true,
    recommendedVRAM: 6.0,
    recommendedRAM: 12.0,
    isInstalled: false,
    isLoaded: false,
    description: 'Tortoise-TTS fine-tuned for Urdu (multi-speaker variant) with voice cloning from a reference clip. Very slow (minutes per sentence on CPU). The stock Tortoise parts download with it. Runs in its own environment (transformers 4.31).',
    hfUrl: 'https://huggingface.co/zohann/urdu-tts',
    downloadInclude: ['models/urdu-multispeaker/ar-model.pth', 'models/urdu-multispeaker/*.json', 'models/urdu-multispeaker/*tokenizer*', 'tokenizer*.json', '*/tokenizer*.json'],
    extraRepos: [{
      repo: 'Manmay/tortoise-tts',
      subdir: 'base',
      include: ['diffusion_decoder.pth', 'clvp2.pth', 'vocoder.pth'],
    }],
    source: 'huggingface',
    revision: 'main',
  },
  {
    id: 'whisper-large-v3-turbo-ct2',
    name: 'Whisper large-v3 turbo (Dubbing: speech recognition)',
    repo: 'mobiuslabsgmbh/faster-whisper-large-v3-turbo',
    adapter: 'dub',
    kind: 'asr',
    version: 'v3-turbo',
    parameterSize: '0.8B',
    downloadSize: '1.6 GB',
    downloadSizeBytes: 1700000000,
    installedSize: '1.6 GB',
    license: 'MIT',
    languages: ['Hindi', 'English', 'Urdu', 'Tamil', 'Telugu', 'Bengali', 'Marathi', 'Gujarati', 'Kannada', 'Malayalam', 'Punjabi', 'Nepali', 'Arabic', 'Spanish', 'French', 'German', 'Chinese', 'Japanese'],
    categories: ['multilingual'],
    capabilities: {
      tts: false, customVoice: false, referenceVoice: false, voiceDesign: false, streaming: false, speed: false,
      pitch: false, emotion: false, instruction: false, temperature: false, pause: false, volume: false,
    },
    cpu: true,
    cuda: true,
    recommendedVRAM: 4.0,
    recommendedRAM: 8.0,
    isInstalled: false,
    isLoaded: false,
    description: 'Listens to the original speech and writes it down with timings (about 100 languages). Used only by Dubbing. Best accuracy that is still fast; a GPU is recommended.',
    hfUrl: 'https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo',
    downloadInclude: ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.json', 'vocabulary.txt', 'preprocessor_config.json'],
    source: 'huggingface',
    revision: 'main',
  },
  {
    id: 'whisper-small-ct2',
    name: 'Whisper small (Dubbing: lighter speech recognition)',
    repo: 'Systran/faster-whisper-small',
    adapter: 'dub',
    kind: 'asr',
    version: 'small',
    parameterSize: '0.24B',
    downloadSize: '0.5 GB',
    downloadSizeBytes: 520000000,
    installedSize: '0.5 GB',
    license: 'MIT',
    languages: ['Hindi', 'English', 'Urdu', 'Tamil', 'Telugu', 'Bengali', 'Marathi', 'Gujarati', 'Kannada', 'Malayalam', 'Punjabi', 'Nepali', 'Arabic', 'Spanish', 'French', 'German', 'Chinese', 'Japanese'],
    categories: ['multilingual'],
    capabilities: {
      tts: false, customVoice: false, referenceVoice: false, voiceDesign: false, streaming: false, speed: false,
      pitch: false, emotion: false, instruction: false, temperature: false, pause: false, volume: false,
    },
    cpu: true,
    cuda: true,
    recommendedVRAM: 2.0,
    recommendedRAM: 4.0,
    isInstalled: false,
    isLoaded: false,
    description: 'Smaller and faster speech recognizer for Dubbing on weak computers. Less accurate, especially for Indian languages.',
    hfUrl: 'https://huggingface.co/Systran/faster-whisper-small',
    downloadInclude: ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.json', 'vocabulary.txt', 'preprocessor_config.json'],
    source: 'huggingface',
    revision: 'main',
  },
  {
    id: 'nllb-200-distilled-600m',
    name: 'NLLB-200 600M (Dubbing: translation)',
    repo: 'facebook/nllb-200-distilled-600M',
    adapter: 'dub',
    kind: 'translation',
    version: '600M',
    parameterSize: '0.6B',
    downloadSize: '2.5 GB',
    downloadSizeBytes: 2560000000,
    installedSize: '2.5 GB',
    license: 'CC-BY-NC-4.0 (non-commercial)',
    languages: ['English', 'Hindi', 'Urdu', 'Tamil', 'Telugu', 'Bengali', 'Marathi', 'Gujarati', 'Kannada', 'Malayalam', 'Punjabi', 'Odia', 'Nepali', 'Assamese', 'Sanskrit', 'Arabic', 'Spanish', 'French', 'German', 'Chinese', 'Japanese', '200 languages'],
    categories: ['multilingual'],
    capabilities: {
      tts: false, customVoice: false, referenceVoice: false, voiceDesign: false, streaming: false, speed: false,
      pitch: false, emotion: false, instruction: false, temperature: false, pause: false, volume: false,
    },
    cpu: true,
    cuda: true,
    recommendedVRAM: 3.0,
    recommendedRAM: 6.0,
    isInstalled: false,
    isLoaded: false,
    description: 'Translates the transcript between about 200 languages, including all major Indian languages. Used only by Dubbing. Non-commercial licence.',
    hfUrl: 'https://huggingface.co/facebook/nllb-200-distilled-600M',
    downloadInclude: ['config.json', 'generation_config.json', 'model.safetensors', 'pytorch_model.bin', 'sentencepiece.bpe.model', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json'],
    source: 'huggingface',
    revision: 'main',
  },
  {
    id: 'xtts-v2',
    name: 'XTTS-v2 17-Language Workstation',
    repo: 'coqui/XTTS-v2',
    adapter: 'xtts',
    version: 'v2.0.2',
    parameterSize: '1.8B',
    downloadSize: '3.12 GB',
    downloadSizeBytes: 3349889024,
    installedSize: '3.40 GB',
    license: 'Coqui Public Model License (CPML)',
    languages: ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Polish', 'Turkish', 'Russian', 'Dutch', 'Czech', 'Arabic', 'Chinese', 'Japanese', 'Hungarian', 'Korean', 'Hindi'],
    categories: ['multilingual', 'voice-cloning', 'high-quality'],
    capabilities: {
      tts: true,
      customVoice: true,
      referenceVoice: true,
      voiceDesign: false,
      streaming: true,
      speed: true,
      pitch: true,
      emotion: true,
      instruction: false,
      temperature: true,
      pause: true,
      volume: true,
    },
    cpu: true,
    cuda: true,
    recommendedVRAM: 8.0,
    recommendedRAM: 16.0,
    isInstalled: false,
    isLoaded: false,
    description: 'Industry-standard multi-lingual voice cloning foundation with 17 languages supported using 3-second reference voice samples.',
    hfUrl: 'https://huggingface.co/coqui/XTTS-v2',
    downloadInclude: ['model.pth', 'config.json', 'vocab.json', 'speakers_xtts.pth', 'dvae.pth', 'mel_stats.pth'],
    source: 'huggingface',
    revision: 'main (30d4186)',
  },
];

export class ModelRegistry {
  private static instance: ModelRegistry;
  private models: TTSModel[] = [];
  private activeModelId = 'qwen3-tts-0.6b-base';
  private downloadTimers: Map<string, number> = new Map();
  private listeners: Set<() => void> = new Set();
  private progressUnsubscribe: (() => void) | null = null;
  private diskState: Record<string, InstalledModelInfo> = {};
  private storagePath: string | null = null;

  private constructor() {
    const persisted = this.readPersistedModels();
    const persistedMap = new Map<string, TTSModel>(persisted.map((m) => [m.id, m]));

    // Start from the built-in catalogue so catalogue updates always appear, then
    // append every persisted model that is not part of the catalogue (imported
    // local models). The previous implementation silently dropped custom models
    // whenever the persisted list was shorter than the catalogue.
    const builtIn = INITIAL_MODELS.map((init) => {
      const existing = persistedMap.get(init.id);
      if (!existing) return { ...init };
      return {
        ...init,
        isInstalled: Boolean(existing.isInstalled),
        isLoaded: Boolean(existing.isLoaded),
        installedBytes: existing.installedBytes,
        diskVerified: existing.diskVerified,
        installSource: existing.installSource,
      };
    });

    const knownIds = new Set(builtIn.map((m) => m.id));
    const customModels = persisted.filter((m) => m && m.id && !knownIds.has(m.id));
    this.models = [...builtIn, ...customModels];
  }

  private readPersistedModels(): TTSModel[] {
    try {
      const stored = localStorage.getItem('tts_studio_models_v2');
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? (parsed as TTSModel[]) : [];
    } catch {
      return [];
    }
  }

  public static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry();
    }
    return ModelRegistry.instance;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.persist();
    this.listeners.forEach(fn => fn());
  }

  private persist(): void {
    try {
      localStorage.setItem('tts_studio_models_v2', JSON.stringify(this.models));
    } catch {
      // ignore
    }
  }

  public getModels(): TTSModel[] {
    return [...this.models];
  }

  public getInstalledModels(): TTSModel[] {
    return this.models.filter(m => m.isInstalled);
  }

  public getActiveModel(): TTSModel {
    const found = this.models.find(m => m.id === this.activeModelId);
    if (found && found.isInstalled) return found;
    const firstInstalled = this.models.find(m => m.isInstalled);
    return firstInstalled || this.models[0];
  }

  /** Sanitises a revision string such as "main (a8f941c)" down to "main". */
  private resolveRevision(model: TTSModel): string {
    const raw = (model.revision || 'main').trim();
    return raw.split(/\s+/)[0] || 'main';
  }

  /**
   * Reads the REAL state of the managed model directory from disk and updates
   * every entry. Call once on app start and after install/uninstall actions.
   * No-op (demo mode) when the desktop model manager is unavailable.
   */
  public async syncWithDisk(): Promise<void> {
    if (!DesktopBridge.available) return;
    const [config, installed] = await Promise.all([
      DesktopBridge.getConfig(),
      DesktopBridge.listInstalled(),
    ]);
    if (config) this.storagePath = config.storagePath;
    if (!installed) {
      this.notify();
      return;
    }
    this.diskState = installed;

    this.models = this.models.map((model) => {
      if (model.source === 'local') {
        // Imported folders live outside the managed storage directory and are
        // owned by the user - they are validated when they are loaded.
        return { ...model, installSource: 'disk' as const };
      }
      const info = installed[model.id];
      const hasWeights = Boolean(info && info.hasWeights);
      const incomplete = hasWeights && info.complete === false;
      const onDisk = hasWeights && !incomplete;
      return {
        ...model,
        isInstalled: onDisk,
        isLoaded: onDisk ? Boolean(model.isLoaded) : false,
        installedBytes: info && info.bytes ? info.bytes : undefined,
        diskVerified: onDisk,
        installSource: 'disk' as const,
        isDownloading: onDisk ? false : model.isDownloading,
        downloadProgress: onDisk ? 100 : model.downloadProgress,
        downloadError: onDisk
          ? undefined
          : incomplete && !model.isDownloading
            ? `Incomplete: ${info.missing?.length || 1} part(s) missing (${(info.missing || []).slice(0, 3).join(', ')}${(info.missing?.length || 0) > 3 ? ', ...' : ''}). Press Download to finish - files already downloaded are kept.`
            : model.downloadError,
        needsRepair: incomplete && !model.isDownloading,
        repairMissing: incomplete ? info.missing : undefined,
      };
    });
    this.notify();
  }

  /**
   * Finishes an incomplete or damaged model: re-lists the repository and downloads only what is
   * missing or unfinished (complete files are skipped, partial ones resume).
   */
  public async repairModel(modelId: string): Promise<void> {
    this.models = this.models.map(m =>
      m.id === modelId ? { ...m, isInstalled: false, isLoaded: false, needsRepair: true, loadError: undefined, downloadError: undefined } : m
    );
    this.notify();
    await this.startDownload(modelId);
  }

  public getStoragePath(): string | null {
    return this.storagePath;
  }

  public getDiskState(): Record<string, InstalledModelInfo> {
    return { ...this.diskState };
  }

  /** Re-checks the recorded manifest against the files that exist on disk. */
  public async verifyOnDisk(modelId: string): Promise<{ ok: boolean; message: string }> {
    const result = await DesktopBridge.verify(modelId);
    if (!result) {
      return { ok: false, message: 'Disk verification is only available in the desktop application.' };
    }
    const ok = result.ok;
    const message = ok
      ? `Verified ${result.weightFileCount} weight file(s), ${formatBytes(result.bytes)} on disk.`
      : result.missing.length
        ? `Incomplete: ${result.missing.length} file(s) missing (${result.missing.slice(0, 3).join(', ')}${result.missing.length > 3 ? ', ...' : ''})`
        : 'No weight files found on disk.';

    this.models = this.models.map((m) =>
      m.id === modelId
        ? { ...m, diskVerified: ok, installedBytes: result.bytes, loadError: ok ? undefined : message }
        : m
    );
    this.notify();
    return { ok, message };
  }

  public async setActiveModel(modelId: string): Promise<void> {
    const model = this.models.find(m => m.id === modelId);
    if (!model || !model.isInstalled) return;
    this.activeModelId = modelId;
    await this.loadModel(modelId);
    this.notify();
  }

  /**
   * Loads (registers into the session) a model. In the desktop app the files are
   * verified on disk first, so a model that was never really downloaded cannot
   * pretend to be loaded any more.
   */
  public async loadModel(modelId: string): Promise<{ ok: boolean; message: string }> {
    const model = this.models.find(m => m.id === modelId);
    if (!model) return { ok: false, message: 'Unknown model id' };

    if (DesktopBridge.available) {
      if (model.source === 'local') {
        const inspection = await DesktopBridge.inspectFolder(model.repo);
        if (!inspection || !inspection.valid) {
          const message = `Local folder is not usable: ${model.repo}`;
          this.setLoadError(modelId, message);
          return { ok: false, message };
        }
      } else {
        const verified = await DesktopBridge.verify(modelId);
        if (!verified || !verified.ok) {
          const message = verified && verified.missing.length
            ? `Weights incomplete - ${verified.missing.length} file(s) missing. Re-install the model.`
            : 'Weight files were not found on disk. Install the model first.';
          this.setLoadError(modelId, message);
          return { ok: false, message };
        }
      }
    }

    this.models = this.models.map(m => {
      if (m.id === modelId) {
        return { ...m, isLoaded: true, loadError: undefined };
      }
      return { ...m, isLoaded: false };
    });

    const active = this.models.find(m => m.id === modelId);
    // Memory estimate is derived from the real size on disk whenever known.
    const sizeGB = active?.installedBytes ? active.installedBytes / (1024 ** 3) : 0;
    const vramNeeded = sizeGB > 0
      ? sizeGB * 1.1
      : (active?.recommendedVRAM ? active.recommendedVRAM * 0.7 : 2.0);
    HardwareDetector.getInstance().updateMemoryUsage(vramNeeded, 6.4);
    HardwareDetector.getInstance().setEngineStatus('Ready');
    this.notify();

    return {
      ok: true,
      message: sizeGB > 0
        ? `Weights verified on disk (${formatBytes(active?.installedBytes)}).`
        : 'Model registered.',
    };
  }

  private setLoadError(modelId: string, message: string): void {
    this.models = this.models.map(m =>
      m.id === modelId ? { ...m, isLoaded: false, loadError: message } : m
    );
    HardwareDetector.getInstance().setEngineStatus('Error');
    this.notify();
  }

  public unloadModel(modelId: string): void {
    this.models = this.models.map(m => {
      if (m.id === modelId) {
        return { ...m, isLoaded: false };
      }
      return m;
    });
    HardwareDetector.getInstance().updateMemoryUsage(1.2, 4.8);
    this.notify();
  }

  public clearGPUMemory(): void {
    this.models = this.models.map(m => ({ ...m, isLoaded: false }));
    HardwareDetector.getInstance().updateMemoryUsage(0.8, 4.0);
    this.notify();
  }

  public async startDownload(modelId: string): Promise<void> {
    const model = this.models.find(m => m.id === modelId);
    if (!model || model.isInstalled || model.isDownloading) return;

    // Resuming a paused download keeps partial files/progress instead of restarting.
    const resumeFromPause = Boolean(model.isPaused);

    if (!DesktopBridge.available) {
      this.startSimulatedDownload(modelId, resumeFromPause);
      return;
    }
    await this.runRealDownload(model, resumeFromPause);
  }

  /**
   * Streams the real repository files to the configured storage directory and
   * tracks byte-accurate progress reported by the Electron main process.
   */
  private async runRealDownload(model: TTSModel, resumeFromPause = false): Promise<void> {
    const modelId = model.id;
    const totalMB = Math.max(1, Math.round(model.downloadSizeBytes / (1024 * 1024)));

    this.models = this.models.map(m => m.id === modelId ? {
      ...m,
      isDownloading: true,
      isPaused: false,
      downloadProgress: resumeFromPause ? (m.downloadProgress ?? 0) : 0,
      downloadedMB: resumeFromPause ? (m.downloadedMB ?? 0) : 0,
      totalMB,
      downloadSpeed: resumeFromPause ? (m.downloadSpeed || '0.0 MB/s') : '0.0 MB/s',
      currentFile: resumeFromPause ? (m.currentFile || '') : '',
      downloadError: undefined,
    } : m);
    this.notify();

    if (!this.progressUnsubscribe) {
      this.progressUnsubscribe = DesktopBridge.onProgress(progress => this.handleProgress(progress));
    }

    const result = await DesktopBridge.download({
      modelId,
      repo: model.repo,
      revision: this.resolveRevision(model),
      include: model.downloadInclude,
      extraRepos: model.extraRepos,
    });

    if (!result.ok) {
      const error = result.error || 'Download failed';
      const cancelled = /abort|cancel/i.test(error);
      this.models = this.models.map(m => m.id === modelId ? {
        ...m,
        isDownloading: false,
        downloadError: cancelled ? undefined : error,
        downloadProgress: m.downloadProgress,
        downloadedMB: m.downloadedMB,
        currentFile: '',
      } : m);
      this.notify();
      return;
    }

    // Re-read the folder so the installed badge/size come from the real files.
    await this.syncWithDisk();
  }

  /** Applies a live progress event coming from the desktop model manager. */
  private handleProgress(progress: DownloadProgress): void {
    const totalMB = Math.max(1, Math.round((progress.totalBytes || 0) / (1024 * 1024)));
    const downloadedMB = Math.round((progress.downloadedBytes || 0) / (1024 * 1024));

    this.models = this.models.map(m => {
      if (m.id !== progress.modelId) return m;

      if (progress.status === 'error') {
        return {
          ...m,
          isDownloading: false,
          downloadError: progress.error || 'Download failed',
          currentFile: '',
        };
      }

      if (progress.status === 'complete') {
        return {
          ...m,
          isDownloading: false,
          isInstalled: true,
          diskVerified: true,
          installSource: 'disk' as const,
          downloadProgress: 100,
          downloadedMB: totalMB,
          totalMB,
          currentFile: '',
          downloadError: undefined,
        };
      }

      return {
        ...m,
        isDownloading: true,
        downloadProgress: progress.percent,
        downloadedMB,
        totalMB,
        downloadSpeed: progress.speedBps ? formatSpeed(progress.speedBps) : progress.speedMBps ? formatSpeed(progress.speedMBps * 1024 * 1024) : m.downloadSpeed,
        downloadEta: formatEta(progress.etaSeconds),
        downloadVerifying: Boolean(progress.verifying),
        currentFile: progress.currentFile,
        downloadFileIndex: progress.fileIndex,
        downloadFileCount: progress.fileCount,
      };
    });
    this.notify();
  }

  /** Pauses an in-progress download. Partial .part files stay on disk so resume is byte-accurate. */
  public async pauseDownload(modelId: string): Promise<void> {
    const model = this.models.find((m) => m.id === modelId);
    if (!model || !model.isDownloading) return;
    const timer = this.downloadTimers.get(modelId);
    if (timer) {
      window.clearInterval(timer);
      this.downloadTimers.delete(modelId);
    }
    if (DesktopBridge.available) {
      await DesktopBridge.cancelDownload(modelId);
    }
    this.models = this.models.map((m) =>
      m.id === modelId ? { ...m, isDownloading: false, isPaused: true } : m
    );
    this.notify();
  }

  /** Resumes a paused download from kept progress / partial files. */
  public async resumeDownload(modelId: string): Promise<void> {
    const model = this.models.find((m) => m.id === modelId);
    if (!model || model.isInstalled || model.isDownloading || !model.isPaused) return;
    await this.startDownload(modelId);
  }

  /** Demo-only animation used when the desktop model manager is unavailable. */
  private startSimulatedDownload(modelId: string, resumeFromPause = false): void {
    const modelIndex = this.models.findIndex(m => m.id === modelId);
    if (modelIndex === -1) return;

    const model = this.models[modelIndex];
    if (model.isInstalled || model.isDownloading) return;

    const totalMB = Math.round(model.downloadSizeBytes / (1024 * 1024));
    let downloadedMB = resumeFromPause ? (model.downloadedMB ?? 0) : 0;

    this.models[modelIndex] = {
      ...model,
      isDownloading: true,
      isPaused: false,
      downloadProgress: resumeFromPause ? (model.downloadProgress ?? 0) : 0,
      downloadSpeed: '18.4 MB/s',
      downloadedMB,
      totalMB,
    };
    this.notify();

    const intervalId = window.setInterval(() => {
      const current = this.models.find(m => m.id === modelId);
      if (!current || !current.isDownloading) {
        clearInterval(intervalId);
        return;
      }

      // Progress increments by ~45-65 MB per tick
      const chunk = 45 + Math.floor(Math.random() * 30);
      downloadedMB = Math.min(totalMB, downloadedMB + chunk);
      const progress = Math.min(100, Math.round((downloadedMB / totalMB) * 100));
      const speed = (chunk * 2.8).toFixed(1) + ' MB/s';

      if (progress >= 100) {
        clearInterval(intervalId);
        this.downloadTimers.delete(modelId);

        // Demo mode only - no bytes were downloaded, so flag the state as such.
        this.models = this.models.map(m => {
          if (m.id === modelId) {
            return {
              ...m,
              isInstalled: true,
              installSource: 'demo' as const,
              diskVerified: false,
              isDownloading: false,
              downloadProgress: 100,
              downloadedMB: totalMB,
              isLoaded: false,
            };
          }
          return m;
        });
        this.notify();
      } else {
        this.models = this.models.map(m => {
          if (m.id === modelId) {
            return {
              ...m,
              downloadProgress: progress,
              downloadedMB,
              downloadSpeed: speed,
            };
          }
          return m;
        });
        this.notify();
      }
    }, 250);

    this.downloadTimers.set(modelId, intervalId);
  }

  public async cancelDownload(modelId: string): Promise<void> {
    const timer = this.downloadTimers.get(modelId);
    if (timer) {
      window.clearInterval(timer);
      this.downloadTimers.delete(modelId);
    }

    if (DesktopBridge.available) {
      await DesktopBridge.cancelDownload(modelId);
    }

    this.models = this.models.map(m => {
      if (m.id === modelId) {
        return {
          ...m,
          isDownloading: false,
          isPaused: false,
          downloadProgress: 0,
          downloadedMB: 0,
          currentFile: '',
          downloadError: undefined,
        };
      }
      return m;
    });
    this.notify();
  }

  /** Opens the installed model folder in the OS file explorer (desktop only). */
  public async locateOnDisk(modelId: string): Promise<boolean> {
    return DesktopBridge.locateModelFolder(modelId);
  }

  /**
   * Removes a model. Downloaded models are deleted from the storage directory;
   * imported local models are only unregistered because the files belong to the
   * user and live outside the managed directory.
   */
  public async uninstallModel(modelId: string): Promise<void> {
    const model = this.models.find(m => m.id === modelId);
    if (!model) return;

    if (model.source === 'local') {
      this.models = this.models.filter(m => m.id !== modelId);
      this.notify();
      return;
    }

    if (DesktopBridge.available) {
      await DesktopBridge.remove(modelId);
    }

    this.models = this.models.map(m => {
      if (m.id === modelId) {
        return {
          ...m,
          isInstalled: false,
          isLoaded: false,
          installedBytes: undefined,
          diskVerified: false,
          installSource: 'disk' as const,
          isDownloading: false,
          downloadProgress: 0,
          downloadedMB: 0,
          downloadError: undefined,
          loadError: undefined,
        };
      }
      return m;
    });

    delete this.diskState[modelId];

    if (this.activeModelId === modelId) {
      const remaining = this.models.find(m => m.isInstalled);
      if (remaining) {
        this.activeModelId = remaining.id;
      }
    }
    this.notify();
  }

  /** Capability profile assumed for a folder inspected with the given adapter. */
  public getCapabilityProfileForAdapter(adapter: AdapterType): TTSModel['capabilities'] {
    const known = this.models.find(m => m.adapter === adapter && m.source === 'huggingface');
    if (known) return { ...known.capabilities };
    return {
      tts: true,
      customVoice: false,
      referenceVoice: false,
      voiceDesign: false,
      streaming: false,
      speed: true,
      pitch: false,
      emotion: false,
      instruction: false,
      temperature: false,
      pause: false,
      volume: true,
    };
  }

  /**
   * Registers a model imported from a local folder. Every size/parameter fact
   * comes from the real folder inspection done by the desktop model manager.
   */
  public addCustomLocalModel(params: {
    name: string;
    folderPath: string;
    adapter: AdapterType;
    parameterSize: string;
    languages: string[];
    capabilities: TTSModel['capabilities'];
    license: string;
    installedBytes?: number;
    parameterCount?: number | null;
    runtime?: string;
    fileCount?: number;
    warnings?: string[];
  }): TTSModel {
    const bytes = params.installedBytes || 0;
    const sizeGB = bytes / (1024 ** 3);

    const newModel: TTSModel = {
      id: 'local-' + Date.now(),
      name: params.name,
      repo: params.folderPath,
      adapter: params.adapter,
      version: 'Local import',
      parameterSize: params.parameterSize,
      downloadSize: 'Local disk',
      downloadSizeBytes: 0,
      installedSize: bytes ? formatBytes(bytes) : 'Local directory',
      license: params.license || 'Proprietary / User',
      languages: params.languages.length ? params.languages : ['English'],
      categories: ['recommended', 'gpu-optimized'],
      capabilities: params.capabilities,
      cpu: true,
      cuda: true,
      recommendedVRAM: bytes ? Math.max(1, Math.round(sizeGB * 1.2)) : 6.0,
      recommendedRAM: bytes ? Math.max(2, Math.round(sizeGB * 1.5)) : 16.0,
      isInstalled: true,
      isLoaded: false,
      installedBytes: bytes || undefined,
      diskVerified: true,
      installSource: 'disk',
      localRuntime: params.runtime,
      localFileCount: params.fileCount,
      localWarnings: params.warnings,
      description: `Imported from ${params.folderPath}${
        params.parameterCount
          ? ` - ${params.parameterCount.toLocaleString()} parameters read from the weight headers`
          : ''
      }`,
      hfUrl: '#',
      source: 'local',
      revision: 'local',
    };

    this.models.push(newModel);
    this.notify();
    return newModel;
  }
}





