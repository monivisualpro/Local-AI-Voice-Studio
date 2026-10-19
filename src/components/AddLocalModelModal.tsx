import React, { useEffect, useState } from 'react';
import { X, FolderOpen, CheckCircle2, AlertTriangle, FolderSearch, HardDrive } from 'lucide-react';
import { ModelRegistry } from '../services/modelRegistry';
import { DesktopBridge, formatBytes, type LocalFolderInspection } from '../services/desktopBridge';
import { TTSModel } from '../types/tts';

interface AddLocalModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onModelAdded: (model: TTSModel) => void;
}

export const AddLocalModelModal: React.FC<AddLocalModelModalProps> = ({
  isOpen,
  onClose,
  onModelAdded,
}) => {
  const [folderPath, setFolderPath] = useState('');
  const [modelName, setModelName] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [inspection, setInspection] = useState<LocalFolderInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const desktopAvailable = DesktopBridge.available;

  useEffect(() => {
    if (!isOpen) {
      setInspection(null);
      setError(null);
      setIsScanning(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const folderName = (target: string) => {
    const cleaned = target.replace(/[\\/]+$/, '');
    const parts = cleaned.split(/[\\/]/);
    return parts[parts.length - 1] || cleaned;
  };

  /** Real inspection performed in the Electron main process. */
  const runInspection = async (target: string) => {
    const path = target.trim();
    setInspection(null);
    setError(null);

    if (!path) {
      setError('Choose or enter the model folder first.');
      return;
    }
    if (!desktopAvailable) {
      setError('Folder inspection requires the desktop application - a browser tab cannot read local files.');
      return;
    }

    setIsScanning(true);
    try {
      const result = await DesktopBridge.inspectFolder(path);
      if (!result) {
        setError('The folder could not be inspected. Check that the path exists and is readable.');
        return;
      }
      setInspection(result);
      if (!modelName.trim()) {
        setModelName(folderName(result.path || path));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const handleBrowse = async () => {
    setError(null);
    const picked = await DesktopBridge.pickModelFolder();
    if (!picked) return;
    setFolderPath(picked);
    await runInspection(picked);
  };

  const handleInspect = async () => {
    await runInspection(folderPath);
  };

  const handleAddModel = () => {
    if (!inspection || !inspection.valid) return;

    const registry = ModelRegistry.getInstance();
    const adapter = (inspection.adapter || 'generic') as TTSModel['adapter'];

    const added = registry.addCustomLocalModel({
      name: modelName.trim() || folderName(inspection.path),
      folderPath: inspection.path,
      adapter,
      parameterSize: inspection.parameterSizeLabel || 'unknown',
      // Languages cannot be derived from the weight files - they are declared by
      // the adapter profile later, so nothing is invented here.
      languages: [],
      capabilities: registry.getCapabilityProfileForAdapter(adapter),
      license: 'Local weights / user-provided',
      installedBytes: inspection.totalBytes,
      parameterCount: inspection.parameterCount,
      runtime: inspection.runtime,
      fileCount: inspection.fileCount,
      warnings: inspection.warnings,
    });

    onModelAdded(added);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-[20px]">
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-[24px] bg-[#11151D] border border-white/[0.08] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.4)] space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-[12px] bg-[#181D27] border border-[#00D9FF]/25 flex items-center justify-center text-[#00D9FF]">
              <FolderOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#F5F7FA]">Add Local Model</h2>
              <p className="text-xs text-[#A2AAB8]">
                {desktopAvailable
                  ? 'Reads the real folder from disk: config, weights, tokenizer'
                  : 'Desktop build required to read model folders'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[10px] text-[#6F7888] hover:text-[#F5F7FA] hover:bg-white/[0.05] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3.5">
          <div>
            <label className="text-xs font-medium text-[#A2AAB8] block mb-1">Model Name</label>
            <input
              type="text"
              value={modelName}
              onChange={e => setModelName(e.target.value)}
              placeholder="e.g. My fine-tuned Qwen3-TTS"
              className="w-full text-xs px-3.5 py-2.5 rounded-[16px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF] transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[#A2AAB8] block mb-1">Model Folder</label>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={folderPath}
                onChange={e => setFolderPath(e.target.value)}
                placeholder="D:\AI\Models\qwen3-tts-0.6b"
                className="flex-1 min-w-[220px] text-xs px-3.5 py-2.5 rounded-[16px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] font-mono focus:outline-none focus:border-[#00D9FF] transition-colors"
              />
              <button
                onClick={handleBrowse}
                disabled={!desktopAvailable || isScanning}
                className="flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-[#F5F7FA] bg-[#181D27] hover:bg-[#1D2430] border border-white/[0.08] rounded-[14px] transition-colors disabled:opacity-40"
              >
                <FolderSearch className="w-3.5 h-3.5 text-[#00D9FF]" />
                Browse
              </button>
              <button
                onClick={handleInspect}
                disabled={isScanning || !folderPath}
                className="px-4 py-2.5 text-xs font-semibold text-[#080A0F] bg-[#00D9FF] hover:bg-[#22E7FF] rounded-[14px] transition-all disabled:opacity-50 shadow-[0_2px_10px_rgba(0,217,255,0.25)]"
              >
                {isScanning ? 'Inspecting...' : 'Inspect Folder'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-[16px] bg-[#FF5C70]/10 border border-[#FF5C70]/30 text-xs text-[#FFB0BB]">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {inspection && (
          <div className="p-4 rounded-[18px] bg-[#181D27] border border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#F5F7FA] flex items-center gap-1.5">
                {inspection.valid ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-[#32D583]" />
                    Weights found on disk
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-[#FFB547]" />
                    No weight files in this folder
                  </>
                )}
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-[8px] border ${
                  inspection.valid
                    ? 'bg-[#32D583]/10 text-[#32D583] border-[#32D583]/20'
                    : 'bg-[#FFB547]/10 text-[#FFB547] border-[#FFB547]/20'
                }`}
              >
                {inspection.valid ? 'IMPORTABLE' : 'INVALID'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[#A2AAB8]">
              <div>
                <span className="text-[#6F7888] block text-[10px]">Adapter match:</span>
                <span className="text-[#00D9FF] font-medium">{inspection.adapter}</span>
              </div>
              <div>
                <span className="text-[#6F7888] block text-[10px]">Weight format:</span>
                <span className="text-[#F5F7FA] font-medium">{inspection.runtime}</span>
              </div>
              <div>
                <span className="text-[#6F7888] block text-[10px]">Parameters (read from headers):</span>
                <span className="text-[#F5F7FA] font-mono text-[11px]">
                  {inspection.parameterCount
                    ? `${inspection.parameterCount.toLocaleString()} (${inspection.parameterSizeLabel})`
                    : 'not readable'}
                </span>
              </div>
              <div>
                <span className="text-[#6F7888] block text-[10px]">Folder contents:</span>
                <span className="text-[#F5F7FA] font-mono text-[11px]">
                  {inspection.totalSizeLabel} / {inspection.fileCount} files
                </span>
              </div>
              <div>
                <span className="text-[#6F7888] block text-[10px]">config.json:</span>
                <span className={inspection.hasConfig ? 'text-[#32D583]' : 'text-[#FFB547]'}>
                  {inspection.hasConfig ? 'found' : 'missing'}
                </span>
              </div>
              <div>
                <span className="text-[#6F7888] block text-[10px]">Tokenizer:</span>
                <span className={inspection.hasTokenizer ? 'text-[#32D583]' : 'text-[#FFB547]'}>
                  {inspection.hasTokenizer ? 'found' : 'missing'}
                </span>
              </div>
            </div>

            {inspection.configSummary && (
              <div className="pt-2 border-t border-white/[0.06] text-[11px] font-mono text-[#A2AAB8] space-y-0.5">
                {inspection.configSummary.modelType && (
                  <div>
                    model_type: <span className="text-[#F5F7FA]">{inspection.configSummary.modelType}</span>
                  </div>
                )}
                {inspection.configSummary.hiddenSize != null && (
                  <div>
                    hidden_size: <span className="text-[#F5F7FA]">{inspection.configSummary.hiddenSize}</span>
                  </div>
                )}
                {inspection.configSummary.layers != null && (
                  <div>
                    layers: <span className="text-[#F5F7FA]">{inspection.configSummary.layers}</span>
                  </div>
                )}
                {inspection.configSummary.sampleRate != null && (
                  <div>
                    sample_rate: <span className="text-[#F5F7FA]">{inspection.configSummary.sampleRate}</span>
                  </div>
                )}
              </div>
            )}

            {inspection.weights.length > 0 && (
              <div className="pt-2 border-t border-white/[0.06] space-y-1">
                <span className="text-[#6F7888] block text-[10px]">
                  Weight files ({inspection.weightFileCount}):
                </span>
                <div className="max-h-24 overflow-y-auto space-y-0.5">
                  {inspection.weights.map(file => (
                    <div
                      key={file.relPath}
                      className="flex items-center justify-between gap-2 text-[10px] font-mono text-[#A2AAB8]"
                    >
                      <span className="truncate">{file.relPath}</span>
                      <span className="text-[#6F7888] shrink-0">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {inspection.warnings.length > 0 && (
              <div className="pt-2 border-t border-white/[0.06] space-y-1">
                {inspection.warnings.map((warning, index) => (
                  <div key={index} className="flex items-start gap-1.5 text-[10px] text-[#FFB547]">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!desktopAvailable && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-[16px] bg-[#FFB547]/10 border border-[#FFB547]/30 text-xs text-[#FFD9A0]">
            <HardDrive className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Reading model folders requires the desktop build. Open the packaged app
              (Local AI Voice Studio.exe) and import the folder there.
            </span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-[#A2AAB8] hover:text-[#F5F7FA] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAddModel}
            disabled={!inspection || !inspection.valid}
            className="px-4 py-2 text-xs font-semibold text-[#080A0F] bg-[#00D9FF] hover:bg-[#22E7FF] rounded-[14px] transition-all shadow-[0_2px_12px_rgba(0,217,255,0.25)] disabled:opacity-40"
          >
            Add Model to Registry
          </button>
        </div>
      </div>
    </div>
  );
};
