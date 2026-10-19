// @ts-nocheck - dev-only UI test (npm i --no-save jsdom @testing-library/react @testing-library/dom)
// Run: npx tsx tests/ui.storage.test.tsx   (needs jsdom + @testing-library/react; not part of the app)
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const g = globalThis as any;
g.window = dom.window; g.document = dom.window.document; Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
g.HTMLElement = dom.window.HTMLElement; g.Node = dom.window.Node; g.MutationObserver = dom.window.MutationObserver;
g.IS_REACT_ACT_ENVIRONMENT = true;
g.confirm = () => true; g.alert = (m: string) => console.log('ALERT:', m);

let ok = true;
const check = (l: string, c: boolean, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };

const calls: string[] = [];
let progressCb: ((p: any) => void) | null = null;
const state = { models: '/data/models', env: '/data/runtime' };
(dom.window as any).electronAPI = {
  isDesktop: true,
  storage: {
    info: async () => ({ portable: false, installFolder: 'C:/Apps/TTS', userData: '/data', models: { path: state.models, defaultPath: '/data/models', freeBytes: 5e11, totalBytes: 1e12 }, environments: { path: state.env, defaultPath: '/data/runtime', freeBytes: 5e11, totalBytes: 1e12 }, voices: { path: '/data/voice-library' }, moving: false }),
    size: async () => ({ bytes: 3.2e9, partial: false }),
    pickFolder: async (t: string) => { calls.push('pick:' + t); return 'D:/AI-Models'; },
    open: async (k: string) => { calls.push('open:' + k); return true; },
    move: async (p: any) => { calls.push('move:' + JSON.stringify(p)); progressCb?.({ kind: p.kind, phase: 'moving', done: 50, total: 100 }); state[p.kind === 'models' ? 'models' : 'env'] = 'D:/AI-Models'; return { ok: true, folder: 'D:/AI-Models', method: 'rename', bytes: 100 }; },
    onProgress: (cb: any) => { progressCb = cb; return () => { progressCb = null; }; },
  },
};

(async () => {
  const React = await import('react');
  const { render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
  const { StorageLocationsCard } = await import('../src/components/StorageLocationsCard');
  const { ModelRegistry } = await import('../src/services/modelRegistry');
  let synced = 0; (ModelRegistry.getInstance() as any).syncWithDisk = async () => { synced++; };
  const q = (t: RegExp | string) => screen.getAllByText(t);

  render(React.createElement(StorageLocationsCard));
  await waitFor(() => screen.getByText('/data/models'));
  check('card shows the real models folder', !!screen.getByText('/data/models'));
  check('card shows the install folder', !!screen.getByText('C:/Apps/TTS'));

  const changeButtons = screen.getAllByRole('button', { name: /Change/ });
  check('there is a Change button for models and for environments', changeButtons.length === 2, String(changeButtons.length));

  fireEvent.click(changeButtons[0]);
  await waitFor(() => screen.getByText('D:/AI-Models'));
  check('Change opens the folder picker and shows the confirm panel', calls.some(c => c.startsWith('pick:')) && !!screen.getByRole('button', { name: /Move everything/ }));

  fireEvent.click(screen.getByRole('button', { name: /Move everything/ }));
  await waitFor(() => screen.getByText(/now live in/));
  check('Move sends kind=models, move=true and the picked folder', calls.some(c => c.startsWith('move:') && c.includes('"kind":"models"') && c.includes('"move":true') && c.includes('D:/AI-Models')));
  check('success message is shown', !!screen.getByText(/Models now live in: D:\/AI-Models/));
  await waitFor(() => screen.getAllByText('D:/AI-Models'));
  check('the card now shows the new folder', screen.getAllByText('D:/AI-Models').length >= 1);

  check('after the move the model list is re-read from the new folder', synced >= 1, `syncWithDisk x${synced}`);

  // use without moving
  cleanup(); calls.length = 0;
  render(React.createElement(StorageLocationsCard));
  await waitFor(() => screen.getAllByText(/Change/));
  fireEvent.click(screen.getAllByRole('button', { name: /Change/ })[1]);
  await waitFor(() => screen.getByRole('button', { name: /Use folder without moving/ }));
  fireEvent.click(screen.getByRole('button', { name: /Use folder without moving/ }));
  await waitFor(() => calls.some(c => c.startsWith('move:')));
  check('environments: "use without moving" sends move=false', calls.some(c => c.includes('"kind":"environments"') && c.includes('"move":false')));

  console.log(ok ? '\nALL STORAGE UI CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
