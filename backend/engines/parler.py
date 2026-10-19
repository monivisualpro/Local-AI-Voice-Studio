"""Parler-TTS and Indic Parler-TTS: the voice is described in plain text (no reference audio).

Indic Parler-TTS (ai4bharat/indic-parler-tts) uses TWO different tokenizers:
  * the PROMPT tokenizer (the text that is spoken) lives inside the model folder
    (tokenizer.json / tokenizer.model ...) and knows the Indic scripts;
  * the DESCRIPTION tokenizer (the voice description) is the Flan-T5 tokenizer of the text
    encoder. The app downloads it next to the model into  <model>/description_tokenizer/ so the
    engine works fully offline.
Original Parler-TTS (parler-tts-mini-v1) uses one tokenizer for both.
"""
import json
import re
from pathlib import Path

from . import common
from .common import UserError, to_mono_float32

DEFAULT_DESCRIPTION = ("A female speaker delivers a slightly expressive and animated speech with a moderate speed "
                       "and pitch. The recording is of very high quality, with the speaker's voice sounding clear "
                       "and very close up.")

# Recommended named speakers from the Indic Parler-TTS model card (name, gender). A named speaker
# keeps the same voice across paragraphs, which is what makes long texts sound like ONE reading.
INDIC_SPEAKERS = {
    "hindi": [("Divya", "female"), ("Rohit", "male")],
    "bengali": [("Aditi", "female"), ("Arjun", "male")],
    "tamil": [("Jaya", "female")],
    "marathi": [("Sunita", "female"), ("Sanjay", "male")],
    "telugu": [("Lalitha", "female"), ("Prakash", "male")],
    "kannada": [("Anu", "female"), ("Suresh", "male")],
    "malayalam": [("Anjali", "female"), ("Harish", "male")],
    "gujarati": [("Neha", "female"), ("Yash", "male")],
    "odia": [("Debjani", "female"), ("Manas", "male")],
    "assamese": [("Sita", "female"), ("Amit", "male")],
    "bodo": [("Maya", "female"), ("Bikram", "male")],
    "nepali": [("Amrita", "female")],
    "sanskrit": [("Aryan", "male")],
    "dogri": [("Karan", "male")],
}
DEFAULT_SPEAKER = {"female": "Divya", "male": "Rohit"}

# Used when the UI sends a "Voice" id such as "male"/"female" instead of a free description.
GENDER_WORDS = {"female": "female", "male": "male"}

_SENTENCE_END = re.compile(r"(?<=[.!?\u0964\u0965\u06d4;:])\s+")


def _build_description(req, indic):
    description = (req.get("instruct") or "").strip()
    if description:
        return description
    gender = "female"
    voice = (req.get("gender") or req.get("voice") or "").lower()
    if voice in GENDER_WORDS:
        gender = GENDER_WORDS[voice]
    if indic:
        speaker = DEFAULT_SPEAKER[gender]
        return (f"{speaker}'s voice is clear and expressive with a moderate speed and pitch, "
                "in a very close recording with almost no background noise.")
    return DEFAULT_DESCRIPTION.replace("A female speaker", f"A {gender} speaker")


class ParlerEngine:
    def __init__(self, model, prompt_tokenizer, description_tokenizer, device, indic=False):
        self.model = model
        self.prompt_tokenizer = prompt_tokenizer
        self.description_tokenizer = description_tokenizer
        self.device = device
        self.indic = indic

    def _encode(self, tokenizer, text):
        enc = tokenizer(text, return_tensors="pt")
        return enc.input_ids.to(self.device), enc.attention_mask.to(self.device)

    def _frame_rate(self):
        try:
            return float(self.model.config.audio_encoder.frame_rate)
        except Exception:
            return 86.0

    def _token_budget(self, text):
        """Hard cap of codec frames for one piece. Without it a piece whose end-of-speech token never comes runs to the
        model default (~30 s) - the long silent / repeating stretch in the finished audio."""
        seconds = len(text) / 7.0 + 1.5  # 7 characters per second is slower than any real speech
        try:
            books = int(self.model.config.decoder.num_codebooks)
        except Exception:
            books = 9
        return int(min(2580, max(120, seconds * self._frame_rate() + books + 2)))

    def _generate(self, desc_ids, desc_mask, text, temperature, max_new_tokens=None):
        import torch

        prompt_ids, prompt_mask = self._encode(self.prompt_tokenizer, text)
        kwargs = dict(input_ids=desc_ids, attention_mask=desc_mask,
                      prompt_input_ids=prompt_ids, prompt_attention_mask=prompt_mask)
        if max_new_tokens:
            kwargs["max_new_tokens"] = int(max_new_tokens)
        if temperature:
            kwargs.update(do_sample=True, temperature=float(temperature))
        common.raise_if_cancelled()
        with torch.inference_mode():
            return self.model.generate(**kwargs)

    def _piece(self, desc_ids, desc_mask, piece, temperature):
        """One piece of text -> audio, checked: a take that runs away, is cut short or corrupt is redone (up to 2 times)
        with calmer sampling, then silence is compacted."""
        import numpy as np

        piece = _ensure_terminal(piece)
        sr = int(self.model.config.sampling_rate)
        budget = self._token_budget(piece)
        max_sec = len(piece) / 6.0 + 2.0
        min_sec = len(piece) / 30.0
        temp = float(temperature) if temperature else 0.7
        best = None
        for attempt in range(3):
            raw = to_mono_float32(self._generate(desc_ids, desc_mask, piece, temp, budget))
            hit_cap = len(raw) / sr * self._frame_rate() >= budget - 2
            audio = common.compact_silence(np.nan_to_num(raw), sr)
            seconds = len(audio) / sr
            bad = (not np.isfinite(raw).all()) or hit_cap or seconds > max_sec or seconds < min_sec
            if not bad:
                return audio
            if attempt < 2:
                print(f"[tts] suspicious take ({seconds:.1f}s speech for {len(piece)} chars) - retry {attempt + 1}/2", flush=True)
            if best is None or abs(seconds - len(piece) / 13.0) < abs(len(best) / sr - len(piece) / 13.0):
                best = audio
            temp = max(0.3, temp * 0.75)
        return best

    def synthesize(self, req):
        import numpy as np

        text = (req.get("text") or "").strip()
        if not text:
            raise UserError("There is no text to speak.")
        description = _build_description(req, self.indic)
        desc_ids, desc_mask = self._encode(self.description_tokenizer, description)
        temperature = req.get("temperature")

        # The backend is called once per chunk by the app; a very long chunk is split further here
        # (sentence boundaries) because Parler degrades past ~30 s of audio per generation.
        pieces = _split_for_model(text, 140 if self.indic else 200)
        parts = []
        for piece in pieces:
            parts.append(self._piece(desc_ids, desc_mask, piece, temperature))
        sr = int(self.model.config.sampling_rate)
        if len(parts) == 1:
            return parts[0], sr
        gap = np.zeros(int(sr * 0.18), dtype=np.float32)
        out = []
        for i, p in enumerate(parts):
            out.append(p)
            if i < len(parts) - 1:
                out.append(gap)
        return np.concatenate(out), sr

    def voices(self):
        names = []
        if self.indic:
            for lang_voices in INDIC_SPEAKERS.values():
                for name, _g in lang_voices:
                    if name not in names:
                        names.append(name)
        return names


_TERMINAL = ".!?\u0964\u0965\u06d4"


def _ensure_terminal(piece):
    """Parler needs a sentence end to know where to stop: a piece without one gets a danda (Indic) or a full stop."""
    piece = piece.strip()
    if not piece or piece[-1] in _TERMINAL + "\"')”":
        return piece
    piece = piece.rstrip(",;:- ")
    return piece + ("\u0964" if re.search(r"[\u0900-\u097f]", piece) else ".")


def _split_for_model(text, limit):
    if len(text) <= limit:
        return [text]
    pieces, current = [], ""
    for sentence in _SENTENCE_END.split(text):
        sentence = sentence.strip()
        if not sentence:
            continue
        while len(sentence) > limit:  # a single endless sentence: cut at the last space
            cut = sentence.rfind(" ", 0, limit)
            cut = cut if cut > 40 else limit
            if current:
                pieces.append(current)
                current = ""
            pieces.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        if not current:
            current = sentence
        elif len(current) + 1 + len(sentence) <= limit:
            current += " " + sentence
        else:
            pieces.append(current)
            current = sentence
    if current:
        pieces.append(current)
    return pieces or [text]


def _is_indic(model_dir):
    cfg = Path(model_dir) / "config.json"
    if (Path(model_dir) / "description_tokenizer").is_dir():
        return True
    try:
        data = json.loads(cfg.read_text(encoding="utf-8"))
    except Exception:
        return False
    return "indic" in json.dumps(data.get("_name_or_path", "")).lower()


def load(model_dir, device, progress=print):
    import torch
    from parler_tts import ParlerTTSForConditionalGeneration
    from transformers import AutoTokenizer

    root = Path(model_dir)
    if not (root / "config.json").is_file():
        raise FileNotFoundError(f"config.json not found in {root} - re-download the model.")
    if not any(root.glob("*.safetensors")) and not (root / "pytorch_model.bin").is_file():
        raise FileNotFoundError("The model weights (model.safetensors) are missing - re-download the model.")

    indic = _is_indic(root)
    # bfloat16 is what the model authors use on GPU; fall back to float32 (never float16: the audio codec
    # overflows) on older cards and on CPU.
    use_bf16 = device == "cuda" and torch.cuda.is_bf16_supported()
    dtype = torch.bfloat16 if use_bf16 else torch.float32
    progress(f"Loading {'Indic ' if indic else ''}Parler-TTS on {device.upper()}...")
    model = ParlerTTSForConditionalGeneration.from_pretrained(str(root), torch_dtype=dtype).to(device)
    model.eval()

    progress("Loading tokenizers...")
    prompt_tokenizer = AutoTokenizer.from_pretrained(str(root))
    desc_dir = root / "description_tokenizer"
    if desc_dir.is_dir():
        description_tokenizer = AutoTokenizer.from_pretrained(str(desc_dir))
    elif indic:
        raise FileNotFoundError(
            "The description tokenizer (Flan-T5) is missing from the Indic Parler-TTS folder - "
            "open the Models page and press Download to finish the missing files.")
    else:
        description_tokenizer = prompt_tokenizer  # original Parler-TTS: one tokenizer for both
    return ParlerEngine(model, prompt_tokenizer, description_tokenizer, device, indic)
