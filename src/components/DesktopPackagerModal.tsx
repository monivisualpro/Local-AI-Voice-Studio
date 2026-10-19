import React, { useState } from 'react';
import {
  X,
  Laptop,
  Check,
  Copy,
  Terminal,
  FileCode,
  Package,
  Layers,
  Cpu,
  HelpCircle,
  Download,
  CheckCircle2,
  FolderArchive,
  ArrowRight,
} from 'lucide-react';

interface DesktopPackagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DesktopPackagerModal: React.FC<DesktopPackagerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'quick' | 'inno' | 'nodemodules' | 'config' | 'python' | 'faq'>('inno');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const QUICK_STEPS = [
    {
      step: '1',
      title: 'Install Electron & Builder dependencies',
      desc: 'Add electron and electron-builder as developer dependencies to your project.',
      code: 'npm install -D electron electron-builder concurrently wait-on',
    },
    {
      step: '2',
      title: 'Build the Web Assets (Vite)',
      desc: 'Compiles your React, TypeScript, and Tailwind code into an optimized dist/ folder.',
      code: 'npm run build',
    },
    {
      step: '3',
      title: 'Package into Windows .EXE',
      desc: 'Runs Electron Builder to generate both a Setup installer and a standalone Portable .exe in release/',
      code: 'npx electron-builder --win --config electron-builder.json',
    },
  ];

  const PACKAGE_JSON_SNIPPET = `{
  "main": "electron/main.cjs",
  "scripts": {
    "dev": "vite --port=3000 --host=0.0.0.0",
    "build": "vite build",
    "electron:dev": "concurrently \\"npm run dev\\" \\"wait-on http://127.0.0.1:3000 && electron .\\"",
    "electron:build": "npm run build && electron-builder --win --config electron-builder.json"
  }
}`;

  const MAIN_CJS_SNIPPET = `// electron/main.cjs
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Local AI Voice Studio',
    backgroundColor: '#080A0F',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      experimentalFeatures: true, // Enables WebGPU and high-performance neural audio
    },
    autoHideMenuBar: true,
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://127.0.0.1:3000');
  } else {
    // Loads compiled Vite files
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});`;

  const BUILDER_CONFIG_SNIPPET = `{
  "appId": "com.localaivoicestudio.app",
  "productName": "Local AI Voice Studio",
  "directories": {
    "output": "release"
  },
  "files": [
    "dist/**/*",
    "electron/**/*",
    "package.json"
  ],
  "win": {
    "target": ["nsis", "portable"],
    "icon": "public/icon.png"
  }
}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150">
      <div
        className="w-full max-w-4xl bg-[#11151D] border border-white/[0.1] rounded-[24px] shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-6 border-b border-white/[0.08] flex items-center justify-between bg-[#080A0F]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] bg-[#00D9FF]/10 border border-[#00D9FF]/30 flex items-center justify-center text-[#00D9FF]">
              <Laptop className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#F5F7FA] flex items-center gap-2">
                Desktop .EXE Packaging Guide
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#32D583]/10 text-[#32D583] border border-[#32D583]/30">
                  Ready to Build
                </span>
              </h2>
              <p className="text-xs text-[#A2AAB8] mt-0.5">
                Convert this React + Vite workstation into a standalone Windows executable (.exe)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-[10px] bg-white/[0.05] hover:bg-white/[0.1] text-[#A2AAB8] hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-white/[0.06] bg-[#0D1017] px-6 gap-2 text-xs overflow-x-auto">
          {[
            { id: 'inno', label: 'Inno Setup (.iss) Builder', icon: Download },
            { id: 'quick', label: 'Quick Build (Electron)', icon: Terminal },
            { id: 'nodemodules', label: 'Node Modules Explained', icon: Package },
            { id: 'config', label: 'Electron Config Files', icon: FileCode },
            { id: 'python', label: 'Local TTS Engine', icon: Cpu },
            { id: 'faq', label: 'Windows .EXE FAQs', icon: HelpCircle },
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3 px-3 flex items-center gap-2 border-b-2 font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-[#00D9FF] text-[#00D9FF] bg-[#11151D]'
                    : 'border-transparent text-[#A2AAB8] hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {/* TAB: Inno Setup */}
          {activeTab === 'inno' && (
            <div className="space-y-5">
              <div className="p-4 rounded-[16px] bg-[#00D9FF]/10 border border-[#00D9FF]/20 text-[#F5F7FA]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-sm text-[#00D9FF]">
                    <CheckCircle2 className="w-4 h-4" />
                    Inno Setup Script (installer.iss) Ready!
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#00D9FF]/20 text-[#00D9FF] border border-[#00D9FF]/30">
                    Build by Moni Visual Pro
                  </span>
                </div>
                <p className="text-[11px] text-[#A2AAB8] mt-1.5 leading-relaxed">
                  We generated the complete <code className="text-[#00D9FF]">installer.iss</code> script and a 1-click batch builder <code className="text-[#00D9FF]">build-inno-installer.bat</code> for your setup. Since you have Node.js and Inno Setup 6 installed on your Windows PC, you can compile the production setup installer with either method below.
                </p>
              </div>

              {/* Method 1: 1-Click Batch */}
              <div className="p-4 rounded-[18px] bg-[#080A0F] border border-white/[0.06] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-xs text-[#F5F7FA] flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#00D9FF]/20 text-[#00D9FF] flex items-center justify-center font-bold text-[11px]">A</span>
                      Method A: Run the 1-Click Inno Batch Builder
                    </h3>
                    <p className="text-[11px] text-[#A2AAB8] mt-0.5">Automates npm build, packaging, and compiles <code className="text-white">installer.iss</code> with Inno Setup compiler (ISCC.exe).</p>
                  </div>
                  <button
                    onClick={() => handleCopy('build-inno-installer.bat', 'run-bat')}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-white/[0.06] hover:bg-white/[0.1] text-[#A2AAB8] hover:text-white transition-colors text-[11px]"
                  >
                    {copiedKey === 'run-bat' ? <Check className="w-3 h-3 text-[#32D583]" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'run-bat' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="p-2.5 rounded-[10px] bg-black/60 border border-white/[0.04] font-mono text-[11px] text-[#00D9FF] select-all">
                  build-inno-installer.bat
                </div>
              </div>

              {/* Method 2: GUI Compiler */}
              <div className="p-4 rounded-[18px] bg-[#080A0F] border border-white/[0.06] space-y-3">
                <div>
                  <h3 className="font-semibold text-xs text-[#F5F7FA] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#32D583]/20 text-[#32D583] flex items-center justify-center font-bold text-[11px]">B</span>
                    Method B: Compile via Inno Setup Compiler GUI
                  </h3>
                  <ol className="mt-2 space-y-2 text-[11px] text-[#A2AAB8] list-decimal list-inside leading-relaxed">
                    <li>Run <code className="text-[#00D9FF]">npm run build</code> in your project directory in terminal or Command Prompt.</li>
                    <li>Double-click <code className="text-white bg-black/40 px-1 py-0.5 rounded">installer.iss</code> in File Explorer (opens directly in Inno Setup Compiler).</li>
                    <li>Click <strong className="text-white">Build &gt; Compile</strong> or press <kbd className="px-1.5 py-0.5 bg-black/60 border border-white/20 rounded font-mono text-white">Ctrl + F9</kbd>.</li>
                    <li>Inno Setup will create <code className="text-[#32D583]">installer_output/Local_AI_Voice_Studio_Setup_v1.3.0.exe</code>.</li>
                  </ol>
                </div>
              </div>

              {/* Script Details */}
              <div className="p-4 rounded-[18px] bg-[#181D27] border border-white/[0.06] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-[#F5F7FA]">Included Inno Setup Script (installer.iss)</span>
                  <button
                    onClick={() => handleCopy('; Inno Setup Script (.iss)\n#define MyAppName "Local AI Voice Studio"\n#define MyAppPublisher "Moni Visual Pro"', 'copy-iss')}
                    className="text-[11px] text-[#00D9FF] hover:underline"
                  >
                    {copiedKey === 'copy-iss' ? 'Copied script header' : 'Copy ISS Header'}
                  </button>
                </div>
                <ul className="text-[11px] text-[#A2AAB8] space-y-1 font-mono">
                  <li>• Publisher: <strong className="text-[#F5F7FA]">Moni Visual Pro</strong></li>
                  <li>• Installer output: <code className="text-[#32D583]">installer_output/Local_AI_Voice_Studio_Setup_v1.3.0.exe</code></li>
                  <li>• Custom App Icon: <code className="text-[#00D9FF]">public/favicon.ico</code> / <code className="text-[#00D9FF]">public/favicon.svg</code></li>
                  <li>• Compression: <code className="text-white">lzma2/ultra64</code> (Ultra high compression ratio)</li>
                  <li>• Features: Desktop shortcut, Start menu group, clean Windows uninstaller</li>
                </ul>
              </div>
            </div>
          )}
          {/* TAB 1: Quick Steps */}
          {activeTab === 'quick' && (
            <div className="space-y-5">
              <div className="p-4 rounded-[16px] bg-[#00D9FF]/10 border border-[#00D9FF]/20 text-[#F5F7FA]">
                <div className="flex items-center gap-2 font-semibold text-sm text-[#00D9FF]">
                  <CheckCircle2 className="w-4 h-4" />
                  Files already created for you in this codebase!
                </div>
                <p className="text-[11px] text-[#A2AAB8] mt-1 leading-relaxed">
                  We have added <code className="text-[#00D9FF]">electron/main.cjs</code>,{' '}
                  <code className="text-[#00D9FF]">electron/preload.cjs</code>,{' '}
                  <code className="text-[#00D9FF]">electron-builder.json</code>, and{' '}
                  <code className="text-[#00D9FF]">build-windows-exe.bat</code> directly to your project.
                  On Windows, you can either run <code className="text-white bg-black/40 px-1 py-0.5 rounded">build-windows-exe.bat</code> or run the commands below.
                </p>
              </div>

              <div className="space-y-4">
                {QUICK_STEPS.map(s => (
                  <div key={s.step} className="p-4 rounded-[18px] bg-[#080A0F] border border-white/[0.06] space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-[#00D9FF]/20 text-[#00D9FF] flex items-center justify-center font-bold text-[11px]">
                          {s.step}
                        </span>
                        <span className="font-semibold text-[#F5F7FA] text-xs">{s.title}</span>
                      </div>
                      <button
                        onClick={() => handleCopy(s.code, `step-${s.step}`)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-white/[0.06] hover:bg-white/[0.1] text-[#A2AAB8] hover:text-white transition-colors text-[11px]"
                      >
                        {copiedKey === `step-${s.step}` ? (
                          <>
                            <Check className="w-3 h-3 text-[#32D583]" />
                            <span className="text-[#32D583]">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Command</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-[#A2AAB8]">{s.desc}</p>
                    <div className="p-2.5 rounded-[10px] bg-black/60 border border-white/[0.04] font-mono text-[11px] text-[#00D9FF] select-all">
                      {s.code}
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 rounded-[16px] bg-[#181D27] border border-white/[0.06] flex items-start justify-between gap-4">
                <div>
                  <h4 className="font-semibold text-xs text-[#F5F7FA]">Resulting Output Files</h4>
                  <p className="text-[11px] text-[#A2AAB8] mt-0.5">
                    After Step 3, check the <code className="text-[#00D9FF]">release/</code> folder:
                  </p>
                  <ul className="mt-2 space-y-1 text-[11px] font-mono text-[#32D583]">
                    <li>✓ release/Local AI Voice Studio Setup 1.0.0.exe (Standard Windows Installer)</li>
                    <li>✓ release/Local AI Voice Studio 1.0.0.exe (Portable single-file .exe)</li>
                  </ul>
                </div>
                <div className="shrink-0">
                  <div className="w-10 h-10 rounded-[12px] bg-[#32D583]/10 border border-[#32D583]/20 flex items-center justify-center text-[#32D583]">
                    <FolderArchive className="w-5 h-5" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Node Modules */}
          {activeTab === 'nodemodules' && (
            <div className="space-y-4">
              <div className="p-4 rounded-[18px] bg-[#080A0F] border border-white/[0.06] space-y-3">
                <h3 className="font-semibold text-sm text-[#F5F7FA] flex items-center gap-2">
                  <Package className="w-4 h-4 text-[#00D9FF]" />
                  How node_modules are handled in an .EXE
                </h3>
                <p className="text-[11px] text-[#A2AAB8] leading-relaxed">
                  A common misconception is thinking you must manually zip or drag the gigabytes of{' '}
                  <code className="text-[#00D9FF]">node_modules</code> alongside the executable. You do{' '}
                  <strong className="text-white">NOT</strong> need to do that! Here is how the modern bundling pipeline works:
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                  <div className="p-3.5 rounded-[14px] bg-[#11151D] border border-white/[0.06] space-y-1.5">
                    <span className="text-[10px] font-mono text-[#00D9FF] uppercase tracking-wider block">
                      Phase 1: Vite Build
                    </span>
                    <h4 className="font-medium text-xs text-[#F5F7FA]">Tree-shaking & Minification</h4>
                    <p className="text-[11px] text-[#A2AAB8] leading-relaxed">
                      When you run <code className="text-white">npm run build</code>, Vite reads your React/Lucide imports from node_modules, strips away all unused code, and bundles everything into lightweight static JS/CSS files inside <code className="text-[#00D9FF]">dist/</code> (usually just 1-3 MB).
                    </p>
                  </div>

                  <div className="p-3.5 rounded-[14px] bg-[#11151D] border border-white/[0.06] space-y-1.5">
                    <span className="text-[10px] font-mono text-[#32D583] uppercase tracking-wider block">
                      Phase 2: Electron Packaging
                    </span>
                    <h4 className="font-medium text-xs text-[#F5F7FA]">ASAR Virtual Archive</h4>
                    <p className="text-[11px] text-[#A2AAB8] leading-relaxed">
                      Electron Builder takes the <code className="text-[#00D9FF]">dist/</code> files and any production-only runtime packages and packs them into a single read-only encrypted file named <code className="text-[#32D583]">app.asar</code> inside your final <code className="text-[#32D583]">.exe</code>.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-[18px] bg-[#181D27] border border-white/[0.06] space-y-2">
                <h4 className="font-semibold text-xs text-[#F5F7FA]">What about native Node C++ modules?</h4>
                <p className="text-[11px] text-[#A2AAB8] leading-relaxed">
                  If you add native Node modules (such as <code className="text-[#00D9FF]">onnxruntime-node</code> or <code className="text-[#00D9FF]">node-web-audio-api</code>), electron-builder automatically compiles or downloads the matching Electron prebuilt binaries using <code className="text-white">electron-builder install-app-deps</code> during the build.
                </p>
                <div className="p-2.5 rounded-[10px] bg-black/40 font-mono text-[11px] text-[#00D9FF]">
                  npx electron-builder install-app-deps
                </div>
              </div>

              <div className="p-4 rounded-[18px] bg-[#32D583]/10 border border-[#32D583]/20 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-xs text-[#32D583]">Key Takeaway for Distribution:</span>
                  <p className="text-[11px] text-[#A2AAB8] mt-0.5">
                    Your end-users do <strong>not</strong> need Node.js, npm, or node_modules installed. The resulting <code className="text-white">.exe</code> runs 100% standalone on any 64-bit Windows PC!
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Config Files */}
          {activeTab === 'config' && (
            <div className="space-y-4">
              <p className="text-[11px] text-[#A2AAB8]">
                Review or copy the exact configuration files that power the Electron desktop environment:
              </p>

              {/* electron/main.cjs */}
              <div className="rounded-[16px] bg-[#080A0F] border border-white/[0.06] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-white/[0.04]">
                  <span className="font-mono text-[11px] text-[#00D9FF]">electron/main.cjs</span>
                  <button
                    onClick={() => handleCopy(MAIN_CJS_SNIPPET, 'main.cjs')}
                    className="flex items-center gap-1 text-[10px] text-[#A2AAB8] hover:text-white"
                  >
                    {copiedKey === 'main.cjs' ? <Check className="w-3 h-3 text-[#32D583]" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'main.cjs' ? 'Copied' : 'Copy File'}</span>
                  </button>
                </div>
                <pre className="p-4 font-mono text-[10px] text-[#A2AAB8] overflow-x-auto max-h-48 leading-relaxed">
                  {MAIN_CJS_SNIPPET}
                </pre>
              </div>

              {/* package.json snippet */}
              <div className="rounded-[16px] bg-[#080A0F] border border-white/[0.06] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-white/[0.04]">
                  <span className="font-mono text-[11px] text-[#00D9FF]">package.json (Scripts to add)</span>
                  <button
                    onClick={() => handleCopy(PACKAGE_JSON_SNIPPET, 'pkg.json')}
                    className="flex items-center gap-1 text-[10px] text-[#A2AAB8] hover:text-white"
                  >
                    {copiedKey === 'pkg.json' ? <Check className="w-3 h-3 text-[#32D583]" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'pkg.json' ? 'Copied' : 'Copy JSON'}</span>
                  </button>
                </div>
                <pre className="p-4 font-mono text-[10px] text-[#A2AAB8] overflow-x-auto max-h-40 leading-relaxed">
                  {PACKAGE_JSON_SNIPPET}
                </pre>
              </div>

              {/* electron-builder.json */}
              <div className="rounded-[16px] bg-[#080A0F] border border-white/[0.06] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-black/40 border-b border-white/[0.04]">
                  <span className="font-mono text-[11px] text-[#00D9FF]">electron-builder.json</span>
                  <button
                    onClick={() => handleCopy(BUILDER_CONFIG_SNIPPET, 'builder.json')}
                    className="flex items-center gap-1 text-[10px] text-[#A2AAB8] hover:text-white"
                  >
                    {copiedKey === 'builder.json' ? <Check className="w-3 h-3 text-[#32D583]" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'builder.json' ? 'Copied' : 'Copy Config'}</span>
                  </button>
                </div>
                <pre className="p-4 font-mono text-[10px] text-[#A2AAB8] overflow-x-auto max-h-40 leading-relaxed">
                  {BUILDER_CONFIG_SNIPPET}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 4: Python & TTS Backend */}
          {activeTab === 'python' && (
            <div className="space-y-4">
              <div className="p-4 rounded-[18px] bg-[#080A0F] border border-white/[0.06] space-y-2">
                <h3 className="font-semibold text-sm text-[#F5F7FA] flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#00D9FF]" />
                  Connecting Local Python / PyTorch TTS to the .EXE
                </h3>
                <p className="text-[11px] text-[#A2AAB8] leading-relaxed">
                  If you want to bundle neural open-weight engines (Kokoro 82M, Qwen3-TTS, Chatterbox, F5-TTS, XTTS-v2, Parler-TTS), you have two standard desktop architecture patterns:
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-4 rounded-[16px] bg-[#11151D] border border-white/[0.06] space-y-2">
                  <div className="text-[10px] font-mono text-[#00D9FF] uppercase tracking-wider">
                    Option A (Easiest & Most Flexible)
                  </div>
                  <h4 className="font-semibold text-xs text-[#F5F7FA]">Local REST / WebSocket Server</h4>
                  <p className="text-[11px] text-[#A2AAB8] leading-relaxed">
                    Run your Python TTS pipeline as a local server (e.g. FastAPI / Flask / Uvicorn on <code className="text-[#00D9FF]">http://127.0.0.1:8000</code>).
                    The .exe communicates over local loopback HTTP.
                  </p>
                  <ul className="text-[10px] text-[#A2AAB8] space-y-1 list-disc list-inside mt-2 font-mono">
                    <li>Zero latency (loopback is internal)</li>
                    <li>Direct access to CUDA / PyTorch / ONNX</li>
                    <li>Independent updates to models</li>
                  </ul>
                </div>

                <div className="p-4 rounded-[16px] bg-[#11151D] border border-white/[0.06] space-y-2">
                  <div className="text-[10px] font-mono text-[#32D583] uppercase tracking-wider">
                    Option B (Single All-in-One .EXE)
                  </div>
                  <h4 className="font-semibold text-xs text-[#F5F7FA]">Embedded Python via extraResources</h4>
                  <p className="text-[11px] text-[#A2AAB8] leading-relaxed">
                    Compile the Python backend using <code className="text-white">pyinstaller --onedir server.py</code> and add it into <code className="text-[#00D9FF]">electron-builder.json</code> under <code className="text-white">extraResources</code>:
                  </p>
                  <pre className="p-2 rounded-[8px] bg-black/50 text-[10px] text-[#32D583] font-mono">
{`"extraResources": [
  { "from": "python_dist/", "to": "backend" }
]`}
                  </pre>
                  <p className="text-[10px] text-[#A2AAB8] mt-1">
                    Electron's main process automatically spawns <code className="text-white">backend/server.exe</code> on app launch and terminates it on exit!
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: FAQs */}
          {activeTab === 'faq' && (
            <div className="space-y-3">
              {[
                {
                  q: 'Will users see a "Windows protected your PC" SmartScreen warning?',
                  a: 'Because your .exe is freshly compiled without a purchased EV Code Signing Certificate, Windows SmartScreen will show "Unknown Publisher". Users simply click "More info" -> "Run anyway". For official release, you can sign the .exe with a standard or EV certificate.',
                },
                {
                  q: 'How large will the resulting .exe file be?',
                  a: 'The base portable Electron .exe is approximately 70-95 MB (which includes the Chromium rendering engine and Node.js runtime). Your React TTS code adds only 1-2 MB.',
                },
                {
                  q: 'Can I build Windows .exe if I am developing on macOS or Linux?',
                  a: 'Yes! Electron Builder supports cross-compilation for Windows using Wine or Docker, or you can build directly on Windows / GitHub Actions CI with a single click.',
                },
                {
                  q: 'Does WebGPU and Web Audio work inside Electron?',
                  a: 'Yes! Electron 30+ includes full hardware WebGPU and multi-threaded Web Audio API. Our electron/main.cjs configuration includes experimentalFeatures enabled for top rendering speed.',
                },
              ].map((item, idx) => (
                <div key={idx} className="p-4 rounded-[16px] bg-[#080A0F] border border-white/[0.06] space-y-1">
                  <h4 className="font-semibold text-xs text-[#F5F7FA]">{item.q}</h4>
                  <p className="text-[11px] text-[#A2AAB8] leading-relaxed">{item.a}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-white/[0.08] bg-[#080A0F] flex items-center justify-between">
          <span className="text-[11px] font-mono text-[#6F7888]">
            Target: Windows x64 (NSIS Installer & Portable .exe)
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-[12px] bg-[#00D9FF] hover:bg-[#22E7FF] text-[#080A0F] text-xs font-semibold transition-all shadow-[0_2px_10px_rgba(0,217,255,0.25)]"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
