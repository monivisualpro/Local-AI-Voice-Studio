// Unpunctuated Hindi (e.g. a transcript) gets sentence marks; punctuated text is untouched.
import { restoreHindiPunctuation, chunkScript } from '../src/services/textChunker';
let ok = true;
const check = (l: string, c: boolean) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) ok = false; };

const raw = 'क्या आपने महसूस किया है कि आपकी टांगें अब पहले जैसी मजबूत नहीं रहीं क्या सीढ़ियां चढ़ते वक्त आप जल्दी थक जाते हैं या दिन के इख्तिताम पर आपको अपनी टांगों में भारीपन और बेचैनी महसूस होती है बहुत से लोग इसे सिर्फ बुढ़ापे का एक लाजमी हिस्सा समझ कर नजरअंदाज कर देते हैं लेकिन हकीकत में हमारी रोजमर्रा की खुराक इसमें एक बुनियादी किरदार अदा करती है';
const fixed = restoreHindiPunctuation(raw);
check('question mark inserted before the second "क्या"', fixed.includes('रहीं? क्या'));
check('comma inserted before "लेकिन"', fixed.includes('हैं, लेकिन'));
check('text ends with a danda', fixed.endsWith('\u0964'));
check('no word was changed or lost', fixed.replace(/[?,\u0964]/g, '').split(/\s+/).join(' ') === raw);
const already = 'यह एक वाक्य है। यह दूसरा वाक्य है, और यह तीसरा। ' + raw.slice(0, 120) + '।';
check('already punctuated text is untouched', restoreHindiPunctuation(already) === already);
check('English is untouched', restoreHindiPunctuation('hello world this is plain english text without any punctuation at all but long enough to pass the length gate for sure') === 'hello world this is plain english text without any punctuation at all but long enough to pass the length gate for sure');
const chunks = chunkScript(raw, 130);
check('every chunk is short enough for Parler', chunks.every(c => c.text.length <= 150));
check('no chunk is cut without a mark except at the length limit', chunks.slice(0, -1).filter(c => !/[?,\u0964]$/.test(c.text)).length <= 1);
console.log(ok ? '\nALL HINDI PUNCTUATION CHECKS PASSED' : '\nFAILED');
process.exit(ok ? 0 : 1);
