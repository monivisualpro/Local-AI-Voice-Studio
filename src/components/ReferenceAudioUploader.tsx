import React, { useRef, useState, useEffect } from 'react';
import {
  UploadCloud,
  Play,
  Pause,
  X,
  CheckCircle2,
  Folder,
  Plus,
  Layers,
  ChevronDown,
} from 'lucide-react';
import { ReferenceAudioItem, ReferenceFolder } from '../types/tts';
import { StorageService } from '../services/storageService';
import { AudioEngine } from '../services/audioEngine';
import { AddReferenceAudioModal } from './AddReferenceAudioModal';
import { ReferenceAudioLibraryModal } from './ReferenceAudioLibraryModal';

export interface ReferenceAudioFile {
  name: string;
  size: number;
  duration: number;
  url: string;
  referenceText?: string;
  accent?: string;
  language?: string;
  id?: string;
}

interface ReferenceAudioUploaderProps {
  referenceAudio?: ReferenceAudioFile | null;
  onAudioChange?: (audio: ReferenceAudioFile | null) => void;
  supportsReferenceText?: boolean;
  activeReferences?: ReferenceAudioItem[];
  onActiveReferencesChange?: (refs: ReferenceAudioItem[]) => void;
}

export const ReferenceAudioUploader: React.FC<ReferenceAudioUploaderProps> = ({
  referenceAudio,
  onAudioChange,
  supportsReferenceText = true,
  activeReferences = [],
  onActiveReferencesChange,
}) => {
  const [libraryReferences, setLibraryReferences] = useState<ReferenceAudioItem[]>(
    StorageService.getInstance().getUsableReferenceAudios()
  );
  const [folders, setFolders] = useState<ReferenceFolder[]>(
    StorageService.getInstance().getReferenceFolders()
  );

  const [isPlayingId, setIsPlayingId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isFolderLibraryOpen, setIsFolderLibraryOpen] = useState(false);
  const [selectedDropdownValue, setSelectedDropdownValue] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const unsub = StorageService.getInstance().subscribe(() => {
      setLibraryReferences(StorageService.getInstance().getUsableReferenceAudios());
      setFolders(StorageService.getInstance().getReferenceFolders());
    });
    return unsub;
  }, []);

  // Sync initial referenceAudio to activeReferences if activeReferences is empty
  useEffect(() => {
    if (activeReferences.length === 0 && referenceAudio && referenceAudio.url) {
      const match = libraryReferences.find(r => r.url === referenceAudio.url || r.name === referenceAudio.name);
      if (match) {
        if (onActiveReferencesChange) onActiveReferencesChange([match]);
      } else {
        const tempItem: ReferenceAudioItem = {
          id: `ref-temp-${Date.now()}`,
          name: referenceAudio.name,
          language: referenceAudio.language || 'English',
          accent: referenceAudio.accent || 'Custom',
          folderId: 'folder-custom-clones',
          folderName: 'My Cloned Audio References',
          size: referenceAudio.size,
          duration: referenceAudio.duration,
          url: referenceAudio.url,
          referenceText: referenceAudio.referenceText,
          createdAt: Date.now(),
        };
        if (onActiveReferencesChange) onActiveReferencesChange([tempItem]);
      }
    }
  }, [referenceAudio]);

  const handleDropdownSelect = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const refId = e.target.value;
    if (!refId) return;

    if (refId === '__add_new__') {
      setIsAddModalOpen(true);
      setSelectedDropdownValue('');
      return;
    }

    if (refId === '__open_folders__') {
      setIsFolderLibraryOpen(true);
      setSelectedDropdownValue('');
      return;
    }

    const selected = libraryReferences.find(r => r.id === refId);
    if (!selected) return;

    if (!selected.isDownloaded && selected.downloadUrl) {
      alert(selected.name + ' is not downloaded yet. Open Voices > Reference Studio > Download, then select it here.');
      setSelectedDropdownValue('');
      try { await StorageService.getInstance().downloadReferenceAudio(selected.id); } catch (err) { console.error(err); }
      return;
    }
    let validUrl: string;
    try { validUrl = await AudioEngine.getInstance().ensureReferenceAudioUrl(selected); } catch (err) { alert(err instanceof Error ? err.message : 'No playable audio.'); setSelectedDropdownValue(''); return; }
    const updatedSelected = { ...selected, url: validUrl };

    let updatedList: ReferenceAudioItem[] = [];
    if (!activeReferences.some(r => r.id === selected.id)) {
      updatedList = [...activeReferences, updatedSelected];
    } else {
      updatedList = activeReferences;
    }

    if (onActiveReferencesChange) {
      onActiveReferencesChange(updatedList);
    }

    // Sync primary reference
    if (onAudioChange && updatedList[0]) {
      onAudioChange({
        id: updatedList[0].id,
        name: updatedList[0].name,
        size: updatedList[0].size,
        duration: updatedList[0].duration,
        url: updatedList[0].url,
        referenceText: updatedList[0].referenceText,
        accent: updatedList[0].accent,
        language: updatedList[0].language,
      });
    }

    setSelectedDropdownValue('');
  };

  const handleRemoveReference = (refId: string) => {
    const updated = activeReferences.filter(r => r.id !== refId);
    if (onActiveReferencesChange) {
      onActiveReferencesChange(updated);
    }
    if (onAudioChange) {
      if (updated.length > 0) {
        onAudioChange({
          id: updated[0].id,
          name: updated[0].name,
          size: updated[0].size,
          duration: updated[0].duration,
          url: updated[0].url,
          referenceText: updated[0].referenceText,
          accent: updated[0].accent,
          language: updated[0].language,
        });
      } else {
        onAudioChange(null);
      }
    }
    if (isPlayingId === refId && audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      setIsPlayingId(null);
    }
  };

  const handleTogglePlay = async (refItem: ReferenceAudioItem | ReferenceAudioFile) => {
    const id = refItem.id || refItem.name;
    if (isPlayingId === id) {
      if (audioPlayerRef.current) audioPlayerRef.current.pause();
      setIsPlayingId(null);
      return;
    }

    const item = refItem as ReferenceAudioItem;
    if (item && !item.isDownloaded && item.downloadUrl) {
      alert(item.name + ' is not downloaded yet. Download it in Voices first.');
      return;
    }

    let url = refItem.url;
    if (!url || (!url.startsWith('blob:') && !url.startsWith('http'))) {
      try {
        url = await AudioEngine.getInstance().ensureReferenceAudioUrl({
          id: id,
          url: refItem.url,
          downloadUrl: (refItem as ReferenceAudioItem).downloadUrl,
          referenceText: refItem.referenceText,
          accent: (refItem as any).accent,
          language: (refItem as any).language,
        });
      } catch (err) {
        alert(err instanceof Error ? err.message : 'No playable audio for this reference.');
        return;
      }
    }

    if (audioPlayerRef.current) {
      audioPlayerRef.current.src = url;
      audioPlayerRef.current.play().then(() => {
        setIsPlayingId(id);
      }).catch(err => console.error(err));
    }
  };

  const processFile = async (file: File) => {
    if (!file.type.includes('audio') && !file.name.match(/\.(wav|mp3|m4a|ogg)$/i)) {
      alert('Please upload a valid audio file (.wav, .mp3, .m4a)');
      return;
    }

    const url = URL.createObjectURL(file);
    const audio = new Audio(url);

    audio.onloadedmetadata = () => {
      const newRef: ReferenceAudioItem = {
        id: `ref-drop-${Date.now()}`,
        name: file.name.replace(/\.[^/.]+$/, ''),
        language: 'English',
        accent: 'Custom Upload',
        folderId: 'folder-custom-clones',
        folderName: 'My Cloned Audio References',
        size: file.size,
        duration: audio.duration,
        url: url,
        referenceText: '',
        createdAt: Date.now(),
        isBuiltIn: false,
      };

      // Saved together with its audio: the clip must still be there after a restart.
      void StorageService.getInstance().addReferenceAudioWithBlob(newRef, file).then(saved => {
        const updated = [...activeReferences, saved];
        if (onActiveReferencesChange) onActiveReferencesChange(updated);
        if (onAudioChange) {
          onAudioChange({
            id: saved.id,
            name: saved.name,
            size: saved.size,
            duration: saved.duration,
            url: saved.url,
            referenceText: '',
            accent: saved.accent,
            language: saved.language,
          });
        }
      });
    };
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  // Group references by Accent & Language for the dropdown
  const groupedReferences: Record<string, ReferenceAudioItem[]> = {};
  libraryReferences.forEach(ref => {
    const key = `${ref.language} · ${ref.accent}`;
    if (!groupedReferences[key]) groupedReferences[key] = [];
    groupedReferences[key].push(ref);
  });

  return (
    <div className="space-y-3.5">
      <audio
        ref={audioPlayerRef}
        onEnded={() => setIsPlayingId(null)}
        onError={() => setIsPlayingId(null)}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/wav,audio/mp3,audio/mpeg,audio/m4a,audio/x-m4a,.wav,.mp3,.m4a"
        onChange={e => e.target.files?.[0] && processFile(e.target.files[0])}
        className="hidden"
      />

      {/* Control Bar: Dropdown for multiple accents/languages + Quick Action Buttons */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Accent & Language Dropdown */}
        <div className="flex-1 min-w-[240px] relative">
          <select
            value={selectedDropdownValue}
            onChange={handleDropdownSelect}
            className="w-full text-xs pl-3.5 pr-8 py-2.5 rounded-[16px] bg-[#181D27] dark:bg-[#181D27] dark:text-[#F5F7FA] border border-white/[0.08] focus:outline-none focus:border-[#00D9FF] transition-all appearance-none cursor-pointer"
          >
            <option value="" className="bg-[#11151D] text-[#A2AAB8] dark:bg-[#11151D] dark:text-[#A2AAB8]" disabled={libraryReferences.length === 0}>＋ Add Audio Reference from Accent / Language...</option>
            
            <optgroup label="⚡ Quick Library Navigation" className="font-semibold text-[#00D9FF] bg-[#0D1016]">
              <option value="__open_folders__" className="bg-[#11151D] text-[#F5F7FA]">📂 Dedicated Reference Folders & Library Manager...</option>
              <option value="__add_new__" className="bg-[#11151D] text-[#F5F7FA]">🎤 + Upload New Audio Reference...</option>
            </optgroup>

            {Object.entries(groupedReferences).map(([groupTitle, items]) => (
              <optgroup key={groupTitle} label={`🌐 ${groupTitle}`} className="font-semibold text-[#00D9FF] bg-[#0D1016]">
                {items.map(item => {
                  const isAlreadyAdded = activeReferences.some(r => r.id === item.id);
                  return (
                    <option key={item.id} value={item.id} className="bg-[#11151D] text-[#F5F7FA]">
                      {isAlreadyAdded ? '✓ ' : '+ '} {item.name} ({item.accent}, {item.duration.toFixed(1)}s)
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-[#6F7888] pointer-events-none" />
        </div>

        {/* Action: Open Folder Manager */}
        <button
          type="button"
          onClick={() => setIsFolderLibraryOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-[14px] bg-[#181D27] hover:bg-[#1D2430] border border-white/[0.08] text-xs font-medium text-[#F5F7FA] transition-colors shadow-xs"
          title="Browse dedicated folder library for reference clone audio"
        >
          <Folder className="w-3.5 h-3.5 text-[#00D9FF]" />
          <span>Folders ({folders.length})</span>
        </button>

        {/* Action: Add Reference Audio */}
        <button
          type="button"
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-[14px] bg-[#00D9FF]/10 hover:bg-[#00D9FF]/20 border border-[#00D9FF]/30 text-xs font-semibold text-[#00D9FF] transition-colors shadow-xs"
          title="Add a new audio reference"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Audio</span>
        </button>
      </div>

      {/* Active References List / Conditioning Multi-Stems */}
      {activeReferences.length > 0 ? (
        <div className="space-y-2.5">
          {activeReferences.length > 1 && (
            <div className="flex items-center justify-between px-3 py-1.5 rounded-[12px] bg-[#00D9FF]/10 border border-[#00D9FF]/20 text-[11px] text-[#00D9FF]">
              <span className="flex items-center gap-1.5 font-medium">
                <Layers className="w-3.5 h-3.5" />
                <span>Multi-Reference Conditioning Active ({activeReferences.length} Stems Blended)</span>
              </span>
              <span className="font-mono text-[10px] text-[#A2AAB8]">
                Acoustic prompt interpolated across accents
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {activeReferences.map((refItem, idx) => {
              const isPlaying = isPlayingId === (refItem.id || refItem.name);

              return (
                <div
                  key={refItem.id || idx}
                  className="rounded-[18px] bg-[#181D27] border border-white/[0.08] p-3 flex flex-col justify-between gap-2.5 relative group shadow-sm hover:border-[#00D9FF]/30 transition-all"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 truncate">
                      <button
                        type="button"
                        onClick={() => handleTogglePlay(refItem)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all ${
                          isPlaying
                            ? 'bg-[#00D9FF] text-[#080A0F] shadow-[0_0_12px_rgba(0,217,255,0.4)]'
                            : 'bg-white/[0.08] hover:bg-[#00D9FF]/20 text-[#00D9FF]'
                        }`}
                        title={isPlaying ? 'Pause' : 'Play reference stem'}
                      >
                        {isPlaying ? (
                          <Pause className="w-3.5 h-3.5 fill-current" />
                        ) : (
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        )}
                      </button>

                      <div className="truncate">
                        <div className="text-xs font-semibold text-[#F5F7FA] flex items-center gap-1 truncate">
                          <span className="truncate">{refItem.name}</span>
                          <CheckCircle2 className="w-3 h-3 text-[#32D583] shrink-0" />
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-[#A2AAB8] font-mono mt-0.5">
                          <span className="text-[#00D9FF]">{refItem.accent}</span>
                          <span className="text-white/20">·</span>
                          <span>{refItem.language}</span>
                          <span className="text-white/20">·</span>
                          <span>{refItem.duration ? refItem.duration.toFixed(1) : '5.0'}s</span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveReference(refItem.id)}
                      className="p-1 rounded-[8px] text-[#6F7888] hover:text-[#FF5C70] hover:bg-white/[0.05] transition-colors"
                      title="Remove from clone references"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Alignment Transcript Context */}
                  {supportsReferenceText && (
                    <input
                      type="text"
                      value={refItem.referenceText || ''}
                      onChange={e => {
                        const updated = activeReferences.map(r =>
                          r.id === refItem.id ? { ...r, referenceText: e.target.value } : r
                        );
                        if (onActiveReferencesChange) onActiveReferencesChange(updated);
                        if (onAudioChange && updated[0]?.id === refItem.id) {
                          onAudioChange({
                            ...refItem,
                            referenceText: e.target.value,
                          });
                        }
                      }}
                      placeholder="Reference transcript context (alignment text)..."
                      className="w-full text-[11px] px-2.5 py-1.5 rounded-[10px] bg-[#080A0F] border border-white/[0.06] text-[#F5F7FA] placeholder-[#6F7888] focus:outline-none focus:border-[#00D9FF]"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Empty Dropzone when no active references */
        <div
          onDragOver={e => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border border-dashed rounded-[20px] p-6 text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-[#00D9FF] bg-[#00D9FF]/5'
              : 'border-white/[0.12] hover:border-[#00D9FF]/50 bg-[#181D27]/40 hover:bg-[#181D27]/80'
          }`}
        >
          <div className="w-10 h-10 rounded-[14px] bg-[#181D27] mx-auto mb-2.5 flex items-center justify-center text-[#00D9FF] shadow-xs">
            <UploadCloud className="w-5 h-5" />
          </div>
          <div className="text-xs font-semibold text-[#F5F7FA]">
            Select accents from the dropdown above <span className="text-[#A2AAB8] font-normal">or</span> drop audio files here
          </div>
          <div className="text-[11px] text-[#6F7888] mt-1 font-mono">
            Supported: WAV, MP3, M4A · Dedicated library folders available
          </div>
        </div>
      )}

      {/* Dedicated Folder Library Browser Modal */}
      {isFolderLibraryOpen && (
        <ReferenceAudioLibraryModal
          isOpen={isFolderLibraryOpen}
          onClose={() => setIsFolderLibraryOpen(false)}
          selectedReferenceIds={activeReferences.map(r => r.id)}
          selectionMode="multiple"
          onToggleReference={refItem => {
            let updated: ReferenceAudioItem[] = [];
            if (activeReferences.some(r => r.id === refItem.id)) {
              updated = activeReferences.filter(r => r.id !== refItem.id);
            } else {
              updated = [...activeReferences, refItem];
            }
            if (onActiveReferencesChange) onActiveReferencesChange(updated);
            if (onAudioChange) {
              if (updated.length > 0) {
                onAudioChange({
                  id: updated[0].id,
                  name: updated[0].name,
                  size: updated[0].size,
                  duration: updated[0].duration,
                  url: updated[0].url,
                  referenceText: updated[0].referenceText,
                  accent: updated[0].accent,
                  language: updated[0].language,
                });
              } else {
                onAudioChange(null);
              }
            }
          }}
          onSelectReference={refItem => {
            const updated = [refItem];
            if (onActiveReferencesChange) onActiveReferencesChange(updated);
            if (onAudioChange) {
              onAudioChange({
                id: refItem.id,
                name: refItem.name,
                size: refItem.size,
                duration: refItem.duration,
                url: refItem.url,
                referenceText: refItem.referenceText,
                accent: refItem.accent,
                language: refItem.language,
              });
            }
          }}
        />
      )}

      {/* Add Reference Audio Modal */}
      {isAddModalOpen && (
        <AddReferenceAudioModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          folders={folders}
          onReferenceAdded={newRef => {
            const updated = [...activeReferences, newRef];
            if (onActiveReferencesChange) onActiveReferencesChange(updated);
            if (onAudioChange) {
              onAudioChange({
                id: newRef.id,
                name: newRef.name,
                size: newRef.size,
                duration: newRef.duration,
                url: newRef.url,
                referenceText: newRef.referenceText,
                accent: newRef.accent,
                language: newRef.language,
              });
            }
          }}
        />
      )}
    </div>
  );
};
