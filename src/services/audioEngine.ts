/**
 * Audio Engine & Processing Service
 * Provides audio synthesis, long-text segmentation, chunk stitching,
 * waveform peak analysis, and lossless PCM WAV file encoding.
 */
import { getReferenceAudioBlob } from './referenceAudioStorage';
import { StorageService } from './storageService';
import { DesktopBridge, TtsErrorCode, TtsSetupInfo } from './desktopBridge';
import { ModelRegistry } from './modelRegistry';
import { chunkScript as splitScript, TextChunk } from './textChunker';
import { applyEffects } from './audioEffects';

/** Error from the real speech engine; carries a code so the UI can offer setup help. */
export class TtsEngineError extends Error {
  code: TtsErrorCode;
  setup?: TtsSetupInfo;
  constructor(message: string, code: TtsErrorCode = 'other', setup?: TtsSetupInfo) {
    super(message);
    this.name = 'TtsEngineError';
    this.code = code;
    this.setup = setup;
  }
}

/** The user pressed Stop: not an error, the caller just ends its loop. */
export class TtsCancelledError extends Error {
  constructor() {
    super('Stopped.');
    this.name = 'TtsCancelledError';
  }
}

export class AudioEngine {
  private static instance: AudioEngine;
  private audioCtx: AudioContext | null = null;

  private constructor() {}

  public static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  public getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Splits the script into model-sized pieces (see textChunker.ts): sentence-aware for Latin, Devanagari,
   * Urdu and CJK scripts, never drops text, and remembers paragraph ends for longer pauses.
   */
  public chunkScript(text: string, maxChunkLength = 220): TextChunk[] {
    return splitScript(text, maxChunkLength);
  }

  /** Kokoro voice ids per UI gender (used when the UI voice is not itself a Kokoro id). */
  /**
   * Each preset gets its OWN Kokoro voice, with a prefix that matches its gender
   * (af_/bf_ = female, am_/bm_ = male), so two presets never sound the same and a
   * male-named preset never plays a female voice. Kokoro has no neutral voice, so the
   * "neutral" preset keeps a clear default.
   */
  private static readonly PRESET_KOKORO_VOICES: Record<string, string> = {
    'voice-narrator-male': 'bm_george',
    'voice-conversational-female': 'af_bella',
    'voice-cinematic-male': 'am_adam',
    'voice-corporate-female': 'af_nicole',
    'voice-multilingual-neutral': 'af_heart',
  };

  private static readonly KOKORO_VOICES: Record<string, string> = {
    female: 'af_heart',
    male: 'am_michael',
    neutral: 'af_heart',
  };

  /**
   * REAL synthesis: runs the downloaded model through the local Python backend
   * (Electron main process -> backend/server.py) and decodes the returned WAV.
   * Throws a descriptive Error on any failure - it never falls back to fake audio.
   */
  public async synthesizeWithModel(
    text: string,
    options: {
      modelId: string;
      modelDir?: string;
      adapter?: string;
      voiceId?: string;
      gender?: 'male' | 'female' | 'neutral';
      language?: string;
      speed?: number;
      instruct?: string;
      temperature?: number;
      /** Chatterbox emotion exaggeration 0..1 */
      exaggeration?: number;
      /** Applied to the finished audio for engines that cannot do it themselves (pitch-preserving speed, pitch in semitones). */
      postSpeed?: number;
      postPitch?: number;
      referenceWav?: Uint8Array;
      referenceText?: string;
      /** Id of this request, so Stop can end exactly this generation. */
      requestId?: string;
      compactSilence?: boolean;
    }
  ): Promise<{ buffer: AudioBuffer; wavBlob: Blob; duration: number; device?: string }> {
    if (!DesktopBridge.ttsAvailable) {
      throw new TtsEngineError(
        'Real speech generation only works inside the desktop app (Electron). Start it with "npm run electron:dev", not in a browser tab.'
      );
    }
    // Only Kokoro uses Kokoro voice ids. Other engines (Svara, Parler...) receive the gender and language and
    // choose their own speaker; sending them a Kokoro id would be meaningless.
    const isKokoro = !options.adapter || options.adapter === 'kokoro';
    const voice = !isKokoro
      ? undefined
      : options.voiceId && /^[abefhijpz][fm]_[a-z]+$/.test(options.voiceId)
        ? options.voiceId
        : (options.voiceId && AudioEngine.PRESET_KOKORO_VOICES[options.voiceId]) ||
          AudioEngine.KOKORO_VOICES[options.gender || 'female'];

    const result = await DesktopBridge.synthesize({
      requestId: options.requestId,
      compactSilence: options.compactSilence,
      modelId: options.modelId,
      modelDir: options.modelDir,
      adapter: options.adapter,
      text,
      voice,
      speed: options.speed,
      lang: options.language,
      gender: options.gender,
      instruct: options.instruct,
      temperature: options.temperature,
      exaggeration: options.exaggeration,
      referenceWav: options.referenceWav,
      referenceText: options.referenceText,
    });
    if (result.cancelled || result.code === 'cancelled') throw new TtsCancelledError();
    if (!result.ok || !result.wav) {
      throw new TtsEngineError(
        result.error || 'The speech engine returned no audio.',
        result.code || 'other',
        result.setup
      );
    }

    const copy = new Uint8Array(result.wav).buffer as ArrayBuffer;
    const wavBlob = new Blob([copy.slice(0)], { type: 'audio/wav' });
    const ctx = this.getAudioContext();
    const decoded = await ctx.decodeAudioData(copy);
    const speed = options.postSpeed ?? 1;
    const pitch = options.postPitch ?? 0;
    if (Math.abs(speed - 1) < 0.005 && Math.abs(pitch) < 0.05) return { buffer: decoded, wavBlob, duration: decoded.duration, device: result.device };
    const processed = this.processBuffer(decoded, { speed, pitch });
    return { buffer: processed, wavBlob: this.createWavBlob(processed), duration: processed.duration, device: result.device };
  }

  /** Stop button: ends the running generation on the speech engine immediately. */
  public async cancelSynthesis(requestId?: string): Promise<void> {
    await DesktopBridge.cancelSynthesis(requestId);
  }

  /** Pitch-preserving speed and duration-preserving pitch for any AudioBuffer (see audioEffects.ts). */
  public processBuffer(buffer: AudioBuffer, o: { speed?: number; pitch?: number; volume?: number }): AudioBuffer {
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(applyEffects(buffer.getChannelData(c), buffer.sampleRate, o));
    const out = this.getAudioContext().createBuffer(channels.length, Math.max(1, channels[0].length), buffer.sampleRate);
    channels.forEach((d, c) => out.getChannelData(c).set(d));
    return out;
  }

  /**
   * Turns any reference clip (blob:/data:/http URL or a stored Blob) into a mono 16-bit WAV
   * (max 30 s) that every engine can read, regardless of the original format.
   */
  public async referenceToWav(source: string | Blob, fallbackId?: string): Promise<Uint8Array> {
    let blob: Blob | null = null;
    if (typeof source !== 'string') {
      blob = source;
    } else {
      // The stored copy (IndexedDB, then the file in the voice library) is the reliable source: a blob: URL saved
      // in an earlier session no longer exists after a restart.
      if (fallbackId) blob = await StorageService.getInstance().getReferenceBlob(fallbackId);
      if (!blob && source) {
        try { blob = await (await fetch(source)).blob(); } catch { /* dead blob: URL */ }
      }
    }
    if (!blob) throw new Error('The audio of this reference voice is missing (it was not saved by an older version of the app). Open Voices, delete it and add the clip again.');

    const decoded = await this.getAudioContext().decodeAudioData(await blob.arrayBuffer());
    const seconds = Math.min(decoded.duration, 30);
    const frames = Math.floor(seconds * decoded.sampleRate);
    const mono = new Float32Array(frames);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < frames; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }

    const out = new ArrayBuffer(44 + frames * 2);
    const v = new DataView(out);
    const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + frames * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, decoded.sampleRate, true); v.setUint32(28, decoded.sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) {
      const x = Math.max(-1, Math.min(1, mono[i]));
      v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
    return new Uint8Array(out);
  }

  /**
   * Real preview / sample audio using the currently loaded model (same engine
   * as Generate, so previews match the final output). Throws TtsEngineError
   * with a plain-language reason when no real engine is ready - never fake audio.
   */
  public async synthesizePreview(
    text: string,
    options: { voiceId?: string; gender?: 'male' | 'female' | 'neutral'; language?: string; speed?: number } = {}
  ): Promise<{ buffer: AudioBuffer; wavBlob: Blob; duration: number }> {
    if (!DesktopBridge.ttsAvailable) {
      throw new TtsEngineError('Previews need the desktop app. Start it with "npm run electron:dev".');
    }
    const loaded = ModelRegistry.getInstance().getModels().find(m => m.isLoaded && m.isInstalled && m.adapter === 'kokoro');
    if (!loaded) {
      throw new TtsEngineError(
        'Voice previews use the Kokoro 82M preset voices. Install and load Kokoro 82M (Models page) to audition voices. Cloning models such as Qwen3-TTS use your own reference audio instead.'
      );
    }
    return this.synthesizeWithModel(text, {
      modelId: loaded.id,
      adapter: 'kokoro',
      modelDir: loaded.source === 'local' ? loaded.repo : undefined,
      voiceId: options.voiceId,
      gender: options.gender,
      language: options.language,
      speed: options.speed,
    });
  }

  /**
   * Stitch multiple audio buffers into one master buffer with natural inter-chunk pauses.
   */
  public stitchAudioBuffers(buffers: AudioBuffer[], pauseMs = 220): AudioBuffer {
    if (buffers.length === 0) {
      const ctx = this.getAudioContext();
      return ctx.createBuffer(1, 1024, 24000);
    }
    if (buffers.length === 1) {
      return buffers[0];
    }

    const sampleRate = buffers[0].sampleRate;
    const pauseSamples = Math.floor((pauseMs / 1000) * sampleRate);

    let totalSamples = 0;
    buffers.forEach((b, idx) => {
      totalSamples += b.length;
      if (idx < buffers.length - 1) {
        totalSamples += pauseSamples;
      }
    });

    const ctx = this.getAudioContext();
    const stitched = ctx.createBuffer(1, totalSamples, sampleRate);
    const outputData = stitched.getChannelData(0);

    let offset = 0;
    buffers.forEach((b, idx) => {
      const inputData = b.getChannelData(0);
      outputData.set(inputData, offset);
      offset += b.length;

      if (idx < buffers.length - 1) {
        // Inter-sentence pause (quiet baseline room presence)
        for (let i = 0; i < pauseSamples; i++) {
          outputData[offset + i] = (Math.random() * 2 - 1) * 0.0005;
        }
        offset += pauseSamples;
      }
    });

    return stitched;
  }

  /**
   * Joins the generated pieces into ONE continuous track:
   *  - leading/trailing silence of each piece is trimmed (models add 0.2-0.6 s of it, which made every
   *    sentence boundary sound like a separate recording),
   *  - each piece is level-matched to the others (no volume jumps),
   *  - 15 ms fades remove clicks,
   *  - pauses are exact digital silence: `pauseMs` between pieces of a paragraph, `paragraphPauseMs` after a
   *    paragraph.
   */
  public joinChunks(
    items: { buffer: AudioBuffer; paragraphEnd?: boolean }[],
    pauseMs = 220,
    paragraphPauseMs = Math.round(pauseMs * 2.4),
  ): AudioBuffer {
    const ctx = this.getAudioContext();
    if (items.length === 0) return ctx.createBuffer(1, 1024, 24000);

    const sampleRate = items[0].buffer.sampleRate;
    const mono = items.map(it => this.toMonoAtRate(it.buffer, sampleRate));

    // trim silence (keep 40 ms of natural edge), measure loudness
    const trimmed = mono.map(data => {
      const threshold = 0.006;
      let a = 0;
      let b = data.length;
      while (a < b && Math.abs(data[a]) < threshold) a++;
      while (b > a && Math.abs(data[b - 1]) < threshold) b--;
      const keep = Math.floor(sampleRate * 0.04);
      return data.subarray(Math.max(0, a - keep), Math.min(data.length, b + keep));
    });
    const rms = trimmed.map(d => {
      let sum = 0;
      for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      return Math.sqrt(sum / Math.max(1, d.length));
    });
    const voiced = rms.filter(r => r > 1e-5).sort((x, y) => x - y);
    const target = voiced.length ? voiced[Math.floor(voiced.length / 2)] : 0;

    const fade = Math.floor(sampleRate * 0.015);
    const gapSamples = (i: number) =>
      Math.floor(((items[i].paragraphEnd ? paragraphPauseMs : pauseMs) / 1000) * sampleRate);
    let total = 0;
    trimmed.forEach((d, i) => {
      total += d.length;
      if (i < trimmed.length - 1) total += gapSamples(i);
    });

    const out = ctx.createBuffer(1, Math.max(1, total), sampleRate);
    const dst = out.getChannelData(0);
    let offset = 0;
    trimmed.forEach((d, i) => {
      const gain = rms[i] > 1e-5 && target > 0 ? Math.min(1.5, Math.max(0.67, target / rms[i])) : 1;
      for (let k = 0; k < d.length; k++) {
        let g = gain;
        if (k < fade) g *= k / fade;
        else if (k >= d.length - fade) g *= (d.length - 1 - k) / fade;
        dst[offset + k] = Math.max(-1, Math.min(1, d[k] * g));
      }
      offset += d.length;
      if (i < trimmed.length - 1) offset += gapSamples(i); // already zero = digital silence
    });
    return out;
  }

  /** Any AudioBuffer -> mono Float32Array at `rate` (linear resampling when the rate differs). */
  private toMonoAtRate(buffer: AudioBuffer, rate: number): Float32Array {
    const ch = buffer.numberOfChannels;
    let mono: Float32Array;
    if (ch === 1) {
      mono = buffer.getChannelData(0);
    } else {
      mono = new Float32Array(buffer.length);
      for (let c = 0; c < ch; c++) {
        const d = buffer.getChannelData(c);
        for (let i = 0; i < buffer.length; i++) mono[i] += d[i] / ch;
      }
    }
    if (buffer.sampleRate === rate) return mono;
    const ratio = buffer.sampleRate / rate;
    const n = Math.floor(mono.length / ratio);
    const res = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(mono.length - 1, i0 + 1);
      res[i] = mono[i0] + (mono[i1] - mono[i0]) * (pos - i0);
    }
    return res;
  }

  /**
   * Extract normalized waveform peaks (e.g., 90 points) for rendering visualizer bars.
   */
  public extractWaveformPeaks(buffer: AudioBuffer, peakCount = 96): number[] {
    const data = buffer.getChannelData(0);
    const blockSize = Math.floor(data.length / peakCount);
    const peaks: number[] = [];

    for (let i = 0; i < peakCount; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, data.length);
      let sum = 0;

      for (let j = start; j < end; j++) {
        sum += Math.abs(data[j]);
      }

      const avg = sum / (end - start || 1);
      // Boost low peaks visually for pleasant aesthetic
      const visualVal = Math.min(1.0, Math.max(0.08, Math.pow(avg * 2.2, 0.75)));
      peaks.push(visualVal);
    }

    return peaks;
  }

  /**
   * Encode an AudioBuffer into a true standard 16-bit PCM lossless WAV file Blob.
   */
  public createWavBlob(audioBuffer: AudioBuffer): Blob {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const dataLength = audioBuffer.length * blockAlign;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    // RIFF chunk descriptor
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');

    // "fmt " sub-chunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
    view.setUint16(20, format, true); // AudioFormat
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
    view.setUint16(32, blockAlign, true); // BlockAlign
    view.setUint16(34, bitDepth, true); // BitsPerSample

    // "data" sub-chunk
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    // Write interleaved PCM 16-bit samples. The channel arrays are fetched ONCE: calling getChannelData() inside the
    // sample loop made exporting a long script (tens of millions of samples) take minutes and freeze the window.
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) channels.push(audioBuffer.getChannelData(ch));
    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  /**
   * Helper to download blob directly to user's disk.
   */
  public downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  private referenceAudioCache: Map<string, string> = new Map();

  /**
   * Ensure reference audio sample has a valid, playable Blob URL.
   * REAL AUDIO ONLY: returns the stored blob URL, a blob: URL, or a remote
   * downloadUrl. Never synthesizes fake audio — throws when nothing playable
   * exists so callers can show "Download first" instead of a fake preview.
   */
  public async ensureReferenceAudioUrl(ref: {
    id: string;
    url?: string;
    downloadUrl?: string;
    referenceText?: string;
    speakerGender?: 'male' | 'female' | 'neutral';
    language?: string;
    accent?: string;
  }): Promise<string> {
    // Stored audio first (IndexedDB, then the voice-library file): a saved blob: URL is dead after a restart.
    try {
      const stored = await StorageService.getInstance().getReferencePlayableUrl(ref.id);
      if (stored) return stored;
    } catch {}
    if (ref.url && ref.url.startsWith('http')) return ref.url;
    if (this.referenceAudioCache.has(ref.id)) {
      return this.referenceAudioCache.get(ref.id)!;
    }
    // Brand-new clip that is only a live blob: URL of this session.
    if (ref.url && ref.url.startsWith('blob:')) {
      try { await (await fetch(ref.url)).blob(); return ref.url; } catch { /* dead URL */ }
    }
    try {
      const storedBlob = await getReferenceAudioBlob(ref.id);
      if (storedBlob) {
        const storedBlobUrl = URL.createObjectURL(storedBlob);
        this.referenceAudioCache.set(ref.id, storedBlobUrl);
        return storedBlobUrl;
      }
    } catch {}

    // Fall back to the remote file directly (still real audio, streams online).
    if (ref.downloadUrl) {
      return ref.downloadUrl;
    }

    throw new Error(
      'No playable audio for this reference. Download it or upload a real audio file first.'
    );
  }
}
