import React from 'react';
import { TtsErrorCode, TtsSetupInfo, DesktopBridge } from '../services/desktopBridge';
import { RuntimeInstaller } from './RuntimeInstaller';

interface Props {
  code: TtsErrorCode;
  message: string;
  setup?: TtsSetupInfo;
  adapter: string;
  onRetry: () => void;
  /** Re-downloads only the missing model files. */
  onRepair?: () => void;
}

/** Shown when the speech engine cannot start. Offers a one-click, resumable install. */
export const TtsSetupPanel: React.FC<Props> = ({ code, message, adapter, onRetry, onRepair }) => {
  if (code === 'model-incomplete') {
    return (
      <div className="rounded-[16px] border border-[#FFB547]/30 bg-[#FFB547]/[0.06] p-4 space-y-3 text-xs text-[#F5F7FA]">
        <div className="font-semibold text-sm">The downloaded model is incomplete</div>
        <pre className="whitespace-pre-wrap text-[11px] text-[#A2AAB8] max-h-28 overflow-auto">{message}</pre>
        <div className="text-[#A2AAB8]">Some files were never fully downloaded (for example the download was interrupted). Repair downloads only the missing files; everything already on disk is kept.</div>
        <div className="flex gap-2">
          {onRepair && <button onClick={onRepair} className="px-3 py-1.5 rounded-[10px] bg-[#00D9FF] text-black font-semibold">Repair model files</button>}
          <button onClick={onRetry} className="px-3 py-1.5 rounded-[10px] bg-[#181D27] border border-white/[0.08]">Retry</button>
        </div>
      </div>
    );
  }

  const title =
    code === 'python-missing' || code === 'deps-missing'
      ? 'This voice engine needs to be set up once'
      : code === 'timeout'
      ? 'The speech engine took too long to start'
      : 'The speech engine could not start';

  return (
    <div className="rounded-[16px] border border-[#FFB547]/30 bg-[#FFB547]/[0.06] p-4 space-y-3 text-xs text-[#F5F7FA]">
      <div className="font-semibold text-sm">{title}</div>
      <pre className="whitespace-pre-wrap text-[11px] text-[#A2AAB8] max-h-28 overflow-auto">{message}</pre>
      <RuntimeInstaller adapter={adapter} onDone={onRetry} />
      <div className="flex gap-2">
        <button onClick={() => DesktopBridge.openBackendFolder()} className="px-3 py-1.5 rounded-[10px] bg-[#181D27] border border-white/[0.08]">Open backend folder</button>
        <button onClick={onRetry} className="px-3 py-1.5 rounded-[10px] bg-[#181D27] border border-white/[0.08]">Retry</button>
      </div>
    </div>
  );
};
