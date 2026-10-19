import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2, AlertTriangle, Download } from 'lucide-react';
import { DesktopBridge, RuntimeStatus } from '../services/desktopBridge';
import { ModelRegistry } from '../services/modelRegistry';
import { RuntimeInstaller } from './RuntimeInstaller';
import { TTSModel } from '../types/tts';

// Languages the Indian cloning model Sooktam-2 speaks; everything else uses XTTS-v2 (17 languages incl. Hindi).
const SOOKTAM_LANGS = ['hindi', 'marathi', 'gujarati', 'tamil', 'telugu', 'kannada', 'bengali', 'malayalam', 'odia', 'urdu', 'punjabi'];
export const recommendedCloner = (target: string): string => (SOOKTAM_LANGS.includes(target.toLowerCase()) ? 'sooktam-2' : 'xtts-v2');

interface Step { key: string; label: string; detail: string; done: boolean; kind: 'env' | 'model'; adapter?: string; modelId?: string }

/**
 * One checklist for everything Dubbing needs, with ONE button that does all of it in order:
 * the Dubbing engine (Python libraries), speech-recognition model, translation model, a voice-cloning model and its engine.
 */
export function DubbingSetup({ asrId, target, clonerInstalled, onChanged }: { asrId: string; target: string; clonerInstalled: boolean; onChanged: () => void }) {
  const [models, setModels] = useState<TTSModel[]>(ModelRegistry.getInstance().getModels());
  const [rt, setRt] = useState<RuntimeStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const started = useRef<Set<string>>(new Set());

  const refreshRuntime = useCallback(async () => { setRt(await DesktopBridge.runtimeStatus()); }, []);
  useEffect(() => { void refreshRuntime(); }, [refreshRuntime]);
  useEffect(() => ModelRegistry.getInstance().subscribe(() => setModels(ModelRegistry.getInstance().getModels())), []);

  const byId = (id: string) => models.find(m => m.id === id);
  const voiceId = recommendedCloner(target);
  const voice = byId(voiceId);

  const steps: Step[] = useMemo(() => {
    const s: Step[] = [
      { key: 'env-dub', kind: 'env', adapter: 'dub', label: 'Dubbing engine', detail: 'Python libraries for speech recognition, translation and music separation (one time, a few GB)', done: Boolean(rt?.engines['dub']?.ready) },
      { key: 'asr', kind: 'model', modelId: asrId, label: byId(asrId)?.name || 'Speech recognition model', detail: byId(asrId)?.downloadSize || '', done: Boolean(byId(asrId)?.isInstalled) },
      { key: 'mt', kind: 'model', modelId: 'nllb-200-distilled-600m', label: byId('nllb-200-distilled-600m')?.name || 'Translation model', detail: byId('nllb-200-distilled-600m')?.downloadSize || '', done: Boolean(byId('nllb-200-distilled-600m')?.isInstalled) },
    ];
    if (!clonerInstalled && voice) {
      s.push({ key: 'voice', kind: 'model', modelId: voiceId, label: `${voice.name} (voice cloning for ${target})`, detail: voice.downloadSize, done: Boolean(voice.isInstalled) });
      s.push({ key: 'env-voice', kind: 'env', adapter: voice.adapter, label: `${voice.name} engine`, detail: 'its Python libraries (one time)', done: Boolean(rt?.engines[voice.adapter]?.ready) });
    }
    return s;
  }, [models, rt, asrId, clonerInstalled, voiceId, target]);

  const next = steps.find(s => !s.done);
  const allDone = !next;
  useEffect(() => { if (allDone) onChanged(); }, [allDone]);

  // runner: starts the next missing model download; environment steps are started by the RuntimeInstaller shown below
  useEffect(() => {
    if (!running) return;
    if (!next) { setRunning(false); return; }
    if (next.kind !== 'model' || started.current.has(next.key)) return;
    started.current.add(next.key);
    (async () => {
      const registry = ModelRegistry.getInstance();
      await registry.startDownload(next.modelId!);
      const m = registry.getModels().find(x => x.id === next.modelId);
      if (!m?.isInstalled) {
        setError(`${m?.name || next.modelId}: ${m?.downloadError || 'the download did not finish. Press "Set up everything" to resume it.'}`);
        setRunning(false);
        started.current.delete(next.key);
      }
    })();
  }, [running, next?.key]);

  if (allDone) return null;
  const current = running ? next : undefined;
  const cm = current?.kind === 'model' ? byId(current.modelId!) : undefined;

  return (
    <div className="p-5 rounded-[24px] bg-[#11151D] border border-[#FFB547]/30 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-[#F5F7FA]">Set up Dubbing</h2>
        <p className="text-xs text-[#A2AAB8]">A few downloads are needed once. Press the button and they are installed in order; you can pause or stop any time and continue later.</p>
      </div>
      <ul className="space-y-1.5">
        {steps.map(s => {
          const isCur = current?.key === s.key;
          return (
            <li key={s.key} className="flex items-start gap-2 text-xs">
              {s.done ? <CheckCircle2 className="w-4 h-4 text-[#32D583] shrink-0" /> : isCur ? <Loader2 className="w-4 h-4 text-[#00D9FF] animate-spin shrink-0" /> : <Circle className="w-4 h-4 text-[#6F7888] shrink-0" />}
              <div className="min-w-0">
                <div className={s.done ? 'text-[#A2AAB8]' : 'text-[#F5F7FA]'}>{s.label}</div>
                {!s.done && s.detail && <div className="text-[11px] text-[#6F7888]">{s.detail}</div>}
              </div>
            </li>
          );
        })}
      </ul>

      {current?.kind === 'env' && (
        <div className="p-3 rounded-[14px] bg-[#080A0F] border border-white/[0.06]">
          <RuntimeInstaller key={current.key} adapter={current.adapter!} autoStart onDone={() => { void refreshRuntime(); }} />
        </div>
      )}
      {cm && (
        <div className="p-3 rounded-[14px] bg-[#080A0F] border border-white/[0.06] space-y-1.5">
          <div className="text-xs text-[#F5F7FA]">Downloading {cm.name}... {Math.round(cm.downloadProgress || 0)}%{cm.downloadSpeed ? ` - ${cm.downloadSpeed}` : ''}</div>
          <div className="h-1.5 rounded-full bg-[#11151D] overflow-hidden"><div className="h-full bg-[#00D9FF] transition-all" style={{ width: `${Math.max(2, cm.downloadProgress || 0)}%` }} /></div>
        </div>
      )}
      {error && <div className="flex gap-2 text-xs text-[#FF5C70]"><AlertTriangle className="w-4 h-4 shrink-0" /><span className="break-words">{error}</span></div>}

      {!running ? (
        <button onClick={() => { setError(''); started.current.clear(); setRunning(true); }} className="px-4 py-2 rounded-[12px] text-xs font-semibold bg-[#00D9FF] text-[#080A0F] flex items-center gap-2">
          <Download className="w-4 h-4" /> Set up everything
        </button>
      ) : (
        <button onClick={() => { setRunning(false); void DesktopBridge.runtimePause(); }} className="px-3 py-2 rounded-[12px] text-xs font-semibold bg-[#181D27] border border-white/[0.1] text-[#F5F7FA]">Pause</button>
      )}
    </div>
  );
}
