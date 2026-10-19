import type { TTSModel } from '../types/tts';

/** What each real speech engine needs from the UI. Mirrors backend/engines/*.py. */
export interface EngineProfile {
  wired: boolean;
  /** Why an engine cannot run yet (shown to the user). */
  notWiredReason?: string;
  /** Reference audio clip: required (voice cloning), optional, or not used. */
  reference: 'required' | 'optional' | 'none';
  /** Reference clip must come with its transcript (F5-TTS). */
  needsTranscript: boolean;
  /** Free-text voice/style description (VoiceDesign, Parler). */
  usesInstruction: boolean;
  /** Picks from the preset voice list (Kokoro). */
  usesPresetVoices: boolean;
  /** Longest text piece (characters) the engine handles well in one go. Longer scripts are split and re-joined. */
  maxChunkChars: number;
  /** The engine changes speed itself (better quality). Otherwise the app stretches the finished audio. */
  nativeSpeed: boolean;
  /** How the Emotion setting reaches the engine: a numeric parameter, words in the voice description, or not at all. */
  emotion: 'parameter' | 'description' | 'none';
  /** One-line help shown when something is missing. */
  hint: string;
}

const NOT_WIRED = (name: string, why: string): EngineProfile => ({
  wired: false,
  notWiredReason: `${name} cannot run in this build: ${why} Use one of the supported models instead.`,
  reference: 'none',
  needsTranscript: false,
  usesInstruction: false,
  usesPresetVoices: false,
  maxChunkChars: 220,
  nativeSpeed: false,
  emotion: 'none',
  hint: '',
});

export function getEngineProfile(model: Pick<TTSModel, 'id' | 'name' | 'adapter'>): EngineProfile {
  const base = { wired: true, needsTranscript: false, usesInstruction: false, usesPresetVoices: false, nativeSpeed: false, emotion: 'none' as const };
  switch (model.adapter) {
    case 'kokoro':
      return { ...base, reference: 'none', usesPresetVoices: true, maxChunkChars: 400, nativeSpeed: true, hint: '' };
    case 'qwen3':
      if (/voicedesign/i.test(model.id)) {
        return { ...base, reference: 'none', usesInstruction: true, maxChunkChars: 320, emotion: 'description',
          hint: 'Describe the voice in the Style Instruction box (e.g. "a warm, calm female voice").' };
      }
      return { ...base, reference: 'required', maxChunkChars: 150, // the 0.6B model drifts / glitches on long pieces
        hint: 'Qwen3-TTS Base clones a voice: add a 3-20 second reference clip (a transcript improves quality).' };
    case 'f5tts':
      return { ...base, reference: 'required', needsTranscript: true, maxChunkChars: 240, nativeSpeed: true,
        hint: 'F5-TTS needs a reference clip AND the exact words spoken in it.' };
    case 'chatterbox':
      return { ...base, reference: 'optional', maxChunkChars: 260, emotion: 'parameter',
        hint: 'Optional: add a reference clip to clone a voice; otherwise the built-in voice is used.' };
    case 'xtts':
      return { ...base, reference: 'optional', maxChunkChars: 240, nativeSpeed: true, // XTTS truncates audio for texts above ~250 characters
        hint: 'Optional: add a reference clip to clone a voice; otherwise a built-in speaker is used.' };
    case 'parler':
      if (/indic/i.test(model.id)) {
        return { ...base, reference: 'none', usesInstruction: true, maxChunkChars: 130, emotion: 'description', // Parler degrades on long pieces
          hint: 'Type the text in the script of the language you want (Devanagari for Hindi, Tamil script for Tamil, ...). Name a speaker in the Style Instruction box, e.g. "Divya\'s voice is clear and expressive, very close recording, no background noise." Recommended: Hindi Divya (female) / Rohit (male), Bengali Aditi / Arjun, Tamil Jaya, Marathi Sunita / Sanjay, Telugu Lalitha / Prakash. Using the same speaker name for the whole text keeps one voice. No voice cloning.' };
      }
      return { ...base, reference: 'none', usesInstruction: true, maxChunkChars: 280, emotion: 'description',
        hint: 'Describe the voice in the Style Instruction box.' };
    case 'svara':
      return { ...base, reference: 'none', usesPresetVoices: true, maxChunkChars: 200,
        hint: 'Choose the language; the male/female voice follows the persona gender (e.g. "Hindi (Female)"). End a sentence with <happy>, <sad>, <anger>, <fear> or <clear> for style.' };
    case 'sooktam':
      return { ...base, reference: 'optional', needsTranscript: true, maxChunkChars: 180,
        hint: 'Add a 3-10 second reference clip AND type the words it says (same language). Without a clip, the sample voice shipped with the model is used.' };
    case 'urdu-tortoise':
      return { ...base, reference: 'required', maxChunkChars: 200,
        hint: 'Add a clean 6-15 second reference clip of the voice to clone. Type Urdu in Urdu script. Very slow on CPU.' };
    case 'dub':
      return { ...base, reference: 'none', maxChunkChars: 220, hint: 'Used by the Dubbing page (speech recognition / translation), not by the Studio.' };
    default:
      return NOT_WIRED(model.name, 'no inference adapter exists for it.');
  }
}
