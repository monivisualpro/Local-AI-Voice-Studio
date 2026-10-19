// Generated audio of the History page, kept in IndexedDB. A plain blob: URL stops working when the app is restarted
// (and used to be revoked when a segment was regenerated), so History could not play older entries.
const DB_NAME = 'TTSStudioHistoryAudioDB';
const STORE = 'history_audio';
let dbPromise: Promise<IDBDatabase> | null = null;
const urlCache = new Map<string, string>();

function getDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.reject(new Error('IndexedDB not supported'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = window.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeHistoryAudio(id: string, blob: Blob): Promise<void> {
  try { await tx('readwrite', s => s.put(blob, id)); } catch (e) { console.warn('Could not keep the audio in History:', e); }
}

/** A playable URL for a History entry: the stored audio when there is one, otherwise the URL saved with the entry. */
export async function resolveHistoryAudioUrl(id: string, fallbackUrl: string): Promise<string> {
  const cached = urlCache.get(id);
  if (cached) return cached;
  try {
    const blob = await tx<Blob | undefined>('readonly', s => s.get(id) as IDBRequest<Blob | undefined>);
    if (blob) {
      const url = URL.createObjectURL(blob);
      urlCache.set(id, url);
      return url;
    }
  } catch { /* fall through */ }
  return fallbackUrl;
}

export async function deleteHistoryAudio(id: string): Promise<void> {
  const url = urlCache.get(id);
  if (url) { URL.revokeObjectURL(url); urlCache.delete(id); }
  try { await tx('readwrite', s => s.delete(id)); } catch { /* ignore */ }
}

export async function clearHistoryAudio(): Promise<void> {
  urlCache.forEach(u => URL.revokeObjectURL(u));
  urlCache.clear();
  try { await tx('readwrite', s => s.clear()); } catch { /* ignore */ }
}
