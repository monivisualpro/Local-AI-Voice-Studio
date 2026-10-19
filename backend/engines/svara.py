"""Svara-TTS (Kenpath): 19 Indian languages, named speakers ("Hindi (Female)"), Orpheus/SNAC architecture.

The SNAC 24 kHz audio codec is downloaded next to the model (snac_24khz/) so the engine works fully offline.
"""
from pathlib import Path

import numpy as np

from .common import UserError
from .svara_tokens import END_OF_SPEECH, build_prompt_ids, extract_snac_codes, speaker_id

EMOTION_TAGS = ("happy", "sad", "anger", "fear", "clear")


class SvaraEngine:
    def __init__(self, model, tokenizer, snac, device):
        self.model, self.tokenizer, self.snac, self.device = model, tokenizer, snac, device

    def synthesize(self, req):
        import torch

        text = (req.get("text") or "").strip()
        if not text:
            raise UserError("There is no text to speak.")
        speaker = speaker_id(req.get("voice"), req.get("lang") or req.get("language"), req.get("gender"))
        text_ids = self.tokenizer(f"{speaker}: {text}", add_special_tokens=False).input_ids
        input_ids = torch.tensor([build_prompt_ids(text_ids)], dtype=torch.long, device=self.device)
        temperature = float(req.get("temperature") or 0.6)
        with torch.inference_mode():
            out = self.model.generate(
                input_ids=input_ids, attention_mask=torch.ones_like(input_ids),
                max_new_tokens=7 * 90 * 24,  # ~24 s of audio at ~90 frames/s
                do_sample=True, temperature=temperature, top_p=0.9, repetition_penalty=1.1,
                eos_token_id=END_OF_SPEECH, pad_token_id=END_OF_SPEECH)
        layers = extract_snac_codes(out[0, input_ids.shape[1]:].tolist())
        if layers is None:
            raise UserError("Svara-TTS produced no audio for this text. Try a shorter sentence or add punctuation.")
        with torch.inference_mode():
            codes = [torch.from_numpy(np.asarray(c)).long().unsqueeze(0).to(self.device) for c in layers]
            audio = self.snac.decode(codes)
        wav = audio.detach().float().cpu().numpy().reshape(-1)
        return wav, 24000

    def voices(self):
        return []


def load(model_dir, device, progress=print):
    import torch
    from snac import SNAC
    from transformers import AutoModelForCausalLM, AutoTokenizer

    root = Path(model_dir)
    snac_dir = root / "snac_24khz"
    if not (snac_dir / "pytorch_model.bin").is_file():
        raise FileNotFoundError("The SNAC audio codec (snac_24khz) is missing - open the Models page and press "
                                "Download to finish the missing files.")
    use_bf16 = device == "cuda" and torch.cuda.is_bf16_supported()
    dtype = torch.bfloat16 if use_bf16 else (torch.float16 if device == "cuda" else torch.float32)
    progress(f"Loading Svara-TTS (3B) on {device.upper()}...")
    tokenizer = AutoTokenizer.from_pretrained(str(root))
    model = AutoModelForCausalLM.from_pretrained(str(root), torch_dtype=dtype).to(device).eval()
    progress("Loading SNAC audio codec...")
    snac = SNAC.from_pretrained(str(snac_dir)).eval().to(device)
    return SvaraEngine(model, tokenizer, snac, device)
