import React, { useCallback, useEffect, useState } from 'react';
import { HardDrive, FolderOpen, ArrowRightLeft, Loader2, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { storageApi, StorageInfo, StorageProgress } from '../services/desktopBridge';
import { ModelRegistry } from '../services/modelRegistry';

const fmt = (b: number) => {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(i >= 3 ? 1 : 0)} ${u[i]}`;
};

type Kind = 'models' | 'environments';
const LABEL: Record<Kind, string> = { models: 'Models', environments: 'Environments (Python + libraries)' };

/**
 * Shows where everything is stored and lets the user put the big folders (models, Python environments) on another
 * drive. "Move" transfers what is already downloaded, verified, before the old copy is removed.
 */
export function StorageLocationsCard() {
  const api = storageApi();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{ kind: Kind; folder: string } | null>(null);
  const [progress, setProgress] = useState<StorageProgress | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const busy = Boolean(progress && progress.phase !== 'done' && progress.phase !== 'error');

  const refresh = useCallback(() => { api?.info().then(setInfo); }, [api]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => (api ? api.onProgress(p => setProgress(p)) : undefined), [api]);

  if (!api) {
    return (
      <div className="p-6 rounded-[24px] bg-[#11151D] border border-white/[0.08] space-y-2">
        <div className="flex items-center gap-2.5"><HardDrive className="w-4 h-4 text-[#00D9FF]" /><h2 className="text-sm font-semibold text-[#F5F7FA]">Storage locations</h2></div>
        <p className="text-xs text-[#A2AAB8]">Models and environments are stored on disk by the desktop app. Open the desktop app to see and change these folders.</p>
      </div>
    );
  }

  const calcSize = async (kind: 'models' | 'environments' | 'voices') => {
    setSizes(s => ({ ...s, [kind]: 'calculating...' }));
    const r = await api.size(kind);
    setSizes(s => ({ ...s, [kind]: `${r.partial ? 'at least ' : ''}${fmt(r.bytes)}` }));
  };

  const choose = async (kind: Kind) => {
    setResult(null);
    const folder = await api.pickFolder(`Select the new folder for ${LABEL[kind]}`);
    if (folder) setPending({ kind, folder });
  };

  const run = async (move: boolean) => {
    if (!pending) return;
    setResult(null);
    setProgress({ kind: pending.kind, phase: 'moving', done: 0, total: 0 });
    const r = await api.move({ kind: pending.kind, folder: pending.folder, move });
    setPending(null);
    setProgress(null);
    if (r.ok) {
      setResult({ ok: true, text: `${LABEL[pending.kind]} now live in: ${r.folder}${r.method === 'copy' ? ' (copied and verified, the old copy was removed)' : ''}` });
      setSizes({});
      // The rest of the app must look at the NEW folder: re-read which models are installed there.
      void ModelRegistry.getInstance().syncWithDisk();
    } else {
      setResult({ ok: false, text: r.error || 'The move failed.' });
    }
    refresh();
  };

  const pct = progress && progress.total ? Math.min(100, Math.round(((progress.done || 0) / progress.total) * 100)) : 0;
  const btn = 'px-2.5 py-1.5 rounded-[10px] text-[11px] font-semibold bg-[#181D27] text-[#A2AAB8] hover:text-[#F5F7FA] disabled:opacity-40 flex items-center gap-1';

  const Row = ({ title, kind, openKind, path, extra, changeKind }: { title: string; kind?: 'models' | 'environments' | 'voices'; openKind: 'install' | 'models' | 'environments' | 'voices' | 'userData'; path: string; extra?: string; changeKind?: Kind }) => (
    <div className="p-3 rounded-[16px] bg-[#080A0F] border border-white/[0.05] space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-[#F5F7FA]">{title}</div>
        <div className="flex items-center gap-1.5">
          {kind && <button className={btn} disabled={busy} onClick={() => void calcSize(kind)}>{sizes[kind] || 'Show size'}</button>}
          <button className={btn} disabled={busy} onClick={() => void api.open(openKind)}><FolderOpen className="w-3 h-3" /> Open</button>
          {changeKind && <button className={`${btn} !bg-[#00D9FF] !text-[#080A0F]`} disabled={busy} onClick={() => void choose(changeKind)}><ArrowRightLeft className="w-3 h-3" /> Change</button>}
        </div>
      </div>
      <div className="text-[11px] font-mono text-[#A2AAB8] break-all select-all">{path}</div>
      {extra && <div className="text-[11px] text-[#6F7888]">{extra}</div>}
    </div>
  );

  return (
    <div className="p-6 rounded-[24px] bg-[#11151D] border border-white/[0.08] space-y-4 shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] pb-3">
        <HardDrive className="w-4 h-4 text-[#00D9FF]" />
        <div>
          <h2 className="text-sm font-semibold text-[#F5F7FA]">Storage locations</h2>
          <p className="text-xs text-[#A2AAB8]">Where the app, your models and the Python environments are. Models and environments are the big ones: you can move them to another drive.</p>
        </div>
      </div>

      {info?.portable && (
        <div className="flex gap-2 p-3 rounded-[14px] bg-[#FFB547]/10 border border-[#FFB547]/30 text-[11px] text-[#FFB547]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>You are running the <b>portable</b> version. It never installs, so it never asks for a folder. To install into a folder you choose, run the <b>Setup</b> installer instead. Your models and settings are kept either way.</span>
        </div>
      )}

      {info && (
        <div className="space-y-2">
          <Row title="Application (install folder)" openKind="install" path={info.installFolder} />
          <Row
            title="Models" kind="models" openKind="models" changeKind="models" path={info.models.path}
            extra={`Free space on that drive: ${fmt(info.models.freeBytes)} of ${fmt(info.models.totalBytes)}`}
          />
          <Row
            title="Environments (Python + libraries)" kind="environments" openKind="environments" changeKind="environments" path={info.environments.path}
            extra={`Free space on that drive: ${fmt(info.environments.freeBytes)} of ${fmt(info.environments.totalBytes)}`}
          />
          <Row title="Voice library files" kind="voices" openKind="voices" path={info.voices.path} />
          <Row title="Settings and app data" openKind="userData" path={info.userData} extra="Stays here even when you uninstall the app, so your models and voices survive a re-install." />
        </div>
      )}

      {pending && !busy && (
        <div className="p-4 rounded-[16px] bg-[#181D27] border border-[#00D9FF]/30 space-y-3">
          <div className="text-xs text-[#F5F7FA]">
            New folder for <b>{LABEL[pending.kind]}</b>:
            <div className="font-mono text-[11px] text-[#00D9FF] break-all mt-1">{pending.folder}</div>
          </div>
          <div className="text-[11px] text-[#A2AAB8] space-y-1">
            <p><b className="text-[#F5F7FA]">Move everything</b> (recommended): your downloaded {pending.kind === 'models' ? 'models' : 'environments'} are moved there. Same drive = instant; another drive = copied, checked, then the old copy is removed. If the folder is not empty, a <code>{pending.kind === 'models' ? 'models' : 'runtime'}</code> folder is created inside it.</p>
            <p><b className="text-[#F5F7FA]">Use this folder without moving</b>: choose this if the folder already contains your {pending.kind === 'models' ? 'downloaded models' : 'environments'} (for example from another computer or an older install). Nothing is copied.</p>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded-[12px] text-xs font-semibold bg-[#00D9FF] text-[#080A0F]" onClick={() => void run(true)}>Move everything</button>
            <button className="px-3 py-2 rounded-[12px] text-xs font-semibold bg-[#181D27] border border-white/[0.1] text-[#F5F7FA]" onClick={() => void run(false)}>Use folder without moving</button>
            <button className="px-3 py-2 rounded-[12px] text-xs text-[#A2AAB8]" onClick={() => setPending(null)}><X className="w-3.5 h-3.5 inline" /> Cancel</button>
          </div>
        </div>
      )}

      {busy && (
        <div className="p-4 rounded-[16px] bg-[#181D27] border border-white/[0.08] space-y-2">
          <div className="flex items-center gap-2 text-xs text-[#F5F7FA]">
            <Loader2 className="w-4 h-4 animate-spin text-[#00D9FF]" />
            {progress?.phase === 'repairing' ? 'Updating the environments for their new location...' : `Moving ${LABEL[progress?.kind || 'models']}... ${progress?.total ? `${pct}%` : ''}`}
          </div>
          <div className="h-1.5 rounded-full bg-[#080A0F] overflow-hidden"><div className="h-full bg-[#00D9FF] transition-all" style={{ width: `${progress?.phase === 'repairing' ? 100 : pct}%` }} /></div>
          <p className="text-[11px] text-[#6F7888]">Do not close the app. If it is interrupted, your original files are still there and you can simply try again.</p>
        </div>
      )}

      {result && (
        <div className={`flex gap-2 p-3 rounded-[14px] text-[11px] border ${result.ok ? 'bg-[#32D583]/10 border-[#32D583]/30 text-[#32D583]' : 'bg-[#FF5C70]/10 border-[#FF5C70]/30 text-[#FF5C70]'}`}>
          {result.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span className="break-all">{result.text}</span>
        </div>
      )}
    </div>
  );
}
