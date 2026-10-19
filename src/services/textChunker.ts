/**
 * Splits a long script into model-sized pieces WITHOUT losing a single character of text and
 * WITHOUT cutting in the middle of a sentence where it can be avoided.
 *
 *  - Understands sentence ends of Latin, Devanagari (danda), Urdu/Arabic, Chinese/Japanese scripts.
 *  - Packs short sentences together up to `maxChars`, so a long text becomes as FEW pieces as the
 *    model allows (every piece boundary is a place where the voice can change slightly).
 *  - Remembers which pieces end a paragraph, so the joiner can leave a longer pause there.
 *  - A single newline inside a sentence (hard-wrapped pasted text) is treated as a space; a blank
 *    line, or a newline after a finished sentence, starts a new paragraph.
 */
export interface TextChunk {
  text: string;
  /** True when this piece is the last one of its paragraph (longer pause after it). */
  paragraphEnd: boolean;
}

// Sentence-ending marks: . ! ? … and their Hindi/Urdu/CJK equivalents.
const SENTENCE_END = /[.!?\u2026\u0964\u0965\u06d4\u061f\u3002\uff01\uff1f\uff0e]/;
// Soft break marks, used only when one sentence alone is longer than the limit.
const SOFT_BREAK = /[,;:\u060c\u061b\u3001\uff0c\uff1b\uff1a\u2014]/;
const CLOSERS = new Set(['"', "'", ')', ']', '}', '\u201d', '\u2019', '\u00bb', '\u300d', '\u300f']);

const HINDI_SENTENCE_OPENERS = new Set(['क्या', 'अगर', 'आज', 'आइए', 'अक्सर', 'हमारा', 'हमारी', 'इसलिए']);
const HINDI_CONJUNCTIONS = new Set(['लेकिन', 'बल्कि', 'ताकि', 'क्योंकि', 'जबकि']);
const HINDI_FINAL_AUX = /^(है|हैं|था|थी|थे|होगा|होगी|होंगे|होंगी|चाहिए)$/;
const ANY_PUNCT = /[.!?,;:\u0964\u0965\u06d4\u061f\u060c]/g;

/**
 * Speech-to-text transcripts and pasted scripts often have NO punctuation at all. Speech models (Indic Parler most of
 * all) use punctuation to know where a sentence ends: without it they run on, repeat words or stall. For unpunctuated
 * Hindi (Devanagari) text this adds the missing marks at clear boundaries: a danda / question mark before sentence
 * openers, commas before conjunctions, and a break after a very long run. Text that already has punctuation is untouched.
 */
export function restoreHindiPunctuation(text: string): string {
  const letters = text.match(/\p{L}/gu) || [];
  const devanagari = text.match(/[\u0900-\u097F]/g) || [];
  if (letters.length < 60 || devanagari.length / letters.length < 0.5) return text;
  const words = text.split(/\s+/).filter(Boolean);
  const marks = (text.match(ANY_PUNCT) || []).length;
  if (marks * 30 >= words.length) return text; // already punctuated
  const out: string[] = [];
  let since = 0; // words since the last break
  let startedWithKya = false;
  const endsWithMark = (w: string) => /[.!?,;:\u0964\u0965\u06d4\u061f\u060c]$/.test(w);
  const close = (mark: string) => {
    if (out.length && !endsWithMark(out[out.length - 1])) out[out.length - 1] += mark;
    since = 0;
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1] || '';
    const opener = HINDI_SENTENCE_OPENERS.has(w) || (w === 'इस' && next === 'वीडियो') || (w === 'बहुत' && next === 'से');
    if (opener && since >= 5) {
      close(startedWithKya ? '?' : '\u0964');
      startedWithKya = false;
    } else if (HINDI_CONJUNCTIONS.has(w) && since >= 4) {
      close(',');
      since = 3; // a comma is not a sentence end: keep counting toward the long-run rule
    }
    if (since === 0 && !startedWithKya) startedWithKya = w === 'क्या';
    out.push(w);
    since++;
    // A very long run without a mark: end it right after a closing auxiliary verb ("... होती है").
    if (since >= 14 && HINDI_FINAL_AUX.test(w) && i + 1 < words.length) {
      const sentenceEnd = since >= 20;
      close(sentenceEnd ? (startedWithKya ? '?' : '\u0964') : ',');
      if (sentenceEnd) startedWithKya = false;
    }
  }
  if (out.length && !/[.!?\u0964\u0965\u06d4\u061f]$/.test(out[out.length - 1])) out[out.length - 1] = out[out.length - 1].replace(/[,;:]$/, '') + '\u0964';
  return out.join(' ');
}

function normalizeSpaces(s: string): string {
  return s.replace(/[ \t\u00a0\u3000]+/g, ' ').trim();
}

/** Splits text into paragraphs (blank lines, or a newline that follows a finished sentence). */
export function splitParagraphs(text: string): string[] {
  const unified = text.replace(/\r\n?/g, '\n');
  const blocks = unified.split(/\n[ \t]*\n+/);
  const paragraphs: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    let current = '';
    for (const line of lines) {
      if (!current) {
        current = line;
        continue;
      }
      const last = current.replace(/[\s"'\u201d\u2019)\]]+$/u, '').slice(-1);
      if (last && SENTENCE_END.test(last)) {
        paragraphs.push(current); // line break after a complete sentence = paragraph break
        current = line;
      } else {
        current += ' ' + line; // hard-wrapped line: same sentence continues
      }
    }
    if (current) paragraphs.push(current);
  }
  return paragraphs.map(normalizeSpaces).filter(Boolean);
}

/** Splits one paragraph into sentences. Text without any end mark stays as one sentence. */
export function splitSentences(paragraph: string): string[] {
  const out: string[] = [];
  let start = 0;
  const chars = Array.from(paragraph);
  let pos = 0;
  const offsets: number[] = [];
  for (const ch of chars) {
    offsets.push(pos);
    pos += ch.length;
  }
  for (let i = 0; i < chars.length; i++) {
    if (!SENTENCE_END.test(chars[i])) continue;
    // swallow repeated marks ("?!", "...") and closing quotes/brackets
    let j = i;
    while (j + 1 < chars.length && (SENTENCE_END.test(chars[j + 1]) || CLOSERS.has(chars[j + 1]))) j++;
    const next = chars[j + 1];
    const cjk = /[\u3002\uff01\uff1f\uff0e]/.test(chars[i]);
    // A "." inside a number/abbreviation ("3.14", "e.g.x") is not a sentence end: needs space/end after it.
    if (next !== undefined && !/\s/.test(next) && !cjk) {
      i = j;
      continue;
    }
    const end = j + 1 < chars.length ? offsets[j + 1] : paragraph.length;
    const sentence = paragraph.slice(start, end).trim();
    if (sentence) out.push(sentence);
    start = end;
    i = j;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** Breaks an over-long sentence at soft marks, then at spaces, then (last resort) by length. */
function splitLongSentence(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) return [sentence];
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    let cut = -1;
    for (let i = window.length - 1; i >= Math.floor(maxChars * 0.4); i--) {
      if (SOFT_BREAK.test(window[i])) {
        cut = i + 1;
        break;
      }
    }
    if (cut < 0) {
      const space = window.lastIndexOf(' ');
      cut = space >= Math.floor(maxChars * 0.4) ? space + 1 : -1;
    }
    if (cut < 0) cut = maxChars; // no spaces at all (e.g. Chinese text without punctuation)
    // never cut a surrogate pair in half
    const code = rest.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut += 1;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces.filter(Boolean);
}

export function chunkScript(text: string, maxChars = 220): TextChunk[] {
  text = restoreHindiPunctuation(text);
  const limit = Math.max(40, Math.floor(maxChars));
  const chunks: TextChunk[] = [];

  for (const paragraph of splitParagraphs(text)) {
    const pieces: string[] = [];
    for (const sentence of splitSentences(paragraph)) pieces.push(...splitLongSentence(sentence, limit));

    const packed: string[] = [];
    let current = '';
    for (const piece of pieces) {
      if (!current) current = piece;
      else if (current.length + 1 + piece.length <= limit) current += ' ' + piece;
      else {
        packed.push(current);
        current = piece;
      }
    }
    if (current) packed.push(current);

    // A tiny last piece ("Okay.") sounds odd on its own: glue it to the previous piece when it fits a bit over.
    if (packed.length > 1 && packed[packed.length - 1].length < 24) {
      const tail = packed.pop() as string;
      const prev = packed[packed.length - 1];
      if (prev.length + 1 + tail.length <= Math.ceil(limit * 1.15)) packed[packed.length - 1] = prev + ' ' + tail;
      else packed.push(tail);
    }
    packed.forEach((t, i) => chunks.push({ text: t, paragraphEnd: i === packed.length - 1 }));
  }
  return chunks;
}
