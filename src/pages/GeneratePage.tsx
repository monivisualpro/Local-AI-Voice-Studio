import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Sliders,
  ChevronDown,
  Volume2,
  Mic,
  Languages,
  CheckCircle2,
  AlertCircle,
  FileText,
  Clock,
  Layers,
  Cpu,
  Save,
  Loader2,
  ArrowRight,
  ShieldAlert,
  Zap,
  Folder,
  Pause,
  Play,
  Square,
  Trash2,
  Combine,
} from 'lucide-react';
import {
  TTSModel,
  Voice,
  HardwareInfo,
  GenerationSettings,
  GenerationChunk,
  GenerationHistoryItem,
  ReferenceAudioItem,
} from '../types/tts';
import { AudioEngine, TtsEngineError, TtsCancelledError } from '../services/audioEngine';
import { TtsSetupPanel } from '../components/TtsSetupPanel';
import { getEngineProfile } from '../services/engineProfiles';
import { buildVoiceInstruction, kokoroVoiceFor, withEmotionDescription, chatterboxExaggeration } from '../services/voiceInstruction';
import { storeHistoryAudio } from '../services/historyAudioStorage';
import { DesktopBridge, TtsErrorCode, TtsSetupInfo } from '../services/desktopBridge';
import { StorageService } from '../services/storageService';
import { HardwareDetector } from '../services/hardwareDetector';
import { ModelRegistry } from '../services/modelRegistry';
import { isSpeechModel } from '../types/tts';
import { AudioPlayer } from '../components/AudioPlayer';
import { ReferenceAudioUploader } from '../components/ReferenceAudioUploader';
import { ChunkQueueViewer } from '../components/ChunkQueueViewer';

interface GeneratePageProps {
  activeModel: TTSModel;
  hardware: HardwareInfo;
  onNavigateToModels: (category?: string) => void;
  onNavigateToVoices: () => void;
  onSwitchToCpu?: () => void;
}

export const GeneratePage: React.FC<GeneratePageProps> = ({
  activeModel,
  hardware,
  onNavigateToModels,
  onNavigateToVoices,
  onSwitchToCpu,
}) => {
  const [voices, setVoices] = useState<Voice[]>(StorageService.getInstance().getVoices());
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(voices[0]?.id || 'voice-narrator-male');
  const [selectedLanguage, setSelectedLanguage] = useState<string>(activeModel.languages[0] || 'English');

  // Script state
  const [script, setScript] = useState<string>('');

  // Reference voice state
  const [voiceMode, setVoiceMode] = useState<'preset' | 'reference'>('preset');
  // The voice used last time is selected again after a restart (falls back to the first usable voice).
  const initialReference = (): ReferenceAudioItem | undefined => {
    const list = StorageService.getInstance().getUsableReferenceAudios().filter(r => !r.audioMissing);
    let lastId = '';
    try { lastId = localStorage.getItem('tts_studio_last_reference') || ''; } catch { /* storage unavailable */ }
    return list.find(r => r.id === lastId) || list[0];
  };
  const [activeReferences, setActiveReferences] = useState<ReferenceAudioItem[]>(() => {
    const first = initialReference();
    return first ? [first] : [];
  });
  const [referenceAudio, setReferenceAudio] = useState<{
    id?: string;
    name: string;
    size: number;
    duration: number;
    url: string;
    referenceText?: string;
  } | null>(() => {
    const first = initialReference();
    if (first) {
      return {
        id: first.id,
        name: first.name,
        size: first.size,
        duration: first.duration,
        url: first.url,
        referenceText: first.referenceText,
      };
    }
    return null;
  });

  // System Hardware Analysis & Recommendations
  const allModels = ModelRegistry.getInstance().getModels().filter(isSpeechModel);
  const systemAnalysis = HardwareDetector.getInstance().analyzeSystemAndRecommendModels(allModels);
  const isRecommendedModel = activeModel.id === systemAnalysis.topRecommendedModelId;
  const topRecModel = allModels.find(m => m.id === systemAnalysis.topRecommendedModelId);

  // Advanced settings state
  const [settings, setSettings] = useState<GenerationSettings>({
    speed: 1.0,
    pitch: 0,
    emotion: 'neutral',
    instruction: 'Speak calmly, warmly and naturally.',
    temperature: 0.7,
    pauseDurationMs: 220,
    volume: 100,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationQueue, setGenerationQueue] = useState<GenerationChunk[]>([]);
  const [activeChunkIndex, setActiveChunkIndex] = useState(-1);
  const [isPaused, setIsPaused] = useState(false);       // Pause pressed (the current segment still finishes)
  const [pauseReached, setPauseReached] = useState(false); // the engine is now really idle
  const [isStopping, setIsStopping] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [deviceUsed, setDeviceUsed] = useState<string>('');
  const abortRef = useRef(false);
  const pauseRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const runStartedRef = useRef(0);
  const historyIdRef = useRef<string | null>(null); // one History entry per script, updated when a run is resumed
  const segmentSecondsRef = useRef<number[]>([]);

  // Output state
  const [masterAudioBuffer, setMasterAudioBuffer] = useState<AudioBuffer | null>(null);
  const [masterAudioUrl, setMasterAudioUrl] = useState<string>('');
  const [outputFilename, setOutputFilename] = useState<string>('speech_output.wav');
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [engineIssue, setEngineIssue] = useState<{ code: TtsErrorCode; setup?: TtsSetupInfo } | null>(null);
  const [engineStatus, setEngineStatus] = useState<string>('');
  const masterAudioUrlRef = useRef<string>('');
  // Always-current copy of the segment queue (state updates are async; the merge needs the latest data).
  const queueRef = useRef<GenerationChunk[]>([]);
  const commitQueue = (updater: (q: GenerationChunk[]) => GenerationChunk[]) => {
    queueRef.current = updater(queueRef.current);
    setGenerationQueue(queueRef.current);
  };

  // Low VRAM condition check
  const isLowVramDetected = hardware.vramGB <= 2.5 && hardware.activeDevice === 'cuda';

  // Sync available languages when activeModel changes
  useEffect(() => {
    if (!activeModel.languages.includes(selectedLanguage)) {
      setSelectedLanguage(activeModel.languages[0] || 'English');
    }
  }, [activeModel]);

  // Models that can ONLY clone a voice (Qwen3 Base, F5-TTS) have no preset voices: the preset list would be
  // ignored and the first reference clip used silently (a "female" preset could then speak with a male clip).
  const activeProfile = getEngineProfile(activeModel);
  useEffect(() => {
    if (activeProfile.reference === 'required' && voiceMode !== 'reference') setVoiceMode('reference');
    if (activeProfile.reference === 'none' && voiceMode !== 'preset') setVoiceMode('preset');
  }, [activeModel.id]);

  // Remember which reference voice was used last, so it is selected again after a restart.
  useEffect(() => {
    const id = activeReferences[0]?.id;
    if (!id) return;
    try { localStorage.setItem('tts_studio_last_reference', id); } catch { /* storage unavailable */ }
  }, [activeReferences]);

  // Clock for the "elapsed / time left" display while generating (stops while paused).
  useEffect(() => {
    if (!isGenerating) return;
    const t = setInterval(() => { if (!pauseRef.current) setElapsedSec(Math.round((Date.now() - runStartedRef.current) / 1000)); }, 500);
    return () => clearInterval(t);
  }, [isGenerating]);

  // Keep voices in sync with storage
  useEffect(() => {
    const unsub = StorageService.getInstance().subscribe(() => {
      setVoices(StorageService.getInstance().getVoices());
    });
    return unsub;
  }, []);

  // Live speech-engine status ("Loading PyTorch...", "Loading model weights...")
  useEffect(() => {
    return DesktopBridge.onTtsProgress(p => {
      if (p.installing) return; // pip output is shown inside the setup panel
      if (p.device) setDeviceUsed(p.device);
      setEngineStatus(p.ready || p.idle ? '' : p.message);
    });
  }, []);

  // Compute text statistics
  const charCount = script.length;
  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0;
  const estimatedSeconds = Math.round((wordCount / (145 * settings.speed)) * 60);
  const estM = Math.floor(estimatedSeconds / 60);
  const estS = estimatedSeconds % 60;
  const estTimeFormatted = `${estM.toString().padStart(2, '0')}:${estS.toString().padStart(2, '0')}`;

  const selectedVoice = voices.find(v => v.id === selectedVoiceId) || voices[0];

  /** Everything the real engine needs for the active model (reference clip, description, voice). */
  const resolveSynthOptions = async (): Promise<{
    error?: string;
    options?: {
      modelId: string; modelDir?: string; adapter: string; voiceId?: string;
      gender?: 'male' | 'female' | 'neutral'; language?: string; speed?: number; temperature?: number; exaggeration?: number; postSpeed?: number; postPitch?: number;
      instruct?: string; referenceWav?: Uint8Array; referenceText?: string;
    };
  }> => {
    const profile = getEngineProfile(activeModel);
    let referenceWav: Uint8Array | undefined;
    let referenceText: string | undefined;

    // The reference clip is used when the model REQUIRES one, or when the user chose "Clone". With "Preset" on a
    // model where cloning is optional (Chatterbox, XTTS) the built-in voice is used, as the user selected.
    const useReference = profile.reference === 'required' || (profile.reference === 'optional' && voiceMode === 'reference');
    if (useReference) {
      const refItem = activeReferences[0];
      const ref = refItem ?? referenceAudio;
      if (ref) {
        try {
          // Looked up by id in the stored audio: a saved URL from an earlier session is dead after a restart.
          referenceWav = await AudioEngine.getInstance().referenceToWav(ref.url, refItem?.id ?? referenceAudio?.id);
          referenceText = ('referenceText' in ref ? ref.referenceText : undefined) || undefined;
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (!referenceWav && profile.reference === 'required') {
        return { error: `${activeModel.name} needs a reference voice. ${profile.hint}` };
      }
      if (profile.needsTranscript && !(referenceText && referenceText.trim())) {
        return { error: `${activeModel.name} needs the transcript of the reference clip. ${profile.hint}` };
      }
    }
    if (profile.usesInstruction && !settings.instruction.trim() && !/indic/i.test(activeModel.id)) {
      return { error: `${activeModel.name} needs a voice description. ${profile.hint}` };
    }

    // Preset voices: Kokoro voices are per language. English keeps the distinct persona voices; every other
    // language gets a Kokoro voice of that language and the persona's gender.
    let presetVoice = profile.usesPresetVoices ? selectedVoice?.id : undefined;
    if (profile.usesPresetVoices && activeModel.adapter === 'kokoro' && !['English', 'American English'].includes(selectedLanguage)) {
      presetVoice = kokoroVoiceFor(selectedLanguage, selectedVoice?.gender);
    }

    return {
      options: {
        modelId: activeModel.id,
        modelDir: activeModel.source === 'local' ? activeModel.repo : undefined,
        adapter: activeModel.adapter,
        voiceId: presetVoice,
        gender: selectedVoice?.gender,
        language: selectedLanguage,
        // Engines that change speed themselves get the value; for all others the app stretches the finished audio.
        speed: profile.nativeSpeed ? settings.speed : 1,
        postSpeed: profile.nativeSpeed ? 1 : settings.speed,
        postPitch: settings.pitch,
        temperature: settings.temperature,
        exaggeration: profile.emotion === 'parameter' ? chatterboxExaggeration(settings.emotion) : undefined,
        instruct: profile.usesInstruction
          ? withEmotionDescription(
              buildVoiceInstruction(settings.instruction, useReference ? undefined : selectedVoice?.gender, {
                indic: /indic/i.test(activeModel.id),
                language: selectedLanguage,
              }),
              profile.emotion === 'description' ? settings.emotion : 'neutral'
            )
          : undefined,
        referenceWav,
        referenceText,
      },
    };
  };

  const newRequestId = () => `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const FATAL_CODES: TtsErrorCode[] = ['python-missing', 'deps-missing', 'backend-crashed', 'timeout', 'model-incomplete'];

  /** Checks everything the engine needs before the first segment is sent; shows the problem and returns null when something is missing. */
  const prepareRun = async () => {
    // Real inference needs the desktop shell + a verified, loaded model.
    if (!DesktopBridge.ttsAvailable) {
      setGenerationError(
        'No speech engine available. Real generation runs only in the desktop app - start it with "npm run electron:dev" (a browser tab cannot run the model).'
      );
      return null;
    }
    if (!activeModel.isInstalled || !activeModel.isLoaded) {
      setGenerationError(
        activeModel.loadError ||
          `${activeModel.name} is not loaded. Open Models, verify/install the weights on disk, press "Load Model", then generate again.`
      );
      onNavigateToModels();
      return null;
    }
    const profile = getEngineProfile(activeModel);
    if (!profile.wired) {
      setGenerationError(profile.notWiredReason || `${activeModel.name} cannot run in this build.`);
      return null;
    }
    const synthOptions = await resolveSynthOptions();
    if (synthOptions.error || !synthOptions.options) {
      setGenerationError(synthOptions.error || 'Could not prepare the voice.');
      return null;
    }
    // Unlock WebAudio inside the user gesture (autoplay policy) before looping.
    try {
      const ctx = AudioEngine.getInstance().getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
    } catch {
      /* AudioContext errors are surfaced per-chunk below */
    }
    return synthOptions.options;
  };

  /** One segment, with one automatic retry (sampling is random, so a second try usually fixes a bad take). */
  const generateSegment = async (text: string, options: NonNullable<Awaited<ReturnType<typeof prepareRun>>>) => {
    const engine = AudioEngine.getInstance();
    for (let attempt = 0; ; attempt++) {
      const requestId = newRequestId();
      requestIdRef.current = requestId;
      try {
        return { kind: 'ok' as const, result: await engine.synthesizeWithModel(text, { ...options, requestId, compactSilence: true }) };
      } catch (err) {
        if (err instanceof TtsCancelledError || abortRef.current) return { kind: 'cancelled' as const };
        const fatal = err instanceof TtsEngineError && FATAL_CODES.includes(err.code);
        const userFixable = err instanceof TtsEngineError && /reference|description|transcript/i.test(err.message);
        if (fatal || userFixable || attempt >= 1) return { kind: 'error' as const, err, fatal };
      }
    }
  };

  /** Runs every segment that is not finished yet. Used by Generate (all segments) and Resume (the rest). */
  const runQueue = async (options: NonNullable<Awaited<ReturnType<typeof prepareRun>>>) => {
    abortRef.current = false;
    pauseRef.current = false;
    setIsPaused(false);
    setPauseReached(false);
    setIsStopping(false);
    setGenerationError(null);
    setEngineIssue(null);
    setIsGenerating(true);
    runStartedRef.current = Date.now();
    segmentSecondsRef.current = [];
    setElapsedSec(0);

    let failure: unknown = null;
    try {
      const total = queueRef.current.length;
      for (let i = 0; i < queueRef.current.length; i++) {
        if (abortRef.current) break;

        // Pause: the finished part is merged so it can be played while the engine rests.
        if (pauseRef.current) {
          rebuildMasterAudio();
          setPauseReached(true);
          const pausedAt = Date.now();
          while (pauseRef.current && !abortRef.current) await sleep(120);
          runStartedRef.current += Date.now() - pausedAt; // paused time does not count as generating time
          setPauseReached(false);
          if (abortRef.current) break;
        }

        const item = queueRef.current[i];
        if (item.status === 'completed') continue;

        setActiveChunkIndex(i);
        commitQueue(q => q.map((c, idx) => (idx === i ? { ...c, status: 'generating', progress: 40, error: undefined } : c)));
        const segmentStart = Date.now();
        const outcome = await generateSegment(item.text, options);

        if (outcome.kind === 'cancelled') {
          commitQueue(q => q.map((c, idx) => (idx === i ? { ...c, status: 'waiting', progress: 0 } : c)));
          break;
        }
        if (outcome.kind === 'error') {
          const message = outcome.err instanceof Error ? outcome.err.message : String(outcome.err);
          commitQueue(q => q.map((c, idx) => (idx === i ? { ...c, status: 'failed', progress: 0, error: message } : c)));
          const anyDone = queueRef.current.some(c => c.status === 'completed');
          // Engine-level problems (or the very first piece failing) would repeat for every piece: stop now.
          // A single bad piece does not throw away the others: they are still merged below.
          if (!anyDone || outcome.fatal) {
            failure = outcome.err;
            break;
          }
          failure = failure || outcome.err;
          continue;
        }

        const { result } = outcome;
        if (result.device) setDeviceUsed(result.device);
        segmentSecondsRef.current.push((Date.now() - segmentStart) / 1000);
        const chunkBlobUrl = URL.createObjectURL(result.wavBlob);
        commitQueue(q =>
          q.map((c, idx) => {
            if (idx !== i) return c;
            if (c.audioUrl) URL.revokeObjectURL(c.audioUrl);
            return { ...c, status: 'completed', progress: 100, audioBuffer: result.buffer, audioUrl: chunkBlobUrl, duration: result.duration, error: undefined };
          })
        );
        setGenerationProgress(Math.round((queueRef.current.filter(c => c.status === 'completed').length / total) * 100));
      }

      // ONE continuous track from everything that was generated - also after Stop or a failed piece.
      const merged = rebuildMasterAudio();
      if (merged) await saveToHistory(merged);
      if (failure) throw failure;
    } catch (err) {
      console.error(err);
      if (err instanceof TtsEngineError && FATAL_CODES.includes(err.code)) {
        setEngineIssue({ code: err.code, setup: err.setup });
      }
      const failedCount = queueRef.current.filter(c => c.status === 'failed').length;
      const base = err instanceof Error ? err.message : 'Synthesis failed. Check console for details.';
      setGenerationError(
        failedCount && queueRef.current.some(c => c.status === 'completed')
          ? `${failedCount} segment(s) failed: ${base} The finished segments are already merged below. Press "Resume" to retry only the failed ones.`
          : base
      );
    } finally {
      requestIdRef.current = null;
      setIsGenerating(false);
      setIsPaused(false);
      setPauseReached(false);
      setIsStopping(false);
      setActiveChunkIndex(-1);
      setEngineStatus('');
    }
  };

  /** Primary workflow: split the script and generate every segment. */
  const handleGenerate = async () => {
    if (!script.trim() || isGenerating) return;
    const options = await prepareRun();
    if (!options) return;

    clearOutput();
    const profile = getEngineProfile(activeModel);
    const chunksText = AudioEngine.getInstance().chunkScript(script, profile.maxChunkChars);
    const stamp = Date.now();
    queueRef.current = chunksText.map((c, idx) => ({
      id: `chunk-${stamp}-${idx}`,
      index: idx,
      text: c.text,
      wordCount: c.text.split(/\s+/).length,
      paragraphEnd: c.paragraphEnd,
      status: 'waiting' as const,
      progress: 0,
    }));
    setGenerationQueue(queueRef.current);
    setGenerationProgress(0);
    historyIdRef.current = null;
    await runQueue(options);
  };

  /** After Stop or a failure: continue with the segments that are not finished (finished ones are kept). */
  const handleResumeRemaining = async () => {
    if (isGenerating || !queueRef.current.some(c => c.status !== 'completed')) return;
    const options = await prepareRun();
    if (!options) return;
    commitQueue(q => q.map(c => (c.status === 'failed' ? { ...c, status: 'waiting', progress: 0, error: undefined } : c)));
    await runQueue(options);
  };

  const handlePause = () => {
    pauseRef.current = true;
    setIsPaused(true);
  };

  const handleContinue = () => {
    pauseRef.current = false;
    setIsPaused(false);
  };

  /** Stop: ends the running segment on the engine at once (frees GPU/CPU), keeps everything already finished. */
  const handleStop = async () => {
    if (!isGenerating) return;
    abortRef.current = true;
    pauseRef.current = false;
    setIsPaused(false);
    setIsStopping(true);
    await AudioEngine.getInstance().cancelSynthesis(requestIdRef.current ?? undefined);
  };

  /** Frees the previous result completely (queue, segment sounds, merged track). */
  const clearOutput = () => {
    queueRef.current.forEach(c => { if (c.audioUrl) URL.revokeObjectURL(c.audioUrl); });
    queueRef.current = [];
    setGenerationQueue([]);
    if (masterAudioUrlRef.current) URL.revokeObjectURL(masterAudioUrlRef.current);
    masterAudioUrlRef.current = '';
    setMasterAudioBuffer(null);
    setMasterAudioUrl('');
    setGenerationError(null);
    setEngineIssue(null);
    setGenerationProgress(0);
  };

  /** Delete: stops a running generation and throws the unsaved result away. */
  const handleDiscard = async () => {
    const hasAudio = queueRef.current.some(c => c.status === 'completed');
    if (hasAudio && !window.confirm('Delete the generated audio of this script? Entries already saved in History are not affected.')) return;
    if (isGenerating) {
      await handleStop();
      for (let i = 0; i < 50 && abortRef.current && requestIdRef.current !== null; i++) await sleep(100);
    }
    clearOutput();
    historyIdRef.current = null;
  };

  /** Keeps the finished segments in History (also a partial result) - updated in place when a run is resumed. */
  const saveToHistory = async (merged: { stitched: AudioBuffer; blob: Blob; url: string }) => {
    const total = queueRef.current.length;
    const completed = queueRef.current.filter(c => c.status === 'completed').length;
    const id = historyIdRef.current || `gen-${Date.now()}`;
    historyIdRef.current = id;
    const head = script.length > 200 ? script.slice(0, 200) + '...' : script;
    await storeHistoryAudio(id, merged.blob); // survives restarts and later regenerations
    StorageService.getInstance().upsertHistoryItem({
      id,
      timestamp: Date.now(),
      projectName: completed < total ? `Partial (${completed}/${total} segments)` : 'Untitled Script',
      modelId: activeModel.id,
      modelName: activeModel.name,
      voiceId: voiceMode === 'reference' ? 'reference-custom' : selectedVoiceId,
      voiceName: voiceMode === 'reference' ? (activeReferences[0]?.name || referenceAudio?.name || 'Reference Clone') : (selectedVoice?.name || ''),
      language: selectedLanguage,
      script: head,
      duration: merged.stitched.duration,
      audioUrl: merged.url,
      device: (deviceUsed || hardware.activeDevice).toUpperCase().replace('CUDA', 'GPU'),
      fileSizeBytes: merged.blob.size,
      settings: { ...settings },
    });
  };

  /** Joins every finished segment (in order) into the single master track shown in the player. */
  const rebuildMasterAudio = () => {
    const engine = AudioEngine.getInstance();
    const done = queueRef.current.filter(c => c.status === 'completed' && c.audioBuffer);
    if (!done.length) return null;
    const stitched = engine.joinChunks(
      done.map(c => ({ buffer: c.audioBuffer as AudioBuffer, paragraphEnd: c.paragraphEnd })),
      settings.pauseDurationMs
    );
    const leveled = engine.processBuffer(stitched, { volume: settings.volume }); // Volume slider: final loudness
    const blob = engine.createWavBlob(leveled);
    if (masterAudioUrlRef.current) URL.revokeObjectURL(masterAudioUrlRef.current);
    const url = URL.createObjectURL(blob);
    masterAudioUrlRef.current = url;
    setMasterAudioBuffer(leveled);
    setMasterAudioUrl(url);
    setOutputFilename(`TTS_${activeModel.name.split(' ')[0]}_${Date.now().toString().slice(-4)}.wav`);
    return { stitched: leveled, blob, url };
  };

  /** Manual "Merge now": rebuild the single track from whatever is finished (e.g. after replacing a segment). */
  const handleMergeNow = async () => {
    const merged = rebuildMasterAudio();
    if (merged) await saveToHistory(merged);
  };

  const chunkAudioRef = useRef<HTMLAudioElement | null>(null);
  const handlePlayIndividualChunk = (chunk: GenerationChunk) => {
    if (!chunk.audioUrl) return;
    chunkAudioRef.current?.pause(); // one segment at a time (clicking several used to play them on top of each other)
    const a = new Audio(chunk.audioUrl);
    chunkAudioRef.current = a;
    void a.play().catch(() => undefined);
  };
  useEffect(() => () => { chunkAudioRef.current?.pause(); }, []);

  const handleRegenerateChunk = async (chunkId: string) => {
    const chunk = queueRef.current.find(c => c.id === chunkId);
    if (!chunk || isGenerating) return;

    const previous = chunk;
    commitQueue(q => q.map(c => (c.id === chunkId ? { ...c, status: 'generating', progress: 30 } : c)));
    setIsGenerating(true);
    abortRef.current = false;

    let result;
    try {
      const resolved = await resolveSynthOptions();
      if (resolved.error || !resolved.options) throw new Error(resolved.error || 'Could not prepare the voice.');
      requestIdRef.current = newRequestId();
      result = await AudioEngine.getInstance().synthesizeWithModel(chunk.text, { ...resolved.options, requestId: requestIdRef.current, compactSilence: true });
    } catch (err) {
      requestIdRef.current = null;
      setIsGenerating(false);
      setIsStopping(false);
      if (err instanceof TtsCancelledError) {
        commitQueue(q => q.map(c => (c.id === chunkId ? previous : c))); // Stop: the old version of the segment stays
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      commitQueue(q => q.map(c => (c.id === chunkId ? { ...c, status: 'failed', progress: 0, error: message } : c)));
      setGenerationError(message);
      return;
    }

    const chunkUrl = URL.createObjectURL(result.wavBlob);
    commitQueue(q =>
      q.map(c =>
        c.id === chunkId
          ? { ...c, status: 'completed', progress: 100, audioBuffer: result.buffer, audioUrl: chunkUrl, duration: result.duration, error: undefined }
          : c
      )
    );
    setGenerationError(null);
    requestIdRef.current = null;
    setIsGenerating(false);
    setIsStopping(false);
    const merged = rebuildMasterAudio(); // the single merged track always reflects the newest version of every segment
    if (merged) await saveToHistory(merged);
  };

  const handleSaveToProject = () => {
    StorageService.getInstance().saveProject({
      id: `proj-${Date.now()}`,
      name: `Project ${new Date().toLocaleDateString()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelId: activeModel.id,
      voiceId: selectedVoiceId,
      language: selectedLanguage,
      script,
      settings,
      referenceAudio: referenceAudio || undefined,
      lastGeneratedAudioUrl: masterAudioUrl,
      lastGeneratedDuration: masterAudioBuffer?.duration,
    });
    setSaveToast('Session saved to local projects');
    setTimeout(() => setSaveToast(null), 3000);
  };

  // ---- progress numbers for the monitor card and the control buttons
  const totalSegments = generationQueue.length;
  const doneSegments = generationQueue.filter(c => c.status === 'completed').length;
  const unfinishedSegments = totalSegments - doneSegments;
  const canResume = !isGenerating && totalSegments > 0 && unfinishedSegments > 0;
  const avgSegmentSec = segmentSecondsRef.current.length
    ? segmentSecondsRef.current.reduce((a, b) => a + b, 0) / segmentSecondsRef.current.length
    : 0;
  const etaSec = avgSegmentSec ? Math.round(avgSegmentSec * unfinishedSegments) : 0;
  const clock = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;
  const deviceLabel = deviceUsed ? (/cuda|gpu/i.test(deviceUsed) ? 'GPU' : /mps/i.test(deviceUsed) ? 'Apple GPU' : 'CPU') : '';
  const gpuExpectedButCpu = deviceLabel === 'CPU' && hardware.activeDevice === 'cuda';
  const monitorTitle = isStopping
    ? 'Stopping...'
    : isPaused
      ? pauseReached ? 'Paused' : 'Pausing after this segment...'
      : 'Generating speech';

  return (
    <div className="space-y-6 pb-12 max-w-7xl mx-auto">
      {/* Low-VRAM / Hardware Advisory Banner */}
      {isLowVramDetected && (
        <div className="p-4 rounded-[20px] bg-[#181D27] border border-[#FFB547]/30 flex flex-wrap items-center justify-between gap-3 text-xs shadow-sm">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-5 h-5 text-[#FFB547] shrink-0" />
            <div>
              <div className="font-semibold text-[#F5F7FA]">
                Limited GPU memory detected ({hardware.vramGB} GB VRAM).
              </div>
              <div className="text-[#A2AAB8] mt-0.5">
                Recommended: Switch to CPU mode or choose lightweight models like Kokoro-82M or Chatterbox.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onSwitchToCpu && (
              <button
                onClick={onSwitchToCpu}
                className="px-3 py-1.5 text-xs font-semibold text-[#080A0F] bg-[#00D9FF] hover:bg-[#22E7FF] rounded-[10px] transition-all"
              >
                Switch to CPU
              </button>
            )}
            <button
              onClick={() => onNavigateToModels('lightweight')}
              className="px-3 py-1.5 text-xs font-medium text-[#F5F7FA] bg-[#11151D] hover:bg-[#181D27] border border-white/[0.08] rounded-[10px] transition-colors"
            >
              View Lightweight Models
            </button>
          </div>
        </div>
      )}

      {/* Save Notification Toast */}
      {saveToast && (
        <div className="p-3.5 rounded-[16px] bg-[#181D27] border border-[#00D9FF]/40 text-xs text-[#00D9FF] flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#32D583]" />
            <span>{saveToast}</span>
          </div>
        </div>
      )}

      {/* Browser mode: tell the user BEFORE they click Generate */}
      {!DesktopBridge.ttsAvailable && (
        <div className="p-4 rounded-[20px] bg-[#FFB547]/[0.08] border border-[#FFB547]/40 text-xs text-[#F5F7FA] flex items-start gap-2.5">
          <AlertCircle className="w-5 h-5 text-[#FFB547] shrink-0" />
          <div>
            <div className="font-semibold">You are running in a browser tab - real speech is disabled</div>
            <div className="text-[#A2AAB8] mt-0.5">
              The voice model runs only in the desktop app. Close this tab and start it with{' '}
              <code className="text-[#00D9FF]">npm run electron:dev</code>.
            </div>
          </div>
        </div>
      )}

      {/* Python / packages missing: guided setup */}
      {engineIssue && generationError && (
        <TtsSetupPanel
          adapter={activeModel.adapter}
          onRepair={() => {
            setEngineIssue(null);
            setGenerationError(null);
            void ModelRegistry.getInstance().repairModel(activeModel.id);
            onNavigateToModels();
          }}
          code={engineIssue.code}
          message={generationError}
          setup={engineIssue.setup}
          onRetry={() => {
            setEngineIssue(null);
            setGenerationError(null);
            handleGenerate();
          }}
        />
      )}

      {/* Generation Error Banner */}
      {generationError && !engineIssue && (
        <div className="p-4 rounded-[20px] bg-[#181D27] border border-[#FF5C70]/40 flex items-start gap-2.5 text-xs shadow-sm">
          <AlertCircle className="w-5 h-5 text-[#FF5C70] shrink-0" />
          <div className="flex-1">
            <div className="font-semibold text-[#F5F7FA]">Generation failed</div>
            <div className="text-[#A2AAB8] mt-0.5 break-words">{generationError}</div>
            <div className="text-[#6F7888] mt-1 font-mono text-[11px]">
              Tip: open DevTools Console (F12) — AudioContext / AudioBuffer errors appear there.
            </div>
          </div>
          <button
            onClick={() => onNavigateToModels()}
            className="px-3 py-1.5 text-xs font-semibold text-[#080A0F] bg-[#00D9FF] hover:bg-[#22E7FF] rounded-[10px] transition-all shrink-0"
          >
            Open Models
          </button>
        </div>
      )}

      {/* Model-not-loaded warning */}
      {!activeModel.isLoaded && (
        <div className="p-4 rounded-[20px] bg-[#181D27] border border-[#FFB547]/30 flex flex-wrap items-center justify-between gap-3 text-xs shadow-sm">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-[#FFB547] shrink-0" />
            <div>
              <div className="font-semibold text-[#F5F7FA]">
                {activeModel.name} is not loaded — Generate is blocked.
              </div>
              <div className="text-[#A2AAB8] mt-0.5">
                {activeModel.loadError || 'Load the verified weights in Models before synthesizing.'}
              </div>
            </div>
          </div>
          <button
            onClick={() => onNavigateToModels()}
            className="px-3 py-1.5 text-xs font-semibold text-[#080A0F] bg-[#FFB547] hover:bg-[#FFC46B] rounded-[10px] transition-all"
          >
            Go to Models
          </button>
        </div>
      )}

      {/* Primary Setup Row: 1. Model ↓ 2. Voice ↓ 3. Language */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 1. Model Selector Card */}
        <div className="p-5 rounded-[22px] bg-[#11151D] border border-white/[0.08] space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between text-xs">
            <label className="font-medium text-[#F5F7FA] flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-[#00D9FF]" />
              Model Architecture
            </label>
            <button
              onClick={() => onNavigateToModels()}
              className="text-[11px] text-[#00D9FF] hover:underline font-mono"
            >
              Catalog →
            </button>
          </div>

          <button
            onClick={() => onNavigateToModels()}
            className="w-full text-left p-3 rounded-[16px] bg-[#181D27] border border-white/[0.08] hover:border-[#00D9FF]/30 transition-all group"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs text-[#F5F7FA] group-hover:text-white truncate">
                {activeModel.name}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-white/[0.05] text-[#00D9FF] border border-white/[0.04]">
                {activeModel.parameterSize}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[#A2AAB8] mt-1.5 font-mono">
              <span className={hardware.activeDevice === 'cuda' ? 'text-[#32D583]' : 'text-[#00D9FF]'}>
                {hardware.activeDevice.toUpperCase()} ✓
              </span>
              <span className="text-white/20">·</span>
              <span>{activeModel.license}</span>
              <span className="text-white/20">·</span>
              <span>{activeModel.languages.length} Langs</span>
            </div>
            {isRecommendedModel ? (
              <div className="mt-2 text-[10px] font-mono text-[#32D583] flex items-center gap-1">
                <span>⭐ System Recommended ({hardware.vramGB}GB VRAM Fit)</span>
              </div>
            ) : topRecModel ? (
              <div className="mt-2 text-[10px] font-mono text-[#FFB547] flex items-center justify-between">
                <span>Tip: {topRecModel.name.split(' ')[0]} optimal for your setup</span>
                <span className="text-[#00D9FF] group-hover:underline">Catalog →</span>
              </div>
            ) : null}
          </button>
        </div>

        {/* 2. Voice Selector Card */}
        <div className="p-5 rounded-[22px] bg-[#11151D] border border-white/[0.08] space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between text-xs">
            <label className="font-medium text-[#F5F7FA] flex items-center gap-1.5">
              <Mic className="w-4 h-4 text-[#00D9FF]" />
              Voice Persona
            </label>
            <div className="flex items-center gap-1 bg-[#181D27] p-0.5 rounded-[10px] border border-white/[0.06] text-[11px]">
              {activeProfile.reference !== 'required' && (
              <button
                onClick={() => setVoiceMode('preset')}
                className={`px-2 py-0.5 rounded-[8px] transition-colors ${
                  voiceMode === 'preset'
                    ? 'bg-[#00D9FF]/20 text-[#00D9FF] font-semibold'
                    : 'text-[#A2AAB8] hover:text-white'
                }`}
              >
                Preset
              </button>
              )}
              {activeModel.capabilities.referenceVoice && (
                <button
                  onClick={() => setVoiceMode('reference')}
                  className={`px-2 py-0.5 rounded-[8px] transition-colors ${
                    voiceMode === 'reference'
                      ? 'bg-[#FF3CAC]/20 text-[#FF3CAC] font-semibold'
                      : 'text-[#A2AAB8] hover:text-white'
                  }`}
                >
                  Clone
                </button>
              )}
            </div>
          </div>

          {voiceMode === 'preset' ? (
            <select
              value={selectedVoiceId}
              onChange={e => setSelectedVoiceId(e.target.value)}
              className="w-full text-xs p-3 rounded-[16px] bg-[#181D27] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF] transition-colors"
            >
              {voices.map(v => (
                <option key={v.id} value={v.id} className="bg-[#11151D] text-[#F5F7FA]">
                  {v.name} ({v.gender || 'neutral'}, {v.language})
                </option>
              ))}
            </select>
          ) : (
            <div className="text-xs p-2.5 rounded-[16px] bg-[#181D27] border border-[#FF3CAC]/30 text-[#FF3CAC] font-mono flex items-center justify-between">
              <span>{activeReferences.length} Stems Active</span>
              <span className="text-[10px] text-[#A2AAB8] truncate max-w-[150px]">
                {activeReferences.length > 0
                  ? activeReferences.map(r => r.accent).slice(0, 2).join(' + ')
                  : 'Add Reference Below'}
              </span>
            </div>
          )}

          <div className="text-[11px] text-[#6F7888] truncate">
            {voiceMode === 'preset'
              ? selectedVoice?.description
              : `${activeReferences.length} reference audio clip(s) conditioning acoustic timbre`}
          </div>
        </div>

        {/* 3. Language Selector Card (Dynamically populated from model capabilities) */}
        <div className="p-5 rounded-[22px] bg-[#11151D] border border-white/[0.08] space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between text-xs">
            <label className="font-medium text-[#F5F7FA] flex items-center gap-1.5">
              <Languages className="w-4 h-4 text-[#00D9FF]" />
              Synthesis Language
            </label>
            <span className="text-[11px] text-[#6F7888] font-mono">
              {activeModel.languages.length} Supported
            </span>
          </div>

          <select
            value={selectedLanguage}
            onChange={e => setSelectedLanguage(e.target.value)}
            className="w-full text-xs p-3 rounded-[16px] bg-[#181D27] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF] transition-colors"
          >
            {activeModel.languages.map(lang => (
              <option key={lang} value={lang} className="bg-[#11151D] text-[#F5F7FA]">
                {lang}
              </option>
            ))}
          </select>

          <div className="text-[11px] text-[#6F7888] flex items-center gap-1.5 font-mono">
            <span>Acoustic Vocoder:</span>
            <span className="text-[#32D583]">Native Frame Rate</span>
          </div>
        </div>
      </div>

      {/* 4. Reference Audio Uploader (Visible when in Reference Mode or if model supports voice clone) */}
      {(voiceMode === 'reference' || activeModel.capabilities.referenceVoice) && (
        <div className="p-5 rounded-[24px] bg-[#11151D] border border-white/[0.08] space-y-3.5 shadow-sm">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[#F5F7FA] flex items-center gap-2">
              <Mic className="w-4 h-4 text-[#FF3CAC]" />
              Zero-Shot Reference Voice Samples ({activeReferences.length} Active)
            </span>
            <span className="text-[11px] text-[#6F7888] font-mono">
              Target Model: {activeModel.name}
            </span>
          </div>
          {/qwen3/i.test(activeModel.id) && /hindi|urdu|bengali|tamil|telugu|marathi|gujarati|kannada|malayalam|punjabi|odia|assamese|nepali/i.test(selectedLanguage) && (
            <div className="mb-3 p-3 rounded-[14px] bg-[#FF5C70]/10 border border-[#FF5C70]/30 text-[11px] text-[#FF5C70] leading-relaxed">
              Qwen3-TTS does not support {selectedLanguage} (it speaks Chinese, English, Japanese, Korean, German, French, Russian, Portuguese, Spanish and Italian),
              so the result will be garbled. For Indian languages use Indic Parler-TTS, Sooktam-2 or Svara.
            </div>
          )}
          {/qwen3/i.test(activeModel.id) && !/voicedesign/i.test(activeModel.id) && !referenceAudio?.referenceText?.trim() && (
            <div className="mb-3 p-3 rounded-[14px] bg-[#FFB547]/10 border border-[#FFB547]/25 text-[11px] text-[#FFB547] leading-relaxed">
              For clean cloning, write the exact words spoken in the reference clip into its transcript box. Without a transcript the voice is copied
              less accurately and may sound unstable. Best clip: 5-12 seconds, one speaker, no music or echo.
            </div>
          )}
          <ReferenceAudioUploader
            referenceAudio={referenceAudio}
            onAudioChange={setReferenceAudio}
            activeReferences={activeReferences}
            onActiveReferencesChange={setActiveReferences}
            supportsReferenceText={activeModel.capabilities.tts}
          />
        </div>
      )}

      {/* 5. Script Editor Section (24px Apple container, large dark writing area) */}
      <div className="p-6 rounded-[24px] bg-[#11151D] border border-white/[0.08] space-y-4 shadow-[0_10px_40px_rgba(0,0,0,0.25)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#00D9FF]" />
            <h2 className="text-sm font-semibold text-[#F5F7FA]">Script Editor</h2>
          </div>

          {/* Clear */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setScript('')}
              className="px-2 py-1 text-[11px] text-[#FF5C70] hover:bg-[#FF5C70]/10 rounded-[8px] transition-colors"
              title="Clear script"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Text Area */}
        <div className="relative">
          <textarea
            value={script}
            onChange={e => setScript(e.target.value)}
            rows={5}
            placeholder="Type or paste text here to synthesize with local AI speech model..."
            className="w-full text-sm leading-relaxed p-4 rounded-[16px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] placeholder-[#6F7888] focus:outline-none focus:border-[#00D9FF] transition-all resize-y min-h-[140px]"
          />
        </div>

        {/* Stats Row & Controls Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#A2AAB8] pt-1">
          <div className="flex items-center gap-4 font-mono tabular-nums">
            <span>
              <strong className="text-[#F5F7FA] font-medium">{charCount.toLocaleString()}</strong> characters
            </span>
            <span className="text-white/20">·</span>
            <span>
              <strong className="text-[#F5F7FA] font-medium">{wordCount.toLocaleString()}</strong> words
            </span>
            <span className="text-white/20">·</span>
            <span className="flex items-center gap-1.5 text-[#00D9FF]">
              <Clock className="w-3.5 h-3.5 text-[#00D9FF]" />
              ~{estTimeFormatted} estimated
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs text-[#00D9FF] hover:underline font-medium"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{showAdvanced ? 'Hide Controls' : 'Advanced Controls'}</span>
            </button>
          </div>
        </div>

        {/* Advanced Model-Specific Controls (strictly shown based on model capabilities) */}
        {showAdvanced && (
          <div className="p-4 rounded-[18px] bg-[#181D27] border border-white/[0.08] space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between text-xs border-b border-white/[0.06] pb-2">
              <span className="font-semibold text-[#F5F7FA]">Model Acoustic Parameters</span>
              <span className="text-[10px] text-[#6F7888] font-mono">
                Filtered for {activeModel.name}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              {/* Speed */}
              {(
                true
              ) && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[#A2AAB8]">
                    <span>Speed</span>
                    <span className="text-[#F5F7FA] font-mono">{settings.speed}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="1.75"
                    step="0.05"
                    value={settings.speed}
                    onChange={e =>
                      setSettings({ ...settings, speed: parseFloat(e.target.value) })
                    }
                    className="w-full accent-[#00D9FF] h-1.5 bg-[#080A0F] rounded-lg cursor-pointer"
                  />
                </div>
              )}

              {/* Pitch */}
              {(
                true
              ) && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[#A2AAB8]">
                    <span>Pitch Offset</span>
                    <span className="text-[#F5F7FA] font-mono">{settings.pitch > 0 ? `+${settings.pitch}` : settings.pitch} st</span>
                  </div>
                  <input
                    type="range"
                    min="-6"
                    max="6"
                    step="1"
                    value={settings.pitch}
                    onChange={e =>
                      setSettings({ ...settings, pitch: parseInt(e.target.value) })
                    }
                    className="w-full accent-[#00D9FF] h-1.5 bg-[#080A0F] rounded-lg cursor-pointer"
                  />
                </div>
              )}

              {/* Emotion */}
              {activeProfile.emotion !== 'none' && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[#A2AAB8]">
                    <span>Emotion</span>
                    <span className="text-[#F5F7FA] capitalize">{settings.emotion}</span>
                  </div>
                  <select
                    value={settings.emotion}
                    onChange={e => setSettings({ ...settings, emotion: e.target.value })}
                    className="w-full text-xs p-2 rounded-[12px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF]"
                  >
                    <option value="neutral" className="bg-[#11151D] text-[#F5F7FA]">Neutral (Default)</option>
                    <option value="warm" className="bg-[#11151D] text-[#F5F7FA]">Warm & Empathetic</option>
                    <option value="dramatic" className="bg-[#11151D] text-[#F5F7FA]">Dramatic & Cinematic</option>
                    <option value="whisper" className="bg-[#11151D] text-[#F5F7FA]">Intimate Whisper</option>
                    <option value="excited" className="bg-[#11151D] text-[#F5F7FA]">Energetic & Upbeat</option>
                  </select>
                </div>
              )}

              {/* Volume: final loudness of the finished audio (works with every model) */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[#A2AAB8]">
                  <span>Volume</span>
                  <span className="text-[#F5F7FA] font-mono">{settings.volume}%</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={settings.volume}
                  onChange={e => setSettings({ ...settings, volume: parseInt(e.target.value, 10) })}
                  className="w-full accent-[#00D9FF] h-1.5 bg-[#080A0F] rounded-lg cursor-pointer"
                />
              </div>

              {/* Pause duration */}
              {activeModel.capabilities.pause && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[#A2AAB8]">
                    <span>Sentence Pause</span>
                    <span className="text-[#F5F7FA] font-mono">{settings.pauseDurationMs}ms</span>
                  </div>
                  <input
                    type="range"
                    min="100"
                    max="600"
                    step="20"
                    value={settings.pauseDurationMs}
                    onChange={e =>
                      setSettings({ ...settings, pauseDurationMs: parseInt(e.target.value) })
                    }
                    className="w-full accent-[#00D9FF] h-1.5 bg-[#080A0F] rounded-lg cursor-pointer"
                  />
                </div>
              )}
            </div>

            {/* Instruction / Style prompt input */}
            {activeModel.capabilities.instruction && (
              <div className="pt-2 border-t border-white/[0.06] space-y-1.5">
                <div className="flex justify-between text-xs text-[#A2AAB8]">
                  <span>Natural Language Style Instruction</span>
                  <span className="text-[10px] text-[#00D9FF]">Prompt-Conditioned</span>
                </div>
                <input
                  type="text"
                  value={settings.instruction}
                  onChange={e => setSettings({ ...settings, instruction: e.target.value })}
                  placeholder="e.g. Speak calmly, warmly, with a reflective cadence..."
                  className="w-full text-xs px-3.5 py-2 rounded-[14px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF]"
                />
              </div>
            )}
          </div>
        )}

        {/* Primary CTA Row: Generate Speech */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveToProject}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#A2AAB8] hover:text-[#F5F7FA] bg-[#181D27] hover:bg-[#1D2430] border border-white/[0.08] rounded-[14px] transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Session</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            {isGenerating && (
              <>
                {isPaused ? (
                  <button
                    onClick={handleContinue}
                    disabled={isStopping}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[#32D583] hover:bg-[#32D583]/10 border border-[#32D583]/30 rounded-[14px] transition-colors disabled:opacity-40"
                  >
                    <Play className="w-3.5 h-3.5" /> Continue
                  </button>
                ) : (
                  <button
                    onClick={handlePause}
                    disabled={isStopping}
                    title="Finishes the segment that is being generated, then waits"
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[#FFB547] hover:bg-[#FFB547]/10 border border-[#FFB547]/30 rounded-[14px] transition-colors disabled:opacity-40"
                  >
                    <Pause className="w-3.5 h-3.5" /> Pause
                  </button>
                )}
                <button
                  onClick={handleStop}
                  disabled={isStopping}
                  title="Stops the engine right away. Segments that are already finished are kept and merged."
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#FF5C70] hover:bg-[#FF5C70]/10 border border-[#FF5C70]/40 rounded-[14px] transition-colors disabled:opacity-40"
                >
                  <Square className="w-3.5 h-3.5" /> {isStopping ? 'Stopping...' : 'Stop'}
                </button>
              </>
            )}
            {canResume && (
              <button
                onClick={handleResumeRemaining}
                title="Generates only the segments that are not finished (uses the current voice settings)"
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[#00D9FF] hover:bg-[#00D9FF]/10 border border-[#00D9FF]/30 rounded-[14px] transition-colors"
              >
                <Play className="w-3.5 h-3.5" /> Resume ({unfinishedSegments} left)
              </button>
            )}
            {!isGenerating && totalSegments > 0 && (
              <button
                onClick={handleDiscard}
                title="Delete the generated audio of this script"
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#A2AAB8] hover:text-[#FF5C70] hover:bg-[#FF5C70]/10 border border-white/[0.08] rounded-[14px] transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}

            {/* Generate Speech button — Strongest CTA */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !script.trim() || !activeModel.isLoaded}
              title={!activeModel.isLoaded ? 'Load the model in Models first' : 'Generate speech'}
              className="btn-primary-cta px-6 py-2.5 rounded-[14px] flex items-center gap-2 text-sm disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#080A0F]" />
                  <span>{isPaused ? 'Paused' : `Synthesizing (${generationProgress}%)...`}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-[#080A0F]" />
                  <span>Generate Speech</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Live generation monitor: proves the engine is working and shows where it runs */}
      {isGenerating && (
        <div className="p-5 rounded-[22px] bg-[#11151D] border border-[#00D9FF]/25 space-y-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-[#F5F7FA] flex items-center gap-2">
              {isPaused && pauseReached ? <Pause className="w-4 h-4 text-[#FFB547]" /> : <Loader2 className="w-4 h-4 animate-spin text-[#00D9FF]" />}
              {monitorTitle}
            </span>
            <span className="flex items-center gap-2 font-mono text-[11px] text-[#A2AAB8]">
              {deviceLabel && (
                <span className={`px-2 py-0.5 rounded-[8px] border ${deviceLabel === 'CPU' ? 'text-[#FFB547] border-[#FFB547]/30 bg-[#FFB547]/10' : 'text-[#32D583] border-[#32D583]/30 bg-[#32D583]/10'}`}>
                  {deviceLabel}
                </span>
              )}
              <span>Segment {Math.min(doneSegments + 1, totalSegments)} / {totalSegments}</span>
              <span>Elapsed {clock(elapsedSec)}</span>
              {etaSec > 0 && !isPaused && <span>~{clock(etaSec)} left</span>}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-[#080A0F] overflow-hidden">
            <div className="h-full bg-[#00D9FF] transition-all duration-500" style={{ width: `${totalSegments ? (doneSegments / totalSegments) * 100 : 0}%` }} />
          </div>
          <div className="text-[11px] text-[#A2AAB8] min-h-[16px] break-words">
            {isStopping
              ? 'Stopping the engine...'
              : isPaused && pauseReached
                ? `Paused. ${doneSegments} segment(s) are finished and merged below - press Continue or Stop.`
                : engineStatus || 'Preparing the speech engine (the first start after opening the app loads the model and can take a few minutes)...'}
          </div>
          {gpuExpectedButCpu && (
            <div className="text-[11px] text-[#FFB547] flex items-start gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                A GPU was detected, but the speech engine is running on the CPU (much slower). Open Settings, Voice Engines &amp; Dependencies, and press Repair on this
                model to install the CUDA build of PyTorch.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Long Text Generation Queue */}
      {generationQueue.length > 1 && (
        <ChunkQueueViewer
          chunks={generationQueue}
          activeChunkIndex={activeChunkIndex}
          onPlayChunk={handlePlayIndividualChunk}
          onRegenerateChunk={handleRegenerateChunk}
          busy={isGenerating}
          onMerge={handleMergeNow}
        />
      )}

      {/* Generated Audio Player (24px Apple container) */}
      {(masterAudioBuffer || masterAudioUrl) && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-[#A2AAB8] tracking-wider uppercase px-1">
            Generated Speech Output
          </h2>
          <AudioPlayer
            audioBuffer={masterAudioBuffer}
            audioUrl={masterAudioUrl}
            filename={outputFilename}
            onRegenerate={handleGenerate}
            voiceName={voiceMode === 'reference' ? 'Custom Reference Clone' : selectedVoice?.name}
            modelName={activeModel.name}
            isGenerating={isGenerating}
          />
        </div>
      )}
    </div>
  );
};
