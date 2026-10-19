import React from 'react';
import { Volume2, Plus, Sun, Moon } from 'lucide-react';
import { HardwareInfo } from '../types/tts';

interface TopNavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  hardware: HardwareInfo;
  onNewProject: () => void;
  loadedModelName: string;
  theme?: 'dark' | 'light' | 'system';
  onToggleTheme?: () => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({
  activeTab,
  setActiveTab,
  hardware,
  onNewProject,
  loadedModelName,
  theme = 'dark',
  onToggleTheme,
}) => {
  return (
    <header className="h-14 border-b border-white/[0.08] bg-[#080A0F]/90 backdrop-blur-[20px] px-6 flex items-center justify-between z-30 shrink-0">
      {/* Zone 1: Single text element wordmark */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-[10px] bg-[#11151D] border border-white/[0.08] flex items-center justify-center text-[#00D9FF] shadow-sm">
          <Volume2 className="w-4 h-4" />
        </div>
        <button
          onClick={() => setActiveTab('generate')}
          className="text-left group flex items-center gap-2"
        >
          <span className="font-semibold text-sm tracking-tight text-[#F5F7FA] group-hover:text-white transition-colors">
            Local AI Voice Studio
          </span>
          <span className="text-[11px] text-[#6F7888] font-mono border-l border-white/[0.08] pl-2">
            v1.3.0
          </span>
        </button>
      </div>

      {/* Zone 2: 4-6 clean text navigation links */}
      <nav className="hidden md:flex items-center gap-7 text-xs font-medium">
        {[
          { id: 'generate', label: 'Generate' },
          { id: 'dubbing', label: 'Dubbing' },
          { id: 'voices', label: 'Voices' },
          { id: 'models', label: 'Model Library' },
          { id: 'history', label: 'History' },
          { id: 'settings', label: 'Settings' },
        ].map(item => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`transition-colors py-1.5 relative ${
                isActive
                  ? 'text-[#00D9FF] font-semibold'
                  : 'text-[#A2AAB8] hover:text-[#F5F7FA]'
              }`}
            >
              {item.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#00D9FF] rounded-full shadow-[0_0_8px_rgba(0,217,255,0.4)]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Actions, Theme & System indicators */}
      <div className="flex items-center gap-3">
        <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-[10px] bg-[#11151D] border border-white/[0.08] text-xs font-mono text-[#A2AAB8]">
          <span className={`w-1.5 h-1.5 rounded-full ${hardware.activeDevice === 'cuda' ? 'bg-[#32D583]' : 'bg-[#00D9FF]'}`} />
          <span>{hardware.activeDevice.toUpperCase()}</span>
          <span className="text-white/20">|</span>
          <span className="truncate max-w-[130px] text-[#F5F7FA]" title={loadedModelName}>
            {loadedModelName.split(' ')[0]} {loadedModelName.split(' ')[1] || ''}
          </span>
        </div>

        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] bg-[#11151D] hover:bg-[#181D27] border border-white/[0.08] text-[#A2AAB8] hover:text-[#F5F7FA] transition-all text-xs group"
            title={`Switch to ${theme === 'dark' ? 'Light / White' : 'Dark'} mode`}
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5 text-[#FFB547] transition-transform group-hover:rotate-45" />
                <span className="font-mono text-[11px] font-medium text-[#F5F7FA]">White</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-[#00D9FF] transition-transform group-hover:-rotate-12" />
                <span className="font-mono text-[11px] font-medium text-[#0F172A]">Dark</span>
              </>
            )}
          </button>
        )}

        <button
          onClick={onNewProject}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#F5F7FA] bg-[#181D27] hover:bg-[#1D2430] border border-white/[0.08] rounded-[10px] transition-colors whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5 text-[#00D9FF]" />
          <span>New Session</span>
        </button>
      </div>
    </header>
  );
};
