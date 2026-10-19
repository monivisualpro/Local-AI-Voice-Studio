import { buildVoiceInstruction, kokoroVoiceFor, withEmotionDescription, chatterboxExaggeration } from '../src/services/voiceInstruction';
import { getEngineProfile } from '../src/services/engineProfiles';
let ok = true;
const check = (l: string, c: boolean, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };

const dflt = 'Speak calmly, warmly and naturally.';
let r = buildVoiceInstruction(dflt, 'female');
check('female persona + gender-less description -> female added', /female/i.test(r), r);
r = buildVoiceInstruction(dflt, 'male');
check('male persona + gender-less description -> male added', /^A male voice/.test(r), r);
r = buildVoiceInstruction('A warm middle-aged woman with a British accent', 'male');
check("user's own gender words are respected (never overridden)", r === 'A warm middle-aged woman with a British accent', r);
r = buildVoiceInstruction(dflt, 'neutral');
check('neutral persona leaves the description alone', r === dflt);
r = buildVoiceInstruction('He speaks slowly', 'female');
check('"He" in the description counts as gender words', r === 'He speaks slowly');
r = buildVoiceInstruction('The human speaks', 'female');
check('"human" does not count as "man"', /female/.test(r), r);

r = buildVoiceInstruction(dflt, 'female', { indic: true, language: 'Hindi' });
check('Indic + female + Hindi -> Divya, grammatical', r === "Divya's voice is clear and expressive. Speak calmly, warmly and naturally.", r);
r = buildVoiceInstruction(dflt, 'male', { indic: true, language: 'Hindi' });
check('Indic + male + Hindi -> Rohit', /^Rohit's voice is clear and expressive\. Speak/.test(r) && !/is Speak/.test(r), r);
r = buildVoiceInstruction("Jaya's voice is slow and calm.", 'male', { indic: true, language: 'Tamil' });
check('Indic: a speaker the user named is kept', r === "Jaya's voice is slow and calm.", r);
r = buildVoiceInstruction('', 'female', { indic: true, language: 'Tamil' });
check('Indic + Tamil + female -> Jaya, with a default description', /^Jaya's voice is clear/.test(r), r);
r = buildVoiceInstruction('', 'male', { indic: true, language: 'Tamil' });
check('Indic + Tamil + male (no male speaker listed) -> Rohit fallback', /^Rohit's voice/.test(r), r);

check('Kokoro Hindi female', kokoroVoiceFor('Hindi', 'female') === 'hf_alpha');
check('Kokoro Hindi male', kokoroVoiceFor('Hindi', 'male') === 'hm_omega');
check('Kokoro unknown language falls back to American English', kokoroVoiceFor('Klingon', 'female') === 'af_heart');
check('every Kokoro voice matches the backend voice-id pattern', Object.values(await import('../src/services/voiceInstruction').then(m => m.KOKORO_BY_LANGUAGE)).every(v => /^[abefhijpz][fm]_[a-z]+$/.test(v.female) && /^[abefhijpz][fm]_[a-z]+$/.test(v.male)));
// emotion + engine capabilities
check('emotion words are appended to a voice description', /energetic/.test(withEmotionDescription('A calm voice.', 'excited')));
check('neutral adds nothing', withEmotionDescription('A calm voice.', 'neutral') === 'A calm voice.');
check('the same emotion is never added twice', (withEmotionDescription(withEmotionDescription('x', 'warm'), 'warm').match(/warm, kind/g) || []).length === 1);
check('Chatterbox exaggeration: whisper < neutral < excited < dramatic', chatterboxExaggeration('whisper') < chatterboxExaggeration('neutral') && chatterboxExaggeration('neutral') < chatterboxExaggeration('excited') && chatterboxExaggeration('excited') < chatterboxExaggeration('dramatic'));
const prof = (adapter: string, id = 'x') => getEngineProfile({ id, name: id, adapter } as any);
check('speed is native only for Kokoro, XTTS and F5-TTS', ['kokoro', 'xtts', 'f5tts'].every(a => prof(a).nativeSpeed) && ['chatterbox', 'parler', 'svara', 'sooktam', 'qwen3', 'urdu-tortoise'].every(a => !prof(a).nativeSpeed));
check('emotion: Chatterbox = parameter, Parler = description, Kokoro = none', prof('chatterbox').emotion === 'parameter' && prof('parler').emotion === 'description' && prof('kokoro').emotion === 'none');
console.log(ok ? '\nALL VOICE CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
