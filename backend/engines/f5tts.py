"""F5-TTS: zero-shot voice cloning. Needs reference audio AND its transcript."""
import os
from pathlib import Path

from .common import UserError, decode_reference, to_mono_float32, write_temp_wav


class F5Engine:
    def __init__(self, model):
        self.model = model

    def synthesize(self, req):
        ref = decode_reference(req, required=True, model_hint="F5-TTS")
        ref_text = (req.get("ref_text") or "").strip()
        if not ref_text:
            raise UserError(
                "F5-TTS needs the transcript of the reference audio (what is said in the clip). "
                "Type it in the reference audio's 'Reference text' field, then generate again.")
        path = write_temp_wav(*ref)
        try:
            wav, sr, _ = self.model.infer(
                ref_file=path, ref_text=ref_text, gen_text=req["text"],
                speed=float(req.get("speed") or 1.0), remove_silence=False)
        finally:
            if os.path.exists(path):
                os.remove(path)
        return to_mono_float32(wav), int(sr)

    def voices(self):
        return []


def _find_checkpoint(model_dir):
    root = Path(model_dir)
    preferred = sorted(root.glob("F5TTS_v1_Base/model_*.safetensors")) or sorted(root.glob("F5TTS_v1_Base/model_*.pt"))
    if preferred:
        return preferred[-1], "F5TTS_v1_Base"
    for pattern, name in (("F5TTS_Base/model_*.safetensors", "F5TTS_Base"), ("**/model_*.safetensors", "F5TTS_v1_Base"),
                          ("**/*.safetensors", "F5TTS_v1_Base"), ("**/*.pt", "F5TTS_v1_Base")):
        found = sorted(root.glob(pattern))
        if found:
            return found[-1], name
    raise FileNotFoundError("No F5-TTS checkpoint (model_*.safetensors) found - re-download the model.")


def load(model_dir, device, progress=print):
    from f5_tts.api import F5TTS

    ckpt, arch = _find_checkpoint(model_dir)
    vocab = next(iter(sorted(Path(model_dir).glob("**/vocab.txt"))), None)
    progress(f"Loading F5-TTS ({arch}) on {device.upper()}... (the vocoder downloads once on first use)")
    model = F5TTS(model=arch, ckpt_file=str(ckpt), vocab_file=str(vocab) if vocab else "", device=device)
    return F5Engine(model)
