"""Svara-TTS token handling (pure Python + numpy, no torch) so it can be unit-tested anywhere.

Prompt layout (from the official Kenpath/svara-tts-inference encoder):
    <|begin_of_text|> <custom_token_3> <|audio|> {speaker}: {text} <custom_token_4> <|eot_id|> <custom_token_5> <custom_token_1>
The model then generates SNAC audio tokens (7 per frame) and finishes with <custom_token_2> (END_OF_SPEECH).
"""
import numpy as np

BOS_TOKEN = 128000
END_OF_TURN = 128009
AUDIO_TOKEN = 156939
START_OF_SPEECH = 128257
END_OF_SPEECH = 128258
START_OF_HUMAN = 128259
END_OF_HUMAN = 128260
START_OF_AI = 128261
AUDIO_TOKENS_START = 128266
AUDIO_VOCAB_SIZE = 4096
CODES_PER_FRAME = 7

# UI language -> Svara speaker language name (the speaker id is "<Language> (<Gender>)").
SVARA_LANGUAGES = {
    "hindi": "Hindi", "bengali": "Bengali", "marathi": "Marathi", "telugu": "Telugu", "kannada": "Kannada",
    "bhojpuri": "Bhojpuri", "magahi": "Magahi", "chhattisgarhi": "Chhattisgarhi", "maithili": "Maithili",
    "assamese": "Assamese", "bodo": "Bodo", "dogri": "Dogri", "gujarati": "Gujarati", "malayalam": "Malayalam",
    "punjabi": "Punjabi", "tamil": "Tamil", "nepali": "Nepali", "sanskrit": "Sanskrit",
    "english": "English (Indian)", "american english": "English (Indian)", "british english": "English (Indian)",
    "indian english": "English (Indian)", "english (indian)": "English (Indian)",
}
VOICE_ID_LANG = {  # official voice_id prefixes (hi_male ...) -> language name
    "hi": "Hindi", "bn": "Bengali", "mr": "Marathi", "te": "Telugu", "kn": "Kannada", "bh": "Bhojpuri",
    "mag": "Magahi", "hne": "Chhattisgarhi", "mai": "Maithili", "as": "Assamese", "brx": "Bodo", "doi": "Dogri",
    "gu": "Gujarati", "ml": "Malayalam", "pa": "Punjabi", "ta": "Tamil", "en": "English (Indian)", "ne": "Nepali",
    "sa": "Sanskrit",
}


def speaker_id(voice, language, gender):
    """Returns e.g. 'Hindi (Female)'. `voice` may already be a speaker id or an official voice_id (hi_female)."""
    v = (voice or "").strip()
    if v.endswith(")") and "(" in v and v.rsplit("(", 1)[1][:-1].lower() in ("male", "female"):
        return v
    if "_" in v and v.split("_")[0] in VOICE_ID_LANG and v.split("_")[1] in ("male", "female"):
        return f"{VOICE_ID_LANG[v.split('_')[0]]} ({v.split('_')[1].capitalize()})"
    lang = SVARA_LANGUAGES.get((language or "english").strip().lower(), "English (Indian)")
    g = "Male" if str(gender or "").lower() == "male" else "Female"
    return f"{lang} ({g})"


def build_prompt_ids(text_ids):
    """text_ids: token ids of '<speaker>: <text>' tokenized WITHOUT special tokens."""
    return ([BOS_TOKEN, START_OF_HUMAN, AUDIO_TOKEN] + list(text_ids)
            + [END_OF_HUMAN, END_OF_TURN, START_OF_AI, START_OF_SPEECH])


def extract_snac_codes(generated_ids):
    """Generated token ids -> three SNAC code layers (each a 1-D int array), or None if nothing usable.

    Mirrors the official mapper: keep audio tokens only; code = id - 128266 - (position % 7) * 4096;
    whole frames of 7; layer0 = col 0, layer1 = cols (1, 4), layer2 = cols (2, 3, 5, 6).
    """
    ids = np.asarray(list(generated_ids), dtype=np.int64)
    ids = ids[(ids >= AUDIO_TOKENS_START) & (ids < AUDIO_TOKENS_START + CODES_PER_FRAME * AUDIO_VOCAB_SIZE)]
    n = (len(ids) // CODES_PER_FRAME) * CODES_PER_FRAME
    if n == 0:
        return None
    ids = ids[:n]
    pos = np.arange(n) % CODES_PER_FRAME
    codes = ids - AUDIO_TOKENS_START - pos * AUDIO_VOCAB_SIZE
    # A token from the wrong band (model glitch) would be out of range: clamp instead of crashing the decoder.
    codes = np.clip(codes, 0, AUDIO_VOCAB_SIZE - 1).reshape(-1, CODES_PER_FRAME)
    return codes[:, 0], codes[:, [1, 4]].reshape(-1), codes[:, [2, 3, 5, 6]].reshape(-1)
