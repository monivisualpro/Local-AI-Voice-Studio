import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Download,
  FileAudio,
} from 'lucide-react';
import { AudioEngine } from '../services/audioEngine';

interface AudioPlayerProps {
  audioBuffer: AudioBuffer | null;
  audioUrl?: string;
  filename?: string;
  onRegenerate?: () => void;
  voiceName?: string;
  modelName?: string;
  isGenerating?: boolean;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  audioBuffer,
  audioUrl,
  filename = 'speech_output.wav',
  onRegenerate,
  voiceName = 'Preset Voice',
  modelName = 'Qwen3-TTS',
  isGenerating = false,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [peaks, setPeaks] = useState<number[]>([]);

  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (audioBuffer) {
      setDuration(audioBuffer.duration);
      const extracted = AudioEngine.getInstance().extractWaveformPeaks(audioBuffer, 92);
      setPeaks(extracted);
    } else {
      setPeaks([]);
      setDuration(0);
    }
    setCurrentTime(0);
    setIsPlaying(false);
  }, [audioBuffer, audioUrl]);

  const handleTimeUpdate = () => {
    if (audioElementRef.current) {
      setCurrentTime(audioElementRef.current.currentTime);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const togglePlay = () => {
    if (!audioElementRef.current || !audioUrl) return;

    if (isPlaying) {
      audioElementRef.current.pause();
      setIsPlaying(false);
    } else {
      audioElementRef.current.playbackRate = playbackRate;
      audioElementRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioElementRef.current || !duration || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = pct * duration;
    audioElementRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    if (audioElementRef.current) {
      audioElementRef.current.playbackRate = rate;
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    setIsMuted(newVol === 0);
    if (audioElementRef.current) {
      audioElementRef.current.volume = newVol;
    }
  };

  const toggleMute = () => {
    if (!audioElementRef.current) return;
    if (isMuted) {
      setIsMuted(false);
      audioElementRef.current.volume = volume || 1.0;
    } else {
      setIsMuted(true);
      audioElementRef.current.volume = 0;
    }
  };

  const handleDownloadLosslessWav = () => {
    if (audioBuffer) {
      const blob = AudioEngine.getInstance().createWavBlob(audioBuffer);
      AudioEngine.getInstance().downloadBlob(blob, filename.endsWith('.wav') ? filename : `${filename}.wav`);
    } else if (audioUrl) {
      const a = document.createElement('a');
      a.href = audioUrl;
      a.download = filename;
      a.click();
    }
  };

  const handleDownloadMp3 = () => {
    if (audioBuffer) {
      const blob = AudioEngine.getInstance().createWavBlob(audioBuffer);
      AudioEngine.getInstance().downloadBlob(blob, filename.replace('.wav', '.mp3'));
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="rounded-[24px] bg-[#11151D] border border-white/[0.08] p-6 shadow-[0_10px_40px_rgba(0,0,0,0.25)] relative overflow-hidden">
      {audioUrl && (
        <audio
          ref={audioElementRef}
          src={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
        />
      )}

      {/* Top row: Track Metadata & Export Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[12px] bg-[#181D27] border border-white/[0.08] flex items-center justify-center text-[#00D9FF]">
            <FileAudio className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-[#F5F7FA] flex items-center gap-2">
              <span className="truncate max-w-[280px]">{filename}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-[10px] bg-white/[0.05] text-[#00D9FF] font-mono border border-white/[0.04]">
                16-BIT / 24KHZ
              </span>
            </div>
            <div className="text-xs text-[#A2AAB8] flex items-center gap-2 mt-0.5">
              <span>{voiceName}</span>
              <span className="text-white/20">·</span>
              <span>{modelName}</span>
            </div>
          </div>
        </div>

        {/* Download Buttons */}
        <div className="flex items-center gap-2">
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              disabled={isGenerating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#A2AAB8] hover:text-[#F5F7FA] bg-[#181D27] hover:bg-[#1D2430] border border-white/[0.08] rounded-[12px] transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Regenerate</span>
            </button>
          )}

          <button
            onClick={handleDownloadLosslessWav}
            disabled={!audioBuffer && !audioUrl}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#080A0F] bg-[#00D9FF] hover:bg-[#22E7FF] rounded-[12px] transition-all shadow-[0_2px_12px_rgba(0,217,255,0.25)] disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export WAV</span>
          </button>

          <button
            onClick={handleDownloadMp3}
            disabled={!audioBuffer && !audioUrl}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#F5F7FA] bg-[#181D27] hover:bg-[#1D2430] border border-white/[0.08] rounded-[12px] transition-colors disabled:opacity-40"
          >
            <span>MP3</span>
          </button>
        </div>
      </div>

      {/* Center Waveform Display: Cyan with Pink Accent sections */}
      <div
        ref={containerRef}
        onClick={handleSeek}
        className="w-full h-24 bg-[#080A0F] rounded-[16px] border border-white/[0.06] p-3 flex items-center justify-between gap-[2px] cursor-pointer relative group select-none overflow-hidden"
      >
        {peaks.length > 0 ? (
          peaks.map((peak, idx) => {
            const barPct = (idx / peaks.length) * 100;
            const isPassed = barPct <= progressPct;
            // Pink accent on crest peaks for high vocal energy or needle threshold
            const isPinkAccent = peak > 0.65 && isPassed;

            return (
              <div
                key={idx}
                className="flex-1 flex flex-col justify-center items-center h-full"
              >
                <div
                  className={`w-full rounded-full transition-colors duration-150 ${
                    isPassed
                      ? isPinkAccent
                        ? 'bg-[#FF3CAC]'
                        : 'bg-[#00D9FF]'
                      : 'bg-white/10 group-hover:bg-white/15'
                  }`}
                  style={{
                    height: `${Math.max(8, peak * 100)}%`,
                  }}
                />
              </div>
            );
          })
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-[#6F7888]">
            Waveform ready after speech generation
          </div>
        )}

        {/* Scrub needle */}
        {duration > 0 && (
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-[#00D9FF] pointer-events-none shadow-[0_0_8px_#00D9FF]"
            style={{ left: `${progressPct}%` }}
          />
        )}
      </div>

      {/* Bottom Controls Row: Play, Scrub, Volume, Speed */}
      <div className="flex flex-wrap items-center justify-between gap-4 mt-4 pt-1">
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            disabled={!audioBuffer && !audioUrl}
            className="w-10 h-10 rounded-full bg-[#00D9FF] hover:bg-[#22E7FF] flex items-center justify-center text-[#080A0F] hover:scale-105 active:scale-95 transition-all shadow-[0_2px_16px_rgba(0,217,255,0.3)] disabled:opacity-40"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          {/* Time Display */}
          <div className="font-mono text-xs text-[#A2AAB8] tabular-nums">
            <span className="text-[#F5F7FA] font-medium">{formatTime(currentTime)}</span>
            <span className="mx-1 text-[#6F7888]">/</span>
            <span className="text-[#6F7888]">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Volume & Speed */}
        <div className="flex items-center gap-4">
          {/* Playback speed selector */}
          <div className="flex items-center gap-1 bg-[#181D27] p-1 rounded-[12px] border border-white/[0.08]">
            {[0.75, 1.0, 1.25, 1.5].map(rate => (
              <button
                key={rate}
                onClick={() => handleSpeedChange(rate)}
                className={`px-2 py-1 text-[11px] font-mono rounded-[8px] transition-colors ${
                  playbackRate === rate
                    ? 'bg-[#00D9FF]/20 text-[#00D9FF] font-semibold'
                    : 'text-[#A2AAB8] hover:text-[#F5F7FA]'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>

          {/* Volume control */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              className="text-[#A2AAB8] hover:text-[#F5F7FA] transition-colors"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-[#FF5C70]" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={e => handleVolumeChange(parseFloat(e.target.value))}
              className="w-16 accent-[#00D9FF] h-1.5 bg-[#080A0F] rounded-lg cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
