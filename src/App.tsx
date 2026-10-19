/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { HardwareInfo, TTSModel } from './types/tts';
import { HardwareDetector } from './services/hardwareDetector';
import { ModelRegistry } from './services/modelRegistry';
import { StorageService } from './services/storageService';
import { DesktopBridge } from './services/desktopBridge';
import { TopNavbar } from './components/TopNavbar';
import { Sidebar } from './components/Sidebar';
import { FirstRunModal } from './components/FirstRunModal';
import { GeneratePage } from './pages/GeneratePage';
import { ModelsPage } from './pages/ModelsPage';
import { VoicesPage } from './pages/VoicesPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { DubbingPage } from './pages/DubbingPage';
import { Mic, Users, Layers, Clock, Settings, Languages } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'generate' | 'dubbing' | 'voices' | 'models' | 'history' | 'settings'>('generate');
  const [modelsCategoryFilter, setModelsCategoryFilter] = useState<string>('all');
  const [hardware, setHardware] = useState<HardwareInfo>(HardwareDetector.getInstance().getHardwareInfo());
  const [models, setModels] = useState<TTSModel[]>(ModelRegistry.getInstance().getModels());
  const [activeModel, setActiveModel] = useState<TTSModel>(ModelRegistry.getInstance().getActiveModel());
  const [isFirstRunOpen, setIsFirstRunOpen] = useState(!StorageService.getInstance().getSettings().firstRunCompleted);
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(
    StorageService.getInstance().getSettings().theme || 'dark'
  );

  // Apply the saved idle-unload preference to the desktop speech engine on launch
  useEffect(() => {
    const saved = StorageService.getInstance().getSettings();
    const minutes = saved.idleUnloadMinutes ?? (saved.autoUnloadInactive ? 10 : 0);
    DesktopBridge.setTtsIdleMinutes(minutes);
  }, []);

  // Sync theme to document element and react to changes
  useEffect(() => {
    const applyTheme = (targetTheme: 'dark' | 'light' | 'system') => {
      const root = document.documentElement;
      let effective: 'dark' | 'light' = 'dark';

      if (targetTheme === 'system') {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        effective = prefersDark ? 'dark' : 'light';
      } else {
        effective = targetTheme;
      }

      if (effective === 'light') {
        root.classList.add('light');
        root.classList.remove('dark');
      } else {
        root.classList.add('dark');
        root.classList.remove('light');
      }
    };

    applyTheme(theme);

    if (theme === 'system' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [theme]);

  // Sync settings updates (including theme changes from Settings page)
  useEffect(() => {
    const unsub = StorageService.getInstance().subscribe(() => {
      const currentSettings = StorageService.getInstance().getSettings();
      if (currentSettings.theme && currentSettings.theme !== theme) {
        setTheme(currentSettings.theme);
      }
    });
    return unsub;
  }, [theme]);

  // Sync models and active model
  useEffect(() => {
    const unsub = ModelRegistry.getInstance().subscribe(() => {
      setModels(ModelRegistry.getInstance().getModels());
      setActiveModel(ModelRegistry.getInstance().getActiveModel());
    });
    return unsub;
  }, []);

  // Read the REAL model state from disk once on start-up. When the desktop
  // bridge is unavailable (browser preview) this is a no-op.
  useEffect(() => {
    let cancelled = false;
    const registry = ModelRegistry.getInstance();
    registry
      .syncWithDisk()
      .then(() => {
        if (cancelled) return;
        setModels(registry.getModels());
        setActiveModel(registry.getActiveModel());
        setHardware(HardwareDetector.getInstance().getHardwareInfo());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectModel = async (modelId: string) => {
    await ModelRegistry.getInstance().setActiveModel(modelId);
    setActiveTab('generate');
  };

  const handleClearMemory = () => {
    ModelRegistry.getInstance().clearGPUMemory();
    setHardware(HardwareDetector.getInstance().getHardwareInfo());
  };

  const handleNewProject = () => {
    setActiveTab('generate');
  };

  const handleSelectVoiceForStudio = (voiceId: string) => {
    setActiveTab('generate');
  };

  const handleLoadScriptToStudio = (script: string, voiceId?: string, modelId?: string) => {
    if (modelId) {
      void ModelRegistry.getInstance().setActiveModel(modelId);
    }
    setActiveTab('generate');
  };

  const handleDownloadRecommended = () => {
    const qwen = models.find(m => m.id === 'qwen3-tts-0.6b-base');
    if (qwen && !qwen.isInstalled) {
      // Real Hugging Face download to the configured storage directory.
      void ModelRegistry.getInstance().startDownload('qwen3-tts-0.6b-base');
    }
  };

  const handleNavigateToModels = (category?: string) => {
    if (category) {
      setModelsCategoryFilter(category);
    } else {
      setModelsCategoryFilter('all');
    }
    setActiveTab('models');
  };

  const handleSwitchToCpu = () => {
    const updated = HardwareDetector.getInstance().setComputeSetting('cpu');
    setHardware(updated);
    StorageService.getInstance().updateSettings({ computeDevice: 'cpu' });
  };

  const handleToggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    StorageService.getInstance().updateSettings({ theme: nextTheme });
  };

  return (
    <div className="min-h-screen bg-[#080A0F] text-[#F5F7FA] flex flex-col antialiased selection:bg-[#00D9FF]/20 selection:text-[#00D9FF]">
      {/* Top Navbar */}
      <TopNavbar
        activeTab={activeTab}
        setActiveTab={setActiveTab as any}
        hardware={hardware}
        onNewProject={handleNewProject}
        loadedModelName={activeModel.name}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      {/* Main Workspace: Sidebar + Content Viewport */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Sidebar (hidden on small mobile screens) */}
        <div className="hidden md:flex">
          <Sidebar
            activeTab={activeTab}
            setActiveTab={setActiveTab as any}
            hardware={hardware}
            loadedModelName={activeModel.name}
            onClearMemory={handleClearMemory}
            theme={theme}
            onToggleTheme={handleToggleTheme}
          />
        </div>

        {/* Dynamic Content Viewport */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-8 pb-20 md:pb-8 bg-gradient-to-b from-[#080A0F] via-[#0D1016] to-[#080A0F]">
          {activeTab === 'generate' && (
            <GeneratePage
              activeModel={activeModel}
              hardware={hardware}
              onNavigateToModels={handleNavigateToModels}
              onNavigateToVoices={() => setActiveTab('voices')}
              onSwitchToCpu={handleSwitchToCpu}
            />
          )}

          {activeTab === 'models' && (
            <ModelsPage
              hardware={hardware}
              activeModelId={activeModel.id}
              onSelectModel={handleSelectModel}
              initialCategory={modelsCategoryFilter}
            />
          )}

          {activeTab === 'dubbing' && (
            <DubbingPage onNavigateToModels={handleNavigateToModels} />
          )}

          {activeTab === 'voices' && (
            <VoicesPage
              onSelectVoiceForStudio={handleSelectVoiceForStudio}
            />
          )}

          {activeTab === 'history' && (
            <HistoryPage
              onLoadScriptToStudio={handleLoadScriptToStudio}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsPage
              hardware={hardware}
              onHardwareChange={setHardware}
              onThemeChange={setTheme}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (Visible on mobile/tablet screens < 768px) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#080A0F]/95 backdrop-blur-xl border-t border-white/[0.08] flex items-center justify-around px-2 z-40">
        {[
          { id: 'generate', label: 'Studio', icon: Mic },
          { id: 'dubbing', label: 'Dubbing', icon: Languages },
          { id: 'voices', label: 'Voices', icon: Users },
          { id: 'models', label: 'Models', icon: Layers },
          { id: 'history', label: 'History', icon: Clock },
          { id: 'settings', label: 'Settings', icon: Settings },
        ].map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
                isActive ? 'text-[#00D9FF]' : 'text-[#6F7888] hover:text-[#A2AAB8]'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium mt-1">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* First-Run Experience Modal */}
      <FirstRunModal
        isOpen={isFirstRunOpen}
        onClose={() => setIsFirstRunOpen(false)}
        hardware={hardware}
        onDownloadRecommended={handleDownloadRecommended}
      />
    </div>
  );
}
