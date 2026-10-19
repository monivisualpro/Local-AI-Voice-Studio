import React, { useState, useEffect } from 'react';
import {
  Clock,
  Play,
  Pause,
  Download,
  Trash2,
  RotateCcw,
  Search,
  Mic,
} from 'lucide-react';
import { GenerationHistoryItem } from '../types/tts';
import { resolveHistoryAudioUrl } from '../services/historyAudioStorage';
import { StorageService } from '../services/storageService';

interface HistoryPageProps {
  onLoadScriptToStudio: (script: string, voiceId?: string, modelId?: string) => void;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ onLoadScriptToStudio }) => {
  const [history, setHistory] = useState<GenerationHistoryItem[]>(
    StorageService.getInstance().getHistory()
  );
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    const unsub = StorageService.getInstance().subscribe(() => {
      setHistory(StorageService.getInstance().getHistory());
    });
    return unsub;
  }, []);

  const handlePlayToggle = async (item: GenerationHistoryItem) => {
    if (playingId === item.id) {
      currentAudio?.pause();
      setPlayingId(null);
      return;
    }

    if (currentAudio) {
      currentAudio.pause();
    }

    const audio = new Audio(await resolveHistoryAudioUrl(item.id, item.audioUrl));
    audio.onended = () => setPlayingId(null);
    audio.play().catch(() => { setPlayingId(null); alert('This entry has no playable audio any more (it was created by an older version).'); });
    setCurrentAudio(audio);
    setPlayingId(item.id);
  };

  const handleDelete = (id: string) => {
    StorageService.getInstance().deleteHistoryItem(id);
  };

  const handleClearAll = () => {
    if (confirm('Clear all local generation history?')) {
      StorageService.getInstance().clearHistory();
    }
  };

  const handleDownload = async (item: GenerationHistoryItem) => {
    const a = document.createElement('a');
    a.href = await resolveHistoryAudioUrl(item.id, item.audioUrl);
    a.download = `TTS_${item.modelName.split(' ')[0]}_${item.id}.wav`;
    a.click();
  };

  const filteredHistory = history.filter(h => {
    const query = searchQuery.toLowerCase();
    return (
      h.script.toLowerCase().includes(query) ||
      h.modelName.toLowerCase().includes(query) ||
      h.voiceName.toLowerCase().includes(query)
    );
  });

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6 pb-12 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#F5F7FA] flex items-center gap-2.5">
            <Clock className="w-5 h-5 text-[#00E5FF]" />
            Generation History & Audio Archive
          </h1>
          <p className="text-xs text-[#A2AAB8] mt-1">
            Local archive of synthesized takes with audio stems, scripts, and lossless export capabilities.
          </p>
        </div>

        {history.length > 0 && (
          <button
            onClick={handleClearAll}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-[#FF5C70] hover:bg-[#FF5C70]/10 border border-[#FF5C70]/20 rounded-[12px] transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear History</span>
          </button>
        )}
      </div>

      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6F7888]" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by script text, voice persona, or model..."
          className="w-full text-xs pl-10 pr-4 py-2.5 rounded-[16px] bg-[#11151D] border border-white/[0.08] text-[#F5F7FA] placeholder-[#6F7888] focus:outline-none focus:border-[#00D9FF] transition-colors shadow-sm"
        />
      </div>

      {/* History Items (20px continuous Apple geometry) */}
      {filteredHistory.length > 0 ? (
        <div className="space-y-3">
          {filteredHistory.map(item => {
            const isPlaying = playingId === item.id;

            return (
              <div
                key={item.id}
                className="p-5 rounded-[20px] bg-[#11151D] border border-white/[0.08] hover:border-white/[0.14] transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm"
              >
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      onClick={() => handlePlayToggle(item)}
                      className="w-8 h-8 rounded-full bg-[#00D9FF]/15 text-[#00D9FF] hover:bg-[#00D9FF]/25 flex items-center justify-center transition-colors shrink-0 shadow-sm"
                    >
                      {isPlaying ? (
                        <Pause className="w-3.5 h-3.5 fill-current" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      )}
                    </button>

                    <span className="font-semibold text-[#F5F7FA] flex items-center gap-1.5 truncate">
                      <Mic className="w-3.5 h-3.5 text-[#00D9FF]" />
                      {item.voiceName}
                    </span>

                    <span className="text-white/20">·</span>
                    <span className="text-[#A2AAB8] font-mono text-[11px] truncate">
                      {item.modelName}
                    </span>

                    <span className="text-white/20">·</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-white/[0.05] text-[#32D583] border border-white/[0.04]">
                      {item.device}
                    </span>

                    <span className="text-white/20">·</span>
                    <span className="text-[11px] text-[#6F7888] font-mono">
                      {item.duration ? `${item.duration.toFixed(1)}s` : 'Take'}
                    </span>

                    <span className="text-white/20">·</span>
                    <span className="text-[11px] text-[#6F7888] font-mono">
                      {formatDate(item.timestamp)}
                    </span>
                  </div>

                  <p className="text-xs text-[#A2AAB8] line-clamp-2 leading-relaxed">
                    "{item.script}"
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onLoadScriptToStudio(item.script, item.voiceId, item.modelId)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#A2AAB8] hover:text-[#00D9FF] bg-[#181D27] hover:bg-[#1D2430] border border-white/[0.08] rounded-[10px] transition-colors"
                    title="Load in Studio"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Load in Studio</span>
                  </button>

                  <button
                    onClick={() => handleDownload(item)}
                    className="flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold text-[#080A0F] bg-[#00D9FF] hover:bg-[#22E7FF] rounded-[10px] transition-all shadow-sm"
                    title="Download lossless WAV"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export WAV</span>
                  </button>

                  <button
                    onClick={() => handleDelete(item.id)}
                    className="p-1.5 text-[#6F7888] hover:text-[#FF5C70] transition-colors"
                    title="Delete item"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-12 text-center rounded-[24px] bg-[#11151D] border border-white/[0.06] space-y-3">
          <div className="w-12 h-12 rounded-[16px] bg-[#181D27] mx-auto flex items-center justify-center text-[#6F7888]">
            <Clock className="w-6 h-6" />
          </div>
          <h2 className="text-sm font-semibold text-[#F5F7FA]">No generation history yet</h2>
          <p className="text-xs text-[#A2AAB8] max-w-sm mx-auto">
            Synthesized takes from Generate Studio will appear here automatically with lossless export options.
          </p>
        </div>
      )}
    </div>
  );
};
