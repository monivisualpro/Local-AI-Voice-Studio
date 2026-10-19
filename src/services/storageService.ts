import { Voice, GenerationHistoryItem, StudioProject, AppSettings, ReferenceFolder, ReferenceAudioItem } from '../types/tts';
import { INITIAL_REFERENCE_FOLDERS, INITIAL_REFERENCE_AUDIOS } from './referenceCatalog';
import { storeReferenceAudioBlob, getReferenceAudioBlob, deleteReferenceAudioBlob } from './referenceAudioStorage';
import { voiceFilesApi } from './desktopBridge';
import { deleteHistoryAudio, clearHistoryAudio } from './historyAudioStorage';

export { INITIAL_REFERENCE_FOLDERS, INITIAL_REFERENCE_AUDIOS };

export const INITIAL_VOICES: Voice[] = [
  {
    id: 'voice-narrator-male',
    name: 'Alistair Sterling',
    category: 'preset',
    gender: 'male',
    language: 'English',
    modelCompatibility: ['*'],
    description: 'Deep, resonant documentary narrator with calm cadence and classical timbre.',
    stylePrompt: 'Deep baritone, authoritative, cinematic documentary pacing.',
  },
  {
    id: 'voice-conversational-female',
    name: 'Serena Vance',
    category: 'preset',
    gender: 'female',
    language: 'English',
    modelCompatibility: ['*'],
    description: 'Warm, clear conversational voice suited for podcasts, narration, and tutorials.',
    stylePrompt: 'Warm, natural, clear enunciation with gentle mid-tones.',
  },
  {
    id: 'voice-cinematic-male',
    name: 'Marcus Kael',
    category: 'preset',
    gender: 'male',
    language: 'English',
    modelCompatibility: ['qwen3-tts-0.6b-base', 'qwen3-tts-1.7b-voicedesign'],
    description: 'Dramatic trailer narrator with rich gravelly undertones and commanding presence.',
    stylePrompt: 'Gravelly, low-pitch, dramatic tension and pause control.',
  },
  {
    id: 'voice-corporate-female',
    name: 'Elena Rostova',
    category: 'preset',
    gender: 'female',
    language: 'English',
    modelCompatibility: ['*'],
    description: 'Crisp, articulate presenter voice designed for corporate keynotes and executive summaries.',
    stylePrompt: 'Professional, rhythmic, polished diction.',
  },
  {
    id: 'voice-multilingual-neutral',
    name: 'Kai Takahashi',
    category: 'preset',
    gender: 'neutral',
    language: 'Japanese',
    modelCompatibility: ['qwen3-tts-0.6b-base'],
    description: 'Smooth bilingual voice with natural Japanese and English prosody.',
    stylePrompt: 'Gentle, balanced, authentic Tokyo dialect cadence.',
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  modelStoragePath: 'D:\\AI\\Models',
  computeDevice: 'auto',
  selectedGpuIndex: 0,
  cpuThreads: 'auto',
  ramLimitGB: 'auto',
  autoUnloadInactive: true,
  idleUnloadMinutes: 10,
  lowMemoryMode: false,
  sampleRate: 24000,
  exportFormat: 'wav',
  normalizeAudio: true,
  trimSilence: true,
  firstRunCompleted: false,
};

export class StorageService {
  private static instance: StorageService;

  private voices: Voice[] = [];
  private history: GenerationHistoryItem[] = [];
  private projects: StudioProject[] = [];
  private settings: AppSettings = DEFAULT_SETTINGS;
  private referenceFolders: ReferenceFolder[] = [];
  private referenceAudios: ReferenceAudioItem[] = [];

  private listeners: Set<() => void> = new Set();
  /** Live object URLs of this session, by voice id (never saved: they die with the window). */
  private referenceUrlCache: Map<string, string> = new Map();
  /** Resolves once the audio of every saved voice has been located again after start-up. */
  public hydration: Promise<void> = Promise.resolve();

  private constructor() {
    this.loadAll();
  }

  public static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }

  private loadAll(): void {
    try {
      const storedSettings = localStorage.getItem('tts_studio_settings');
      if (storedSettings) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(storedSettings) };
      }

      const storedVoices = localStorage.getItem('tts_studio_voices');
      if (storedVoices) {
        this.voices = JSON.parse(storedVoices);
      } else {
        this.voices = [...INITIAL_VOICES];
      }

      const storedFolders = localStorage.getItem('tts_studio_reference_folders');
      if (storedFolders) {
        const parsedFolders: ReferenceFolder[] = JSON.parse(storedFolders);
        // Merge built-in folders by id so newly shipped categories are visible
        const existingFolderIds = new Set(parsedFolders.map(f => f.id));
        const mergedFolders = [...parsedFolders];
        INITIAL_REFERENCE_FOLDERS.forEach(builtIn => {
          if (!existingFolderIds.has(builtIn.id)) {
            mergedFolders.push(builtIn);
          }
        });
        this.referenceFolders = mergedFolders;
      } else {
        this.referenceFolders = [...INITIAL_REFERENCE_FOLDERS];
      }

      const storedRefs = localStorage.getItem('tts_studio_reference_audios');
      if (storedRefs) {
        const parsedRefs: ReferenceAudioItem[] = JSON.parse(storedRefs);
        // Merge initial catalog items to ensure any newly added built-ins are available
        const existingIds = new Set(parsedRefs.map(r => r.id));
        const mergedRefs = [...parsedRefs];
        INITIAL_REFERENCE_AUDIOS.forEach(builtIn => {
          if (!existingIds.has(builtIn.id)) {
            mergedRefs.push(builtIn);
          }
        });
        this.referenceAudios = mergedRefs;
      } else {
        this.referenceAudios = [...INITIAL_REFERENCE_AUDIOS];
      }
      // Real-person voices were removed from the built-in catalogue: drop them (and their stored audio) from saved data.
      const REMOVED = new Set(['morgan-freeman','emma-stone','daniel-craig','halle-berry','henry-cavill','patrick-stewart','robert-deniro','william-shatner'].map(n => `ref-${n}`));
      this.referenceAudios = this.referenceAudios.filter(r => {
        if (!REMOVED.has(r.id)) return true;
        void deleteReferenceAudioBlob(r.id).catch(() => undefined);
        if (r.localPath) void voiceFilesApi()?.deleteFile(r.localPath).catch(() => undefined);
        return false;
      });
      // A blob: URL only lives until the app closes. Older versions saved them, which is why a voice that played
      // yesterday did not play after a restart: drop the dead URLs, the audio itself is re-read from storage below.
      this.referenceAudios = this.referenceAudios.map(r => (r.url && r.url.startsWith('blob:') ? { ...r, url: '' } : r));
      // One-time catalog corrections (e.g. clips that did not match the voice's gender)
      this.migrateGeneratedSamples();
      // Re-hydrate playable URLs from IndexedDB for any downloaded references
      this.hydration = this.rehydrateDownloadedAudios();

      const storedHistory = localStorage.getItem('tts_studio_history');
      if (storedHistory) {
        this.history = JSON.parse(storedHistory);
      }

      const storedProjects = localStorage.getItem('tts_studio_projects');
      if (storedProjects) {
        this.projects = JSON.parse(storedProjects);
      }
    } catch {
      this.voices = [...INITIAL_VOICES];
      this.referenceFolders = [...INITIAL_REFERENCE_FOLDERS];
      this.referenceAudios = [...INITIAL_REFERENCE_AUDIOS];
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  // Reference Folders
  public getReferenceFolders(): ReferenceFolder[] {
    return [...this.referenceFolders];
  }

  public addReferenceFolder(folder: ReferenceFolder): void {
    this.referenceFolders.push(folder);
    this.persistReferenceFolders();
    this.notify();
  }

  public deleteReferenceFolder(id: string): void {
    this.referenceFolders = this.referenceFolders.filter(f => f.id !== id);
    // Re-assign orphaned reference audios to custom clones folder
    this.referenceAudios = this.referenceAudios.map(ref => {
      if (ref.folderId === id) {
        return {
          ...ref,
          folderId: 'folder-custom-clones',
          folderName: 'My Cloned Audio References',
        };
      }
      return ref;
    });
    this.persistReferenceFolders();
    this.persistReferenceAudios();
    this.notify();
  }

  private persistReferenceFolders(): void {
    try {
      localStorage.setItem('tts_studio_reference_folders', JSON.stringify(this.referenceFolders));
    } catch {}
  }

  // Reference Audio Items
  public getReferenceAudios(): ReferenceAudioItem[] {
    return [...this.referenceAudios];
  }

  /**
   * Real, usable references only: catalog stems that were actually downloaded
   * (blob cached in IndexedDB / playable URL) plus manually added uploads.
   * Anything still remote-only is excluded so the Studio and Voices pages can
   * never pick a fake / non-playable stem.
   */
  public getUsableReferenceAudios(): ReferenceAudioItem[] {
    return this.referenceAudios.filter(r =>
      r.isDownloaded || r.isBuiltIn === false || !r.downloadUrl
    );
  }

  public addReferenceAudio(item: ReferenceAudioItem): void {
    this.referenceAudios.unshift(item);
    this.persistReferenceAudios();
    this.notify();
  }

  public updateReferenceAudio(item: ReferenceAudioItem): void {
    this.referenceAudios = this.referenceAudios.map(a => (a.id === item.id ? item : a));
    this.persistReferenceAudios();
    this.notify();
  }

  public deleteReferenceAudio(id: string): void {
    const gone = this.referenceAudios.find(a => a.id === id);
    if (gone) {
      void deleteReferenceAudioBlob(id).catch(() => undefined);
      if (gone.localPath) void voiceFilesApi()?.deleteFile(gone.localPath).catch(() => undefined);
      this.dropReferenceUrl(id);
      if (gone.url && gone.url.startsWith('blob:')) URL.revokeObjectURL(gone.url);
    }
    this.referenceAudios = this.referenceAudios.filter(a => a.id !== id);
    this.persistReferenceAudios();
    this.notify();
  }

  /**
   * Catalog revision 2: the generated samples used to get a random audio clip, so a
   * "female" voice could play a male speaker. Entries are rebuilt with gender-matched
   * clips; any previously downloaded (wrong) audio is discarded so it is re-downloaded
   * correctly. Voices the user added themselves are never touched.
   */
  private migrateGeneratedSamples(): void {
    const REVISION = 3; // 2: gender-matched clips; 3: generic voice names (no real people)
    const KEY = 'tts_studio_catalog_rev';
    try {
      if (Number(localStorage.getItem(KEY) || 1) >= REVISION) return;
      const fresh = new Map(INITIAL_REFERENCE_AUDIOS.map(r => [r.id, r]));
      this.referenceAudios = this.referenceAudios.map(existing => {
        if (!existing.id.startsWith('ref-sample-')) return existing;
        const replacement = fresh.get(existing.id);
        if (!replacement) return existing;
        if (existing.isDownloaded && existing.downloadUrl !== replacement.downloadUrl) {
          void deleteReferenceAudioBlob(existing.id).catch(() => undefined);
        }
        return existing.downloadUrl === replacement.downloadUrl && existing.isDownloaded
          ? { ...replacement, url: existing.url, isDownloaded: true }
          : { ...replacement };
      });
      this.persistReferenceAudios();
      // Built-in folders pick up their corrected names/descriptions; folders the user made are untouched.
      const freshFolders = new Map(INITIAL_REFERENCE_FOLDERS.map(f => [f.id, f]));
      this.referenceFolders = this.referenceFolders.map(f => {
        const fresh = f.isDefault ? freshFolders.get(f.id) : undefined;
        return fresh ? { ...f, name: fresh.name, description: fresh.description } : f;
      });
      localStorage.setItem('tts_studio_reference_folders', JSON.stringify(this.referenceFolders));
      localStorage.setItem(KEY, String(REVISION));
    } catch {
      /* migration is best-effort; the catalog still loads */
    }
  }

  private persistReferenceAudios(): void {
    try {
      // Never save blob: URLs or download progress - the audio itself lives in IndexedDB and in the voice-library folder.
      const clean = this.referenceAudios.map(r => {
        const { downloadProgress, ...rest } = r;
        void downloadProgress;
        return rest.url && rest.url.startsWith('blob:') ? { ...rest, url: '' } : rest;
      });
      localStorage.setItem('tts_studio_reference_audios', JSON.stringify(clean));
    } catch {}
  }

  /**
   * The saved audio of a voice. IndexedDB first (fast); if the browser storage was cleared or belongs to another
   * app origin, the copy in the voice-library folder is read and put back into IndexedDB.
   */
  public async getReferenceBlob(id: string): Promise<Blob | null> {
    try {
      const stored = await getReferenceAudioBlob(id);
      if (stored) return stored;
    } catch { /* fall through to the file on disk */ }
    const item = this.referenceAudios.find(a => a.id === id);
    const api = voiceFilesApi();
    if (item?.localPath && api?.readFile) {
      try {
        const res = await api.readFile(item.localPath);
        if (res.ok && res.bytes && res.bytes.length) {
          const blob = new Blob([res.bytes as unknown as BlobPart], { type: StorageService.mimeFor(item.localPath) });
          await storeReferenceAudioBlob(id, blob);
          return blob;
        }
      } catch { /* file gone */ }
    }
    return null;
  }

  private static mimeFor(file: string): string {
    const ext = (/\.([a-z0-9]+)$/i.exec(file)?.[1] || 'wav').toLowerCase();
    const map: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', webm: 'audio/webm' };
    return map[ext] || 'audio/wav';
  }

  /** A playable URL for a saved voice (valid for this session), or null when its audio is not stored anywhere. */
  public async getReferencePlayableUrl(id: string): Promise<string | null> {
    const cached = this.referenceUrlCache.get(id);
    if (cached) return cached;
    const blob = await this.getReferenceBlob(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.referenceUrlCache.set(id, url);
    return url;
  }

  private dropReferenceUrl(id: string): void {
    const url = this.referenceUrlCache.get(id);
    if (url) URL.revokeObjectURL(url);
    this.referenceUrlCache.delete(id);
  }

  /**
   * Adds a voice the user made (upload, recording, generated sample) TOGETHER with its audio, so it is still there
   * after a restart. Before, only a temporary blob: URL was kept and the voice silently lost its sound on the next start.
   */
  public async addReferenceAudioWithBlob(item: ReferenceAudioItem, blob: Blob): Promise<ReferenceAudioItem> {
    await storeReferenceAudioBlob(item.id, blob);
    await this.writeVoiceFileToDisk(item, blob);
    const url = URL.createObjectURL(blob);
    this.referenceUrlCache.set(item.id, url);
    const saved: ReferenceAudioItem = { ...item, url, size: blob.size || item.size, audioMissing: false };
    this.addReferenceAudio(saved);
    return saved;
  }
  /**
   * Rehydrate blob URLs from IndexedDB for items marked as downloaded
   */
  private async rehydrateDownloadedAudios(): Promise<void> {
    let changed = false;
    for (const item of this.referenceAudios) {
      const userOwned = item.isBuiltIn === false || (!item.downloadUrl && !item.isBuiltIn);
      if (!item.isDownloaded && !userOwned) continue;
      try {
        const url = await this.getReferencePlayableUrl(item.id);
        if (url) {
          item.url = url;
          if (item.audioMissing) { item.audioMissing = false; changed = true; }
        } else if (item.isDownloaded && item.downloadUrl) {
          // Marked as downloaded but the audio is gone (cleared browser data, file deleted): offer the download again.
          item.isDownloaded = false;
          item.url = '';
          item.localPath = undefined;
          changed = true;
        } else if (userOwned && !item.audioMissing) {
          item.audioMissing = true;
          changed = true;
        }
      } catch (e) {
        console.warn(`Could not restore the audio of ${item.id}`, e);
      }
    }
    if (changed) this.persistReferenceAudios();
    this.notify();
  }

  /**
   * Download remote reference audio stem on-demand, cache into IndexedDB, and produce playable blob URL.
   */
  public async downloadReferenceAudio(id: string): Promise<string> {
    const item = this.referenceAudios.find(a => a.id === id);
    if (!item) {
      throw new Error(`Reference audio with ID ${id} not found.`);
    }

    // Already stored (IndexedDB or the voice-library file): reuse it, never download twice.
    const existingBlob = await this.getReferenceBlob(id);
    if (existingBlob) {
      this.dropReferenceUrl(id);
      const blobUrl = URL.createObjectURL(existingBlob);
      this.referenceUrlCache.set(id, blobUrl);
      item.url = blobUrl;
      item.isDownloaded = true;
      item.downloadProgress = 100;
      if (!item.localPath) await this.writeVoiceFileToDisk(item, existingBlob);
      this.updateReferenceAudio(item);
      return blobUrl;
    }

    if (!item.downloadUrl) {
      throw new Error(`No remote download URL available for ${item.name}`);
    }

    try {
      item.downloadProgress = 15;
      this.notify();

      const response = await fetch(item.downloadUrl, {
        method: 'GET',
        headers: {
          'Accept': 'audio/*,*/*',
        },
      });

      if (!response.ok) {
        throw new Error(`Download failed with HTTP ${response.status}: ${response.statusText}`);
      }

      item.downloadProgress = 70;
      this.notify();

      const blob = await response.blob();
      await storeReferenceAudioBlob(id, blob);
      await this.writeVoiceFileToDisk(item, blob);

      this.dropReferenceUrl(id);
      const blobUrl = URL.createObjectURL(blob);
      this.referenceUrlCache.set(id, blobUrl);
      item.url = blobUrl;
      item.isDownloaded = true;
      item.downloadProgress = 100;
      item.size = blob.size || item.size;

      this.updateReferenceAudio(item);
      return blobUrl;
    } catch (err) {
      item.downloadProgress = 0;
      item.isDownloaded = false;
      this.notify();
      throw err;
    }
  }

  private static extensionFor(blob: Blob, item: ReferenceAudioItem): string {
    const byMime: Record<string, string> = {
      'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
      'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
      'audio/aac': 'aac', 'audio/webm': 'webm',
    };
    const fromMime = byMime[(blob.type || '').split(';')[0].toLowerCase()];
    if (fromMime) return fromMime;
    const fromUrl = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(item.downloadUrl || item.name || '');
    return fromUrl ? fromUrl[1].toLowerCase() : 'wav';
  }

  /** Desktop app: keep a real copy of the voice in <app data>/voice-library so it can be found and reused. */
  private async writeVoiceFileToDisk(item: ReferenceAudioItem, blob: Blob): Promise<void> {
    const api = voiceFilesApi();
    if (!api) return;
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const res = await api.saveFile({ id: item.id, ext: StorageService.extensionFor(blob, item), bytes });
      if (res.ok && res.path) item.localPath = res.path;
    } catch (e) {
      console.warn(`Could not write ${item.id} to disk`, e);
    }
  }

  /**
   * "Locate file": desktop = open the folder with the file selected (the file is re-created from the stored
   * audio when it was deleted outside the app). Browser = no real file path exists, so a copy is saved through the
   * browser's download. Returns a short message for the UI.
   */
  public async locateReferenceAudio(id: string): Promise<string> {
    const item = this.referenceAudios.find(a => a.id === id);
    if (!item) throw new Error('Voice not found.');
    const blob = await this.getReferenceBlob(id);
    if (!blob) throw new Error('This voice is not downloaded yet. Download it first, then you can locate the file.');
    const api = voiceFilesApi();
    if (api) {
      if (!item.localPath || !(await api.exists(item.localPath))) {
        await this.writeVoiceFileToDisk(item, blob);
        this.updateReferenceAudio(item);
      }
      if (!item.localPath) throw new Error('Could not create the file on disk.');
      const res = await api.reveal(item.localPath);
      if (!res.ok) throw new Error(res.error || 'Could not open the file location.');
      return item.localPath;
    }
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `${item.name.replace(/[^\w.-]+/g, '_') || item.id}.${StorageService.extensionFor(blob, item)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'saved-by-browser';
  }

  /**
   * Removes the downloaded audio of a cloud voice (blob in IndexedDB + the playable URL) so it can be
   * downloaded again. The catalogue entry itself stays. Returns false for voices that cannot be re-downloaded
   * (the user's own uploads have no remote URL, so removing their audio would lose it for good).
   */
  public async removeDownloadedReferenceAudio(id: string): Promise<boolean> {
    const item = this.referenceAudios.find(a => a.id === id);
    if (!item || !item.downloadUrl) return false;
    await deleteReferenceAudioBlob(id);
    if (item.localPath) await voiceFilesApi()?.deleteFile(item.localPath).catch(() => undefined);
    item.localPath = undefined;
    this.dropReferenceUrl(id);
    if (item.url && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
    item.url = '';
    item.isDownloaded = false;
    item.downloadProgress = 0;
    this.updateReferenceAudio(item);
    return true;
  }

  /** Deletes the stored copy and downloads it again from the source (fixes a corrupt or partial download). */
  public async redownloadReferenceAudio(id: string): Promise<string> {
    const removed = await this.removeDownloadedReferenceAudio(id);
    if (!removed) throw new Error('This voice has no remote source to download again.');
    return this.downloadReferenceAudio(id);
  }

  // Voices
  public getVoices(): Voice[] {
    return [...this.voices];
  }

  public addVoice(voice: Voice): void {
    this.voices.unshift(voice);
    this.persistVoices();
    this.notify();
  }

  public deleteVoice(id: string): void {
    this.voices = this.voices.filter(v => v.id !== id);
    this.persistVoices();
    this.notify();
  }

  private persistVoices(): void {
    try {
      localStorage.setItem('tts_studio_voices', JSON.stringify(this.voices));
    } catch {}
  }

  // History
  public getHistory(): GenerationHistoryItem[] {
    return [...this.history];
  }

  public addHistoryItem(item: GenerationHistoryItem): void {
    this.history.unshift(item);
    // Keep last 40 items
    if (this.history.length > 40) {
      this.history = this.history.slice(0, 40);
    }
    this.persistHistory();
    this.notify();
  }

  /** Adds the entry, or replaces it when it exists (a resumed generation updates its own History entry). */
  public upsertHistoryItem(item: GenerationHistoryItem): void {
    const index = this.history.findIndex(h => h.id === item.id);
    if (index < 0) return this.addHistoryItem(item);
    this.history[index] = item;
    this.persistHistory();
    this.notify();
  }

  public deleteHistoryItem(id: string): void {
    void deleteHistoryAudio(id);
    this.history = this.history.filter(h => h.id !== id);
    this.persistHistory();
    this.notify();
  }

  public clearHistory(): void {
    void clearHistoryAudio();
    this.history = [];
    this.persistHistory();
    this.notify();
  }

  private persistHistory(): void {
    try {
      localStorage.setItem('tts_studio_history', JSON.stringify(this.history));
    } catch {}
  }

  // Projects
  public getProjects(): StudioProject[] {
    return [...this.projects];
  }

  public saveProject(project: StudioProject): void {
    const existingIndex = this.projects.findIndex(p => p.id === project.id);
    if (existingIndex >= 0) {
      this.projects[existingIndex] = { ...project, updatedAt: Date.now() };
    } else {
      this.projects.unshift({ ...project, updatedAt: Date.now() });
    }
    this.persistProjects();
    this.notify();
  }

  public deleteProject(id: string): void {
    this.projects = this.projects.filter(p => p.id !== id);
    this.persistProjects();
    this.notify();
  }

  private persistProjects(): void {
    try {
      localStorage.setItem('tts_studio_projects', JSON.stringify(this.projects));
    } catch {}
  }

  // Settings
  public getSettings(): AppSettings {
    return { ...this.settings };
  }

  public updateSettings(partial: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...partial };
    try {
      localStorage.setItem('tts_studio_settings', JSON.stringify(this.settings));
    } catch {}
    this.notify();
  }
}
