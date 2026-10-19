import React, { useState } from 'react';
import {
  Sparkles,
  HardDrive,
  Cpu,
  Download,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { HardwareInfo } from '../types/tts';
import { StorageService } from '../services/storageService';

interface FirstRunModalProps {
  isOpen: boolean;
  onClose: () => void;
  hardware: HardwareInfo;
  onDownloadRecommended: () => void;
}

export const FirstRunModal: React.FC<FirstRunModalProps> = ({
  isOpen,
  onClose,
  hardware,
  onDownloadRecommended,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [modelDir, setModelDir] = useState('Documents/Local AI Voice Studio/Models');

  if (!isOpen) return null;

  const handleFinish = () => {
    StorageService.getInstance().updateSettings({
      modelStoragePath: modelDir,
      firstRunCompleted: true,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-[20px]">
      <div className="w-full max-w-lg rounded-[28px] bg-[#11151D] border border-white/[0.08] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.4)] space-y-6 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-[16px] bg-[#181D27] border border-white/[0.08] mx-auto flex items-center justify-center text-[#00D9FF] shadow-sm">
            <Sparkles className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-[#F5F7FA] tracking-tight">
            Welcome to Local AI Voice Studio
          </h2>
          <p className="text-xs text-[#A2AAB8] max-w-md mx-auto">
            100% offline-capable, model-agnostic speech workstation powered by open weights.
          </p>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            {/* Step 1: Storage directory */}
            <div className="p-4 rounded-[20px] bg-[#181D27] border border-white/[0.08] space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#F5F7FA]">
                <HardDrive className="w-4 h-4 text-[#00D9FF]" />
                Choose Model Storage Directory
              </div>
              <p className="text-[11px] text-[#A2AAB8]">
                AI weights will be saved locally in this folder. You can change this anytime.
              </p>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={modelDir}
                  onChange={e => setModelDir(e.target.value)}
                  className="flex-1 text-xs px-3.5 py-2.5 rounded-[16px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] font-mono focus:outline-none focus:border-[#00D9FF] transition-colors"
                />
                <button
                  onClick={() => setModelDir('D:\\AI\\Models')}
                  className="px-3.5 py-2.5 text-xs font-medium text-[#A2AAB8] hover:text-[#F5F7FA] bg-[#080A0F] border border-white/[0.08] rounded-[14px] transition-colors"
                >
                  D:\ Drive
                </button>
              </div>
            </div>

            {/* Hardware detection summary */}
            <div className="p-4 rounded-[20px] bg-[#181D27] border border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-[#F5F7FA]">
                <span className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#32D583]" />
                  Hardware Detection
                </span>
                <span className="text-[10px] font-mono text-[#32D583] bg-[#32D583]/10 px-2 py-0.5 rounded-[8px] border border-[#32D583]/20">
                  TIER {hardware.tier} DETECTED
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-[#A2AAB8] font-mono">
                <div className="p-2.5 rounded-[14px] bg-[#080A0F] border border-white/[0.04]">
                  <div className="text-[10px] text-[#6F7888]">GPU:</div>
                  <div className="text-[#F5F7FA] truncate text-[11px] mt-0.5">
                    {hardware.gpuName.replace(/ANGLE \((.*)\)/, '$1')}
                  </div>
                  <div className="text-[10px] text-[#00D9FF] mt-1">{hardware.vramGB} GB VRAM</div>
                </div>

                <div className="p-2.5 rounded-[14px] bg-[#080A0F] border border-white/[0.04]">
                  <div className="text-[10px] text-[#6F7888]">CPU & RAM:</div>
                  <div className="text-[#F5F7FA] truncate text-[11px] mt-0.5">{hardware.cpuCores} Threads</div>
                  <div className="text-[10px] text-[#32D583] mt-1">{hardware.ramGB} GB System RAM</div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={handleFinish}
                className="text-xs text-[#6F7888] hover:text-[#F5F7FA] transition-colors"
              >
                Skip Setup
              </button>
              <button
                onClick={() => setStep(2)}
                className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-[#080A0F] bg-[#00D9FF] hover:bg-[#22E7FF] rounded-[14px] transition-all shadow-[0_2px_12px_rgba(0,217,255,0.25)]"
              >
                <span>Continue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {/* Recommended Model Card */}
            <div className="p-4 rounded-[20px] bg-[#181D27] border border-[#00D9FF]/25 space-y-3 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#F5F7FA]">
                  Recommended Foundation Model
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-[#00D9FF]/15 text-[#00D9FF] border border-[#00D9FF]/20">
                  LIGHTWEIGHT
                </span>
              </div>

              <div>
                <h3 className="text-sm font-bold text-[#F5F7FA]">Qwen3-TTS 0.6B Base</h3>
                <p className="text-xs text-[#A2AAB8] mt-1">
                  12Hz neural speech tokenization, 10 languages, CPU and CUDA support, zero-shot reference voice cloning.
                </p>
              </div>

              <div className="flex items-center gap-3 text-xs text-[#6F7888] font-mono">
                <span>Download: 980 MB</span>
                <span>·</span>
                <span>VRAM Req: 4 GB</span>
                <span>·</span>
                <span>Apache-2.0</span>
              </div>
            </div>

            {/* Privacy Guarantee */}
            <div className="p-3.5 rounded-[16px] bg-[#080A0F] border border-white/[0.06] flex items-center gap-2.5 text-xs text-[#A2AAB8]">
              <ShieldCheck className="w-4 h-4 text-[#32D583] shrink-0" />
              <span>
                Local Processing: Your scripts and voice references stay entirely on this computer.
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={handleFinish}
                className="px-4 py-2 text-xs font-medium text-[#6F7888] hover:text-[#F5F7FA] transition-colors"
              >
                Skip for now
              </button>
              <button
                onClick={() => {
                  onDownloadRecommended();
                  handleFinish();
                }}
                className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-[#080A0F] bg-[#00D9FF] hover:bg-[#22E7FF] rounded-[14px] transition-all shadow-[0_2px_12px_rgba(0,217,255,0.25)]"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Launch Studio</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
