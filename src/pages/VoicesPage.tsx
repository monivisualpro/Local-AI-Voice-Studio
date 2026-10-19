import React, { useState, useEffect, useRef } from 'react';
import {
  Users,
  Plus,
  Play,
  Pause,
  Trash2,
  Mic,
  X,
  Folder,
  FolderPlus,
  Search,
  Filter,
  ArrowRight,
  FileAudio,
  CheckCircle2,
  Globe,
  Download,
  Loader2,
  CloudOff,
} from 'lucide-react';
import { VoiceFileActions } from '../components/VoiceFileActions';
import { Voice, ReferenceFolder, ReferenceAudioItem } from '../types/tts';
import { StorageService } from '../services/storageService';
import { AudioEngine } from '../services/audioEngine';
import { DesktopBridge } from '../services/desktopBridge';
import { AddReferenceAudioModal } from '../components/AddReferenceAudioModal';

interface VoicesPageProps {
  onSelectVoiceForStudio: (voiceId: string) => void;
}

export const VoicesPage: React.FC<VoicesPageProps> = ({ onSelectVoiceForStudio }) => {
  const [activeTab, setActiveTab] = useState<'personas' | 'references'>('personas');

  // Personas state
  const [voices, setVoices] = useState<Voice[]>(StorageService.getInstance().getVoices());
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // New voice form state
  const [newVoiceName, setNewVoiceName] = useState('');
  const [newVoiceGender, setNewVoiceGender] = useState<'male' | 'female' | 'neutral'>('female');
  const [newVoiceLanguage, setNewVoiceLanguage] = useState('English');
  const [newVoiceDescription, setNewVoiceDescription] = useState('');
  const [newVoiceFile, setNewVoiceFile] = useState<File | null>(null);

  // Reference folders & audio items state
  const [folders, setFolders] = useState<ReferenceFolder[]>(
    StorageService.getInstance().getReferenceFolders()
  );
  const [referenceAudios, setReferenceAudios] = useState<ReferenceAudioItem[]>(
    StorageService.getInstance().getReferenceAudios()
  );
  const [activeFolderId, setActiveFolderId] = useState<string>('all');
  const [accentFilter, setAccentFilter] = useState<string>('all');
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [playingRefId, setPlayingRefId] = useState<string | null>(null);
  const [isAddRefModalOpen, setIsAddRefModalOpen] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const unsub = StorageService.getInstance().subscribe(() => {
      setVoices(StorageService.getInstance().getVoices());
      setFolders(StorageService.getInstance().getReferenceFolders());
      setReferenceAudios(StorageService.getInstance().getReferenceAudios());
    });
    return unsub;
  }, []);

  const handlePreviewVoice = async (voice: Voice) => {
    if (playingVoiceId === voice.id) {
      if (audioRef.current) audioRef.current.pause();
      setPlayingVoiceId(null);
      return;
    }

    setPlayingVoiceId(voice.id);

    try {
      const sampleText = `Hello, this is ${voice.name}. My vocal timbre is configured for your local TTS workstation.`;
      const { wavBlob } = await AudioEngine.getInstance().synthesizePreview(sampleText, {
        voiceId: voice.id,
        gender: voice.gender,
        language: voice.language,
      });

      if (audioRef.current) {
        audioRef.current.src = URL.createObjectURL(wavBlob);
        audioRef.current.onended = () => setPlayingVoiceId(null);
        audioRef.current.play();
      }
    } catch (err) {
      setPlayingVoiceId(null);
      alert(err instanceof Error ? err.message : 'Preview failed.');
    }
  };

  const previewDisabled = !DesktopBridge.ttsAvailable;

  const handlePreviewReference = async (refItem: ReferenceAudioItem) => {
    if (playingRefId === refItem.id) {
      if (audioRef.current) audioRef.current.pause();
      setPlayingRefId(null);
      return;
    }

    try {
      const url = await AudioEngine.getInstance().ensureReferenceAudioUrl(refItem);
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.onended = () => setPlayingRefId(null);
        audioRef.current.play();
        setPlayingRefId(refItem.id);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No playable audio for this reference.');
      setPlayingRefId(null);
    }
  };
  const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({});
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [bulkDownloadProgress, setBulkDownloadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const handleDownloadReference = async (refItem: ReferenceAudioItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (downloadingIds[refItem.id]) return;
    try {
      setDownloadingIds(prev => ({ ...prev, [refItem.id]: true }));
      // Already downloaded: delete the stored copy first so this is a REAL re-download (it used to return the
      // cached file and do nothing).
      if (refItem.isDownloaded) await StorageService.getInstance().redownloadReferenceAudio(refItem.id);
      else await StorageService.getInstance().downloadReferenceAudio(refItem.id);
    } catch (err) {
      console.error('Failed to download reference audio:', err);
      alert(`Download failed: ${(err as Error).message}`);
    } finally {
      setDownloadingIds(prev => ({ ...prev, [refItem.id]: false }));
    }
  };

  const handleRemoveDownload = async (refItem: ReferenceAudioItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm(`Remove the downloaded audio of "${refItem.name}"? The voice stays in the library and can be downloaded again.`)) return;
    try {
      await StorageService.getInstance().removeDownloadedReferenceAudio(refItem.id);
    } catch (err) {
      console.error('Failed to remove downloaded audio:', err);
      alert(`Could not remove the download: ${(err as Error).message}`);
    }
  };


  const handleDeleteVoice = (id: string) => {
    if (confirm('Delete this voice persona from your local library?')) {
      StorageService.getInstance().deleteVoice(id);
    }
  };

  const handleCreateVoice = () => {
    if (!newVoiceName.trim()) return;

    const newVoice: Voice = {
      id: `voice-${Date.now()}`,
      name: newVoiceName.trim(),
      category: newVoiceFile ? 'reference' : 'preset',
      gender: newVoiceGender,
      language: newVoiceLanguage,
      modelCompatibility: ['*'],
      description: newVoiceDescription || 'Custom voice clone calibrated from reference sample.',
      isCustom: true,
      referenceFile: newVoiceFile
        ? {
            name: newVoiceFile.name,
            size: newVoiceFile.size,
            duration: 5.2,
            url: URL.createObjectURL(newVoiceFile),
          }
        : undefined,
    };

    StorageService.getInstance().addVoice(newVoice);
    setIsCreateModalOpen(false);
    setNewVoiceName('');
    setNewVoiceDescription('');
    setNewVoiceFile(null);
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    const newFolder: ReferenceFolder = {
      id: `folder-${Date.now()}`,
      name: newFolderName.trim(),
      description: 'Custom dedicated folder for cloned reference voice audio.',
      color: '#00D9FF',
      createdAt: Date.now(),
    };
    StorageService.getInstance().addReferenceFolder(newFolder);
    setActiveFolderId(newFolder.id);
    setNewFolderName('');
    setIsCreatingFolder(false);
  };

  const handleDeleteFolder = (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this folder? Audio references inside will be moved to custom clones.')) {
      StorageService.getInstance().deleteReferenceFolder(folderId);
      if (activeFolderId === folderId) setActiveFolderId('all');
    }
  };

  const handleDeleteReference = (refId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this audio reference clip from the library?')) {
      StorageService.getInstance().deleteReferenceAudio(refId);
    }
  };

  const handleUseReferenceInStudio = async (refItem: ReferenceAudioItem) => {
    // Resolve a real playable URL before cloning — undownloaded catalog stems
    // have an empty url, which would create a broken voice persona.
    let playableUrl = refItem.url;
    if (!playableUrl || (!playableUrl.startsWith('blob:') && !playableUrl.startsWith('http'))) {
      if (!refItem.isDownloaded && refItem.downloadUrl) {
        alert(`${refItem.name} is not downloaded yet. Downloading the stem first...`);
        try {
          playableUrl = await StorageService.getInstance().downloadReferenceAudio(refItem.id);
        } catch (err) {
          alert(`Download failed: ${(err as Error).message}`);
          return;
        }
      } else {
        try {
          playableUrl = await AudioEngine.getInstance().ensureReferenceAudioUrl(refItem);
        } catch (err) {
          alert(err instanceof Error ? err.message : 'No playable audio for this reference.');
          return;
        }
      }
    }

    // Create or find matching voice persona
    const matchingVoice = voices.find(v => v.name === refItem.name);
    if (matchingVoice) {
      onSelectVoiceForStudio(matchingVoice.id);
    } else {
      const clonedVoice: Voice = {
        id: `voice-ref-${refItem.id}`,
        name: refItem.name,
        category: 'reference',
        gender: refItem.speakerGender || 'neutral',
        language: refItem.language,
        modelCompatibility: ['*'],
        description: refItem.timbreDescription || `${refItem.accent} zero-shot voice clone`,
        isCustom: true,
        referenceFile: {
          name: refItem.name,
          size: refItem.size,
          duration: refItem.duration,
          url: playableUrl,
          referenceText: refItem.referenceText,
        },
      };
      StorageService.getInstance().addVoice(clonedVoice);
      onSelectVoiceForStudio(clonedVoice.id);
    }
  };

  // Filtered reference audios
  const uniqueAccents = Array.from(new Set(referenceAudios.map(r => r.accent))).filter(Boolean);
  const uniqueLanguages = Array.from(new Set(referenceAudios.map(r => r.language))).filter(Boolean);

  const filteredReferences = referenceAudios.filter(item => {
    if (activeFolderId !== 'all' && item.folderId !== activeFolderId) {
      return false;
    }
    if (accentFilter !== 'all' && item.accent !== accentFilter) {
      return false;
    }
    if (languageFilter !== 'all' && item.language !== languageFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = item.name.toLowerCase().includes(q);
      const matchAccent = item.accent.toLowerCase().includes(q);
      const matchLang = item.language.toLowerCase().includes(q);
      const matchText = (item.referenceText || '').toLowerCase().includes(q);
      if (!matchName && !matchAccent && !matchLang && !matchText) {
        return false;
      }
    }
    return true;
  });

  const activeFolder = folders.find(f => f.id === activeFolderId);

  // Bulk download: queue every pending (not-yet-downloaded) stem in the current view
  const pendingDownloadCount = filteredReferences.filter(
    r => r.downloadUrl && !r.isDownloaded
  ).length;

  const handleDownloadAll = async () => {
    if (isDownloadingAll) return;
    const pending = filteredReferences.filter(r => r.downloadUrl && !r.isDownloaded);
    if (pending.length === 0) {
      alert('Every stem in this view is already downloaded.');
      return;
    }
    if (
      !confirm(
        `Download ${pending.length} reference stem(s) now? ` +
          'They will be stored locally and remain available offline.'
      )
    ) {
      return;
    }

    setIsDownloadingAll(true);
    setBulkDownloadProgress({ done: 0, total: pending.length });
    let failed = 0;
    try {
      for (let i = 0; i < pending.length; i++) {
        try {
          await StorageService.getInstance().downloadReferenceAudio(pending[i].id);
        } catch (err) {
          failed += 1;
          console.error('Bulk download failed for', pending[i].name, err);
        }
        setBulkDownloadProgress({ done: i + 1, total: pending.length });
      }
    } finally {
      setIsDownloadingAll(false);
      setBulkDownloadProgress(null);
    }
    if (failed > 0) {
      alert(`Finished with ${failed} failure(s) out of ${pending.length} stems. Check your connection and retry.`);
    } else {
      alert(`Downloaded ${pending.length} stem(s). They are now available in your reference pickers.`);
    }
  };

  return (
    <div className="space-y-6 pb-12 max-w-7xl mx-auto">
      <audio ref={audioRef} />

      {/* Top Header & Section Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#F5F7FA] flex items-center gap-2.5">
            {activeTab === 'personas' ? (
              <Users className="w-5 h-5 text-[#00D9FF]" />
            ) : (
              <Folder className="w-5 h-5 text-[#FF3CAC]" />
            )}
            <span>Voice & Reference Studio</span>
          </h1>
          <p className="text-xs text-[#A2AAB8] mt-1">
            Curated speaker personas, zero-shot clone folders, and international accent reference stems.
          </p>
        </div>

        {/* Segmented Control for Personas vs Dedicated Reference Folders */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[#11151D] p-1 rounded-[16px] border border-white/[0.08]">
            <button
              onClick={() => setActiveTab('personas')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[12px] text-xs font-semibold transition-all ${
                activeTab === 'personas'
                  ? 'bg-[#181D27] text-[#00D9FF] shadow-sm border border-[#00D9FF]/20'
                  : 'text-[#A2AAB8] hover:text-[#F5F7FA]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Voice Personas ({voices.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('references')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[12px] text-xs font-semibold transition-all ${
                activeTab === 'references'
                  ? 'bg-[#181D27] text-[#FF3CAC] shadow-sm border border-[#FF3CAC]/20'
                  : 'text-[#A2AAB8] hover:text-[#F5F7FA]'
              }`}
            >
              <Folder className="w-3.5 h-3.5" />
              <span>Reference Folders ({referenceAudios.length})</span>
            </button>
          </div>

          {activeTab === 'personas' ? (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#080A0F] bg-[#00D9FF] hover:bg-[#22E7FF] rounded-[14px] transition-all shadow-[0_2px_12px_rgba(0,217,255,0.25)]"
            >
              <Plus className="w-4 h-4" />
              <span>Create Persona</span>
            </button>
          ) : (
            <button
              onClick={() => setIsAddRefModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#080A0F] bg-[#FF3CAC] hover:bg-[#FF5ACD] rounded-[14px] transition-all shadow-[0_2px_12px_rgba(255,60,172,0.25)]"
            >
              <Plus className="w-4 h-4" />
              <span>Add Audio Reference</span>
            </button>
          )}
        </div>
      </div>

      {/* VIEW 1: SPEAKER PERSONAS */}
      {activeTab === 'personas' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {voices.map(voice => {
            const isPlaying = playingVoiceId === voice.id;

            return (
              <div
                key={voice.id}
                className="rounded-[24px] bg-[#11151D] border border-white/[0.08] p-5 space-y-4 hover:border-white/[0.14] transition-all flex flex-col justify-between group shadow-sm"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-[12px] bg-[#181D27] border border-white/[0.08] flex items-center justify-center text-[#00D9FF] group-hover:border-[#00D9FF]/40 transition-colors shadow-sm">
                        <Mic className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-[#F5F7FA]">{voice.name}</h2>
                        <div className="flex items-center gap-1.5 text-[11px] text-[#A2AAB8] font-mono mt-0.5">
                          <span className="capitalize">{voice.gender || 'neutral'}</span>
                          <span className="text-white/20">·</span>
                          <span>{voice.language}</span>
                        </div>
                      </div>
                    </div>

                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-white/[0.05] text-[#A2AAB8] border border-white/[0.04]">
                      {voice.category.toUpperCase()}
                    </span>
                  </div>

                  <p className="text-xs text-[#A2AAB8] leading-relaxed">
                    {voice.description}
                  </p>

                  {voice.stylePrompt && (
                    <div className="p-2.5 rounded-[12px] bg-[#080A0F] border border-white/[0.04] text-[11px] text-[#00D9FF]/80 italic">
                      "{voice.stylePrompt}"
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
                  <button
                    onClick={() => handlePreviewVoice(voice)}
                    disabled={previewDisabled}
                    title={previewDisabled ? 'Real audio needs the desktop app - run "npm run electron:dev"' : 'Audition this voice with the loaded model'}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[12px] bg-[#181D27] hover:bg-[#1D2430] border border-white/[0.08] text-xs font-medium text-[#F5F7FA] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                    <span>{isPlaying ? 'Pause' : 'Audition'}</span>
                  </button>

                  <div className="flex items-center gap-2">
                    {voice.isCustom && (
                      <button
                        onClick={() => handleDeleteVoice(voice.id)}
                        className="p-1.5 rounded-[8px] text-[#6F7888] hover:text-[#FF5C70] hover:bg-white/[0.05] transition-colors"
                        title="Delete voice persona"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => onSelectVoiceForStudio(voice.id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-[12px] bg-[#00D9FF]/15 hover:bg-[#00D9FF]/25 border border-[#00D9FF]/30 text-xs font-semibold text-[#00D9FF] transition-colors"
                    >
                      <span>Use in Studio</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW 2: DEDICATED REFERENCE CLONE AUDIO LIBRARY & FOLDERS */}
      {activeTab === 'references' && (
        <div className="rounded-[24px] bg-[#11151D] border border-white/[0.08] overflow-hidden shadow-sm flex flex-col md:flex-row min-h-[600px]">
          {/* Left Folders Directory Tree */}
          <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-white/[0.08] bg-[#0D1016] p-4 space-y-3 shrink-0">
            <div className="flex items-center justify-between text-xs font-semibold text-[#A2AAB8] uppercase tracking-wider px-1">
              <span>Dedicated Folders</span>
              <button
                onClick={() => setIsCreatingFolder(true)}
                className="text-[11px] text-[#00D9FF] hover:underline flex items-center gap-1 normal-case font-mono"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>New</span>
              </button>
            </div>

            {/* Folder creation box */}
            {isCreatingFolder && (
              <div className="p-2.5 rounded-[14px] bg-[#181D27] border border-[#00D9FF]/40 space-y-2">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  placeholder="Folder name..."
                  className="w-full text-xs px-2.5 py-1.5 rounded-[8px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none"
                  autoFocus
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={() => setIsCreatingFolder(false)}
                    className="px-2 py-1 text-[11px] text-[#A2AAB8] hover:text-[#F5F7FA]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateFolder}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-[#00D9FF] text-[#080A0F] rounded-[8px]"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            {/* Folders List */}
            <div className="space-y-1">
              <button
                onClick={() => setActiveFolderId('all')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-[12px] text-xs font-medium transition-colors text-left ${
                  activeFolderId === 'all'
                    ? 'bg-[#181D27] text-[#00D9FF] border border-[#00D9FF]/30 font-semibold'
                    : 'text-[#A2AAB8] hover:text-[#F5F7FA] hover:bg-[#181D27]/50'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <Folder className="w-3.5 h-3.5 text-[#00D9FF] shrink-0" />
                  <span>All References</span>
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-[6px] bg-white/[0.05] text-[#A2AAB8]">
                  {referenceAudios.length}
                </span>
              </button>

              {folders.map(folder => {
                const count = referenceAudios.filter(r => r.folderId === folder.id).length;
                const isSelected = activeFolderId === folder.id;

                return (
                  <div
                    key={folder.id}
                    onClick={() => setActiveFolderId(folder.id)}
                    className={`group w-full flex items-center justify-between px-3 py-2 rounded-[12px] text-xs font-medium cursor-pointer transition-colors text-left ${
                      isSelected
                        ? 'bg-[#181D27] text-[#00D9FF] border border-[#00D9FF]/30 font-semibold'
                        : 'text-[#A2AAB8] hover:text-[#F5F7FA] hover:bg-[#181D27]/50'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Folder
                        className="w-3.5 h-3.5 shrink-0"
                        style={{ color: folder.color || '#00D9FF' }}
                      />
                      <span className="truncate">{folder.name}</span>
                    </span>

                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-[6px] bg-white/[0.05] text-[#A2AAB8]">
                        {count}
                      </span>
                      {!folder.isDefault && (
                        <button
                          onClick={e => handleDeleteFolder(folder.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[#6F7888] hover:text-[#FF5C70] transition-opacity"
                          title="Delete folder"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Main Grid */}
          <div className="flex-1 p-6 space-y-5 overflow-y-auto">
            {/* Header info & Filter Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
              <div>
                <h3 className="text-sm font-bold text-[#F5F7FA] flex items-center gap-2">
                  <span>{activeFolderId === 'all' ? 'All Reference Audio Stems' : activeFolder?.name}</span>
                  <span className="text-[11px] font-mono text-[#00D9FF] font-normal">
                    ({filteredReferences.length} Stems Available)
                  </span>
                </h3>
                <p className="text-xs text-[#A2AAB8] mt-0.5">
                  {activeFolderId === 'all'
                    ? 'Explore audio references categorized by accent and language for zero-shot synthesis.'
                    : activeFolder?.description}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {pendingDownloadCount > 0 && (
                  <button
                    onClick={handleDownloadAll}
                    disabled={isDownloadingAll}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[12px] bg-[#FFB547]/15 hover:bg-[#FFB547]/25 border border-[#FFB547]/30 text-xs font-semibold text-[#FFB547] transition-all disabled:opacity-60 disabled:cursor-wait"
                    title="Download all pending stems in this view for offline use"
                  >
                    {isDownloadingAll ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {isDownloadingAll && bulkDownloadProgress
                        ? `Downloading ${bulkDownloadProgress.done}/${bulkDownloadProgress.total}`
                        : `Download All (${pendingDownloadCount})`}
                    </span>
                  </button>
                )}

                <button
                  onClick={() => setIsAddRefModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[12px] bg-[#00D9FF]/15 hover:bg-[#00D9FF]/25 border border-[#00D9FF]/30 text-xs font-semibold text-[#00D9FF] transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Upload to this Folder</span>
                </button>
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#6F7888]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search accent, language, transcript..."
                  className="w-full text-xs pl-8 pr-3 py-2 rounded-[12px] bg-[#181D27] border border-white/[0.08] text-[#F5F7FA] placeholder-[#6F7888] focus:outline-none focus:border-[#00D9FF]"
                />
              </div>

              <div className="flex items-center gap-1.5 bg-[#181D27] px-2.5 py-1.5 rounded-[12px] border border-white/[0.08]">
                <Filter className="w-3.5 h-3.5 text-[#FF3CAC] shrink-0" />
                <select
                  value={accentFilter}
                  onChange={e => setAccentFilter(e.target.value)}
                  className="w-full text-xs bg-transparent text-[#F5F7FA] focus:outline-none"
                >
                  <option value="all" className="bg-[#11151D] text-[#F5F7FA]">All Accents ({uniqueAccents.length})</option>
                  {uniqueAccents.map(acc => (
                    <option key={acc} value={acc} className="bg-[#11151D] text-[#F5F7FA]">{acc}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5 bg-[#181D27] px-2.5 py-1.5 rounded-[12px] border border-white/[0.08]">
                <Globe className="w-3.5 h-3.5 text-[#32D583] shrink-0" />
                <select
                  value={languageFilter}
                  onChange={e => setLanguageFilter(e.target.value)}
                  className="w-full text-xs bg-transparent text-[#F5F7FA] focus:outline-none"
                >
                  <option value="all" className="bg-[#11151D] text-[#F5F7FA]">All Languages ({uniqueLanguages.length})</option>
                  {uniqueLanguages.map(lang => (
                    <option key={lang} value={lang} className="bg-[#11151D] text-[#F5F7FA]">{lang}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Reference Audios Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
              {filteredReferences.map(refItem => {
                const isPlaying = playingRefId === refItem.id;

                return (
                  <div
                    key={refItem.id}
                    className="rounded-[20px] bg-[#181D27] border border-white/[0.08] p-4 space-y-3 hover:border-white/[0.14] transition-all flex flex-col justify-between group shadow-xs"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-center gap-2.5">
                          {refItem.downloadUrl && !refItem.isDownloaded ? (
                            <button
                              onClick={(e) => handleDownloadReference(refItem, e)}
                              disabled={downloadingIds[refItem.id]}
                              className="w-9 h-9 rounded-full flex items-center justify-center transition-all bg-[#00D9FF]/15 hover:bg-[#00D9FF] text-[#00D9FF] hover:text-[#080A0F] border border-[#00D9FF]/30 disabled:opacity-50"
                              title="Download voice reference stem"
                            >
                              {downloadingIds[refItem.id] ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Download className="w-4 h-4" />
                              )}
                            </button>
                          ) : (
                            <button
                              onClick={() => handlePreviewReference(refItem)}
                              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                                isPlaying
                                  ? 'bg-[#00D9FF] text-[#080A0F] shadow-[0_0_12px_rgba(0,217,255,0.5)]'
                                  : 'bg-white/[0.08] hover:bg-[#00D9FF]/20 text-[#00D9FF]'
                              }`}
                              title={isPlaying ? 'Pause' : 'Audition stem'}
                            >
                              {isPlaying ? (
                                <Pause className="w-4 h-4 fill-current" />
                              ) : (
                                <Play className="w-4 h-4 fill-current ml-0.5" />
                              )}
                            </button>
                          )}

                          <div>
                            <h4 className="text-xs font-bold text-[#F5F7FA] flex items-center gap-1.5">
                              <span>{refItem.name}</span>
                              {refItem.isDownloaded ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#32D583] shrink-0" />
                              ) : (
                                <span className="w-2 h-2 rounded-full bg-[#FFB547]" title="Not downloaded yet" />
                              )}
                            </h4>
                            <div className="flex items-center gap-2 text-[10px] text-[#A2AAB8] font-mono mt-0.5">
                              <span className="text-[#00D9FF]">{refItem.accent}</span>
                              <span className="text-white/20">·</span>
                              <span>{refItem.language}</span>
                              <span className="text-white/20">·</span>
                              <span>{refItem.duration.toFixed(1)}s</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1">
                          <span className="text-[9px] font-mono px-2 py-0.5 rounded-[6px] bg-white/[0.04] text-[#A2AAB8] border border-white/[0.04] truncate max-w-[120px]">
                            {refItem.folderName}
                          </span>
                          {refItem.downloadUrl && (
                            <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${
                              refItem.isDownloaded
                                ? 'text-[#32D583] bg-[#32D583]/10 border border-[#32D583]/20'
                                : 'text-[#FFB547] bg-[#FFB547]/10 border border-[#FFB547]/20'
                            }`}>
                              {refItem.isDownloaded ? 'Downloaded' : 'Cloud Stem'}
                            </span>
                          )}
                        </div>
                      </div>

                      {refItem.timbreDescription && (
                        <p className="text-[11px] text-[#A2AAB8] leading-relaxed">
                          {refItem.timbreDescription}
                        </p>
                      )}

                      {refItem.referenceText && (
                        <div className="p-2.5 rounded-[12px] bg-[#080A0F] border border-white/[0.04] text-[10px] text-[#6F7888] italic line-clamp-2">
                          "{refItem.referenceText}"
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2.5 border-t border-white/[0.06] text-xs">
                      <div className="flex items-center gap-2 text-[10px] font-mono text-[#6F7888]">
                        <span>{(refItem.size / (1024 * 1024)).toFixed(2)} MB</span>
                        <VoiceFileActions item={refItem} />
                      </div>

                      <button
                        onClick={() => handleUseReferenceInStudio(refItem)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-[#00D9FF]/15 hover:bg-[#00D9FF] text-[#00D9FF] hover:text-[#080A0F] text-xs font-semibold transition-all"
                      >
                        <span>Use in Studio (Clone)</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredReferences.length === 0 && (
              <div className="text-center py-16 space-y-3">
                <FileAudio className="w-12 h-12 text-[#6F7888] mx-auto" />
                <p className="text-xs text-[#A2AAB8]">No reference audio clips found in this filter.</p>
                <button
                  onClick={() => setIsAddRefModalOpen(true)}
                  className="px-4 py-2 rounded-[12px] bg-[#00D9FF] text-[#080A0F] text-xs font-semibold"
                >
                  Upload First Reference Audio
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Create Cloned Voice Persona */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-[20px]">
          <div className="w-full max-w-md rounded-[24px] bg-[#11151D] border border-white/[0.08] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.4)] space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-[#00D9FF]" />
                <h3 className="text-sm font-semibold text-[#F5F7FA]">Create Cloned Voice Persona</h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1 rounded-[8px] text-[#6F7888] hover:text-[#F5F7FA]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-medium text-[#A2AAB8] block mb-1">Voice Persona Name</label>
                <input
                  type="text"
                  value={newVoiceName}
                  onChange={e => setNewVoiceName(e.target.value)}
                  placeholder="e.g. David Vance (Studio Reference)"
                  className="w-full px-3.5 py-2.5 rounded-[14px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-medium text-[#A2AAB8] block mb-1">Gender</label>
                  <select
                    value={newVoiceGender}
                    onChange={e => setNewVoiceGender(e.target.value as any)}
                    className="w-full p-2.5 rounded-[14px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF]"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="neutral">Neutral</option>
                  </select>
                </div>
                <div>
                  <label className="font-medium text-[#A2AAB8] block mb-1">Language</label>
                  <input
                    type="text"
                    value={newVoiceLanguage}
                    onChange={e => setNewVoiceLanguage(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-[14px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF]"
                  />
                </div>
              </div>

              <div>
                <label className="font-medium text-[#A2AAB8] block mb-1">Description / Style Prompt</label>
                <textarea
                  value={newVoiceDescription}
                  onChange={e => setNewVoiceDescription(e.target.value)}
                  placeholder="e.g. Warm corporate narrator with moderate tempo..."
                  rows={2}
                  className="w-full p-3 rounded-[14px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF]"
                />
              </div>

              <div>
                <label className="font-medium text-[#A2AAB8] block mb-1">Reference Audio Sample (Optional)</label>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={e => e.target.files && setNewVoiceFile(e.target.files[0])}
                  className="w-full text-[11px] text-[#A2AAB8] file:mr-2 file:py-1 file:px-2.5 file:rounded-[10px] file:border-0 file:text-xs file:bg-[#181D27] file:text-[#00D9FF] hover:file:bg-[#1D2430]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="px-4 py-2 text-xs text-[#A2AAB8] hover:text-[#F5F7FA]"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateVoice}
                disabled={!newVoiceName.trim()}
                className="px-4 py-2 text-xs font-semibold text-[#080A0F] bg-[#00D9FF] hover:bg-[#22E7FF] rounded-[12px] shadow-sm disabled:opacity-40"
              >
                Save Voice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Reference Audio */}
      {isAddRefModalOpen && (
        <AddReferenceAudioModal
          isOpen={isAddRefModalOpen}
          onClose={() => setIsAddRefModalOpen(false)}
          folders={folders}
          defaultFolderId={activeFolderId !== 'all' ? activeFolderId : undefined}
          onReferenceAdded={() => {
            // Updated automatically via subscribe
          }}
        />
      )}
    </div>
  );
};
