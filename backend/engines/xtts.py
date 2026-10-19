"""Coqui XTTS-v2: multilingual voice cloning; falls back to a built-in speaker without reference audio."""
import os
from pathlib import Path

from .common import decode_reference, pick_language, to_mono_float32, write_temp_wav

LANGS = {"english": "en", "spanish": "es", "french": "fr", "german": "de", "italian": "it", "portuguese": "pt",
         "polish": "pl", "turkish": "tr", "russian": "ru", "dutch": "nl", "czech": "cs", "arabic": "ar",
         "chinese": "zh-cn", "japanese": "ja", "hungarian": "hu", "korean": "ko", "hindi": "hi"}


class XttsEngine:
    def __init__(self, model):
        self.model = model
        self._default = None

    def _latents(self, req):
        ref = decode_reference(req, required=False)
        if ref:
            path = write_temp_wav(*ref)
            try:
                return self.model.get_conditioning_latents(audio_path=[path])
            finally:
                if os.path.exists(path):
                    os.remove(path)
        if self._default is None:
            manager = getattr(self.model, "speaker_manager", None)
            if not manager or not manager.speakers:
                from .common import UserError
                raise UserError("XTTS needs a reference audio clip (no built-in speakers were found in this download).")
            name = "Claribel Dervla" if "Claribel Dervla" in manager.speakers else next(iter(manager.speakers))
            self._default = tuple(manager.speakers[name].values())
        return self._default

    def synthesize(self, req):
        lang_name = pick_language(req.get("lang"), list(LANGS.keys()), "english")
        cond, emb = self._latents(req)
        out = self.model.inference(req["text"], LANGS[lang_name], cond, emb, speed=float(req.get("speed") or 1.0))
        return to_mono_float32(out["wav"]), 24000

    def voices(self):
        return []


def _patch_audio_loading():
    """coqui-tts loads reference audio with torchaudio.load, which needs torchcodec + FFmpeg since
    torchaudio 2.9. Our reference clips are always plain WAV, so read them with soundfile instead."""
    import soundfile as sf
    import torch
    import torchaudio
    import TTS.tts.models.xtts as xtts_module

    def load_audio(audiopath, sampling_rate):
        data, sr = sf.read(audiopath, dtype="float32", always_2d=True)  # (samples, channels)
        audio = torch.from_numpy(data.T.copy())                          # (channels, samples)
        if audio.size(0) != 1:
            audio = audio.mean(dim=0, keepdim=True)
        if sr != sampling_rate:
            audio = torchaudio.functional.resample(audio, sr, sampling_rate)
        return audio.clamp_(-1, 1)

    xtts_module.load_audio = load_audio


def load(model_dir, device, progress=print):
    from TTS.tts.configs.xtts_config import XttsConfig
    from TTS.tts.models.xtts import Xtts

    _patch_audio_loading()

    config_path = os.path.join(model_dir, "config.json")
    if not os.path.isfile(config_path):
        raise FileNotFoundError(f"config.json not found in {model_dir}")
    if not (Path(model_dir) / "model.pth").is_file():
        raise FileNotFoundError("model.pth is missing from the XTTS folder - re-download the model.")
    config = XttsConfig()
    config.load_json(config_path)
    model = Xtts.init_from_config(config)
    progress(f"Loading XTTS-v2 on {device.upper()}...")
    model.load_checkpoint(config, checkpoint_dir=model_dir, eval=True)
    model.to(device)
    return XttsEngine(model)
