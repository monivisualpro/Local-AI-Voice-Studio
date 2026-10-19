import React, { useState, useEffect } from 'react';
import {
  Settings,
  Cpu,
  HardDrive,
  Volume2,
  ShieldCheck,
  CheckCircle2,
  Sun,
  Moon,
  Laptop,
} from 'lucide-react';
import { AppSettings, HardwareInfo, ComputeDevice } from '../types/tts';
import { StorageService } from '../services/storageService';
import { HardwareDetector } from '../services/hardwareDetector';
import { ModelRegistry } from '../services/modelRegistry';
import { DesktopBridge } from '../services/desktopBridge';
import { RuntimeInstaller } from '../components/RuntimeInstaller';
import { EnvironmentsPanel } from '../components/EnvironmentsPanel';
import { HuggingFaceTokenCard } from '../components/HuggingFaceTokenCard';
import { StorageLocationsCard } from '../components/StorageLocationsCard';

interface SettingsPageProps {
  hardware: HardwareInfo;
  onHardwareChange: (info: HardwareInfo) => void;
  onThemeChange?: (theme: 'dark' | 'light' | 'system') => void;
}

const ENGINE_LIST: { adapter: string; label: string }[] = [
  { adapter: 'kokoro', label: 'Kokoro 82M - fast, lightweight, preset voices' },
  { adapter: 'qwen3', label: 'Qwen3-TTS - voice cloning and VoiceDesign (Base 0.6B / VoiceDesign 1.7B)' },
  { adapter: 'chatterbox', label: 'Chatterbox - expressive, optional cloning' },
  { adapter: 'f5tts', label: 'F5-TTS - zero-shot cloning (needs reference transcript)' },
  { adapter: 'xtts', label: 'XTTS-v2 - multilingual cloning' },
  { adapter: 'svara', label: 'Svara-TTS - 19 Indian languages, named male/female speakers' },
  { adapter: 'sooktam', label: 'Sooktam-2 (BharatGen) - 12 Indian languages, cloning (own environment)' },
  { adapter: 'urdu-tortoise', label: 'Urdu Tortoise TTS - Urdu + cloning (slow, own environment)' },
  { adapter: 'parler', label: 'Parler-TTS and Indic Parler-TTS (21 Indian languages) - describe the voice in text' },
];

export const SettingsPage: React.FC<SettingsPageProps> = ({
  hardware,
  onHardwareChange,
  onThemeChange,
}) => {
  const [speedLimit, setSpeedLimit] = useState<number>(0);
  useEffect(() => {
    DesktopBridge.getConfig().then(c => setSpeedLimit(Math.round((c?.downloadLimitBps || 0) / (1024 * 1024))));
  }, []);
  const [settings, setSettings] = useState<AppSettings>(
    StorageService.getInstance().getSettings()
  );
  const [savedToast, setSavedToast] = useState(false);
  const [modelDirInput, setModelDirInput] = useState(settings.modelStoragePath);

  useEffect(() => {
    const unsub = StorageService.getInstance().subscribe(() => {
      setSettings(StorageService.getInstance().getSettings());
    });
    return unsub;
  }, []);

  const handleComputeChange = (device: ComputeDevice) => {
    const updatedHw = HardwareDetector.getInstance().setComputeSetting(device);
    onHardwareChange(updatedHw);
    StorageService.getInstance().updateSettings({ computeDevice: device });
    triggerSaveToast();
  };

  const handleThemeSelect = (theme: 'dark' | 'light' | 'system') => {
    StorageService.getInstance().updateSettings({ theme });
    if (onThemeChange) {
      onThemeChange(theme);
    }
    triggerSaveToast();
  };

  const handleToggleLowMemory = () => {
    const newVal = !settings.lowMemoryMode;
    StorageService.getInstance().updateSettings({ lowMemoryMode: newVal });
    triggerSaveToast();
  };

  const IDLE_OPTIONS: { label: string; minutes: number }[] = [
    { label: 'Off', minutes: 0 },
    { label: '5m', minutes: 5 },
    { label: '10m', minutes: 10 },
    { label: '30m', minutes: 30 },
  ];
  const idleMinutes = settings.idleUnloadMinutes ?? (settings.autoUnloadInactive ? 10 : 0);

  const handleIdleMinutesChange = (minutes: number) => {
    StorageService.getInstance().updateSettings({
      idleUnloadMinutes: minutes,
      autoUnloadInactive: minutes > 0,
    });
    DesktopBridge.setTtsIdleMinutes(minutes); // takes effect immediately in the running app
    triggerSaveToast();
  };

  const handleSampleRateChange = (rate: 24000 | 44100 | 48000) => {
    StorageService.getInstance().updateSettings({ sampleRate: rate });
    triggerSaveToast();
  };

  const handleUpdateStoragePath = () => {
    StorageService.getInstance().updateSettings({ modelStoragePath: modelDirInput });
    triggerSaveToast();
  };

  const triggerSaveToast = () => {
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2500);
  };

  const installedModelsCount = ModelRegistry.getInstance().getInstalledModels().length;

  return (
    <div className="space-y-6 pb-12 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#F5F7FA] flex items-center gap-2.5">
            <Settings className="w-5 h-5 text-[#00D9FF]" />
            Application Settings
          </h1>
          <p className="text-xs text-[#A2AAB8] mt-1">
            Configure local hardware compute allocation, storage directories, and acoustic synthesis parameters.
          </p>
        </div>

        {savedToast && (
          <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[12px] bg-[#32D583]/10 border border-[#32D583]/30 text-xs text-[#32D583] font-mono animate-in fade-in duration-150 shadow-sm">
            <CheckCircle2 className="w-4 h-4" />
            <span>Preferences Saved</span>
          </div>
        )}
      </div>

      {/* 1. Theme Configuration */}
      <div className="p-6 rounded-[24px] bg-[#11151D] border border-white/[0.08] space-y-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div>
            <h2 className="text-sm font-semibold text-[#F5F7FA]">Interface Appearance</h2>
            <p className="text-xs text-[#A2AAB8]">Choose between dark workstation or clean white studio theme</p>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-white/[0.05] text-[#00D9FF] border border-white/[0.04] uppercase">
            {(settings.theme || 'dark') === 'dark' ? 'DARK THEME' : (settings.theme === 'light' ? 'WHITE THEME' : 'SYSTEM AUTO')}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { id: 'dark', label: 'Dark Mode (Default)', icon: Moon, desc: 'Professional audio laboratory dark surfaces' },
            { id: 'light', label: 'White / Light Mode', icon: Sun, desc: 'Clean, high-contrast white workstation canvas' },
            { id: 'system', label: 'System Theme', icon: Laptop, desc: 'Synchronize dynamically with operating system' },
          ].map(t => {
            const isSelected = (settings.theme || 'dark') === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => handleThemeSelect(t.id as any)}
                className={`text-left p-4 rounded-[16px] border transition-all ${
                  isSelected
                    ? 'bg-[#181D27] border-[#00D9FF] shadow-[0_0_15px_rgba(0,217,255,0.1)]'
                    : 'bg-[#080A0F] border-white/[0.06] hover:border-white/[0.12]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold flex items-center gap-2 ${isSelected ? 'text-[#00D9FF]' : 'text-[#F5F7FA]'}`}>
                    <Icon className="w-4 h-4" />
                    {t.label}
                  </span>
                  <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${isSelected ? 'border-[#00D9FF]' : 'border-white/20'}`}>
                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-[#00D9FF]" />}
                  </div>
                </div>
                <p className="text-[11px] text-[#A2AAB8] mt-1.5 leading-relaxed">
                  {t.desc}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Compute & Hardware Allocation */}
      <div className="p-6 rounded-[24px] bg-[#11151D] border border-white/[0.08] space-y-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-4 h-4 text-[#00D9FF]" />
            <div>
              <h2 className="text-sm font-semibold text-[#F5F7FA]">Compute Engine & Device</h2>
              <p className="text-xs text-[#A2AAB8]">Select target processing accelerator</p>
            </div>
          </div>
          <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-[8px] bg-[#32D583]/10 text-[#32D583] border border-[#32D583]/20">
            TIER {hardware.tier} DETECTED
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { id: 'auto', title: 'Auto (Recommended)', desc: 'Prefers CUDA if available with safe VRAM headroom' },
            { id: 'cuda', title: 'NVIDIA GPU (CUDA)', desc: 'Hardware accelerated neural speech inference' },
            { id: 'cpu', title: 'CPU Mode', desc: 'First-class CPU execution with multi-threaded PyTorch backend' },
          ].map(opt => {
            const isSelected = hardware.computeSetting === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => handleComputeChange(opt.id as ComputeDevice)}
                className={`text-left p-4 rounded-[16px] border transition-all ${
                  isSelected
                    ? 'bg-[#181D27] border-[#00D9FF] shadow-[0_0_15px_rgba(0,217,255,0.1)]'
                    : 'bg-[#080A0F] border-white/[0.06] hover:border-white/[0.12]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold ${isSelected ? 'text-[#00D9FF]' : 'text-[#F5F7FA]'}`}>
                    {opt.title}
                  </span>
                  <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${isSelected ? 'border-[#00D9FF]' : 'border-white/20'}`}>
                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-[#00D9FF]" />}
                  </div>
                </div>
                <p className="text-[11px] text-[#A2AAB8] mt-1.5 leading-relaxed">
                  {opt.desc}
                </p>
              </button>
            );
          })}
        </div>

        {/* Hardware Status Specs Box (Separating VRAM and RAM cleanly) */}
        <div className="p-4 rounded-[18px] bg-[#080A0F] border border-white/[0.06] space-y-2 text-xs">
          <div className="text-[11px] font-mono text-[#A2AAB8] flex justify-between items-center">
            <span>Detected Accelerators & System Memory:</span>
            <span className="text-[#32D583] font-medium">{hardware.activeDevice.toUpperCase()} ACTIVE</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px] text-[#F5F7FA]">
            <div className="p-2.5 rounded-[12px] bg-[#11151D] border border-white/[0.04]">
              <span className="text-[#6F7888] text-[10px] block">GPU Model</span>
              <span className="truncate block mt-0.5" title={hardware.gpuName}>{hardware.gpuName}</span>
            </div>
            <div className="p-2.5 rounded-[12px] bg-[#11151D] border border-white/[0.04]">
              <span className="text-[#6F7888] text-[10px] block">Dedicated VRAM</span>
              <span className="text-[#00D9FF] block mt-0.5">{hardware.vramGB} GB VRAM</span>
            </div>
            <div className="p-2.5 rounded-[12px] bg-[#11151D] border border-white/[0.04]">
              <span className="text-[#6F7888] text-[10px] block">CPU Topology</span>
              <span className="truncate block mt-0.5">{hardware.cpuCores} Threads ({hardware.cpuName.split('@')[0]})</span>
            </div>
            <div className="p-2.5 rounded-[12px] bg-[#11151D] border border-white/[0.04]">
              <span className="text-[#6F7888] text-[10px] block">System RAM</span>
              <span className="text-[#32D583] block mt-0.5">{hardware.ramGB} GB System RAM</span>
            </div>
          </div>
        </div>

        {/* Low Memory Mode & Auto Unload Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div className="p-3.5 rounded-[16px] bg-[#181D27] border border-white/[0.06] flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-[#F5F7FA]">Low Memory Mode</div>
              <div className="text-[11px] text-[#A2AAB8]">Reduces batch size, purges stale audio caches</div>
            </div>
            <button
              onClick={handleToggleLowMemory}
              className={`w-11 h-6 rounded-full transition-colors relative ${
                settings.lowMemoryMode ? 'bg-[#00D9FF]' : 'bg-white/10'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-[#080A0F] absolute top-1 transition-transform ${
                  settings.lowMemoryMode ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="p-3.5 rounded-[16px] bg-[#181D27] border border-white/[0.06] flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-[#F5F7FA]">Auto-Unload Inactive Models</div>
              <div className="text-[11px] text-[#A2AAB8]">
                {idleMinutes > 0
                  ? `Frees memory automatically after ${idleMinutes}m idle (restarts on the next request)`
                  : 'Keeps the speech engine in memory until you quit the app'}
              </div>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-[12px] bg-[#080A0F] border border-white/[0.06]">
              {IDLE_OPTIONS.map(opt => (
                <button
                  key={opt.minutes}
                  onClick={() => handleIdleMinutesChange(opt.minutes)}
                  className={`px-2.5 py-1 rounded-[8px] text-[11px] font-semibold transition-colors ${
                    idleMinutes === opt.minutes
                      ? 'bg-[#00D9FF] text-[#080A0F]'
                      : 'text-[#A2AAB8] hover:text-[#F5F7FA]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Hugging Face token for gated models (Indic Parler-TTS) */}
      <HuggingFaceTokenCard />

      {/* Voice engines & dependencies: Python, PyTorch (CPU/CUDA), model libraries */}
      <div className="p-5 rounded-[24px] bg-[#11151E] border border-white/[0.06] space-y-4">
        <div>
          <div className="text-sm font-semibold text-[#F5F7FA]">Voice Engines &amp; Dependencies</div>
          <div className="text-[11px] text-[#A2AAB8]">
            One-click install of Python, PyTorch (the right CPU/GPU build) and each model's libraries. Models with
            compatible libraries share ONE environment, so PyTorch and CUDA are downloaded only once; a model that needs
            different versions automatically gets its own. Downloads use multiple connections, are verified, and resume
            exactly where they stopped after a pause, crash or restart. No system Python is needed.
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#A2AAB8]">
          <span>Download speed limit</span>
          {[{ l: 'Unlimited', v: 0 }, { l: '5 MB/s', v: 5 }, { l: '10 MB/s', v: 10 }, { l: '25 MB/s', v: 25 }].map(o => (
            <button
              key={o.v}
              onClick={async () => { await DesktopBridge.setConfig({ downloadLimitBps: o.v * 1024 * 1024 }); setSpeedLimit(o.v); triggerSaveToast(); }}
              className={`px-2.5 py-1 rounded-[8px] text-[11px] font-semibold ${speedLimit === o.v ? 'bg-[#00D9FF] text-[#080A0F]' : 'bg-[#181D27] text-[#A2AAB8] hover:text-[#F5F7FA]'}`}
            >{o.l}</button>
          ))}
        </div>
        <EnvironmentsPanel />
        {ENGINE_LIST.map(e => (
          <details key={e.adapter} className="rounded-[14px] bg-[#0B0E15] border border-white/[0.06] p-3">
            <summary className="cursor-pointer text-xs font-semibold text-[#F5F7FA]">{e.label}</summary>
            <div className="pt-3"><RuntimeInstaller adapter={e.adapter} /></div>
          </details>
        ))}
      </div>

      {/* 3. Storage locations: app, models, environments (real folders, movable) */}
      <StorageLocationsCard />

      {/* 4. Audio Output Standards */}
      <div className="p-6 rounded-[24px] bg-[#11151D] border border-white/[0.08] space-y-4 shadow-sm">
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] pb-3">
          <Volume2 className="w-4 h-4 text-[#00D9FF]" />
          <div>
            <h2 className="text-sm font-semibold text-[#F5F7FA]">Audio Rendering & Export Parameters</h2>
            <p className="text-xs text-[#A2AAB8]">Master output sample rate and dynamic range processing</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[24000, 44100, 48000].map(rate => (
            <button
              key={rate}
              onClick={() => handleSampleRateChange(rate as any)}
              className={`p-3.5 rounded-[16px] border text-left transition-all ${
                settings.sampleRate === rate
                  ? 'bg-[#181D27] border-[#00D9FF] shadow-[0_0_12px_rgba(0,217,255,0.1)]'
                  : 'bg-[#080A0F] border-white/[0.06] hover:border-white/[0.12]'
              }`}
            >
              <div className="text-xs font-semibold text-[#F5F7FA]">
                {rate === 24000 ? '24,000 Hz (Native)' : `${rate.toLocaleString()} Hz`}
              </div>
              <div className="text-[11px] text-[#A2AAB8] mt-1">
                {rate === 24000 ? 'Direct neural vocoder rate' : 'Broadcast studio resampling'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 5. Privacy & Offline Guarantee Statement (Mandatory Requirement) */}
      <div className="p-5 rounded-[24px] bg-[#181D27] border border-white/[0.08] flex items-start gap-3.5 shadow-sm">
        <ShieldCheck className="w-5 h-5 text-[#32D583] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h3 className="text-xs font-bold text-[#F5F7FA]">Local Privacy & Security Guarantee</h3>
          <p className="text-xs text-[#A2AAB8] leading-relaxed">
            "Speech generation runs locally on your computer unless you explicitly configure an external service."
          </p>
          <p className="text-[11px] text-[#6F7888] leading-relaxed mt-1">
            Your scripts, reference voice audio samples, and synthesized files stay strictly on this device.
            Internet connectivity is used solely for downloading open-weights repositories from Hugging Face Hub.
            No telemetric data is collected or sent, and no cloud accounts or Firebase logins are required.
          </p>
        </div>
      </div>
    </div>
  );
};
