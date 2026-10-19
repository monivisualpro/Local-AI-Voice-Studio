/**
 * Makes the voice's gender and language actually reach the model.
 *
 *  - VoiceDesign / Parler choose the speaker's gender from the TEXT description. The default description
 *    ("Speak calmly, warmly and naturally.") says nothing about gender, so the model picked a random voice -
 *    a "female" persona could be read by a man. We now add the persona's gender when the description has none.
 *  - Indic Parler-TTS is steered by a speaker NAME (Divya, Rohit, ...). A name matching the language and gender
 *    is added when the description names no speaker.
 *  - Kokoro voices belong to one language each (af_* American, hf_* Hindi, ...). We choose a voice of the
 *    right language AND gender instead of always using an American English voice.
 */
export type Gender = 'male' | 'female' | 'neutral' | undefined;

const FEMALE_WORDS = /\b(female|woman|women|girl|lady|she|her|feminine)\b/i;
const MALE_WORDS = /\b(male|man|men|boy|guy|he|his|masculine|baritone|bass)\b/i;

export function describesGender(text: string): boolean {
  return FEMALE_WORDS.test(text) || MALE_WORDS.test(text);
}

/** Recommended Indic Parler-TTS speakers from the model card: language -> [female, male]. */
export const INDIC_SPEAKER_BY_LANGUAGE: Record<string, { female?: string; male?: string }> = {
  // Recommended speakers from the model card table (gender follows the name).
  Assamese: { female: 'Sita', male: 'Amit' },
  Bengali: { female: 'Aditi', male: 'Arjun' },
  Bodo: { female: 'Maya', male: 'Bikram' },
  Dogri: { male: 'Karan' },
  Gujarati: { female: 'Neha', male: 'Yash' },
  Hindi: { female: 'Divya', male: 'Rohit' },
  Kannada: { female: 'Anu', male: 'Suresh' },
  Malayalam: { female: 'Anjali', male: 'Harish' },
  Marathi: { female: 'Sunita', male: 'Sanjay' },
  Nepali: { female: 'Amrita' },
  Odia: { female: 'Debjani', male: 'Manas' },
  Sanskrit: { male: 'Aryan' },
  Tamil: { female: 'Jaya' },
  Telugu: { female: 'Lalitha', male: 'Prakash' },
};
const ALL_INDIC_NAMES = ['Divya', 'Rohit', 'Aman', 'Rani', 'Aditi', 'Arjun', 'Tapan', 'Rashmi', 'Arnav', 'Riya', 'Jaya', 'Kavitha', 'Aryan', 'Karan', 'Maya', 'Bikram', 'Sita', 'Amit', 'Poonam', 'Rakesh', 'Neha', 'Yash', 'Suresh', 'Anu', 'Chetan', 'Vidya', 'Anjali', 'Anju', 'Harish', 'Sunita', 'Sanjay', 'Nikhil', 'Radha', 'Varun', 'Isha', 'Amrita', 'Manas', 'Debjani', 'Prakash', 'Lalitha', 'Kiran', 'Laishram', 'Ranjit', 'Bhanu', 'Champa', 'Leela', 'Thoma', 'Mary'];

export function namesIndicSpeaker(text: string): boolean {
  return ALL_INDIC_NAMES.some(n => new RegExp(`\\b${n}\\b`, 'i').test(text));
}

export function buildVoiceInstruction(
  instruction: string,
  gender: Gender,
  opts: { indic?: boolean; language?: string } = {},
): string {
  const base = (instruction || '').trim();
  if (opts.indic) {
    if (namesIndicSpeaker(base)) return base;
    const g = gender === 'male' ? 'male' : 'female';
    const speaker = INDIC_SPEAKER_BY_LANGUAGE[opts.language || '']?.[g]
      ?? (g === 'male' ? 'Rohit' : 'Divya');
    const tail = 'clear and expressive, with a moderate speed and pitch, in a very close recording with almost no background noise.';
    return base
      ? `${speaker}'s voice is clear and expressive. ${base}${/[.!?]$/.test(base) ? '' : '.'}`
      : `${speaker}'s voice is ${tail}`;
  }
  if (gender !== 'male' && gender !== 'female') return base;
  if (describesGender(base)) return base;
  return `A ${gender} voice. ${base}`.trim();
}

/** Kokoro-82M voice per language (and gender). Names are the real Kokoro voice files. */
export const KOKORO_BY_LANGUAGE: Record<string, { female: string; male: string }> = {
  English: { female: 'af_heart', male: 'am_michael' },
  'American English': { female: 'af_heart', male: 'am_michael' },
  'British English': { female: 'bf_emma', male: 'bm_george' },
  Spanish: { female: 'ef_dora', male: 'em_alex' },
  French: { female: 'ff_siwis', male: 'ff_siwis' }, // Kokoro ships no French male voice
  Hindi: { female: 'hf_alpha', male: 'hm_omega' },
  Italian: { female: 'if_sara', male: 'im_nicola' },
  Portuguese: { female: 'pf_dora', male: 'pm_alex' },
  Japanese: { female: 'jf_alpha', male: 'jm_kumo' },
  Chinese: { female: 'zf_xiaobei', male: 'zm_yunjian' },
};

export function kokoroVoiceFor(language: string | undefined, gender: Gender): string {
  const entry = KOKORO_BY_LANGUAGE[language || 'English'] || KOKORO_BY_LANGUAGE.English;
  return gender === 'male' ? entry.male : entry.female;
}

/** The Emotion setting as plain words for engines driven by a voice description (Parler, VoiceDesign). */
const EMOTION_WORDS: Record<string, string> = {
  neutral: '',
  warm: 'The speaker sounds warm, kind and empathetic.',
  excited: 'The speaker sounds energetic, upbeat and enthusiastic.',
  dramatic: 'The speaker sounds dramatic and cinematic, with strong expression.',
  whisper: 'The speaker whispers softly, in an intimate, close, quiet voice.',
  authoritative: 'The speaker sounds confident, firm and authoritative.',
};
export function withEmotionDescription(instruction: string, emotion: string): string {
  const words = EMOTION_WORDS[emotion] || '';
  if (!words || instruction.includes(words)) return instruction;
  return `${instruction.trim()} ${words}`.trim();
}

/** Chatterbox "exaggeration" (0 = flat, 1 = very expressive) per emotion. */
export function chatterboxExaggeration(emotion: string): number {
  return ({ neutral: 0.5, warm: 0.55, excited: 0.8, dramatic: 0.9, whisper: 0.3, authoritative: 0.65 } as Record<string, number>)[emotion] ?? 0.5;
}
