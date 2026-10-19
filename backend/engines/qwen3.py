"""Qwen3-TTS (Base = voice cloning, VoiceDesign = describe a voice, CustomVoice = built-in speakers)."""
import hashlib
import re

import numpy as np
from pathlib import Path

from . import common
from .common import UserError, decode_reference, pick_language, to_mono_float32

_CJK = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]")


def token_budget(text):
    """Upper bound of audio frames (12.5 per second of speech) a text can reasonably need.

    Without it a segment where the model never emits its end-of-speech token runs for the library default of
    2048 frames (~160 s of audio): on a CPU that is many minutes of silent 100 % load that looks like a freeze.
    """
    per_char = 6.0 if _CJK.search(text) else 3.5
    return int(min(2048, max(160, len(text) * per_char + 64)))

SUPPORTED = ["chinese", "english", "german", "italian", "portuguese", "spanish",
             "japanese", "korean", "french", "russian"]


class Qwen3Engine:
    def __init__(self, model, kind):
        self.model = model
        self.kind = kind  # base | voice_design | custom_voice
        self._prompt_cache = {}

    def _language(self, req):
        supported = self.model.get_supported_languages() or SUPPORTED
        return pick_language(req.get("lang"), list(supported) + ["auto"], "auto")

    def synthesize(self, req):
        import torch

        text = req["text"]
        lang = self._language(req)
        gen = {"max_new_tokens": token_budget(text), "repetition_penalty": 1.1}
        try:
            temp = float(req.get("temperature"))
            if 0.05 <= temp <= 1.5:
                gen["temperature"] = temp
                gen["subtalker_temperature"] = temp
        except (TypeError, ValueError):
            pass
        common.raise_if_cancelled()
        return self._guarded(text, gen, lambda g: self._generate(req, text, lang, g))

    def _guarded(self, text, gen, run):
        """Generates, then checks the result. A take that hit the length cap (runaway babble), is far too long for the
        text, or contains NaN is the typical "glitching voice": it is retried with calmer sampling (up to 2 times)."""
        cjk = bool(_CJK.search(text))
        max_seconds = len(text) / (1.5 if cjk else 4.0) + 3.0
        best = None
        for attempt in range(3):
            wav, sr = run(gen)
            seconds = len(wav) / float(sr)
            frames = seconds * 12.5
            bad = (not np.isfinite(wav).all()) or frames >= gen["max_new_tokens"] - 2 or seconds > max_seconds
            if not bad:
                return wav, sr
            if attempt < 2:
                print(f"[tts] suspicious take ({seconds:.1f}s for {len(text)} chars) - retry {attempt + 1}/2 with calmer sampling", flush=True)
            if best is None or (np.isfinite(wav).all() and seconds < len(best[0]) / float(best[1])):
                best = (np.nan_to_num(wav), sr)
            gen = dict(gen, temperature=max(0.3, gen.get("temperature", 0.9) * 0.75),
                       subtalker_temperature=max(0.3, gen.get("subtalker_temperature", 0.9) * 0.75),
                       repetition_penalty=min(1.3, gen["repetition_penalty"] + 0.07))
            common.raise_if_cancelled()
        return best

    def _generate(self, req, text, lang, gen):
        import torch
        with torch.inference_mode():
            if self.kind == "base":
                ref = decode_reference(req, required=True, model_hint="Qwen3-TTS Base")
                ref_text = (req.get("ref_text") or "").strip()
                audio, ref_sr = ref
                audio = common.clean_reference(audio, ref_sr)
                # A long clip with a transcript makes the model's prompt huge and its speech drift/glitch; a transcript
                # that no longer matches a cut clip is worse. So: > 15 s -> speaker-embedding mode, cut to 12 s.
                if len(audio) / ref_sr > 15:
                    ref_text = ""
                if not ref_text:
                    audio = audio[: int(ref_sr * 12)]
                ref = (audio, ref_sr)
                xvec_only = not ref_text  # no transcript -> speaker-embedding-only cloning
                key = hashlib.sha1(ref[0].tobytes() + ref_text.encode() + bytes([xvec_only])).hexdigest()
                prompt = self._prompt_cache.get(key)
                if prompt is None:
                    prompt = self.model.create_voice_clone_prompt(
                        ref_audio=ref, ref_text=ref_text or None, x_vector_only_mode=xvec_only)
                    if len(self._prompt_cache) >= 4:
                        self._prompt_cache.pop(next(iter(self._prompt_cache)))
                    self._prompt_cache[key] = prompt
                wavs, sr = self.model.generate_voice_clone(text=text, language=lang, voice_clone_prompt=prompt, **gen)
            elif self.kind == "voice_design":
                instruct = (req.get("instruct") or "").strip()
                if not instruct:
                    raise UserError(
                        "Qwen3-TTS VoiceDesign needs a voice description, e.g. "
                        "\"A warm, calm middle-aged female voice with a slight British accent\". "
                        "Pick a Design voice or type a description, then generate again.")
                wavs, sr = self.model.generate_voice_design(text=text, instruct=instruct, language=lang, **gen)
            elif self.kind == "custom_voice":
                speakers = self.model.get_supported_speakers() or []
                voice = (req.get("voice") or "").lower()
                speaker = voice if voice in speakers else (speakers[0] if speakers else None)
                if not speaker:
                    raise UserError("This CustomVoice model reports no built-in speakers.")
                wavs, sr = self.model.generate_custom_voice(
                    text=text, speaker=speaker, language=lang, instruct=(req.get("instruct") or None), **gen)
            else:
                raise UserError(f"Unsupported Qwen3-TTS variant: {self.kind}")
        return to_mono_float32(wavs[0]), int(sr)

    def voices(self):
        try:
            return list(self.model.get_supported_speakers() or [])
        except Exception:
            return []


def load(model_dir, device, progress=print):
    import torch
    from qwen_tts import Qwen3TTSModel

    root = Path(model_dir)
    if not (root / "config.json").is_file():
        raise FileNotFoundError(f"config.json not found in {root}")
    if not (root / "speech_tokenizer").is_dir():
        raise FileNotFoundError(
            "The 'speech_tokenizer' folder is missing from the model - open the Models page and press Download to finish the missing files (finished files are kept).")

    kwargs = {}
    if device == "cuda":
        kwargs["device_map"] = "cuda:0"
        # float16 makes Qwen3-TTS produce garbled / glitching speech (and NaNs) on GPUs without bfloat16
        # (GTX 10/16, RTX 20, T4...). float32 is slower but clean, and the 0.6B model fits easily.
        kwargs["dtype"] = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32
        try:
            import flash_attn  # noqa: F401
            kwargs["attn_implementation"] = "flash_attention_2"
        except Exception:
            pass
    else:
        kwargs["device_map"] = "cpu"
        kwargs["dtype"] = torch.float32
    threads = common.cpu_threads()
    if threads and device == "cpu":
        torch.set_num_threads(threads)
    progress(f"Loading Qwen3-TTS weights on {device.upper()}...")
    model = Qwen3TTSModel.from_pretrained(str(root), **kwargs)
    kind = getattr(model.model, "tts_model_type", "base")
    # One call per generated audio frame: counts progress for the UI and lets Stop interrupt a running segment
    # within a fraction of a second (the exception unwinds through HuggingFace generate()).
    talker = getattr(model.model, "talker", None)
    if talker is not None:
        talker.register_forward_pre_hook(lambda module, args: common.tick())
    progress(f"Qwen3-TTS ready ({kind}).")
    return Qwen3Engine(model, kind)
