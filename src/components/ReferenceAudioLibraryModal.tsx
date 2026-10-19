import { VoiceFileActions } from './VoiceFileActions';
import React, { useState, useEffect, useRef } from 'react';
import {
  Folder,
  FolderPlus,
  Play,
  Pause,
  Plus,
  Search,
  Trash2,
  X,
  FileAudio,
  Check,
  CheckCircle2,
  Filter,
  Download,
  Loader2,
  CloudOff,
} from 'lucide-react';
import { ReferenceFolder, ReferenceAudioItem } from '../types/tts';
import { StorageService } from '../services/storageService';
import { AudioEngine } from '../services/audioEngine';
import { AddReferenceAudioModal } from './AddReferenceAudioModal';

interface ReferenceAudioLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedReferenceIds?: string[];
  onSelectReference?: (reference: ReferenceAudioItem) => void;
  onToggleReference?: (reference: ReferenceAudioItem) => void;
  selectionMode?: 'single' | 'multiple';
}

export const ReferenceAudioLibraryModal: React.FC<ReferenceAudioLibraryModalProps> = ({
  isOpen,
  onClose,
  selectedReferenceIds = [],
  onSelectReference,
  onToggleReference,
  selectionMode = 'multiple',
}) => {
  const [folders, setFolders] = useState<ReferenceFolder[]>(
    StorageService.getInstance().getReferenceFolders()
  );
  const [references, setReferences] = useState<ReferenceAudioItem[]>(
    StorageService.getInstance().getUsableReferenceAudios()
  );

  const [activeFolderId, setActiveFolderId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [accentFilter, setAccentFilter] = useState<string>('all');
  const [languageFilter, setLanguageFilter] = useState<string>('all');

  const [playingRefId, setPlayingRefId] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({});

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


  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const unsub = StorageService.getInstance().subscribe(() => {
      setFolders(StorageService.getInstance().getReferenceFolders());
      setReferences(StorageService.getInstance().getUsableReferenceAudios());
    });
    return unsub;
  }, []);

  if (!isOpen) return null;

  const handlePlayPreview = async (refItem: ReferenceAudioItem) => {
    if (playingRefId === refItem.id) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingRefId(null);
      return;
    }

    try {
      const url = await AudioEngine.getInstance().ensureReferenceAudioUrl(refItem);
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
        setPlayingRefId(refItem.id);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No playable audio for this reference.');
      console.error(err);
      setPlayingRefId(null);
    }
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    const newFolder: ReferenceFolder = {
      id: `folder-${Date.now()}`,
      name: newFolderName.trim(),
      description: 'Dedicated folder for cloned reference voice audio.',
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
    if (confirm('Delete this reference folder? Audio items inside will be preserved in custom clones.')) {
      StorageService.getInstance().deleteReferenceFolder(folderId);
      if (activeFolderId === folderId) {
        setActiveFolderId('all');
      }
    }
  };

  const handleDeleteReference = (refId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Remove this audio reference clip?')) {
      StorageService.getInstance().deleteReferenceAudio(refId);
    }
  };

  const uniqueAccents = Array.from(new Set(references.map(r => r.accent))).filter(Boolean);
  const uniqueLanguages = Array.from(new Set(references.map(r => r.language))).filter(Boolean);

  const filteredReferences = references.filter(item => {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <audio
        ref={audioRef}
        onEnded={() => setPlayingRefId(null)}
        onError={() => setPlayingRefId(null)}
      />

      <div className="bg-[#11151D] border border-white/[0.12] rounded-[24px] max-w-5xl w-full h-[88vh] flex flex-col shadow-[0_25px_70px_rgba(0,0,0,0.6)] overflow-hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#080A0F]/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[12px] bg-[#00D9FF]/15 border border-[#00D9FF]/30 text-[#00D9FF] flex items-center justify-center shadow-sm">
              <Folder className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#F5F7FA] tracking-tight">
                Reference Clone Audio Library & Dedicated Folders
              </h2>
              <p className="text-xs text-[#A2AAB8]">
                Organized acoustic references across international accents, dialects, and languages for zero-shot voice conditioning.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[12px] bg-[#00D9FF] hover:bg-[#22E7FF] text-[#080A0F] font-semibold text-xs transition-all shadow-[0_2px_12px_rgba(0,217,255,0.25)]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Reference Audio</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-[10px] text-[#6F7888] hover:text-[#F5F7FA] hover:bg-white/[0.05] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body: Left Folders Sidebar + Right Audio References Grid */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Folders Sidebar */}
          <div className="w-64 border-r border-white/[0.08] bg-[#0D1016] flex flex-col p-4 space-y-3 shrink-0 overflow-y-auto">
            <div className="flex items-center justify-between text-xs font-semibold text-[#A2AAB8] uppercase tracking-wider px-1">
              <span>Folders</span>
              <button
                onClick={() => setIsCreatingFolder(true)}
                className="text-[11px] text-[#00D9FF] hover:underline flex items-center gap-1 normal-case font-mono"
                title="Create dedicated reference folder"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>New</span>
              </button>
            </div>

            {/* Folder creation input */}
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
                  {references.length}
                </span>
              </button>

              {folders.map(folder => {
                const count = references.filter(r => r.folderId === folder.id).length;
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

          {/* Right Main Area: Search, Filters & Reference Cards Grid */}
          <div className="flex-1 flex flex-col p-5 space-y-4 overflow-y-auto">
            {/* Folder Header info & Filter toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-white/[0.06]">
              <div>
                <h3 className="text-sm font-bold text-[#F5F7FA] flex items-center gap-2">
                  <span>{activeFolderId === 'all' ? 'All Reference Audio Stems' : activeFolder?.name}</span>
                  <span className="text-[11px] font-mono text-[#00D9FF] font-normal">
                    ({filteredReferences.length} Stems)
                  </span>
                </h3>
                <p className="text-xs text-[#A2AAB8] mt-0.5">
                  {activeFolderId === 'all'
                    ? 'Explore audio references categorized by accent and language for zero-shot synthesis.'
                    : activeFolder?.description}
                </p>
              </div>

              {selectedReferenceIds.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-[12px] bg-[#00D9FF]/10 border border-[#00D9FF]/30 text-xs text-[#00D9FF]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{selectedReferenceIds.length} Reference(s) Selected</span>
                </div>
              )}
            </div>

            {/* Filter and Search Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#6F7888]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search accent, language, or narrator..."
                  className="w-full text-xs pl-8 pr-3 py-2 rounded-[12px] bg-[#181D27] border border-white/[0.08] text-[#F5F7FA] placeholder-[#6F7888] focus:outline-none focus:border-[#00D9FF]"
                />
              </div>

              {/* Accent Filter */}
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

              {/* Language Filter */}
              <div className="flex items-center gap-1.5 bg-[#181D27] px-2.5 py-1.5 rounded-[12px] border border-white/[0.08]">
                <Filter className="w-3.5 h-3.5 text-[#32D583] shrink-0" />
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

            {/* Reference Audio Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 overflow-y-auto pr-1">
              {filteredReferences.map(refItem => {
                const isPlaying = playingRefId === refItem.id;
                const isSelected = selectedReferenceIds.includes(refItem.id);

                return (
                  <div
                    key={refItem.id}
                    className={`rounded-[18px] bg-[#181D27] border p-4 space-y-3 transition-all relative flex flex-col justify-between group shadow-xs ${
                      isSelected
                        ? 'border-[#00D9FF] bg-[#181D27]/90 shadow-[0_0_20px_rgba(0,217,255,0.08)]'
                        : 'border-white/[0.08] hover:border-white/[0.14]'
                    }`}
                  >
                    <div className="space-y-2.5">
                      {/* Card Top Row: Play button + Title + Badges */}
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-center gap-2.5">
                          {refItem.downloadUrl && !refItem.isDownloaded ? (
                            <button
                              onClick={(e) => handleDownloadReference(refItem, e)}
                              disabled={downloadingIds[refItem.id]}
                              className="w-8 h-8 rounded-full flex items-center justify-center transition-all bg-[#00D9FF]/15 hover:bg-[#00D9FF] text-[#00D9FF] hover:text-[#080A0F] border border-[#00D9FF]/30 disabled:opacity-50"
                              title="Download voice reference stem"
                            >
                              {downloadingIds[refItem.id] ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Download className="w-3.5 h-3.5" />
                              )}
                            </button>
                          ) : (
                            <button
                              onClick={() => handlePlayPreview(refItem)}
                              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                                isPlaying
                                  ? 'bg-[#00D9FF] text-[#080A0F] shadow-[0_0_12px_rgba(0,217,255,0.5)]'
                                  : 'bg-white/[0.08] hover:bg-[#00D9FF]/20 text-[#00D9FF]'
                              }`}
                              title={isPlaying ? 'Pause' : 'Play audio reference'}
                            >
                              {isPlaying ? (
                                <Pause className="w-3.5 h-3.5 fill-current" />
                              ) : (
                                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                              )}
                            </button>
                          )}

                          <div>
                            <h4 className="text-xs font-bold text-[#F5F7FA] flex items-center gap-1.5">
                              <span>{refItem.name}</span>
                              {isSelected && (
                                <Check className="w-3.5 h-3.5 text-[#00D9FF] shrink-0" />
                              )}
                              {refItem.isDownloaded && (
                                <span className="w-1.5 h-1.5 rounded-full bg-[#32D583]" title="Stored offline" />
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

                        {/* Folder tag */}
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

                      {/* Timbre description */}
                      {refItem.timbreDescription && (
                        <p className="text-[11px] text-[#A2AAB8] leading-relaxed line-clamp-2">
                          {refItem.timbreDescription}
                        </p>
                      )}

                      {/* Reference Text */}
                      {refItem.referenceText && (
                        <div className="p-2 rounded-[10px] bg-[#080A0F] border border-white/[0.04] text-[10px] text-[#6F7888] italic line-clamp-2">
                          "{refItem.referenceText}"
                        </div>
                      )}
                    </div>

                    {/* Card Footer Actions */}
                    <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] text-xs">
                      <div className="flex items-center gap-1.5">
                        <VoiceFileActions item={refItem} />
                        <span className="text-[10px] font-mono text-[#6F7888]">
                          {(refItem.size / (1024 * 1024)).toFixed(2)} MB
                        </span>
                      </div>

                      {/* Select / Toggle button */}
                      <button
                        onClick={() => {
                          if (selectionMode === 'multiple' && onToggleReference) {
                            onToggleReference(refItem);
                          } else if (onSelectReference) {
                            onSelectReference(refItem);
                            onClose();
                          }
                        }}
                        className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/40'
                            : 'bg-white/[0.06] hover:bg-[#00D9FF] text-[#F5F7FA] hover:text-[#080A0F]'
                        }`}
                      >
                        {isSelected ? (
                          <>
                            <Check className="w-3 h-3" />
                            <span>Active in Clone</span>
                          </>
                        ) : (
                          <span>+ Add to Clone</span>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredReferences.length === 0 && (
              <div className="text-center py-12 space-y-3">
                <FileAudio className="w-10 h-10 text-[#6F7888] mx-auto" />
                <p className="text-xs text-[#A2AAB8]">No reference audio clips found in this filter.</p>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="px-3.5 py-1.5 rounded-[12px] bg-[#00D9FF] text-[#080A0F] text-xs font-semibold"
                >
                  Add Your First Reference
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-white/[0.08] bg-[#080A0F]/60 text-xs">
          <div className="text-[#A2AAB8]">
            Multi-reference conditioning allows blending accents across speaker clips.
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-[12px] bg-[#00D9FF] text-[#080A0F] font-semibold hover:bg-[#22E7FF] transition-all shadow-[0_2px_12px_rgba(0,217,255,0.25)]"
          >
            Done
          </button>
        </div>
      </div>

      {/* Add Reference Audio Modal */}
      {isAddModalOpen && (
        <AddReferenceAudioModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          folders={folders}
          defaultFolderId={activeFolderId !== 'all' ? activeFolderId : undefined}
          onReferenceAdded={newRef => {
            if (onSelectReference && selectionMode === 'single') {
              onSelectReference(newRef);
            }
          }}
        />
      )}
    </div>
  );
};
