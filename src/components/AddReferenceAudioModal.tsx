import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  X,
  Folder,
  Globe,
  Mic,
  FileAudio,
  Sparkles,
  Check,
  Plus,
} from 'lucide-react';
import { ReferenceFolder, ReferenceAudioItem } from '../types/tts';
import { StorageService } from '../services/storageService';
import { AudioEngine } from '../services/audioEngine';
import { DesktopBridge } from '../services/desktopBridge';

interface AddReferenceAudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReferenceAdded?: (ref: ReferenceAudioItem) => void;
  folders: ReferenceFolder[];
  defaultFolderId?: string;
}

const COMMON_ACCENTS = [
  'US General',
  'British RP',
  'Australian',
  'Scottish',
  'Irish',
  'Indian English',
  'Canadian',
  'Spanish Castilian',
  'Spanish Latin America',
  'French Parisian',
  'German Bavarian',
  'Italian Tuscan',
  'Tokyo Japanese',
  'Mandarin Beijing',
  'Seoul Korean',
];

const COMMON_LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Japanese',
  'Chinese',
  'Korean',
  'Hindi',
  'Portuguese',
  'Russian',
  'Arabic',
];

export const AddReferenceAudioModal: React.FC<AddReferenceAudioModalProps> = ({
  isOpen,
  onClose,
  onReferenceAdded,
  folders,
  defaultFolderId,
}) => {
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('English');
  const [accent, setAccent] = useState('US General');
  const [folderId, setFolderId] = useState(defaultFolderId || folders[0]?.id || 'folder-custom-clones');
  const [speakerGender, setSpeakerGender] = useState<'male' | 'female' | 'neutral'>('female');
  const [referenceText, setReferenceText] = useState('');
  const [timbreDescription, setTimbreDescription] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isSynthesizingSample, setIsSynthesizingSample] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAudioFile(file);
      if (!name) {
        setName(file.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handleCreateNewFolder = () => {
    if (!newFolderName.trim()) return;
    const newFolder: ReferenceFolder = {
      id: `folder-${Date.now()}`,
      name: newFolderName.trim(),
      description: 'Custom user folder for cloned reference audios.',
      color: '#00D9FF',
      createdAt: Date.now(),
    };
    StorageService.getInstance().addReferenceFolder(newFolder);
    setFolderId(newFolder.id);
    setNewFolderName('');
    setIsCreatingFolder(false);
  };

  const handleGenerateSampleStem = async () => {
    setIsSynthesizingSample(true);
    try {
      const sampleText = referenceText.trim() || `This is a calibrated reference vocal stem in ${language} with ${accent} cadence.`;
      const { wavBlob, duration } = await AudioEngine.getInstance().synthesizePreview(sampleText, {
        gender: speakerGender,
        language: language,
        speed: 1.0,
      });

      const url = URL.createObjectURL(wavBlob);
      const selectedFolder = folders.find(f => f.id === folderId) || folders[0];

      const newRef: ReferenceAudioItem = {
        id: `ref-custom-${Date.now()}`,
        name: name.trim() || `${accent} Voice Stem`,
        language,
        accent,
        folderId: selectedFolder?.id || 'folder-custom-clones',
        folderName: selectedFolder?.name || 'My Cloned Audio References',
        size: wavBlob.size,
        duration,
        url,
        referenceText: sampleText,
        speakerGender,
        timbreDescription: timbreDescription || `${accent} vocal timbre calibrated in Local AI Voice Studio.`,
        tags: [accent, language, speakerGender],
        createdAt: Date.now(),
        isBuiltIn: false,
      };

      const saved = await StorageService.getInstance().addReferenceAudioWithBlob(newRef, wavBlob);
      if (onReferenceAdded) onReferenceAdded(saved);
      onClose();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Could not generate the sample stem.');
    } finally {
      setIsSynthesizingSample(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;

    let audioUrl = '';
    let duration = 5.0;
    let size = 2000000;
    let audioBlob: Blob | null = null;

    if (audioFile) {
      audioBlob = audioFile;
      audioUrl = URL.createObjectURL(audioFile);
      size = audioFile.size;
      try {
        const audio = new Audio(audioUrl);
        await new Promise(r => {
          audio.onloadedmetadata = () => {
            duration = audio.duration || 5.0;
            r(true);
          };
          audio.onerror = () => r(false);
        });
      } catch {}
    } else {
      // Synthesize playable audio using AudioEngine
      const sampleText = referenceText.trim() || `Reference voice audio calibrated for ${accent} ${language} voice cloning.`;
      try {
        const synthesized = await AudioEngine.getInstance().synthesizePreview(sampleText, {
          gender: speakerGender,
          language: language,
        });
        audioBlob = synthesized.wavBlob;
        audioUrl = URL.createObjectURL(synthesized.wavBlob);
        duration = synthesized.duration;
        size = synthesized.wavBlob.size;
      } catch (err) {
        alert(
          (err instanceof Error ? err.message : 'Could not create audio.') +
            '\n\nUpload a real audio file instead, or load Kokoro 82M in the desktop app.'
        );
        return;
      }
    }

    const selectedFolder = folders.find(f => f.id === folderId) || folders[0];

    const newRef: ReferenceAudioItem = {
      id: `ref-custom-${Date.now()}`,
      name: name.trim(),
      language,
      accent,
      folderId: selectedFolder?.id || 'folder-custom-clones',
      folderName: selectedFolder?.name || 'My Cloned Audio References',
      size,
      duration,
      url: audioUrl,
      referenceText: referenceText.trim() || undefined,
      speakerGender,
      timbreDescription: timbreDescription.trim() || undefined,
      tags: [accent, language, speakerGender].filter(Boolean),
      createdAt: Date.now(),
      isBuiltIn: false,
    };

    // The audio is saved together with the entry, so the voice still works after the app is restarted.
    const saved = audioBlob ? await StorageService.getInstance().addReferenceAudioWithBlob(newRef, audioBlob) : newRef;
    if (!audioBlob) StorageService.getInstance().addReferenceAudio(newRef);
    if (onReferenceAdded) {
      onReferenceAdded(saved);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="bg-[#11151D] border border-white/[0.12] rounded-[24px] max-w-xl w-full p-6 space-y-5 shadow-[0_20px_60px_rgba(0,0,0,0.5)] max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[12px] bg-[#FF3CAC]/15 border border-[#FF3CAC]/30 text-[#FF3CAC] flex items-center justify-center shadow-sm">
              <FileAudio className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#F5F7FA]">Add Reference Clone Audio</h2>
              <p className="text-xs text-[#A2AAB8]">Upload or configure an accent reference stem for zero-shot voice cloning</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[10px] text-[#6F7888] hover:text-[#F5F7FA] hover:bg-white/[0.05] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Audio File Upload Drop Area */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-[#F5F7FA] flex items-center justify-between">
            <span>Audio File (.WAV, .MP3, .M4A)</span>
            <span className="text-[11px] text-[#A2AAB8] font-normal">3–10s clean speech recommended</span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/wav,audio/mp3,audio/mpeg,audio/m4a,audio/x-m4a,.wav,.mp3,.m4a"
            onChange={handleFileChange}
            className="hidden"
          />

          <div
            onClick={() => fileInputRef.current?.click()}
            className="border border-dashed border-white/[0.12] hover:border-[#00D9FF]/50 bg-[#080A0F] rounded-[18px] p-5 text-center cursor-pointer transition-all hover:bg-[#181D27]/40"
          >
            {audioFile ? (
              <div className="flex items-center justify-center gap-3 text-xs text-[#32D583]">
                <Check className="w-4 h-4" />
                <span className="font-semibold text-[#F5F7FA]">{audioFile.name}</span>
                <span className="text-[#A2AAB8] font-mono">({(audioFile.size / (1024 * 1024)).toFixed(2)} MB)</span>
              </div>
            ) : (
              <div className="space-y-1">
                <UploadCloud className="w-6 h-6 text-[#00D9FF] mx-auto mb-1" />
                <p className="text-xs font-medium text-[#F5F7FA]">Click to browse or drop reference audio clip</p>
                <p className="text-[11px] text-[#6F7888]">Or leave empty to automatically synthesize an acoustic stem</p>
              </div>
            )}
          </div>
        </div>

        {/* Form Inputs Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Reference Name */}
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-medium text-[#A2AAB8]">Reference Voice Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Julian - British RP Documentary"
              className="w-full text-xs px-3.5 py-2.5 rounded-[14px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF] transition-colors"
            />
          </div>

          {/* Language Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#A2AAB8] flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-[#00D9FF]" />
              Language
            </label>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value)}
              className="w-full text-xs px-3 py-2.5 rounded-[14px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF] transition-colors"
            >
              {COMMON_LANGUAGES.map(lang => (
                <option key={lang} value={lang} className="bg-[#11151D] text-[#F5F7FA]">{lang}</option>
              ))}
            </select>
          </div>

          {/* Accent Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#A2AAB8] flex items-center gap-1.5">
              <Mic className="w-3.5 h-3.5 text-[#FF3CAC]" />
              Accent / Dialect
            </label>
            <input
              type="text"
              list="common-accents"
              value={accent}
              onChange={e => setAccent(e.target.value)}
              placeholder="e.g. British RP, US West Coast"
              className="w-full text-xs px-3.5 py-2.5 rounded-[14px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF] transition-colors"
            />
            <datalist id="common-accents">
              {COMMON_ACCENTS.map(acc => (
                <option key={acc} value={acc} />
              ))}
            </datalist>
          </div>

          {/* Folder Destination */}
          <div className="space-y-1.5 sm:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[#A2AAB8] flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-[#FFB547]" />
                Dedicated Folder
              </label>
              {!isCreatingFolder ? (
                <button
                  type="button"
                  onClick={() => setIsCreatingFolder(true)}
                  className="text-[11px] text-[#00D9FF] hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>New Folder</span>
                </button>
              ) : null}
            </div>

            {isCreatingFolder ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  placeholder="New folder name..."
                  className="flex-1 text-xs px-3 py-2 rounded-[12px] bg-[#080A0F] border border-[#00D9FF]/40 text-[#F5F7FA] focus:outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleCreateNewFolder}
                  className="px-3 py-2 text-xs font-semibold bg-[#00D9FF] text-[#080A0F] rounded-[12px]"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingFolder(false)}
                  className="p-2 text-xs text-[#A2AAB8] hover:text-[#F5F7FA]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <select
                value={folderId}
                onChange={e => setFolderId(e.target.value)}
                className="w-full text-xs px-3 py-2.5 rounded-[14px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF] transition-colors"
              >
                {folders.map(f => (
                  <option key={f.id} value={f.id} className="bg-[#11151D] text-[#F5F7FA]">{f.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Gender */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#A2AAB8]">Speaker Vocal Register</label>
            <div className="grid grid-cols-3 gap-1.5 bg-[#080A0F] p-1 rounded-[14px] border border-white/[0.06]">
              {(['female', 'male', 'neutral'] as const).map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setSpeakerGender(g)}
                  className={`py-1.5 rounded-[10px] text-xs font-medium capitalize transition-colors ${
                    speakerGender === g
                      ? 'bg-[#181D27] text-[#00D9FF] shadow-xs'
                      : 'text-[#A2AAB8] hover:text-[#F5F7FA]'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {/* Timbre description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#A2AAB8]">Acoustic Characteristics</label>
            <input
              type="text"
              value={timbreDescription}
              onChange={e => setTimbreDescription(e.target.value)}
              placeholder="e.g. Crisp enunciation, warm baritone"
              className="w-full text-xs px-3 py-2 rounded-[14px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF] transition-colors"
            />
          </div>

          {/* Reference Transcript alignment text */}
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-medium text-[#A2AAB8] flex items-center justify-between">
              <span>Reference Transcript (Alignment Text)</span>
              <span className="text-[11px] text-[#6F7888]">Recommended for enhanced cross-attention</span>
            </label>
            <textarea
              rows={2}
              value={referenceText}
              onChange={e => setReferenceText(e.target.value)}
              placeholder="Verbatim words spoken in the audio reference sample for zero-shot text-to-speech alignment..."
              className="w-full text-xs p-3 rounded-[14px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF] transition-colors resize-none"
            />
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/[0.08]">
          <button
            type="button"
            onClick={handleGenerateSampleStem}
            disabled={isSynthesizingSample || !DesktopBridge.ttsAvailable}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[12px] bg-[#181D27] hover:bg-[#1D2430] border border-white/[0.08] text-xs font-medium text-[#A2AAB8] hover:text-[#F5F7FA] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={DesktopBridge.ttsAvailable ? 'Generate a real sample stem with the loaded model' : 'Real audio needs the desktop app - run "npm run electron:dev"'}
          >
            <Sparkles className="w-3.5 h-3.5 text-[#00D9FF]" />
            <span>{isSynthesizingSample ? 'Generating Stem...' : 'Synthesize Demo Stem'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-[12px] text-xs font-medium text-[#A2AAB8] hover:text-[#F5F7FA] hover:bg-white/[0.05] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim()}
              className="px-4 py-2 rounded-[12px] text-xs font-semibold bg-[#00D9FF] text-[#080A0F] hover:bg-[#22E7FF] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_2px_12px_rgba(0,217,255,0.25)]"
            >
              Save Reference Audio
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
