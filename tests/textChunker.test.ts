// Run with: npx tsx tests/textChunker.test.ts
import { chunkScript, splitParagraphs, splitSentences } from '../src/services/textChunker';

let ok = true;
const check = (label: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  - ' + extra : ''}`);
  if (!cond) ok = false;
};
const squash = (s: string) => s.replace(/\s+/g, '');

const samples: Record<string, string> = {
  englishNoFinalPunct: 'Hello there. This is the first sentence. And this last one has no final full stop',
  hindi: 'नमस्ते दोस्तों। आज हम एक नई कहानी सुनेंगे। यह कहानी बहुत पुरानी है और बहुत दिलचस्प भी है। कृपया ध्यान से सुनिए',
  urdu: 'یہ پہلا جملہ ہے۔ کیا آپ ٹھیک ہیں؟ جی ہاں میں ٹھیک ہوں۔',
  chinese: '今天天气很好。我们去公园散步吧！你觉得怎么样？',
  numbers: 'Pi is 3.14159 and the price is $4.50 today. See www.example.com for details. Dr. Smith agreed.',
  paragraphs: 'First paragraph line one.\n\nSecond paragraph here. It has two sentences.\n\n\n\nThird.',
  hardWrapped: 'This sentence was wrapped by an\neditor in the middle of the\nsentence. A new one starts here.\nAnd another line.',
  noSpaces: '这是一个没有任何标点符号的很长很长的句子'.repeat(30),
  hugeWord: 'a'.repeat(900),
  quotes: 'He said, "Come here!" Then she answered, \'No way.\' (And that was it.)',
  emoji: 'Great job 😀😀😀. We did it 🎉! Next 👩‍💻 task.',
};

for (const [name, text] of Object.entries(samples)) {
  for (const max of [60, 120, 220, 400]) {
    const chunks = chunkScript(text, max);
    const joined = chunks.map(c => c.text).join(' ');
    check(`[${name}] max=${max}: no text lost or invented`, squash(joined) === squash(text), `${chunks.length} chunks`);
    const over = chunks.filter(c => Array.from(c.text).length > Math.ceil(Math.max(40, max) * 1.15) + 1);
    check(`[${name}] max=${max}: no chunk over the limit`, over.length === 0, over.map(c => c.text.length).join(','));
    check(`[${name}] max=${max}: last chunk ends a paragraph`, chunks.length === 0 || chunks[chunks.length - 1].paragraphEnd);
  }
}

// --- specific behaviours
let c = chunkScript(samples.englishNoFinalPunct, 220);
check('trailing text without punctuation is kept (old code dropped it)', c.map(x => x.text).join(' ').includes('no final full stop'));

c = chunkScript(samples.hindi, 60);
check('Hindi danda splits sentences', splitSentences(samples.hindi).length === 4, String(splitSentences(samples.hindi).length));

check('3.14159 / $4.50 / URL are not split', !splitSentences(samples.numbers).some(s => /^\d|^com\b|^50\b/.test(s)), JSON.stringify(splitSentences(samples.numbers)));

const paras = splitParagraphs(samples.paragraphs);
check('blank lines make paragraphs', paras.length === 3, JSON.stringify(paras));
c = chunkScript(samples.paragraphs, 400);
check('paragraph ends are flagged (3 paragraphs -> 3 flags)', c.filter(x => x.paragraphEnd).length === 3);

const wrapped = splitParagraphs(samples.hardWrapped);
check('hard-wrapped lines are re-joined into one sentence', wrapped[0].startsWith('This sentence was wrapped by an editor in the middle of the sentence.'), JSON.stringify(wrapped));

c = chunkScript(samples.hugeWord, 120);
check('one 900-char word is cut by length, nothing lost', c.length >= 7 && squash(c.map(x => x.text).join('')) === samples.hugeWord);

c = chunkScript('A short one. Another short one. And one more short sentence here.', 220);
check('short sentences are PACKED into one chunk (fewer seams)', c.length === 1, String(c.length));

check('empty / whitespace input gives no chunks', chunkScript('  \n\n  ').length === 0);

console.log(ok ? '\nALL CHUNKER CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
