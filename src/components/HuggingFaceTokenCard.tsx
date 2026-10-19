import React, { useEffect, useState } from 'react';
import { KeyRound, CheckCircle2, ExternalLink, Eye, EyeOff, Trash2 } from 'lucide-react';
import { DesktopBridge } from '../services/desktopBridge';

/**
 * Hugging Face access token. A few models (Indic Parler-TTS, ...) are "gated": they are free, but Hugging Face only
 * lets a logged-in account that accepted the model's conditions download them. The app proves that account with a
 * free read token. The token stays on this computer (it is never shown again after saving).
 */
export function HuggingFaceTokenCard({ onSaved }: { onSaved?: () => void }) {
  const [hasToken, setHasToken] = useState(false);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const desktop = DesktopBridge.runtimeAvailable;

  useEffect(() => {
    DesktopBridge.getConfig().then(c => setHasToken(Boolean(c?.hasToken)));
  }, []);

  const save = async () => {
    const token = value.trim();
    if (!token) return;
    if (!token.startsWith('hf_')) {
      setMessage({ kind: 'error', text: 'A Hugging Face token starts with "hf_". Copy the whole token from huggingface.co/settings/tokens.' });
      return;
    }
    const cfg = await DesktopBridge.setConfig({ hfToken: token });
    if (!cfg) {
      setMessage({ kind: 'error', text: 'Could not save the token. This needs the desktop app.' });
      return;
    }
    setHasToken(cfg.hasToken);
    setValue('');
    setMessage({ kind: 'ok', text: 'Token saved. Go to Models and press Download again.' });
    onSaved?.();
  };

  const remove = async () => {
    const cfg = await DesktopBridge.setConfig({ hfToken: '' });
    setHasToken(Boolean(cfg?.hasToken));
    setMessage({ kind: 'ok', text: 'Token removed.' });
  };

  const link = 'inline-flex items-center gap-1 text-[#00D9FF] hover:underline';

  return (
    <div className="p-6 rounded-[24px] bg-[#11151D] border border-white/[0.08] space-y-4 shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] pb-3">
        <KeyRound className="w-4 h-4 text-[#00D9FF]" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-[#F5F7FA]">Hugging Face access token</h2>
          <p className="text-xs text-[#A2AAB8]">Free. Needed only for gated models such as Indic Parler-TTS.</p>
        </div>
        {hasToken && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-[#32D583]">
            <CheckCircle2 className="w-3.5 h-3.5" /> Token saved
          </span>
        )}
      </div>

      <ol className="text-xs text-[#A2AAB8] space-y-1.5 list-decimal pl-4">
        <li>
          Create a free account at{' '}
          <a className={link} href="https://huggingface.co/join" target="_blank" rel="noreferrer">huggingface.co/join <ExternalLink className="w-3 h-3" /></a>
        </li>
        <li>
          Open the model page and press the <b>Agree / Access repository</b> button:{' '}
          <a className={link} href="https://huggingface.co/ai4bharat/indic-parler-tts" target="_blank" rel="noreferrer">ai4bharat/indic-parler-tts <ExternalLink className="w-3 h-3" /></a>
        </li>
        <li>
          Create a token with type <b>Read</b>:{' '}
          <a className={link} href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">huggingface.co/settings/tokens <ExternalLink className="w-3 h-3" /></a>
          . Copy it (it starts with <code>hf_</code>).
        </li>
        <li>Paste it below, press Save, then press Download on the model again.</li>
      </ol>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={e => { setValue(e.target.value); setMessage(null); }}
            onKeyDown={e => { if (e.key === 'Enter') void save(); }}
            placeholder={hasToken ? 'A token is saved. Paste a new one to replace it' : 'hf_xxxxxxxxxxxxxxxxxxxxxxxx'}
            autoComplete="off"
            spellCheck={false}
            disabled={!desktop}
            className="w-full text-xs font-mono px-3 py-2 pr-9 rounded-[12px] bg-[#080A0F] border border-white/[0.08] text-[#F5F7FA] placeholder-[#6F7888] focus:outline-none focus:border-[#00D9FF] disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setShow(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6F7888] hover:text-[#F5F7FA]"
            title={show ? 'Hide' : 'Show'}
          >
            {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <button
          onClick={() => void save()}
          disabled={!desktop || !value.trim()}
          className="px-3 py-2 rounded-[12px] text-xs font-semibold bg-[#00D9FF] text-[#080A0F] disabled:opacity-40"
        >
          Save
        </button>
        {hasToken && (
          <button
            onClick={() => void remove()}
            className="p-2 rounded-[12px] text-[#FF5C70] bg-[#181D27] hover:bg-[#FF5C70]/10"
            title="Remove the saved token"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {!desktop && <p className="text-[11px] text-[#FFB547]">Model downloads (and this token) work in the desktop app only.</p>}
      {message && (
        <p className={`text-[11px] ${message.kind === 'ok' ? 'text-[#32D583]' : 'text-[#FF5C70]'}`}>{message.text}</p>
      )}
      <p className="text-[11px] text-[#6F7888]">
        The token is kept on this computer and is only sent to huggingface.co when downloading. Never share it with anyone.
      </p>
    </div>
  );
}
