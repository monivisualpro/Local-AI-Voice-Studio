import React from 'react';
import { Play, RotateCcw, CheckCircle2, Clock, AlertCircle, Loader2, Combine } from 'lucide-react';
import { GenerationChunk } from '../types/tts';

interface ChunkQueueViewerProps {
  chunks: GenerationChunk[];
  activeChunkIndex: number;
  onPlayChunk: (chunk: GenerationChunk) => void;
  onRegenerateChunk: (chunkId: string) => void;
  /** A generation is running: segment buttons that would start another one are disabled. */
  busy?: boolean;
  /** Rebuilds the single merged track from every finished segment. */
  onMerge?: () => void;
}

export const ChunkQueueViewer: React.FC<ChunkQueueViewerProps> = ({
  chunks,
  activeChunkIndex,
  onPlayChunk,
  onRegenerateChunk,
  busy = false,
  onMerge,
}) => {
  if (chunks.length <= 1) return null;
  const finished = chunks.filter(c => c.status === 'completed').length;

  return (
    <div className="rounded-[20px] bg-[#11151D] border border-white/[0.08] p-5 space-y-3.5 shadow-sm">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-[#F5F7FA] flex items-center gap-2">
          <span>Generation Queue</span>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-[10px] bg-[#00D9FF]/10 text-[#00D9FF] border border-[#00D9FF]/20">
            {chunks.filter(c => c.status === 'completed').length} / {chunks.length} Segments
          </span>
        </span>
        {onMerge ? (
          <button
            onClick={onMerge}
            disabled={busy || finished === 0}
            title="Join all finished segments into one track (done automatically when a run ends)"
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-[#00D9FF] hover:bg-[#00D9FF]/10 border border-[#00D9FF]/25 rounded-[10px] transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <Combine className="w-3 h-3" /> Merge {finished} finished
          </button>
        ) : (
          <span className="text-[11px] text-[#6F7888] font-mono">Sentence Segmentation Active</span>
        )}
      </div>

      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
        {chunks.map((chunk, idx) => {
          const isCurrent = idx === activeChunkIndex;
          return (
            <div
              key={chunk.id}
              className={`p-3 rounded-[14px] border text-xs transition-colors flex items-center justify-between gap-3 ${
                isCurrent
                  ? 'bg-[#181D27] border-[#00D9FF]/40 shadow-[0_0_12px_rgba(0,217,255,0.08)]'
                  : chunk.status === 'completed'
                    ? 'bg-[#0D1016] border-white/[0.05]'
                    : 'bg-[#0D1016]/60 border-white/[0.04]'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="font-mono text-[11px] text-[#6F7888] shrink-0">
                  {(idx + 1).toString().padStart(2, '0')}
                </span>

                <div className="truncate">
                  <div className="truncate font-medium text-[#F5F7FA]">
                    {chunk.text}
                  </div>
                  <div className="text-[10px] text-[#A2AAB8] font-mono mt-0.5">
                    {chunk.wordCount} words
                    {chunk.duration && ` · ${chunk.duration.toFixed(1)}s`}
                  </div>
                </div>
              </div>

              {/* Status and Action */}
              <div className="flex items-center gap-2 shrink-0">
                {chunk.status === 'generating' && (
                  <div className="flex items-center gap-1.5 text-[11px] text-[#00D9FF] font-mono">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00D9FF]" />
                    <span>{chunk.progress}%</span>
                  </div>
                )}

                {chunk.status === 'completed' && (
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#32D583]" />
                    {chunk.audioUrl && (
                      <button
                        onClick={() => onPlayChunk(chunk)}
                        className="p-1 rounded-[8px] text-[#A2AAB8] hover:text-[#00D9FF] hover:bg-white/[0.05] transition-colors"
                        title="Play segment"
                      >
                        <Play className="w-3 h-3 fill-current" />
                      </button>
                    )}
                    <button
                      onClick={() => onRegenerateChunk(chunk.id)}
                      disabled={busy}
                      className="p-1 rounded-[8px] text-[#A2AAB8] hover:text-[#FF3CAC] hover:bg-white/[0.05] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                      title="Regenerate segment"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {chunk.status === 'waiting' && (
                  <div className="flex items-center gap-1 text-[11px] text-[#6F7888] font-mono">
                    <Clock className="w-3 h-3 text-[#6F7888]/70" />
                    <span>Queued</span>
                  </div>
                )}

                {chunk.status === 'failed' && (
                  <div className="flex items-center gap-1 text-[11px] text-[#FF5C70] font-mono">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <button
                      onClick={() => onRegenerateChunk(chunk.id)}
                      disabled={busy}
                      title={chunk.error}
                      className="text-[10px] underline hover:text-white disabled:opacity-30 disabled:pointer-events-none"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
