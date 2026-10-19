"""Sooktam-2 (BharatGen): 12 Indian languages, F5-TTS based, voice cloning from a reference clip + its transcript.

The model folder is self-contained: it ships its own patched `f5_tts` package in  <model>/src  (the app downloads
it with the weights), so this environment must NOT install the public f5-tts package.
"""
import os
import sys
from pathlib import Path

from .common import UserError, decode_reference, to_mono_float32, write_temp_wav

# UI language label -> Sooktam "cls_language" value (lower-case language name, as in the model card example).
CLS_LANGUAGES = {
    "hindi": "hindi", "marathi": "marathi", "gujarati": "gujarati", "tamil": "tamil", "telugu": "telugu",
    "kannada": "kannada", "bengali": "bengali", "malayalam": "malayalam", "odia": "odia", "urdu": "urdu",
    "punjabi": "punjabi", "english": "english", "american english": "english", "british english": "english",
    "indian english": "english",
}


class SooktamEngine:
    def __init__(self, model, root):
        self.model, self.root = model, Path(root)

    def _default_reference(self):
        """The sample clip shipped inside the model repo (Hindi). Used only when the user adds no reference."""
        wav = self.root / "ref.wav"
        if wav.is_file():
            return str(wav), ("सर, मैं तब से यह कह रहा हूँ कि मैंने अपना टिकट कैंसल कर दिया है, लेकिन अब तक मेरे पैसे वापस नहीं आए हैं। "
                              "आप इस मामले को देखेंगे भी या नहीं?")
        return None

    def synthesize(self, req):
        text = (req.get("text") or "").strip()
        if not text:
            raise UserError("There is no text to speak.")
        language = CLS_LANGUAGES.get((req.get("lang") or req.get("language") or "hindi").strip().lower())
        if language is None:
            raise UserError(f"Sooktam-2 does not support the language \"{req.get('lang') or req.get('language')}\". Supported: Hindi, "
                            "Marathi, Gujarati, Tamil, Telugu, Kannada, Bengali, Malayalam, Odia, Urdu, Punjabi, "
                            "Indian English.")
        ref = decode_reference(req, required=False)
        ref_text = (req.get("ref_text") or "").strip()
        temp = None
        try:
            if ref is not None:
                if not ref_text:
                    raise UserError("Sooktam-2 needs the transcript of the reference audio (the exact words spoken in "
                                    "the clip, in the same language). Type it in the 'Reference text' field.")
                ref_path = temp = write_temp_wav(*ref)
            else:
                default = self._default_reference()
                if default is None:
                    raise UserError("Sooktam-2 clones a voice: add a 3-10 second reference clip and type what it says.")
                ref_path, ref_text = default
            wav, sr, _ = self.model.infer(ref_file=ref_path, ref_text=ref_text, gen_text=text,
                                          tokenizer="cls", cls_language=language)
        finally:
            if temp and os.path.exists(temp):
                os.remove(temp)
        return to_mono_float32(wav), int(sr)

    def voices(self):
        return []


def load(model_dir, device, progress=print):
    root = Path(model_dir)
    for need in ("config.json", "hf_auto.py", "vocab.txt"):
        if not (root / need).is_file():
            raise FileNotFoundError(f"{need} is missing from the Sooktam-2 folder - open the Models page and press "
                                    "Download to finish the missing files.")
    if not any(root.glob("model_*.pt")) and not any(root.glob("*.safetensors")):
        raise FileNotFoundError("The Sooktam-2 weights are missing - re-download the model.")
    for p in (str(root / "src"), str(root)):
        if p not in sys.path:
            sys.path.insert(0, p)
    try:
        from transformers import AutoModel
    except ImportError as exc:
        raise FileNotFoundError(f"transformers is not installed in this environment: {exc}") from exc
    progress(f"Loading Sooktam-2 on {device.upper()}... (the vocoder may download once on first use)")
    try:
        model = AutoModel.from_pretrained(str(root), trust_remote_code=True)
    except ModuleNotFoundError as exc:
        raise FileNotFoundError(
            f"Sooktam-2 needs the Python package \"{exc.name}\", which is not installed in its environment. "
            "Open Settings -> Environments and press Repair for Sooktam-2.") from exc
    try:
        model = model.to(device)
    except Exception:  # some wrappers manage their own device
        pass
    return SooktamEngine(model, root)
