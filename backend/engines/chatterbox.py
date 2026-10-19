"""Chatterbox TTS (Resemble AI): default built-in voice, or clone from a reference clip."""
import os

from .common import decode_reference, to_mono_float32, write_temp_wav


class ChatterboxEngine:
    def __init__(self, model):
        self.model = model

    def synthesize(self, req):
        ref = decode_reference(req, required=False)
        path = write_temp_wav(*ref) if ref else None
        try:
            wav = self.model.generate(
                req["text"],
                audio_prompt_path=path,
                exaggeration=float(req.get("exaggeration", 0.5)),
                cfg_weight=float(req.get("cfg_weight", 0.5)),
                temperature=float(req.get("temperature", 0.8)),
            )
        finally:
            if path and os.path.exists(path):
                os.remove(path)
        return to_mono_float32(wav), int(self.model.sr)

    def voices(self):
        return []


def load(model_dir, device, progress=print):
    from chatterbox.tts import ChatterboxTTS

    for needed in ("ve.safetensors", "t3_cfg.safetensors", "s3gen.safetensors", "tokenizer.json"):
        if not os.path.isfile(os.path.join(model_dir, needed)):
            raise FileNotFoundError(f"{needed} is missing from the model folder - re-download the model.")
    progress(f"Loading Chatterbox on {device.upper()}...")
    return ChatterboxEngine(ChatterboxTTS.from_local(model_dir, device))
