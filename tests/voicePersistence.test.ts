// @ts-nocheck - dev-only test (npm i --no-save fake-indexeddb). Run: npx tsx tests/voicePersistence.test.ts
// Reproduces "downloaded voice plays once, but after closing and reopening the app it is gone":
// every voice must survive an app restart, from IndexedDB or - when that was cleared - from the voice-library file.
import 'fake-indexeddb/auto';

const store = new Map<string, string>();
const g = globalThis as any;
g.window = g;
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) };

const disk = new Map<string, Uint8Array>();
g.electronAPI = {
  isDesktop: true,
  voices: {
    saveFile: async (p: any) => { const path = `/lib/${p.id}.${p.ext}`; disk.set(path, p.bytes); return { ok: true, path }; },
    readFile: async (path: string) => (disk.has(path) ? { ok: true, bytes: disk.get(path) } : { ok: false, error: 'gone' }),
    exists: async (path: string) => disk.has(path),
    deleteFile: async (path: string) => { disk.delete(path); return { ok: true }; },
    reveal: async () => ({ ok: true }),
    openFolder: async () => ({ ok: true }),
  },
};

let ok = true;
const check = (l: string, c: boolean, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };
const text = async (blob: Blob) => Buffer.from(await blob.arrayBuffer()).toString();

const { StorageService } = await import('../src/services/storageService');
const { deleteReferenceAudioBlob } = await import('../src/services/referenceAudioStorage');
const restart = async () => {
  (StorageService as any).instance = undefined;
  const s = StorageService.getInstance();
  await s.hydration;
  return s;
};

let s = StorageService.getInstance();
await s.hydration;

// ---- 1. the user's own voice (upload / recording)
const mine = { id: 'ref-custom-1', name: 'My voice', language: 'English', accent: 'x', folderId: 'folder-custom-clones', folderName: 'Mine',
  size: 5, duration: 4, url: '', createdAt: 1, isBuiltIn: false };
await s.addReferenceAudioWithBlob(mine, new Blob(['MYVOICE'], { type: 'audio/wav' }));
const saved = JSON.parse(store.get('tts_studio_reference_audios')!);
check('no blob: URL is ever written to storage', !saved.some((r: any) => (r.url || '').startsWith('blob:')));
check('a copy of the voice is on disk', [...disk.keys()].some(k => k.includes('ref-custom-1')));

s = await restart();
let item = s.getReferenceAudios().find(r => r.id === 'ref-custom-1')!;
check('after restart the voice is still in the list, audio not missing', !!item && !item.audioMissing);
check('after restart its audio can be read', (await text((await s.getReferenceBlob('ref-custom-1'))!)) === 'MYVOICE');
check('after restart it has a playable URL again', !!item.url && item.url.startsWith('blob:'));

// ---- 2. a downloaded catalogue voice (the reported bug): simulate a download then a restart with a STALE saved url
const cat = s.getReferenceAudios().find(r => r.downloadUrl)!;
globalThis.fetch = async () => new Response(new Blob(['CATALOGAUDIO'], { type: 'audio/mpeg' }));
await s.downloadReferenceAudio(cat.id);
const list = JSON.parse(store.get('tts_studio_reference_audios')!);
list.find((r: any) => r.id === cat.id).url = 'blob:http://127.0.0.1:3000/dead-uuid'; // what older versions saved
store.set('tts_studio_reference_audios', JSON.stringify(list));
s = await restart();
item = s.getReferenceAudios().find(r => r.id === cat.id)!;
check('downloaded voice stays "downloaded" after restart', item.isDownloaded === true);
check('the dead blob: URL from the old version is replaced by a live one', item.url.startsWith('blob:') && !item.url.includes('dead-uuid'));
check('and the audio plays (reads back)', (await text((await s.getReferenceBlob(cat.id))!)) === 'CATALOGAUDIO');

// ---- 3. browser storage wiped (new origin / cleared data): the file in the voice library restores it
await deleteReferenceAudioBlob(cat.id);
await deleteReferenceAudioBlob('ref-custom-1');
s = await restart();
item = s.getReferenceAudios().find(r => r.id === cat.id)!;
check('IndexedDB wiped: downloaded voice is restored from the voice-library file', item.isDownloaded && (await text((await s.getReferenceBlob(cat.id))!)) === 'CATALOGAUDIO');
const mine2 = s.getReferenceAudios().find(r => r.id === 'ref-custom-1')!;
check('IndexedDB wiped: own voice is restored from disk too', !mine2.audioMissing && (await text((await s.getReferenceBlob('ref-custom-1'))!)) === 'MYVOICE');

// ---- 4. audio lost everywhere: the UI is told instead of failing silently
disk.clear();
await deleteReferenceAudioBlob(cat.id);
await deleteReferenceAudioBlob('ref-custom-1');
s = await restart();
check('lost catalogue download is offered for download again', s.getReferenceAudios().find(r => r.id === cat.id)!.isDownloaded === false);
check('lost own voice is flagged (not silently "working")', s.getReferenceAudios().find(r => r.id === 'ref-custom-1')!.audioMissing === true);

console.log(ok ? '\nALL VOICE PERSISTENCE CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
