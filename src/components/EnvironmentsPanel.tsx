import React, { useCallback, useEffect, useState } from 'react';
import { DesktopBridge, RuntimeStatus } from '../services/desktopBridge';
import { formatBytes } from '../utils/format';

/** Shows the shared environments: what is installed once, and which models use it. */
export const EnvironmentsPanel: React.FC = () => {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => setStatus(await DesktopBridge.runtimeStatus()), []);

  useEffect(() => {
    void refresh();
    const off = DesktopBridge.onRuntimeProgress(p => {
      if (p.state === 'done' || p.state === 'error' || p.state === 'paused' || p.state === 'cancelled') void refresh();
    });
    return off;
  }, [refresh]);

  // sizes are measured in the background: look again shortly until every size is known
  const unmeasured = Boolean(status && status.envs && status.envs.some(e => e.sizeBytes == null));
  useEffect(() => {
    if (!unmeasured) return;
    const t = setTimeout(() => { void refresh(); }, 2500);
    return () => clearTimeout(t);
  }, [unmeasured, status, refresh]);

  if (!DesktopBridge.runtimeAvailable || !status) return null;
  const envs = status.envs || [];
  const total = envs.reduce((s, e) => s + (e.sizeBytes || 0), 0);

  return (
    <div className="rounded-[14px] bg-[#0B0E15] border border-white/[0.06] p-3 space-y-2 text-xs">
      <div className="flex justify-between gap-2">
        <span className="font-semibold text-[#F5F7FA]">Installed environments</span>
        <span className="text-[#6F7888]">
          Python {status.pythonVersion || 'not installed'} (shared){total ? ` - ${formatBytes(total)} total` : ''}
        </span>
      </div>
      {envs.length === 0 && (
        <div className="text-[#A2AAB8]">Nothing installed yet. Models that use compatible libraries are put in the same environment, so PyTorch and CUDA are downloaded only once.</div>
      )}
      {envs.map(env => (
        <div key={env.id} className="rounded-[10px] bg-black/30 border border-white/[0.06] p-2.5 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-[#00D9FF]">{env.label}</span>
            <span className="text-[#A2AAB8]">
              {env.torch ? `PyTorch ${env.torch.version}${env.torch.cuda ? ` - GPU (${env.torch.device})` : ' - CPU'}` : `PyTorch ${env.torchTag}`}
              {' - '}{env.sizeBytes != null ? formatBytes(env.sizeBytes) : 'measuring...'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {env.adapterLabels.map(l => (
              <span key={l} className="px-2 py-0.5 rounded-full bg-[#181D27] border border-white/[0.08] text-[#F5F7FA]">{l}</span>
            ))}
          </div>
          {env.adapters.length > 1 && <div className="text-[#32D583]">{env.adapters.length} models share one copy of PyTorch and the common libraries.</div>}
          <button
            disabled={busy === env.id}
            onClick={async () => {
              if (!window.confirm(`Delete ${env.label}? This removes ${env.adapterLabels.join(', ')} libraries (the downloaded model files stay). You can reinstall any time.`)) return;
              setBusy(env.id);
              await DesktopBridge.runtimeRemoveEnv(env.id);
              setBusy('');
              await refresh();
            }}
            className="px-2.5 py-1 rounded-[8px] bg-[#181D27] border border-white/[0.08] text-[#FF5C70] disabled:opacity-50"
          >{busy === env.id ? 'Deleting...' : 'Delete environment'}</button>
        </div>
      ))}
    </div>
  );
};
