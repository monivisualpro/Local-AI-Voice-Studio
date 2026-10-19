import React, { useState } from 'react';
import { Download, CloudOff, FolderOpen, Trash2, Loader2 } from 'lucide-react';
import { ReferenceAudioItem } from '../types/tts';
import { StorageService } from '../services/storageService';
import { voiceFilesApi } from '../services/desktopBridge';

/**
 * The three file actions every voice in the library has:
 *   Download / Download again  - fetches the audio (when already downloaded: deletes the copy first, then fetches again)
 *   Remove                     - catalogue voice: removes the downloaded audio (the voice stays, download again anytime)
 *                                your own upload: deletes the clip
 *   Locate file                - desktop app: opens the folder with the file selected; browser: saves a copy
 */
export function VoiceFileActions({ item }: { item: ReferenceAudioItem }) {
  const [busy, setBusy] = useState<'download' | 'locate' | null>(null);
  const storage = StorageService.getInstance();
  const isUpload = !item.downloadUrl;
  const onDisk = Boolean(item.isDownloaded) || isUpload;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const download = async (e: React.MouseEvent) => {
    stop(e);
    if (busy) return;
    setBusy('download');
    try {
      if (item.isDownloaded) await storage.redownloadReferenceAudio(item.id);
      else await storage.downloadReferenceAudio(item.id);
    } catch (err) {
      alert(`Download failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (e: React.MouseEvent) => {
    stop(e);
    if (isUpload) {
      if (item.isBuiltIn) return;
      if (confirm(`Delete "${item.name}"? This is your own clip and cannot be downloaded again.`)) {
        storage.deleteReferenceAudio(item.id);
      }
      return;
    }
    if (!item.isDownloaded) return;
    if (!confirm(`Remove the downloaded audio of "${item.name}"? The voice stays in the library and can be downloaded again.`)) return;
    try {
      await storage.removeDownloadedReferenceAudio(item.id);
    } catch (err) {
      alert(`Could not remove the download: ${(err as Error).message}`);
    }
  };

  const locate = async (e: React.MouseEvent) => {
    stop(e);
    if (busy) return;
    setBusy('locate');
    try {
      const where = await storage.locateReferenceAudio(item.id);
      if (where === 'saved-by-browser') {
        alert('You are using the browser version, which keeps voices inside the browser. A copy was saved to your Downloads folder instead. The desktop app keeps real files you can open from here.');
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const base = 'p-1 rounded-[6px] transition-colors hover:bg-white/[0.05] disabled:opacity-30 disabled:cursor-not-allowed';
  const removeDisabled = isUpload ? Boolean(item.isBuiltIn) : !item.isDownloaded;
  const desktop = Boolean(voiceFilesApi());

  return (
    <div className="flex items-center gap-0.5">
      {item.audioMissing && (
        <span
          className="mr-1 px-1.5 py-0.5 rounded-[6px] text-[10px] font-semibold text-[#FF5C70] bg-[#FF5C70]/10 border border-[#FF5C70]/30"
          title="The sound of this clip was not saved by an older version of the app. Delete it and add the clip again."
        >
          Audio missing
        </span>
      )}
      <button
        onClick={download}
        disabled={isUpload || busy === 'download'}
        className={`${base} ${item.isDownloaded ? 'text-[#32D583]' : 'text-[#00D9FF]'}`}
        title={
          isUpload
            ? 'Your own clip: already on this computer'
            : item.isDownloaded
              ? 'Delete and download again'
              : 'Download this voice'
        }
      >
        {busy === 'download' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
      </button>
      <button
        onClick={remove}
        disabled={removeDisabled}
        className={`${base} text-[#6F7888] hover:text-[#FF5C70]`}
        title={
          isUpload
            ? item.isBuiltIn ? 'Built-in voice' : 'Delete this clip'
            : item.isDownloaded ? 'Remove downloaded audio (download again later)' : 'Not downloaded'
        }
      >
        {isUpload ? <Trash2 className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}
      </button>
      <button
        onClick={locate}
        disabled={!onDisk || busy === 'locate'}
        className={`${base} text-[#A2AAB8] hover:text-[#00D9FF]`}
        title={
          !onDisk
            ? 'Download the voice first'
            : desktop ? 'Show the file in its folder' : 'Save a copy of the file'
        }
      >
        {busy === 'locate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
