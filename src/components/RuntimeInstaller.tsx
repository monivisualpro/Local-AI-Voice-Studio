import React, { useCallback, useEffect, useState } from 'react';
import { DesktopBridge, RuntimeProgress, RuntimeStatus, ConnectivityResult } from '../services/desktopBridge';
import { formatBytes, formatSpeed, formatMbps, formatDuration } from '../utils/format';

const fmtBytes = formatBytes;
const fmtSpeed = formatSpeed;
const fmtEta = (s: number | null): string => formatDuration(s);

/** Tiny live speed graph (like the one in download managers). */
const SpeedGraph: React.FC<{ samples: number[] }> = ({ samples }) => {
  const max = Math.max(1, ...samples);
  const w = 240, h = 44;
  const pts = samples.map((v, i) => `${(i / Math.max(1, 79)) * w},${h - (v / max) * (h - 4) - 2}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-11 rounded-[8px] bg-black/40 border border-white/[0.06]" preserveAspectRatio="none">
      {samples.length > 1 && (
        <>
          <polyline points={`0,${h} ${pts} ${((samples.length - 1) / 79) * w},${h}`} fill="rgba(0,217,255,0.15)" stroke="none" />
          <polyline points={pts} fill="none" stroke="#00D9FF" strokeWidth="1.5" />
        </>
      )}
    </svg>
  );
};

const Stat: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="rounded-[10px] bg-black/30 border border-white/[0.06] px-2.5 py-1.5">
    <div className="text-[10px] uppercase tracking-wide text-[#6F7888]">{label}</div>
    <div className={`text-xs font-semibold ${accent ? 'text-[#00D9FF]' : 'text-[#F5F7FA]'}`}>{value}</div>
  </div>
);

const STEP_ICON: Record<string, string> = { done: '✓', skipped: '✓', running: '…', paused: '⏸', error: '✗', pending: '•' };
const STEP_COLOR: Record<string, string> = {
  done: 'text-[#32D583]', skipped: 'text-[#32D583]', running: 'text-[#00D9FF]', paused: 'text-[#FFB547]', error: 'text-[#FF5C70]', pending: 'text-[#6F7888]',
};

interface Props {
  adapter: string;
  onDone?: () => void;
  /** Start the installation as soon as the panel opens. */
  autoStart?: boolean;
}

/** Installs Python + PyTorch (GPU aware) + model libraries with fast, resumable downloads. */
export const RuntimeInstaller: React.FC<Props> = ({ adapter, onDone, autoStart }) => {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [progress, setProgress] = useState<RuntimeProgress | null>(null);
  const [torchTag, setTorchTag] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [net, setNet] = useState<ConnectivityResult[] | null>(null);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    const s = await DesktopBridge.runtimeStatus();
    setStatus(s);
    if (s?.running && s.running.adapter === adapter) setProgress(s.running);
  }, [adapter]);

  const start = useCallback(async (force = false) => {
    setError('');
    setBusy(true);
    const res = await DesktopBridge.runtimeInstall(adapter, { torchTag, force });
    setBusy(false);
    await refresh();
    if (res.ok) onDone?.();
    else if (!res.paused && !res.cancelled && res.error) setError(res.error);
  }, [adapter, torchTag, refresh, onDone]);

  useEffect(() => {
    void refresh();
    const off = DesktopBridge.onRuntimeProgress(p => {
      if (p.adapter !== adapter) return;
      setProgress(p);
      if (p.state === 'running') {
        setSpeedHistory(h => [...h.slice(-79), p.speed || 0]);
      }
    });
    return off;
  }, [adapter, refresh]);

  useEffect(() => {
    if (autoStart && status && !status.engines[adapter]?.ready && !busy && !progress) void start(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, status?.pythonReady]);

  if (!DesktopBridge.runtimeAvailable) {
    return <div className="text-xs text-[#A2AAB8]">The automatic installer is available in the desktop app (run <code className="text-[#00D9FF]">npm run electron:dev</code>).</div>;
  }
  if (!status) return <div className="text-xs text-[#A2AAB8]">Checking this computer...</div>;

  const eng = status.engines[adapter];
  if (!eng) return <div className="text-xs text-[#FF5C70]">No runtime is defined for "{adapter}".</div>;

  const running = busy || progress?.state === 'running';
  const paused = progress?.state === 'paused';
  const lowDisk = status.freeBytes != null && status.freeBytes < 6 * 1024 ** 3;

  return (
    <div className="space-y-3 text-xs text-[#F5F7FA]">
      {/* what will happen on this computer */}
      <div className="rounded-[12px] bg-black/30 border border-white/[0.06] p-3 space-y-1 text-[#A2AAB8]">
        <div><span className="text-[#F5F7FA] font-semibold">{eng.label}</span> - {eng.ready ? (eng.needsUpdate ? 'installed, update available' : 'installed') : 'not installed yet'}</div>
        {eng.ready && eng.envLabel && (
          <div>Lives in <span className="text-[#00D9FF]">{eng.envLabel}</span>{eng.sharedWith.length ? <> - shares PyTorch and libraries with {eng.sharedWith.join(', ')}</> : ' - not shared with other models yet'}.</div>
        )}
        {!eng.ready && <div>If its libraries are compatible with an environment you already have, it is added there and only the missing packages are downloaded. If it needs different versions, it gets its own environment.</div>}
        <div>{eng.note}</div>
        {eng.ready && eng.torch && !eng.torch.error && (
          <div className="text-[#32D583]">PyTorch {eng.torch.version} - {eng.torch.cuda ? `GPU ready (${eng.torch.device})` : 'running on CPU'}</div>
        )}
        {status.vcRuntime.required && !status.vcRuntime.installed && (
          <div className="text-[#FFB547]">Microsoft Visual C++ runtime will be installed too (Windows may ask for permission).</div>
        )}
        {eng.needsDriverUpdate && status.gpu && (
          <div className="text-[#FFB547]">Your NVIDIA driver ({status.gpu.driver}) is too old for GPU acceleration. Update it at nvidia.com/drivers, then press Repair.</div>
        )}
        {lowDisk && <div className="text-[#FFB547]">Low disk space: {fmtBytes(status.freeBytes || 0)} free. Models and PyTorch need several GB.</div>}
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        {!running && (
          <button onClick={() => start(false)} className="px-3 py-1.5 rounded-[10px] bg-[#00D9FF] text-black font-semibold">
            {paused ? 'Resume' : eng.ready ? (eng.needsUpdate ? 'Update' : 'Re-check') : 'Set up automatically'}
          </button>
        )}
        {running && (
          <>
            <button onClick={() => DesktopBridge.runtimePause()} className="px-3 py-1.5 rounded-[10px] bg-[#FFB547] text-black font-semibold">Pause</button>
            <button onClick={() => DesktopBridge.runtimeCancel(false)} className="px-3 py-1.5 rounded-[10px] bg-[#181D27] border border-white/[0.08]">Stop (keep progress)</button>
          </>
        )}
        {!running && (eng.ready || paused) && (
          <button onClick={() => (paused ? DesktopBridge.runtimeRemove(adapter).then(refresh) : start(true))} className="px-3 py-1.5 rounded-[10px] bg-[#181D27] border border-white/[0.08]">
            {paused ? 'Discard download' : 'Repair'}
          </button>
        )}
        {!running && eng.ready && (
          <button
            onClick={async () => {
              const note = eng.sharedWith.length ? ` The shared libraries stay because ${eng.sharedWith.join(', ')} still use them.` : ' Its environment will be deleted.';
              if (window.confirm(`Remove ${eng.label}?${note}`)) { await DesktopBridge.runtimeRemove(adapter); await refresh(); }
            }}
            className="px-3 py-1.5 rounded-[10px] bg-[#181D27] border border-white/[0.08] text-[#FF5C70]"
          >Remove</button>
        )}
        <button
          onClick={async () => { setTesting(true); setNet(null); setNet(await DesktopBridge.checkConnectivity()); setTesting(false); }}
          disabled={testing}
          className="px-3 py-1.5 rounded-[10px] bg-[#181D27] border border-white/[0.08] disabled:opacity-50"
        >{testing ? 'Testing...' : 'Test connection'}</button>
        <button onClick={() => DesktopBridge.runtimeOpenFolder()} className="px-3 py-1.5 rounded-[10px] bg-[#181D27] border border-white/[0.08]">Open folder</button>
        {!running && !eng.ready && (
          <select value={torchTag} onChange={e => setTorchTag(e.target.value)} className="px-2 py-1.5 rounded-[10px] bg-[#181D27] border border-white/[0.08] text-[#A2AAB8]" title="PyTorch build">
            <option value="auto">PyTorch: automatic</option>
            <option value="cpu">CPU only</option>
            <option value="cu126">CUDA 12.6</option>
            <option value="cu130">CUDA 13.0</option>
          </select>
        )}
      </div>

      {status.proxy && <div className="text-[11px] text-[#6F7888]">Using your system proxy ({status.proxy}).</div>}
      {net && (
        <div className="rounded-[10px] bg-black/30 border border-white/[0.06] p-2 space-y-1">
          {net.map(r => (
            <div key={r.host} className="flex gap-2 text-[11px]">
              <span className={r.ok ? 'text-[#32D583]' : 'text-[#FF5C70]'}>{r.ok ? '✓' : '✗'}</span>
              <span className="text-[#F5F7FA]">{r.name}</span>
              <span className="text-[#6F7888]">{r.ok ? `${r.ms} ms` : r.error}</span>
            </div>
          ))}
        </div>
      )}

      {/* progress */}
      {progress && (progress.state !== 'done' || running) && (() => {
        const downloading = progress.steps.find(x => x.id === 'download')?.status === 'running';
        const active = progress.steps.find(x => x.status === 'running');
        const busyNoBytes = progress.state === 'running' && !downloading;
        return (
          <div className="space-y-3">
            {/* overall bar (animated shimmer while a step has no byte progress, e.g. resolving packages) */}
            <div className="relative h-3 rounded-full bg-white/10 overflow-hidden">
              <div className={`h-full transition-all ${progress.state === 'error' ? 'bg-[#FF5C70]' : progress.state === 'paused' ? 'bg-[#FFB547]' : 'bg-[#00D9FF]'}`} style={{ width: `${progress.overallPercent}%` }} />
              {busyNoBytes && <div className="absolute inset-0 animate-pulse bg-white/10" />}
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-[#A2AAB8]">
              <span className="font-semibold text-[#F5F7FA]">{progress.overallPercent.toFixed(1)}%</span>
              <span>Elapsed {formatDuration(progress.elapsedSeconds ?? 0)}</span>
              {active && <span className="text-[#00D9FF] truncate max-w-full">{active.detail || active.label}</span>}
            </div>

            {progress.envLabel && (
              <div className="rounded-[10px] bg-black/30 border border-white/[0.06] px-3 py-2 text-[#A2AAB8]">
                Environment: <span className="text-[#00D9FF] font-semibold">{progress.envLabel}</span>
                {progress.sharedWith && progress.sharedWith.length > 0 && <> - shared with {progress.sharedWith.join(', ')}</>}
                {progress.reuse && (
                  <div className="text-[#32D583]">
                    {progress.reuse.packagesAlreadyThere > 0
                      ? `${progress.reuse.packagesAlreadyThere} packages already installed and reused - only ${progress.reuse.packagesToAdd} new to download.`
                      : `${progress.reuse.packagesToAdd} packages to download.`}
                  </div>
                )}
              </div>
            )}

            {/* IDM-style transfer panel */}
            {(downloading || progress.totalBytes > 0) && progress.state === 'running' && (
              <>
                <SpeedGraph samples={speedHistory} />
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Stat accent label="Speed" value={`${fmtSpeed(progress.speed)}  (${formatMbps(progress.speed)})`} />
                  <Stat label="Time left" value={fmtEta(progress.etaSeconds)} />
                  <Stat label="Downloaded" value={`${fmtBytes(progress.downloadedBytes)} / ${fmtBytes(progress.totalBytes)}`} />
                  <Stat label="Connections" value={String(progress.connections ?? 0)} />
                  <Stat label="Average" value={fmtSpeed(progress.avgSpeed ?? 0)} />
                  <Stat label="Peak" value={fmtSpeed(progress.peakSpeed ?? 0)} />
                </div>
                {progress.resumedBytes > 0 && (
                  <div className="text-[#32D583]">Resumed: {fmtBytes(progress.resumedBytes)} were already saved - not downloaded again.</div>
                )}
                {progress.speed === 0 && downloading && (
                  <div className="text-[#FFB547]">No data is arriving right now. The app retries automatically; check your internet, VPN or proxy if this continues.</div>
                )}
              </>
            )}

            <ul className="space-y-1">
              {progress.steps.map(st => (
                <li key={st.id} className="flex items-center gap-2">
                  <span className={`w-4 text-center ${STEP_COLOR[st.status]}`}>{STEP_ICON[st.status]}</span>
                  <span className={st.status === 'pending' ? 'text-[#6F7888]' : ''}>{st.label}</span>
                  {st.status === 'running' && <span className="text-[#6F7888]">{Math.round(st.percent)}%</span>}
                </li>
              ))}
            </ul>

            {/* per-file rows */}
            {progress.files.length > 0 && downloading && (
              <div className="space-y-1.5 max-h-44 overflow-auto pr-1">
                {progress.files.filter(f => f.status !== 'done').slice(0, 8).map(f => {
                  const pct = f.total ? Math.min(100, (f.done / f.total) * 100) : 0;
                  return (
                    <div key={f.name}>
                      <div className="flex justify-between gap-2 text-[11px] text-[#A2AAB8]">
                        <span className="truncate">{f.name}</span>
                        <span className="shrink-0">{f.status === 'verifying' ? 'verifying...' : `${pct.toFixed(0)}% - ${fmtBytes(f.total)}${f.speed ? ` - ${fmtSpeed(f.speed)}` : ''}`}</span>
                      </div>
                      <div className="h-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-[#00D9FF]" style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
                <div className="text-[11px] text-[#6F7888]">{progress.files.filter(f => f.status === 'done').length} of {progress.files.length} shown files finished</div>
              </div>
            )}

            {progress.message && progress.state !== 'running' && <div className={progress.state === 'error' ? 'text-[#FF5C70]' : 'text-[#A2AAB8]'}>{progress.message}</div>}

            {/* live technical log, so a slow step never looks frozen */}
            {progress.logTail && progress.logTail.length > 0 && (
              <div>
                <button onClick={() => setShowLog(v => !v)} className="text-[11px] text-[#6F7888] underline">{showLog ? 'Hide details' : 'Show details'}</button>
                {showLog && (
                  <pre className="mt-1 p-2 rounded-[8px] bg-black/50 text-[10px] text-[#A2AAB8] max-h-28 overflow-auto whitespace-pre-wrap">{progress.logTail.join('\n')}</pre>
                )}
              </div>
            )}
          </div>
        );
      })()}
      {error && <pre className="whitespace-pre-wrap text-[#FF5C70] max-h-32 overflow-auto">{error}</pre>}
    </div>
  );
};
