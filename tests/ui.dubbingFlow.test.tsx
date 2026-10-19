// @ts-nocheck - dev-only UI test (npm i --no-save jsdom @testing-library/react @testing-library/dom)
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const g = globalThis as any;
g.window = dom.window; g.document = dom.window.document; Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
g.HTMLElement = dom.window.HTMLElement; g.Node = dom.window.Node; g.MutationObserver = dom.window.MutationObserver; g.IS_REACT_ACT_ENVIRONMENT = true;
g.Audio = function () { return { play: async () => {}, pause: () => {} }; };
(dom.window as any).URL.createObjectURL = () => 'blob:x'; g.URL.createObjectURL = () => 'blob:x';
let ok = true;
const check = (l: string, c: boolean, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };

const log: any[] = [];
let assemblePlans: any[] = [];
const files = new Map<string, Uint8Array>([['/job/reference.wav', new Uint8Array([9])], ['/job/ref1.wav', new Uint8Array([1])], ['/job/ref2.wav', new Uint8Array([2])]]);
(dom.window as any).electronAPI = {
  isDesktop: true,
  runtime: { status: async () => ({ pythonReady: true, engines: { dub: { ready: true }, xtts: { ready: true } }, envs: [], freeBytes: 1e12, vcRuntime: { required: false, installed: true }, running: null }), install: async () => ({ ok: true }), pause: async () => ({ paused: true }), cancel: async () => true, onProgress: () => () => {} },
  dub: {
    pickMedia: async () => '/videos/talk.mp4',
    status: async () => ({ environmentReady: true, models: { 'whisper-large-v3-turbo-ct2': true, 'whisper-small-ct2': true, 'nllb-200-distilled-600m': true } }),
    run: async ({ stage, args }: any) => {
      log.push(stage);
      if (stage === 'selftest') return { ok: true, allOk: false, checks: [{ name: 'Audio tools (ffmpeg)', ok: true, detail: 'ffmpeg runs', seconds: 0.2 }, { name: 'Translation model', ok: false, detail: 'RuntimeError: broken file', seconds: 1.5 }] };
      if (stage === 'prepare') return { ok: true, duration: 20, hasVideo: true };
      if (stage === 'analyze') return { ok: true, language: 'english', segments: [{ id: 0, start: 1, end: 3, text: 'Hello everyone, welcome.', speaker: 'S1' }, { id: 1, start: 4, end: 6, text: 'Today we talk about music.', speaker: 'S2' }], background: '/job/background.wav', reference: { path: '/job/ref1.wav', text: 'Hello everyone.', duration: 5 }, speakers: [{ id: 'S1', count: 1, seconds: 2, reference: { path: '/job/ref1.wav', text: 'Hello everyone.', duration: 5 } }, { id: 'S2', count: 1, seconds: 2, reference: { path: '/job/ref2.wav', text: 'Today.', duration: 4 } }] };
      if (stage === 'translate') return { ok: true, translations: ['नमस्ते सभी लोगों, आप सभी का हार्दिक स्वागत है।', 'आज हम संगीत के बारे में बात करेंगे।'], alternatives: [['सभी का स्वागत है।'], []] };
      if (stage === 'assemble') { assemblePlans.push(args.plan); return { ok: true, output: '/job/dubbed.wav', sped: 1, shifted: 0, overflow: 0, timeline: args.plan.segments.map((s: any, i: number) => ({ index: i, start: s.start, tempo: i === 0 ? 1.15 : 1, duration: 2, shifted: false, overflow: false, drift: 0, slotStart: s.start, slotEnd: s.end })) }; }
      return { ok: true };
    },
    cancel: async () => true,
    writeFile: async ({ name, bytes }: any) => { files.set('/job/' + name, bytes); return { ok: true, path: '/job/' + name }; },
    readFile: async (p: string) => files.get(p) || new Uint8Array([0]),
    saveOutput: async () => ({ ok: true }), clean: async () => true, installEnv: async () => ({ ok: true }), onProgress: () => () => {},
  },
};

(async () => {
  const React = await import('react');
  const { render, screen, fireEvent, waitFor } = await import('@testing-library/react');
  const { ModelRegistry } = await import('../src/services/modelRegistry');
  const { AudioEngine } = await import('../src/services/audioEngine');
  const reg: any = ModelRegistry.getInstance();
  reg.models = reg.models.map((m: any) => (['xtts-v2', 'whisper-large-v3-turbo-ct2', 'nllb-200-distilled-600m'].includes(m.id) ? { ...m, isInstalled: true } : m));
  // fake speech engine: the long Hindi sentence takes 5 s (slot is 2 s), the shorter wording takes 2 s
  const spoken: string[] = []; const refsUsed: number[] = [];
  const eng: any = AudioEngine.getInstance();
  eng.synthesizeWithModel = async (text: string, opts: any) => { spoken.push(text); refsUsed.push(opts.referenceWav[0]); const d = text.length > 30 ? 5.0 : 2.0; return { buffer: { duration: d, sampleRate: 24000 }, wavBlob: new Blob([new Uint8Array([1])]), duration: d }; };
  eng.createWavBlob = () => new Blob([new Uint8Array([1, 2])]);
  eng.joinChunks = (items: any[]) => items[0].buffer;
  const { DubbingPage } = await import('../src/pages/DubbingPage');

  render(React.createElement(DubbingPage, { onNavigateToModels: () => {} }));
  await waitFor(() => screen.getByRole('button', { name: /Choose audio or video/ }));
  fireEvent.click(screen.getByRole('button', { name: /Check my setup/ }));
  await waitFor(() => screen.getByText('RuntimeError: broken file'));
  check('Check my setup lists each component with a clear result', !!screen.getByText('ffmpeg runs') && !!screen.getByText('Translation model'));
  check('the self-test is sent with the chosen models', log.includes('selftest'));
  fireEvent.click(screen.getByRole('button', { name: /Choose audio or video/ }));
  await waitFor(() => screen.getByText('/videos/talk.mp4'));
  fireEvent.click(screen.getByLabelText(/I own this voice/));
  const analyze = screen.getByRole('button', { name: /Analyze and translate/ });
  await waitFor(() => { if (analyze.hasAttribute('disabled')) throw new Error('disabled'); });
  fireEvent.click(analyze);
  await waitFor(() => screen.getByText(/Sentences \(2\)/), { timeout: 5000 });
  check('analyze -> translate ran in order', JSON.stringify(log.filter(x => x !== 'selftest')) === JSON.stringify(['prepare', 'analyze', 'translate']), log.join('>'));
  check('both sentences are listed with editable translations', screen.getAllByRole('textbox').length === 2);
  check('speaker controls appear when 2 speakers were found', screen.getAllByDisplayValue('S1').length >= 1 && screen.getAllByDisplayValue('S2').length >= 1);

  fireEvent.click(screen.getByRole('button', { name: /Create the dub/ }));
  await waitFor(() => screen.getByText(/Your dub is ready/), { timeout: 8000 });
  check('too-long sentence was re-spoken with the shorter wording', spoken.includes('सभी का स्वागत है।'), spoken.map(s => s.slice(0, 12)).join(' | '));
  check('each speaker is cloned from THEIR OWN voice sample', refsUsed[0] === 1 && refsUsed[1] === 2, refsUsed.join(','));
  const plan = assemblePlans[0];
  check('assemble gets 2 sentences with their original times', plan.segments.length === 2 && plan.segments[0].start === 1 && plan.segments[1].end === 6);
  check('timing settings are sent (speed limit, lead-in, trail)', plan.maxSpeedup === 1.4 && plan.leadIn === 0.35 && plan.trail === 0.6 && plan.ease === true);
  check('the shortened wording is shown in the list', (screen.getAllByRole('textbox')[0] as HTMLTextAreaElement).value === 'सभी का स्वागत है।');
  check('timing report is shown with speed and sync status', !!screen.getByText('1.15x') && screen.getAllByText('in sync').length === 2);

  fireEvent.click(screen.getByRole('button', { name: /Re-fit timing/ }));
  await waitFor(() => { if (assemblePlans.length < 2) throw new Error('no refit'); });
  check('re-fit re-mixes WITHOUT speaking again', assemblePlans.length === 2 && spoken.length === 3, `spoken ${spoken.length}x`);
  check('video can be saved with the new audio', !!screen.getByRole('button', { name: /Save as video/ }));

  console.log(ok ? '\nALL DUBBING FLOW UI CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('TEST CRASHED', e.message); process.exit(1); });
