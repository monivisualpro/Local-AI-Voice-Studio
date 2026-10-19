import React from 'react';
import {
  Mic,
  Users,
  Clock,
  Settings,
  Activity,
  Layers,
  Sparkles,
  Trash2,
  Languages,
} from 'lucide-react';
import { HardwareInfo } from '../types/tts';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  hardware: HardwareInfo;
  loadedModelName: string;
  onClearMemory: () => void;
  theme?: 'dark' | 'light' | 'system';
  onToggleTheme?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  hardware,
  loadedModelName,
  onClearMemory,
  theme = 'dark',
  onToggleTheme,
}) => {
  const navItems = [
    { id: 'generate', label: 'Generate', icon: Mic, hint: 'Synthesis Studio' },
    { id: 'dubbing', label: 'Dubbing', icon: Languages, hint: 'Speech to Speech' },
    { id: 'voices', label: 'Voices', icon: Users, hint: 'Personas & Clones' },
    { id: 'models', label: 'Models', icon: Layers, hint: 'Hub & Adapters' },
    { id: 'history', label: 'History', icon: Clock, hint: 'Stems & Exports' },
  ];

  return (
    <aside className="w-64 border-r border-white/[0.08] bg-[#080A0F] flex flex-col justify-between p-4 shrink-0 select-none">
      <div className="space-y-6">
        {/* Brand header */}
        <div className="px-2 pt-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[10px] bg-[#11151D] border border-white/[0.08] flex items-center justify-center text-[#00D9FF] shadow-sm">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-[#F5F7FA]">
                Local AI Voice
              </div>
              <div className="text-[11px] text-[#6F7888]">Studio</div>
            </div>
          </div>
        </div>

        {/* Primary Navigation */}
        <nav className="space-y-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-[12px] text-xs font-medium transition-all group relative ${
                  isActive
                    ? 'bg-[#11151D] text-[#00D9FF] border border-[#00D9FF]/25 shadow-[0_2px_12px_rgba(0,217,255,0.06)]'
                    : 'text-[#A2AAB8] hover:text-[#F5F7FA] hover:bg-[#11151D]/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className={`w-4 h-4 transition-colors ${
                      isActive ? 'text-[#00D9FF]' : 'text-[#6F7888] group-hover:text-[#A2AAB8]'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>
                <span className="text-[10px] text-[#6F7888] group-hover:text-[#A2AAB8] transition-colors font-mono">
                  {item.hint}
                </span>

                {/* Subtle active indicator bar */}
                {isActive && (
                  <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-[#00D9FF] rounded-r shadow-[0_0_8px_rgba(0,217,255,0.5)]" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Area: Settings & Hardware Status */}
      <div className="space-y-3 pt-4 border-t border-white/[0.08]">
        {/* Settings button */}
        <button
          onClick={() => setActiveTab('settings')}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[12px] text-xs font-medium transition-colors ${
            activeTab === 'settings'
              ? 'bg-[#11151D] text-[#00D9FF] border border-[#00D9FF]/25'
              : 'text-[#A2AAB8] hover:text-[#F5F7FA] hover:bg-[#11151D]'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </button>

        {/* System & Hardware Telemetry Card */}
        <div className="p-3.5 rounded-[16px] bg-[#11151D] border border-white/[0.08] text-xs space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[#F5F7FA] flex items-center gap-1.5 text-xs">
              <Activity className="w-3.5 h-3.5 text-[#00D9FF]" />
              System Status
            </span>
            <button
              onClick={onClearMemory}
              title="Clear VRAM and cache buffers"
              className="text-[#6F7888] hover:text-[#FF5C70] transition-colors p-1"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-1.5 text-[11px] font-mono text-[#A2AAB8]">
            <div className="flex justify-between items-center">
              <span className="text-[#6F7888]">Compute:</span>
              <span className={`font-medium flex items-center gap-1 ${hardware.activeDevice === 'cuda' ? 'text-[#32D583]' : 'text-[#00D9FF]'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hardware.activeDevice === 'cuda' ? 'bg-[#32D583]' : 'bg-[#00D9FF]'}`} />
                {hardware.activeDevice === 'cuda' ? 'GPU Ready' : 'CPU Active'}
              </span>
            </div>

            <div className="flex justify-between items-center truncate">
              <span className="text-[#6F7888]">Loaded:</span>
              <span className="text-[#F5F7FA] truncate max-w-[120px]" title={loadedModelName}>
                {loadedModelName.split(' ')[0]} {loadedModelName.split(' ')[1] || ''}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-[#6F7888]">VRAM:</span>
              <span className="text-[#F5F7FA] tabular-nums">
                {hardware.vramUsedGB.toFixed(1)} / {hardware.vramGB.toFixed(0)} GB
              </span>
            </div>

            <div className="w-full bg-[#080A0F] h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-[#00D9FF] h-full transition-all duration-500 rounded-full"
                style={{
                  width: `${Math.min(100, Math.round((hardware.vramUsedGB / hardware.vramGB) * 100))}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Creator signature */}
        <div className="px-2 pt-1 pb-0.5 text-center">
          <div className="text-[10px] font-mono text-[#6F7888] flex items-center justify-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00D9FF]/70 shadow-[0_0_6px_rgba(0,217,255,0.6)]" />
            <span>Develop by <strong className="text-[#A2AAB8] font-semibold">Moni Visual Pro</strong></span>
          </div>
        </div>
      </div>
    </aside>
  );
};
