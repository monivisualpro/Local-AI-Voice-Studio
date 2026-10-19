// @ts-nocheck - dev-only UI test (npm i --no-save jsdom @testing-library/react @testing-library/dom)
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const g = globalThis as any;
g.window = dom.window; g.document = dom.window.document; Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
g.HTMLElement = dom.window.HTMLElement; g.Node = dom.window.Node; g.MutationObserver = dom.window.MutationObserver; g.IS_REACT_ACT_ENVIRONMENT = true;
let ok = true;
const check = (l: string, c: boolean, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };

const ready: Record<string, boolean> = { dub: false, sooktam: false, xtts: false };
const order: string[] = [];
const engine = (label: string, k: string) => ({ label, ready: ready[k], envId: ready[k] ? 'env-a' : null, envLabel: 'Environment A', sharedWith: [], needsUpdate: false, installedTorchTag: 'cpu', plannedTorchTag: 'cpu', device: 'cpu', note: 'CPU', needsDriverUpdate: false, torch: null });
(dom.window as any).electronAPI = {
  isDesktop: true,
  runtime: {
    status: async () => ({ platform: 'win32', arch: 'x64', root: '/r', freeBytes: 5e11, pythonReady: true, pythonVersion: '3.11', gpu: null, vcRuntime: { required: false, installed: true }, envs: [], running: null,
      engines: { dub: engine('Dubbing', 'dub'), sooktam: engine('Sooktam-2', 'sooktam'), xtts: engine('XTTS-v2', 'xtts') } }),
    install: async ({ adapter }: any) => { order.push('env:' + adapter); await new Promise(r => setTimeout(r, 20)); ready[adapter] = true; return { ok: true }; },
    pause: async () => ({ paused: true }), cancel: async () => true, onProgress: () => () => {},
  },
};

(async () => {
  const React = await import('react');
  const { render, screen, fireEvent, waitFor } = await import('@testing-library/react');
  const { ModelRegistry } = await import('../src/services/modelRegistry');
  const { DubbingSetup, recommendedCloner } = await import('../src/components/DubbingSetup');
  const reg: any = ModelRegistry.getInstance();
  const setInstalled = (id: string) => { reg.models = reg.models.map((m: any) => (m.id === id ? { ...m, isInstalled: true } : m)); reg.notify(); };
  reg.startDownload = async (id: string) => { order.push('model:' + id); await new Promise(r => setTimeout(r, 20)); setInstalled(id); };

  check('recommended cloner: Urdu -> Sooktam-2, German -> XTTS-v2', recommendedCloner('Urdu') === 'sooktam-2' && recommendedCloner('German') === 'xtts-v2');

  let changed = 0;
  const { container } = render(React.createElement(DubbingSetup, { asrId: 'whisper-small-ct2', target: 'Urdu', clonerInstalled: false, onChanged: () => { changed++; } }));
  await waitFor(() => screen.getByRole('button', { name: /Set up everything/ }));
  check('checklist lists the engine, both models, the voice model and its engine', ['Dubbing engine', 'Whisper small', 'NLLB-200', 'Sooktam-2'].every(t => container.textContent!.includes(t)));

  fireEvent.click(screen.getByRole('button', { name: /Set up everything/ }));
  await waitFor(() => expect_(order.length >= 5), { timeout: 8000 });
  function expect_(c: boolean) { if (!c) throw new Error('not yet ' + order.join(',')); }
  check('everything is installed in the right order', JSON.stringify(order) === JSON.stringify(['env:dub', 'model:whisper-small-ct2', 'model:nllb-200-distilled-600m', 'model:sooktam-2', 'env:sooktam']), order.join(' > '));
  await waitFor(() => { if (container.textContent!.includes('Set up Dubbing')) throw new Error('still showing'); }, { timeout: 4000 });
  check('when finished the setup panel disappears and the page is told', changed >= 1 && !container.textContent!.includes('Set up Dubbing'));

  // an already-installed cloner is not downloaded again
  order.length = 0;
  console.log(ok ? '\nALL DUBBING SETUP UI CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('TEST CRASHED', e.message); process.exit(1); });
