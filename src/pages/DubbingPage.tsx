import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Languages, FileAudio, Loader2, Play, Download, Wand2, AlertTriangle, CheckCircle2, Square, Film } from 'lucide-react';
import { dubApi, DubSegment, DubSpeaker, DubProgress, DesktopBridge } from '../services/desktopBridge';
import { ModelRegistry } from '../services/modelRegistry';
import { AudioEngine } from '../services/audioEngine';
import { getEngineProfile } from '../services/engineProfiles';
import { isSpeechModel, TTSModel } from '../types/tts';
import { DubbingSetup } from '../components/DubbingSetup';

const SOURCE_LANGS = ['Auto-detect', 'English', 'Hindi', 'Urdu', 'Tamil', 'Telugu', 'Bengali', 'Marathi', 'Gujarati', 'Kannada', 'Malayalam', 'Punjabi', 'Nepali', 'Arabic', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Russian', 'Turkish', 'Chinese', 'Japanese', 'Korean', 'Indonesian'];
const TARGET_LANGS = SOURCE_LANGS.filter(l => l !== 'Auto-detect').concat(['Odia', 'Assamese', 'Sanskrit']);
const ASR_MODELS = [
  { id: 'whisper-large-v3-turbo-ct2', label: 'Whisper large-v3 turbo (best)' },
  { id: 'whisper-small-ct2', label: 'Whisper small (light)' },
];
const MT_MODEL = 'nllb-200-distilled-600m';

interface Row extends DubSegment { translation: string; alts: string[]; shortened?: boolean }
interface Clip { path: string; duration: number }
interface Placed { id: number; start: number; tempo: number; duration: number; shifted: boolean; early?: boolean; overflow: boolean; drift: number; slotStart: number; slotEnd: number }
type Step = 'idle' | 'analyzing' | 'review' | 'dubbing' | 'done';

const card = 'p-5 rounded-[24px] bg-[#11151D] border border-white/[0.08] space-y-3';
const select = 'w-full text-xs px-3 py-2 rounded-[12px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF]';
const label = 'text-[11px] font-semibold text-[#A2AAB8] mb-1 block';
const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const modelSupports = (m: TTSModel, lang: string) => {
  const l = lang.toLowerCase();
  return m.languages.some(x => { const y = x.toLowerCase(); return y.includes(l) || (l === 'english' && y.includes('english')) || /^\d+\s+languages/.test(y) || y.includes('multilingual'); });
};

export function DubbingPage({ onNavigateToModels }: { onNavigateToModels: () => void }) {
  const api = dubApi();
  const jobRef = useRef(`dub${Date.now()}`);
  const abortRef = useRef(false);
  const cache = useRef<Map<string, Clip>>(new Map()); // "id|text|model|lang" -> synthesized sentence

  const [status, setStatus] = useState<{ environmentReady: boolean; models: Record<string, boolean> } | null>(null);
  const [models, setModels] = useState<TTSModel[]>(ModelRegistry.getInstance().getModels());
  const [file, setFile] = useState<string>('');
  const [src, setSrc] = useState('Auto-detect');
  const [tgt, setTgt] = useState('Hindi');
  const [asr, setAsr] = useState(ASR_MODELS[0].id);
  const [ttsId, setTtsId] = useState('');
  const [separate, setSeparate] = useState(true);
  const [speakersMode, setSpeakersMode] = useState('auto');
  const [checks, setChecks] = useState<{ name: string; ok: boolean; detail: string; seconds: number }[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [consent, setConsent] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [progress, setProgress] = useState<{ pct: number; text: string }>({ pct: 0, text: '' });
  const [error, setError] = useState('');
  const [detected, setDetected] = useState('');
  const [info, setInfo] = useState<{ duration: number; hasVideo: boolean; background: string | null; reference?: { path: string; text: string; duration: number }; speakers: DubSpeaker[] } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [outUrl, setOutUrl] = useState('');
  const [outPath, setOutPath] = useState('');
  const [report, setReport] = useState<{ sped: number; shifted: number; overflow: number; extended: number } | null>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [maxSpeed, setMaxSpeed] = useState(1.4);
  const [autoShorten, setAutoShorten] = useState(true);
  const itemsRef = useRef<{ index: number; start: number; end: number; wav: string; id: number }[]>([]);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const refreshStatus = () => { api?.status().then(setStatus); };
  useEffect(() => { refreshStatus(); }, []);
  useEffect(() => ModelRegistry.getInstance().subscribe(() => { setModels(ModelRegistry.getInstance().getModels()); refreshStatus(); }), []);
  useEffect(() => (api ? api.onProgress((p: DubProgress) => { if (p.jobId === jobRef.current) setProgress({ pct: p.pct, text: p.message || p.stage }); }) : undefined), [api]);

  const cloners = useMemo(
    () => models.filter(m => isSpeechModel(m) && m.isInstalled && getEngineProfile(m).wired && getEngineProfile(m).reference !== 'none'),
    [models]
  );
  useEffect(() => {
    if (!cloners.length) { setTtsId(''); return; }
    if (!cloners.some(m => m.id === ttsId)) setTtsId((cloners.find(m => modelSupports(m, tgt)) || cloners[0]).id);
  }, [cloners, tgt]);
  const tts = cloners.find(m => m.id === ttsId);
  const ttsOk = tts ? modelSupports(tts, tgt) : false;

  if (!api) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className={card}><h1 className="text-lg font-semibold text-[#F5F7FA]">Dubbing</h1>
          <p className="text-sm text-[#A2AAB8]">Dubbing runs AI models on your computer, so it only works in the desktop app.</p></div>
      </div>
    );
  }

  const missing: string[] = [];
  if (status) {
    if (!status.models[asr]) missing.push(ASR_MODELS.find(m => m.id === asr)!.label);
    if (!status.models[MT_MODEL]) missing.push('NLLB-200 600M (translation)');
  }
  const busy = step === 'analyzing' || step === 'dubbing';
  const fail = (m: string) => { setError(m); setStep(file ? (rows.length ? 'review' : 'idle') : 'idle'); };

  const pick = async () => {
    const p = await api.pickMedia();
    if (p) { setFile(p); setRows([]); setInfo(null); setOutUrl(''); setError(''); setStep('idle'); cache.current.clear(); jobRef.current = `dub${Date.now()}`; }
  };

  /** Runs every real component once on a tiny sample, so a problem shows up here with a clear message. */
  const selfTest = async () => {
    setChecking(true); setChecks(null); setError('');
    const r = await api.run({ jobId: jobRef.current, stage: 'selftest', args: { asrModel: asr, mtModel: MT_MODEL, separation: separate } });
    setChecking(false);
    if (!r.ok) return setError(r.error || 'The check could not run.');
    setChecks(r.checks || []);
  };

  const analyze = async () => {
    setError(''); setOutUrl(''); setStep('analyzing'); setProgress({ pct: 0, text: 'Starting...' });
    const job = jobRef.current;
    const prep = await api.run({ jobId: job, stage: 'prepare', args: { input: file } });
    if (!prep.ok) return fail(prep.error || 'Could not read the file.');
    const an = await api.run({ jobId: job, stage: 'analyze', args: { asrModel: asr, language: src === 'Auto-detect' ? 'auto' : src.toLowerCase(), separate, speakers: speakersMode } });
    if (!an.ok) return fail(an.error || 'Speech recognition failed.');
    const from = (an.language && an.language.length > 2 ? an.language : src).toString();
    const fromName = from.charAt(0).toUpperCase() + from.slice(1);
    setDetected(fromName);
    setProgress({ pct: 0, text: 'Translating...' });
    const tr = await api.run({ jobId: job, stage: 'translate', args: { mtModel: MT_MODEL, src: fromName.toLowerCase(), tgt: tgt.toLowerCase(), segments: an.segments } });
    if (!tr.ok) return fail(tr.error || 'Translation failed.');
    setInfo({ duration: prep.duration || 0, hasVideo: Boolean(prep.hasVideo), background: an.background ?? null, reference: an.reference, speakers: an.speakers || [] });
    setRows((an.segments || []).map((s, i) => ({ ...s, translation: (tr.translations || [])[i] || '', alts: (tr.alternatives || [])[i] || [] })));
    setStep('review');
  };

  const synthesizeText = async (row: Row, text: string): Promise<Clip> => {
    const speaker = info!.speakers.find(x => x.id === row.speaker) || info!.speakers[0];
    const ref = speaker?.reference || info!.reference!;
    const key = `${row.id}|${text}|${tts!.id}|${tgt}|${speaker?.id || ''}`;
    const hit = cache.current.get(key);
    if (hit) return hit;
    const engine = AudioEngine.getInstance();
    const profile = getEngineProfile(tts!);
    const refBytes = await api.readFile(ref.path);
    if (!refBytes) throw new Error('The voice sample for cloning is missing. Press "Analyze" again.');
    const opts = {
      modelId: tts!.id, modelDir: tts!.source === 'local' ? tts!.repo : undefined, adapter: tts!.adapter, language: tgt,
      referenceWav: refBytes, referenceText: ref.text, temperature: 0.7,
    };
    const pieces = engine.chunkScript(text, profile.maxChunkChars);
    const parts: { buffer: AudioBuffer; paragraphEnd?: boolean }[] = [];
    for (const p of pieces) {
      if (abortRef.current) throw new Error('Cancelled.');
      const r = await engine.synthesizeWithModel(p.text, opts);
      parts.push({ buffer: r.buffer });
    }
    if (!parts.length) throw new Error('Empty sentence.');
    const buffer = parts.length === 1 ? parts[0].buffer : engine.joinChunks(parts, 120);
    const blob = engine.createWavBlob(buffer);
    const w = await api.writeFile({ jobId: jobRef.current, name: `tts_${row.id}_${Date.now()}.wav`, bytes: new Uint8Array(await blob.arrayBuffer()) });
    if (!w.ok || !w.path) throw new Error(w.error || 'Could not save a sentence.');
    const clip = { path: w.path, duration: buffer.duration };
    cache.current.set(key, clip);
    return clip;
  };

  /** Candidate wording whose predicted speaking time is closest to (but not much above) the original time slot. */
  const pickShorter = (row: Row, secondsPerChar: number): string | null => {
    const slot = Math.max(0.5, row.end - row.start);
    const options = [row.translation, ...row.alts].filter(Boolean);
    const scored = options.map(t => ({ t, pred: t.length * secondsPerChar }));
    const fitting = scored.filter(o => o.pred <= slot * 1.08);
    const best = fitting.length ? fitting.sort((a, b) => b.pred - a.pred)[0] : scored.sort((a, b) => a.pred - b.pred)[0];
    return best && best.t !== row.translation ? best.t : null;
  };

  const placeAndMix = async (items: typeof itemsRef.current) => {
    setProgress({ pct: 88, text: 'Fitting each sentence to the picture and mixing...' });
    const res = await api.run({ jobId: jobRef.current, stage: 'assemble', args: { plan: { duration: info!.duration, segments: items, keepBackground: separate, background: info!.background, backgroundGain: 0.8, duck: true, maxSpeedup: maxSpeed, leadIn: 0.35, trail: 0.6, ease: true } } });
    if (!res.ok || !res.output) throw new Error(res.error || 'Mixing failed.');
    const bytes = await api.readFile(res.output);
    if (!bytes) throw new Error('The dubbed file could not be read.');
    setOutPath(res.output);
    setOutUrl(URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' })));
    setReport({ sped: res.sped || 0, shifted: res.shifted || 0, overflow: res.overflow || 0, extended: 0 });
    setPlaced((res.timeline || []).map(t => ({ id: items[t.index].id, start: t.start, tempo: t.tempo, duration: t.duration, shifted: t.shifted, early: t.early, overflow: t.overflow, drift: t.drift || 0, slotStart: t.slotStart || 0, slotEnd: t.slotEnd || 0 })));
    setStep('done');
  };

  const dub = async () => {
    if (!tts || !info?.reference) return;
    setError(''); setOutUrl(''); setStep('dubbing'); abortRef.current = false;
    try {
      const todo = rows.filter(r => r.translation.trim());
      const clips = new Map<number, Clip>();
      for (let i = 0; i < todo.length; i++) {
        setProgress({ pct: Math.round((i / todo.length) * 60), text: `Speaking sentence ${i + 1} of ${todo.length}...` });
        clips.set(todo[i].id, await synthesizeText(todo[i], todo[i].translation));
      }
      // Fit pass: sentences that would run much longer than the original get a shorter wording (n-best translations)
      if (autoShorten) {
        const chars = todo.reduce((n, r) => n + r.translation.length, 0);
        const secs = todo.reduce((n, r) => n + clips.get(r.id)!.duration, 0);
        const spc = secs / Math.max(1, chars);
        const tooLong = todo.filter(r => clips.get(r.id)!.duration > (r.end - r.start) * 1.2 && r.alts.length);
        for (let i = 0; i < tooLong.length; i++) {
          const r = tooLong[i];
          setProgress({ pct: 60 + Math.round((i / Math.max(1, tooLong.length)) * 25), text: `Fitting sentence ${i + 1} of ${tooLong.length} into its time...` });
          const alt = pickShorter(r, spc);
          if (!alt) continue;
          const clip = await synthesizeText(r, alt);
          if (clip.duration < clips.get(r.id)!.duration * 0.95) {
            clips.set(r.id, clip);
            setRows(rs => rs.map(x => (x.id === r.id ? { ...x, translation: alt, alts: [r.translation, ...x.alts.filter(a => a !== alt)], shortened: true } : x)));
          }
        }
      }
      const items = todo.map(r => ({ index: r.id, id: r.id, start: r.start, end: r.end, wav: clips.get(r.id)!.path }));
      itemsRef.current = items;
      await placeAndMix(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('review');
    }
  };

  /** Same spoken sentences, new timing settings: no new speech is generated. */
  const refit = async () => {
    if (!itemsRef.current.length) return;
    setError(''); setStep('dubbing');
    try { await placeAndMix(itemsRef.current); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStep('done'); }
  };

  const previewClip = async (id: number) => {
    const it = itemsRef.current.find(x => x.id === id);
    if (!it) return;
    const bytes = await api.readFile(it.wav);
    if (!bytes) return;
    previewRef.current?.pause();
    previewRef.current = new Audio(URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' })));
    void previewRef.current.play();
  };

  const cancel = async () => { abortRef.current = true; await api.cancel(); };
  const saveAudio = () => api.saveOutput({ path: outPath, suggestedName: `dubbed_${tgt.toLowerCase()}.wav` });
  const makeVideo = async () => {
    setStep('dubbing'); setProgress({ pct: 90, text: 'Putting the new audio into the video...' });
    const r = await api.run({ jobId: jobRef.current, stage: 'mux', args: { video: file } });
    setStep('done');
    if (!r.ok || !r.output) return setError(r.error || 'Could not create the video.');
    await api.saveOutput({ path: r.output, suggestedName: `dubbed_${tgt.toLowerCase()}.mp4` });
  };

  const needEnv = status && !status.environmentReady;
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Languages className="w-5 h-5 text-[#00D9FF]" />
        <div>
          <h1 className="text-lg font-semibold text-[#F5F7FA]">Dubbing: speech to speech</h1>
          <p className="text-xs text-[#A2AAB8]">Translate a recording into another language, spoken in the original voice. Everything runs on your computer.</p>
        </div>
      </div>

      <DubbingSetup asrId={asr} target={tgt} clonerInstalled={cloners.length > 0} onChanged={refreshStatus} />

      {!needEnv && missing.length === 0 && (
        <div className={card}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-[#F5F7FA]">Check my setup</div>
              <div className="text-[11px] text-[#6F7888]">Runs the recognizer, translator{separate ? ', music separator' : ''} and speaker detection once on a tiny sample, so you know everything works before a long job. {separate ? 'The music separator downloads ~80 MB the first time.' : ''}</div>
            </div>
            <button onClick={() => void selfTest()} disabled={checking || busy} className="px-3 py-2 rounded-[12px] text-xs font-semibold bg-[#181D27] border border-white/[0.1] text-[#F5F7FA] disabled:opacity-50 flex items-center gap-2 shrink-0">
              {checking && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{checking ? 'Checking...' : 'Check my setup'}
            </button>
          </div>
          {checking && <div className="text-[11px] text-[#A2AAB8]">{progress.text}</div>}
          {checks && (
            <ul className="space-y-1.5">
              {checks.map(c => (
                <li key={c.name} className="flex gap-2 text-xs">
                  {c.ok ? <CheckCircle2 className="w-4 h-4 text-[#32D583] shrink-0" /> : <AlertTriangle className="w-4 h-4 text-[#FF5C70] shrink-0" />}
                  <div className="min-w-0"><span className="text-[#F5F7FA]">{c.name}</span><span className="text-[#6F7888]"> ({c.seconds}s)</span>
                    <div className={`break-words ${c.ok ? 'text-[#A2AAB8]' : 'text-[#FF5C70]'}`}>{c.detail}</div></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={card}>
        <div className="flex items-center gap-2">
          <button onClick={() => void pick()} disabled={busy} className="px-3 py-2 rounded-[12px] text-xs font-semibold bg-[#181D27] border border-white/[0.1] text-[#F5F7FA] flex items-center gap-2 disabled:opacity-50"><FileAudio className="w-4 h-4" /> Choose audio or video</button>
          <span className="text-xs font-mono text-[#A2AAB8] truncate" title={file}>{file || 'No file chosen'}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><span className={label}>Spoken language</span><select className={select} value={src} onChange={e => setSrc(e.target.value)} disabled={busy}>{SOURCE_LANGS.map(l => <option key={l}>{l}</option>)}</select></div>
          <div><span className={label}>Dub into</span><select className={select} value={tgt} onChange={e => setTgt(e.target.value)} disabled={busy}>{TARGET_LANGS.map(l => <option key={l}>{l}</option>)}</select></div>
          <div><span className={label}>Speech recognition</span><select className={select} value={asr} onChange={e => setAsr(e.target.value)} disabled={busy}>{ASR_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
          <div><span className={label}>Voice cloning model</span>
            <select className={select} value={ttsId} onChange={e => setTtsId(e.target.value)} disabled={busy || !cloners.length}>
              {cloners.length === 0 && <option value="">None installed</option>}
              {cloners.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></div>
        </div>
        {!cloners.length && <p className="text-[11px] text-[#FFB547]">No voice-cloning model is installed. Download one on the Models page (for example XTTS-v2, Chatterbox, or Sooktam-2 for Indian languages).</p>}
        {tts && !ttsOk && <p className="text-[11px] text-[#FFB547]">{tts.name} does not list {tgt} as a supported language. Pick another cloning model or the result may be wrong.</p>}
        <label className="flex items-center gap-2 text-xs text-[#A2AAB8]"><input type="checkbox" checked={separate} onChange={e => setSeparate(e.target.checked)} disabled={busy} /> Keep the music and background sounds (separates them from the voice first; downloads an ~80 MB model once, slower)</label>
        <label className="flex items-center gap-2 text-xs text-[#A2AAB8]">Speakers
          <select className="text-xs px-2 py-1 rounded-[10px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA]" value={speakersMode} onChange={e => setSpeakersMode(e.target.value)} disabled={busy}>
            <option value="auto">Detect automatically</option><option value="off">One speaker</option><option value="2">2 speakers</option><option value="3">3 speakers</option><option value="4">4 speakers</option>
          </select>
          <span className="text-[11px] text-[#6F7888]">each speaker is dubbed in their own cloned voice</span></label>
        <label className="flex items-center gap-2 text-xs text-[#A2AAB8]"><input type="checkbox" checked={autoShorten} onChange={e => setAutoShorten(e.target.checked)} disabled={busy} /> Fit sentences to the original timing (uses a shorter wording when the translation would run too long)</label>
        <label className="flex items-start gap-2 text-xs text-[#A2AAB8]"><input className="mt-0.5" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} /> I own this voice or have the speaker's permission to clone it.</label>
        <div className="flex gap-2">
          <button onClick={() => void analyze()} disabled={!file || busy || needEnv || missing.length > 0 || !consent} className="px-4 py-2 rounded-[12px] text-xs font-semibold bg-[#00D9FF] text-[#080A0F] disabled:opacity-40 flex items-center gap-2"><Wand2 className="w-4 h-4" /> Analyze and translate</button>
          {busy && <button onClick={() => void cancel()} className="px-3 py-2 rounded-[12px] text-xs font-semibold bg-[#FF5C70]/15 text-[#FF5C70] flex items-center gap-1"><Square className="w-3.5 h-3.5" /> Cancel</button>}
        </div>
      </div>

      {busy && (
        <div className={card}>
          <div className="flex items-center gap-2 text-xs text-[#F5F7FA]"><Loader2 className="w-4 h-4 animate-spin text-[#00D9FF]" />{progress.text}</div>
          <div className="h-1.5 rounded-full bg-[#080A0F] overflow-hidden"><div className="h-full bg-[#00D9FF] transition-all" style={{ width: `${Math.max(3, progress.pct)}%` }} /></div>
        </div>
      )}
      {error && <div className="flex gap-2 p-3 rounded-[14px] bg-[#FF5C70]/10 border border-[#FF5C70]/30 text-xs text-[#FF5C70]"><AlertTriangle className="w-4 h-4 shrink-0" /><span className="break-words">{error}</span></div>}

      {(step === 'review' || step === 'done' || (step === 'dubbing' && rows.length > 0)) && rows.length > 0 && (
        <div className={card}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#F5F7FA]">Sentences ({rows.length}){detected && <span className="ml-2 text-[11px] font-normal text-[#A2AAB8]">detected: {detected} - one speaker is assumed</span>}</h2>
            <button onClick={() => void dub()} disabled={busy || !tts || !consent} className="px-4 py-2 rounded-[12px] text-xs font-semibold bg-[#32D583] text-[#080A0F] disabled:opacity-40 flex items-center gap-2"><Play className="w-4 h-4" /> Create the dub</button>
          </div>
          <p className="text-[11px] text-[#6F7888]">Fix the translation if needed, then create the dub. Only edited sentences are spoken again.</p>
          <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
            {rows.map((r, i) => (
              <div key={r.id} className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2 rounded-[14px] bg-[#080A0F] border border-white/[0.05]">
                <div className="text-xs text-[#A2AAB8]"><span className="font-mono text-[10px] text-[#6F7888]">{fmtT(r.start)}-{fmtT(r.end)}</span>{r.shortened && <span className="ml-2 text-[10px] text-[#32D583]">shortened to fit</span>}
                  {(info?.speakers.length || 0) > 1 && (
                    <select value={r.speaker || 'S1'} disabled={busy} onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, speaker: e.target.value } : x)))} className="ml-2 text-[10px] px-1 rounded bg-[#11151D] border border-white/[0.08] text-[#00D9FF]">
                      {info!.speakers.map(sp => <option key={sp.id} value={sp.id}>{sp.id}</option>)}
                    </select>
                  )}<div>{r.text}</div></div>
                <textarea value={r.translation} rows={2} disabled={busy} onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, translation: e.target.value } : x)))}
                  className="w-full text-xs p-2 rounded-[10px] bg-[#11151D] border border-white/[0.08] text-[#F5F7FA] focus:outline-none focus:border-[#00D9FF]" />
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'done' && outUrl && (
        <div className={`${card} border-[#32D583]/30`}>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#32D583]"><CheckCircle2 className="w-4 h-4" /> Your dub is ready</div>
          <audio controls src={outUrl} className="w-full" />
          <div className="flex items-center gap-3 text-[11px] text-[#A2AAB8]">
            <label className="flex items-center gap-2">Max speed-up
              <input type="range" min={1.0} max={1.6} step={0.05} value={maxSpeed} onChange={e => setMaxSpeed(Number(e.target.value))} />
              <span className="font-mono text-[#F5F7FA]">{maxSpeed.toFixed(2)}x</span></label>
            <button onClick={() => void refit()} className="px-2.5 py-1.5 rounded-[10px] bg-[#181D27] border border-white/[0.1] text-[#F5F7FA]">Re-fit timing</button>
            {report && <span>{report.sped} sped up, {report.shifted} late, {report.overflow} could not fit</span>}
          </div>
          {placed.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-[12px] bg-[#080A0F] border border-white/[0.05]">
              <table className="w-full text-[11px]">
                <thead className="text-[#6F7888] sticky top-0 bg-[#080A0F]"><tr><th className="text-left p-1.5">Original</th><th className="text-left p-1.5">Placed</th><th className="p-1.5">Speed</th><th className="text-left p-1.5">Sync</th><th /></tr></thead>
                <tbody>
                  {placed.map(p => (
                    <tr key={p.id} className="border-t border-white/[0.04]">
                      <td className="p-1.5 font-mono text-[#A2AAB8]">{fmtT(p.slotStart)}-{fmtT(p.slotEnd)}</td>
                      <td className="p-1.5 font-mono text-[#A2AAB8]">{fmtT(p.start)}-{fmtT(p.start + p.duration)}</td>
                      <td className="p-1.5 text-center font-mono">{p.tempo > 1.01 ? `${p.tempo.toFixed(2)}x` : '1x'}</td>
                      <td className={`p-1.5 ${p.overflow ? 'text-[#FF5C70]' : p.shifted ? 'text-[#FFB547]' : 'text-[#32D583]'}`}>{p.overflow ? 'too long' : p.shifted ? `late ${p.drift.toFixed(1)}s` : 'in sync'}</td>
                      <td className="p-1.5 text-right"><button onClick={() => void previewClip(p.id)} className="text-[#00D9FF]">Play</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {report && report.overflow > 0 && (
            <p className="text-[11px] text-[#FFB547]">{report.overflow} sentence(s) are longer than the time available. Shorten their translation in the list above (or pick another wording) and press "Create the dub" again; unchanged sentences are not spoken again.</p>
          )}
          <div className="flex gap-2">
            <button onClick={() => void saveAudio()} className="px-3 py-2 rounded-[12px] text-xs font-semibold bg-[#00D9FF] text-[#080A0F] flex items-center gap-2"><Download className="w-4 h-4" /> Save audio</button>
            {info?.hasVideo && <button onClick={() => void makeVideo()} className="px-3 py-2 rounded-[12px] text-xs font-semibold bg-[#181D27] border border-white/[0.1] text-[#F5F7FA] flex items-center gap-2"><Film className="w-4 h-4" /> Save as video with the new audio</button>}
          </div>
        </div>
      )}
      <p className="text-[11px] text-[#6F7888]">Limits: one speaker is assumed (the voice is cloned from the clearest sentences). Quality depends on the language pair and the cloning model. Only dub voices you have the right to use.</p>
    </div>
  );
}
