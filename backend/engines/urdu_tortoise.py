"""Urdu TTS (ahmedHanzala/urdu-tts, weights zohann/urdu-tts): a Tortoise-TTS autoregressive model fine-tuned for
Urdu and voice cloning. Needs a reference clip. The fine-tuned model replaces Tortoise's autoregressive.pth; the other
Tortoise parts (diffusion decoder, CLVP, vocoder) are the stock ones, downloaded into  <model>/base/.
"""
import os
import re
from pathlib import Path

import numpy as np

from .common import UserError, decode_reference, to_mono_float32, write_temp_wav

BASE_FILES = ("diffusion_decoder.pth", "clvp2.pth", "vocoder.pth")


SAMPLE_URDU = "اردو ایک خوبصورت زبان ہے"


def check_urdu_vocabulary(tokenizer):
    """A vocabulary without Urdu letters would turn every character into [UNK]: refuse instead of producing noise."""
    ids = tokenizer.encode(SAMPLE_URDU)
    unk = tokenizer.tokenizer.token_to_id("[UNK]")
    if ids and unk is not None and sum(1 for i in ids if i == unk) / len(ids) > 0.5:
        raise FileNotFoundError(
            "The tokenizer found in the Urdu TTS folder does not contain Urdu letters, so speech would be noise. "
            "Re-download the model (the Urdu tokenizer file must be part of it).")


class UrduEngine:
    def __init__(self, tts, device, custom_tokenizer=False):
        self.tts, self.device, self.custom_tokenizer = tts, device, custom_tokenizer

    def synthesize(self, req):
        from tortoise.utils.audio import load_audio

        text = (req.get("text") or "").strip()
        if not text:
            raise UserError("There is no text to speak.")
        ref = decode_reference(req, required=True, model_hint="Urdu TTS (Tortoise)")
        path = write_temp_wav(*ref)
        try:
            samples = [load_audio(path, 22050)]
        finally:
            if os.path.exists(path):
                os.remove(path)
        preset = "fast" if self.device == "cuda" else "ultra_fast"
        gen = self.tts.tts_with_preset(text, voice_samples=samples, preset=preset, k=1)
        return to_mono_float32(gen), 24000

    def voices(self):
        return []


def _find_ar_checkpoint(root):
    for pattern in ("ar-model.pth", "**/ar-model.pth", "**/autoregressive*.pth"):
        found = sorted(root.glob(pattern))
        if found:
            return found[0]
    raise FileNotFoundError("ar-model.pth is missing - re-download the model.")


def _find_tokenizer(root):
    """A custom BPE vocabulary shipped with the model (name unknown: anything with tokenizer/vocab in its name)."""
    found = [p for p in root.glob("**/*.json") if re.search(r"tokeni[sz]er|vocab", p.name, re.I)
             and p.name.lower() not in ("tokenizer_config.json", "special_tokens_map.json") and "base" not in p.relative_to(root).parts[:1]]
    found.sort(key=lambda p: (0 if "urdu" in p.name.lower() else 1, len(p.parts), p.name))
    return found[0] if found else None


def load(model_dir, device, progress=print):
    root = Path(model_dir)
    ar = _find_ar_checkpoint(root)
    base = root / "base"
    missing = [n for n in BASE_FILES if not (base / n).is_file()]
    if missing:
        raise FileNotFoundError("Tortoise base files are missing (" + ", ".join(missing) + ") - open the Models page "
                                "and press Download to finish the missing files.")
    import tortoise.api as api

    local = {n: str(base / n) for n in BASE_FILES}
    local["autoregressive.pth"] = str(ar)
    # Tortoise normally downloads its weights on its own; point it at the files we already have instead.
    api.get_model_path = lambda name, models_dir=None: local[name]
    tokenizer = _find_tokenizer(root)
    progress(f"Loading Urdu Tortoise TTS on {device.upper()}... (this model is slow: expect minutes per sentence on CPU)")
    # With a custom (Urdu) vocabulary the text must NOT go through Tortoise's English cleaner: that one transliterates every
    # character to ASCII (unidecode), which destroys Urdu script. "basic cleaners" only lowercase and trim.
    tts = api.TextToSpeech(models_dir=str(base), enable_redaction=False, kv_cache=True, half=(device == "cuda"),
                           tokenizer_vocab_file=str(tokenizer) if tokenizer else None, tokenizer_basic=bool(tokenizer))
    if tokenizer:
        check_urdu_vocabulary(tts.tokenizer)
    return UrduEngine(tts, device, custom_tokenizer=bool(tokenizer))
    return UrduEngine(tts, device)
