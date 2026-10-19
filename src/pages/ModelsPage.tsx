import React, { useState, useEffect } from 'react';
import {
  Layers,
  Download,
  Pause,
  Play,
  FolderOpen,
  Trash2,
  HardDrive,
  Cpu,
  FolderPlus,
  ExternalLink,
  Search,
  CheckCircle2,
  Zap,
  Activity,
  Sparkles,
  Award,
  ShieldCheck,
  Flame,
  Gauge,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { TTSModel, HardwareInfo, ModelCategory } from '../types/tts';
import { isSpeechModel } from '../types/tts';
import { ModelRegistry } from '../services/modelRegistry';
import { HardwareDetector } from '../services/hardwareDetector';
import { DesktopBridge, formatBytes } from '../services/desktopBridge';
import { AddLocalModelModal } from '../components/AddLocalModelModal';

interface ModelsPageProps {
  hardware: HardwareInfo;
  activeModelId: string;
  onSelectModel: (id: string) => void;
  initialCategory?: string;
}

const CATEGORIES: { id: ModelCategory; label: string }[] = [
  { id: 'all', label: 'All Models' },
  { id: 'recommended', label: 'Recommended' },
  { id: 'lightweight', label: 'Lightweight' },
  { id: 'voice-cloning', label: 'Voice Cloning' },
  { id: 'multilingual', label: 'Multilingual' },
  { id: 'voice-design', label: 'Voice Design' },
  { id: 'high-quality', label: 'High Quality' },
  { id: 'cpu-friendly', label: 'CPU Friendly' },
  { id: 'gpu-optimized', label: 'GPU Optimized' },
  { id: 'installed', label: 'Installed' },
];

export const ModelsPage: React.FC<ModelsPageProps> = ({
  hardware,
  activeModelId,
  onSelectModel,
  initialCategory,
}) => {
  const [models, setModels] = useState<TTSModel[]>(ModelRegistry.getInstance().getModels());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<ModelCategory>(
    (initialCategory as ModelCategory) || 'all'
  );
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const unsub = ModelRegistry.getInstance().subscribe(() => {
      setModels(ModelRegistry.getInstance().getModels());
    });
    return unsub;
  }, []);

  // Re-read the REAL on-disk state every time the Model Manager is opened.
  useEffect(() => {
    void ModelRegistry.getInstance().syncWithDisk();
  }, []);

  // System Hardware Analysis & Intelligent Recommendations
  const systemAnalysis = HardwareDetector.getInstance().analyzeSystemAndRecommendModels(models.filter(isSpeechModel));
  const topRecModel = models.find(m => m.id === systemAnalysis.topRecommendedModelId);
  const speedRecModel = models.find(m => m.id === systemAnalysis.speedRecommendedModelId);
  const qualityRecModel = models.find(m => m.id === systemAnalysis.qualityRecommendedModelId);

  const handleInstall = (modelId: string) => {
    // Real Hugging Face download into the configured storage directory.
    void ModelRegistry.getInstance().startDownload(modelId);
  };

  const handleCancelDownload = (modelId: string) => {
    void ModelRegistry.getInstance().cancelDownload(modelId);
  };

  const handlePauseDownload = (modelId: string) => {
    void ModelRegistry.getInstance().pauseDownload(modelId);
  };

  const handleResumeDownload = (modelId: string) => {
    void ModelRegistry.getInstance().resumeDownload(modelId);
  };

  const handleLocateModel = async (modelId: string) => {
    const ok = await ModelRegistry.getInstance().locateOnDisk(modelId);
    if (!ok) alert('Locate in folder is only available in the desktop app (.exe) after a real on-disk install.');
  };

  const handleUninstall = (modelId: string) => {
    if (confirm('Delete the model files from disk?')) {
      void ModelRegistry.getInstance().uninstallModel(modelId);
    }
  };

  const handleLoad = async (modelId: string) => {
    await ModelRegistry.getInstance().loadModel(modelId);
    onSelectModel(modelId);
  };

  const handleUnload = (modelId: string) => {
    ModelRegistry.getInstance().unloadModel(modelId);
  };

  const handleVerify = (modelId: string) => {
    void ModelRegistry.getInstance().verifyOnDisk(modelId);
  };

  const filteredModels = models.filter(m => {
    // Category filter
    if (activeCategory === 'installed') {
      if (!m.isInstalled) return false;
    } else if (activeCategory !== 'all') {
      if (!m.categories || !m.categories.includes(activeCategory)) return false;
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = m.name.toLowerCase().includes(q);
      const matchRepo = m.repo.toLowerCase().includes(q);
      const matchDesc = m.description.toLowerCase().includes(q);
      const matchLang = m.languages.some(l => l.toLowerCase().includes(q));
      if (!matchName && !matchRepo && !matchDesc && !matchLang) {
        return false;
      }
    }

    return true;
  });

  const getHardwareSuitability = (model: TTSModel) => {
    const evalData = systemAnalysis.modelEvaluations[model.id];
    if (evalData) {
      if (evalData.suitability === 'optimal') {
        return {
          status: 'Optimal Fit',
          color: 'text-[#32D583] bg-[#32D583]/10 border-[#32D583]/30',
          msg: evalData.primaryReason,
          rtf: evalData.realtimeFactor,
        };
      } else if (evalData.suitability === 'compatible') {
        return {
          status: 'Compatible (CPU)',
          color: 'text-[#FFB547] bg-[#FFB547]/10 border-[#FFB547]/30',
          msg: evalData.primaryReason,
          rtf: evalData.realtimeFactor,
        };
      } else {
        return {
          status: 'Heavy Load',
          color: 'text-[#FF5C70] bg-[#FF5C70]/10 border-[#FF5C70]/30',
          msg: evalData.primaryReason,
          rtf: evalData.realtimeFactor,
        };
      }
    }

    if (hardware.vramGB >= model.recommendedVRAM) {
      return { status: 'Optimal', color: 'text-[#32D583] bg-[#32D583]/10 border-[#32D583]/20', msg: 'Recommended for your GPU', rtf: '14.0x' };
    } else {
      return { status: 'CPU Compatible', color: 'text-[#FFB547] bg-[#FFB547]/10 border-[#FFB547]/20', msg: 'High RAM usage, CPU inference', rtf: '2.5x' };
    }
  };

  return (
    <div className="space-y-6 pb-12 max-w-7xl mx-auto">
      {/* Top Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#F5F7FA] flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-[#00D9FF]" />
            Model Manager & Neural Hub
          </h1>
          <p className="text-xs text-[#A2AAB8] mt-1">
            Curated open-weights speech models from Hugging Face Hub with localized safetensors execution.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#F5F7FA] bg-[#181D27] hover:bg-[#1D2430] border border-white/[0.08] rounded-[14px] transition-colors shadow-sm"
          >
            <FolderPlus className="w-4 h-4 text-[#00D9FF]" />
            <span>Add Local Model</span>
          </button>
          <button
            onClick={() => ModelRegistry.getInstance().clearGPUMemory()}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#6F7888] hover:text-[#FF5C70] bg-[#181D27] hover:bg-[#1D2430] border border-white/[0.08] rounded-[14px] transition-colors"
            title="Free VRAM buffers"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear VRAM</span>
          </button>
        </div>
      </div>

      {/* System Specification Analysis & Intelligent Recommendations Showcase */}
      <div className="p-6 rounded-[24px] bg-[#11151D] border border-white/[0.08] space-y-5 shadow-[0_8px_32px_rgba(0,0,0,0.2)] relative overflow-hidden">
        {/* Glow accent in background */}
        <div className="absolute top-0 right-0 w-96 h-48 bg-[#00D9FF]/5 blur-3xl pointer-events-none rounded-full" />

        {/* Section Title */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[10px] bg-[#00D9FF]/15 border border-[#00D9FF]/30 text-[#00D9FF] flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#F5F7FA] flex items-center gap-2">
                <span>System Specification Analysis</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-[6px] bg-[#00D9FF]/10 text-[#00D9FF] border border-[#00D9FF]/20 uppercase">
                  {systemAnalysis.tierSummary}
                </span>
              </h2>
              <p className="text-xs text-[#A2AAB8]">
                Real-time hardware inspection calibrated to neural speech weights and compute bounds.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className="text-[#A2AAB8]">Acceleration:</span>
            <span className={hardware.cudaAvailable ? 'text-[#32D583] font-semibold' : 'text-[#00D9FF]'}>
              {hardware.cudaAvailable ? 'CUDA Hardware Direct' : 'High-Performance CPU Vector Engine'}
            </span>
          </div>
        </div>

        {/* Hardware Specs Readout Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* GPU Spec */}
          <div className="p-3 rounded-[16px] bg-[#181D27] border border-white/[0.06] space-y-1">
            <span className="text-[10px] font-mono text-[#6F7888] uppercase block">Graphics Processor</span>
            <span className="text-xs font-semibold text-[#F5F7FA] truncate block" title={hardware.gpuName}>
              {hardware.gpuName.replace('NVIDIA GeForce ', '').replace(' (Auto-Detected)', '')}
            </span>
            <div className="flex items-center justify-between text-[11px] font-mono pt-1 text-[#A2AAB8]">
              <span>VRAM:</span>
              <span className="text-[#00D9FF] font-medium">{hardware.vramGB.toFixed(1)} GB Dedicated</span>
            </div>
          </div>

          {/* CPU Spec */}
          <div className="p-3 rounded-[16px] bg-[#181D27] border border-white/[0.06] space-y-1">
            <span className="text-[10px] font-mono text-[#6F7888] uppercase block">Central Processor</span>
            <span className="text-xs font-semibold text-[#F5F7FA] truncate block" title={hardware.cpuName}>
              {hardware.cpuName.split('@')[0]}
            </span>
            <div className="flex items-center justify-between text-[11px] font-mono pt-1 text-[#A2AAB8]">
              <span>Cores / Threads:</span>
              <span className="text-[#32D583] font-medium">{hardware.cpuCores} Threads</span>
            </div>
          </div>

          {/* System Memory */}
          <div className="p-3 rounded-[16px] bg-[#181D27] border border-white/[0.06] space-y-1">
            <span className="text-[10px] font-mono text-[#6F7888] uppercase block">System Memory (RAM)</span>
            <span className="text-xs font-semibold text-[#F5F7FA] block">
              {hardware.ramGB} GB Host RAM
            </span>
            <div className="flex items-center justify-between text-[11px] font-mono pt-1 text-[#A2AAB8]">
              <span>Available Headroom:</span>
              <span className="text-[#32D583] font-medium">{(hardware.ramGB - hardware.ramUsedGB).toFixed(1)} GB Free</span>
            </div>
          </div>

          {/* Hardware Capability Tier */}
          <div className="p-3 rounded-[16px] bg-[#181D27] border border-white/[0.06] space-y-1">
            <span className="text-[10px] font-mono text-[#6F7888] uppercase block">System Class</span>
            <span className="text-xs font-semibold text-[#00D9FF] block">
              Tier {hardware.tier} of 5 Workstation
            </span>
            <div className="flex items-center justify-between text-[11px] font-mono pt-1 text-[#A2AAB8]">
              <span>Max Latency Target:</span>
              <span className="text-[#F5F7FA] font-medium">&lt; 150ms First Token</span>
            </div>
          </div>
        </div>

        {/* Top Recommendation Banner for the System */}
        {topRecModel && (
          <div className="p-4 rounded-[18px] bg-gradient-to-r from-[#00D9FF]/10 via-[#181D27] to-[#FF3CAC]/10 border border-[#00D9FF]/30 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-[12px] bg-[#00D9FF] text-[#080A0F] flex items-center justify-center font-bold shadow-[0_0_16px_rgba(0,217,255,0.4)]">
                <Sparkles className="w-5 h-5 fill-current" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#F5F7FA]">
                    Recommended Architecture for Your Rig:
                  </span>
                  <span className="text-xs font-bold text-[#00D9FF] underline">
                    {topRecModel.name} ({topRecModel.parameterSize})
                  </span>
                  {activeModelId === topRecModel.id && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-[6px] bg-[#32D583]/20 text-[#32D583] border border-[#32D583]/30">
                      CURRENTLY ACTIVE
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#A2AAB8] mt-0.5">
                  {systemAnalysis.modelEvaluations[topRecModel.id]?.details || topRecModel.description}
                </p>
                <div className="flex items-center gap-3 text-[10px] font-mono text-[#A2AAB8] mt-1.5">
                  <span className="text-[#32D583]">
                    ⚡ {systemAnalysis.modelEvaluations[topRecModel.id]?.realtimeFactor}
                  </span>
                  <span className="text-white/20">·</span>
                  <span>Requires {topRecModel.recommendedVRAM} GB VRAM / {topRecModel.recommendedRAM} GB RAM</span>
                  <span className="text-white/20">·</span>
                  <span className="text-[#00D9FF]">{systemAnalysis.modelEvaluations[topRecModel.id]?.primaryReason}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {activeModelId !== topRecModel.id ? (
                <button
                  onClick={() => {
                    if (!topRecModel.isInstalled) {
                      handleInstall(topRecModel.id);
                    } else {
                      handleLoad(topRecModel.id);
                    }
                  }}
                  className="px-4 py-2 rounded-[12px] bg-[#00D9FF] hover:bg-[#22E7FF] text-[#080A0F] font-semibold text-xs transition-all shadow-[0_2px_14px_rgba(0,217,255,0.3)] flex items-center gap-1.5"
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>
                    {!topRecModel.isInstalled ? 'Install Recommended Model' : 'Switch & Load Recommended'}
                  </span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-[#32D583] font-mono bg-[#32D583]/10 px-3 py-1.5 rounded-[10px] border border-[#32D583]/20">
                  <Check className="w-3.5 h-3.5" />
                  <span>System Optimal Model Loaded</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Search Bar & Category Filters */}
      <div className="space-y-3">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6F7888]" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search models by name, architecture, language, or capability..."
            className="w-full text-xs pl-10 pr-4 py-2.5 rounded-[16px] bg-[#11151D] border border-white/[0.08] text-[#F5F7FA] placeholder-[#6F7888] focus:outline-none focus:border-[#00D9FF] transition-colors shadow-sm"
          />
        </div>

        {/* Scrollable Categories List */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 no-scrollbar">
          {CATEGORIES.map(cat => {
            const count = cat.id === 'all' 
              ? models.length 
              : cat.id === 'installed'
                ? models.filter(m => m.isInstalled).length
                : models.filter(m => m.categories?.includes(cat.id)).length;

            const isSelected = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3 py-1.5 text-xs rounded-[12px] whitespace-nowrap transition-all border ${
                  isSelected
                    ? 'bg-[#181D27] text-[#00D9FF] border-[#00D9FF]/30 font-medium shadow-sm'
                    : 'bg-[#11151D] text-[#A2AAB8] border-white/[0.06] hover:text-[#F5F7FA] hover:bg-[#181D27]'
                }`}
              >
                {cat.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Models Grid (24px Apple container cards) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredModels.map(model => {
          const isSelected = model.id === activeModelId;
          const suitability = getHardwareSuitability(model);

          return (
            <div
              key={model.id}
              className={`rounded-[24px] bg-[#11151D] border p-6 space-y-4 transition-all relative overflow-hidden flex flex-col justify-between shadow-[0_4px_24px_rgba(0,0,0,0.18)] ${
                model.id === systemAnalysis.topRecommendedModelId
                  ? 'border-[#00D9FF]/60 ring-1 ring-[#00D9FF]/20 shadow-[0_0_30px_rgba(0,217,255,0.08)]'
                  : isSelected
                    ? 'border-[#00D9FF]/40 shadow-[0_0_24px_rgba(0,217,255,0.06)]'
                    : 'border-white/[0.08] hover:border-white/[0.14]'
              }`}
            >
              <div className="space-y-3.5">
                {/* System Recommendation Top Ribbon */}
                {model.id === systemAnalysis.topRecommendedModelId && (
                  <div className="flex items-center justify-between px-3 py-1.5 rounded-[12px] bg-[#00D9FF]/15 border border-[#00D9FF]/30 text-[11px] font-mono text-[#00D9FF]">
                    <span className="flex items-center gap-1.5 font-bold">
                      <Sparkles className="w-3.5 h-3.5 fill-current" />
                      <span>RECOMMENDED FOR YOUR SYSTEM</span>
                    </span>
                    <span className="text-[#32D583] font-semibold">{suitability.rtf}</span>
                  </div>
                )}

                {/* Header Row */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-[#F5F7FA] tracking-tight">
                        {model.name}
                      </h2>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-white/[0.05] text-[#00D9FF] border border-white/[0.04]">
                        {model.parameterSize}
                      </span>
                      {isSelected && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-[#00D9FF]/15 text-[#00D9FF] border border-[#00D9FF]/30">
                          ACTIVE IN STUDIO
                        </span>
                      )}
                      {model.installSource === 'demo' && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-[#FFB547]/15 text-[#FFB547] border border-[#FFB547]/30">
                          DEMO (NO DISK WEIGHTS)
                        </span>
                      )}
                      {model.isInstalled && model.diskVerified && model.installSource === 'disk' && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-[#32D583]/15 text-[#32D583] border border-[#32D583]/30">
                          VERIFIED ON DISK
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-[#6F7888] mt-1 font-mono">
                      <span>repo: {model.repo}</span>
                    </div>
                  </div>

                  <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded-[8px] border ${suitability.color}`}>
                    {suitability.status}
                  </span>
                </div>

                <p className="text-xs text-[#A2AAB8] leading-relaxed">
                  {model.description}
                </p>

                {/* Hardware Match Reason */}
                <div className="p-2.5 rounded-[12px] bg-[#080A0F] border border-white/[0.04] text-[11px] text-[#A2AAB8] flex items-center justify-between font-mono">
                  <span className="truncate pr-2">💡 {suitability.msg}</span>
                  <span className="text-[#32D583] shrink-0 font-bold">{suitability.rtf}</span>
                </div>

                {/* Model Capability Badges (TTS, Voice Clone, Multilingual, CPU, CUDA) */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-[#181D27] text-[#00D9FF] border border-[#00D9FF]/20">
                    TTS ✓
                  </span>
                  {model.capabilities.referenceVoice && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-[#181D27] text-[#FF3CAC] border border-[#FF3CAC]/25">
                      Voice Clone ✓
                    </span>
                  )}
                  {model.capabilities.voiceDesign && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-[#181D27] text-[#00D9FF] border border-[#00D9FF]/20">
                      Voice Design ✓
                    </span>
                  )}
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-[#181D27] text-[#F5F7FA] border border-white/[0.06]">
                    {model.languages.length} Languages
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-[#181D27] text-[#32D583] border border-[#32D583]/20">
                    CPU ✓ · CUDA ✓
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-[8px] bg-[#181D27] text-[#A2AAB8] border border-white/[0.06]">
                    License: {model.license}
                  </span>
                </div>

                {/* Hardware Requirements Metric Row */}
                <div className="grid grid-cols-3 gap-2 p-3 rounded-[16px] bg-[#080A0F] border border-white/[0.04] text-[11px] font-mono text-[#A2AAB8]">
                  <div>
                    <span className="text-[#6F7888] block text-[10px]">
                      {model.isInstalled && model.installedBytes ? 'On disk:' : 'Download:'}
                    </span>
                    <span className="text-[#F5F7FA]">
                      {model.isInstalled && model.installedBytes
                        ? formatBytes(model.installedBytes)
                        : model.downloadSize}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#6F7888] block text-[10px]">Rec. VRAM:</span>
                    <span className="text-[#00D9FF]">{model.recommendedVRAM} GB</span>
                  </div>
                  <div>
                    <span className="text-[#6F7888] block text-[10px]">Rec. RAM:</span>
                    <span className="text-[#32D583]">{model.recommendedRAM} GB</span>
                  </div>
                </div>

                {/* Download Progress Card: downloading or paused (resume keeps partial files) */}
                {(model.isDownloading || model.isPaused) && (
                  <div className="p-3.5 rounded-[16px] bg-[#181D27] border border-[#00D9FF]/30 space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-[#00D9FF] font-semibold">
                        {model.isPaused && !model.isDownloading
                          ? `Paused at ${model.downloadProgress ?? 0}% — resume to continue`
                          : `Downloading ${model.downloadProgress ?? 0}%`}
                      </span>
                      <span className="text-[#A2AAB8]">
                        {model.downloadedMB} / {model.totalMB} MB ({model.downloadSpeed || '--'}{model.downloadEta ? ` - ${model.downloadEta}` : ''}){model.downloadVerifying ? ' - verifying...' : ''}
                      </span>
                    </div>
                    <div className="w-full bg-[#080A0F] h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-[#00D9FF] h-full transition-all duration-300 rounded-full"
                        style={{ width: `${model.downloadProgress ?? 0}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center gap-3 text-[10px] text-[#A2AAB8] font-mono">
                      <span className="truncate">
                        {model.currentFile
                          ? `${model.downloadFileIndex || 1}/${model.downloadFileCount || 1} - ${model.currentFile}`
                          : ModelRegistry.getInstance().getStoragePath() || 'Storage directory'}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {model.isDownloading ? (
                          <button
                            onClick={() => handlePauseDownload(model.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-[#FFB547]/15 border border-[#FFB547]/30 text-[#FFB547] hover:bg-[#FFB547]/25 transition-colors"
                          >
                            <Pause className="w-3 h-3" />
                            Pause
                          </button>
                        ) : (
                          model.isPaused && (
                            <button
                              onClick={() => handleResumeDownload(model.id)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-[#32D583]/15 border border-[#32D583]/30 text-[#32D583] hover:bg-[#32D583]/25 transition-colors"
                            >
                              <Play className="w-3 h-3" />
                              Resume
                            </button>
                          )
                        )}
                        <button
                          onClick={() => handleCancelDownload(model.id)}
                          className="text-[#FF5C70] hover:underline shrink-0"
                        >
                          Cancel
                        </button>
                      </span>
                    </div>
                  </div>
                )}

                {model.downloadError && (
                  <div className="flex items-start gap-2 p-3 rounded-[14px] bg-[#FF5C70]/10 border border-[#FF5C70]/25 text-[11px] text-[#FFB0BB]">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{model.needsRepair ? model.downloadError : `Download failed: ${model.downloadError}`}</span>
                  </div>
                )}

                {model.loadError && (
                  <div className="flex items-start gap-2 p-3 rounded-[14px] bg-[#FFB547]/10 border border-[#FFB547]/25 text-[11px] text-[#FFD9A0]">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{model.loadError}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-white/[0.06] mt-4">
                <a
                  href={model.hfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs text-[#A2AAB8] hover:text-[#00D9FF] transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Hugging Face Repo</span>
                </a>

                <div className="flex items-center gap-2">
                  {model.isInstalled && !isSpeechModel(model) ? (
                    <span className="px-3 py-1.5 text-xs font-medium text-[#32D583] bg-[#32D583]/10 border border-[#32D583]/25 rounded-[10px]">Ready - used by Dubbing</span>
                  ) : model.isInstalled ? (
                    <>
                      {model.isLoaded ? (
                        <button
                          onClick={() => handleUnload(model.id)}
                          className="px-3 py-1.5 text-xs font-medium text-[#A2AAB8] hover:text-[#F5F7FA] bg-[#181D27] border border-white/[0.08] rounded-[10px] transition-colors"
                        >
                          Unload VRAM
                        </button>
                      ) : (
                        <button
                          onClick={() => handleLoad(model.id)}
                          className="px-3 py-1.5 text-xs font-medium text-[#00D9FF] hover:text-white bg-[#181D27] border border-[#00D9FF]/20 rounded-[10px] transition-colors"
                        >
                          Load Model
                        </button>
                      )}

                      {!isSelected && (
                        <button
                          onClick={() => onSelectModel(model.id)}
                          className="px-3.5 py-1.5 text-xs font-semibold text-[#080A0F] bg-[#00D9FF] hover:bg-[#22E7FF] rounded-[10px] transition-all shadow-[0_2px_10px_rgba(0,217,255,0.25)]"
                        >
                          Use in Studio
                        </button>
                      )}

                      <button
                        onClick={() => handleVerify(model.id)}
                        className="p-1.5 text-[#6F7888] hover:text-[#00D9FF] transition-colors"
                        title="Re-verify files on disk"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                      </button>

                      {model.installSource === 'disk' && (
                        <button
                          onClick={() => handleLocateModel(model.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#A2AAB8] hover:text-[#F5F7FA] bg-[#181D27] border border-white/[0.08] rounded-[10px] transition-colors"
                          title="Open model folder in file explorer"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          Locate Files
                        </button>
                      )}

                      <button
                        onClick={() => handleUninstall(model.id)}
                        className="p-1.5 text-[#6F7888] hover:text-[#FF5C70] transition-colors"
                        title="Uninstall model"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleInstall(model.id)}
                      disabled={model.isDownloading}
                      className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-[#080A0F] bg-[#00D9FF] hover:bg-[#22E7FF] rounded-[10px] transition-all shadow-[0_2px_10px_rgba(0,217,255,0.25)] disabled:opacity-40"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Install ({model.downloadSize})</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredModels.length === 0 && (
        <div className="p-12 text-center rounded-[24px] bg-[#11151D] border border-white/[0.06] space-y-2">
          <p className="text-sm font-medium text-[#F5F7FA]">No models match your query</p>
          <p className="text-xs text-[#A2AAB8]">Try clearing the search filter or choosing another category.</p>
        </div>
      )}

      <AddLocalModelModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onModelAdded={newModel => {
          onSelectModel(newModel.id);
        }}
      />
    </div>
  );
};
