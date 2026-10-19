"""Shared helpers for engines: reference-audio decoding, temp files, language mapping."""
import base64
import io
import os
import tempfile
import threading
import time

import numpy as np
import soundfile as sf

MAX_REF_SECONDS = 30


class UserError(Exception):
    """A problem the user can fix (missing reference audio, wrong language...). Shown as-is in the UI."""


def decode_reference(req, required=True, model_hint=""):
    """Returns (mono float32 ndarray, sample_rate) from req['ref_audio_b64'], or None."""
    b64 = req.get("ref_audio_b64")
    if not b64:
        if required:
            raise UserError(
                f"{model_hint or 'This model'} clones a voice, so it needs a reference audio clip "
                "(3-20 seconds of clean speech). Add or select one in the Reference Voice section, then generate again."
            )
        return None
    data, sr = sf.read(io.BytesIO(base64.b64decode(b64)), dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=-1)
    limit = int(sr * MAX_REF_SECONDS)
    if len(data) > limit:
        data = data[:limit]
    if len(data) < int(sr * 0.5):
        raise UserError("The reference audio is too short - use at least 3 seconds of clear speech.")
    return np.ascontiguousarray(data, dtype=np.float32), int(sr)


def write_temp_wav(data, sr):
    fd, path = tempfile.mkstemp(suffix=".wav", prefix="tts_ref_")
    os.close(fd)
    sf.write(path, data, sr, subtype="PCM_16")
    return path


def pick_language(requested, supported, default="auto"):
    """Maps a UI language label ('English', 'Mandarin', 'American English'...) to one of `supported`."""
    text = (requested or "").strip().lower()
    aliases = {"mandarin": "chinese", "american english": "english", "british english": "english",
               "cantonese": "chinese"}
    text = aliases.get(text, text)
    for name in supported:
        if text == name or text.startswith(name):
            return name
    for name in supported:
        if name in text:
            return name
    return default


def to_mono_float32(audio):
    """Accepts torch tensors / numpy arrays of any shape -> 1-D float32 numpy array."""
    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().float().numpy()
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim > 1:
        audio = audio.reshape(-1) if audio.shape[0] == 1 else audio.mean(axis=0)
    return audio


# ---------------------------------------------------------------------------
# Cancellation + live progress (shared by server.py and the engines)
# ---------------------------------------------------------------------------
class Cancelled(Exception):
    """Raised inside a running generation when the user pressed Stop."""


_CTX = threading.local()
_EPOCH = {"n": 0}
PROGRESS = {"busy": False, "steps": 0, "started": 0.0, "chars": 0}


def current_epoch():
    return _EPOCH["n"]


def cancel_all():
    """Stops the running generation (and any request that arrived before this call)."""
    _EPOCH["n"] += 1


def begin_job(epoch, chars):
    _CTX.epoch = epoch
    PROGRESS.update(busy=True, steps=0, started=time.time(), chars=chars)
    raise_if_cancelled()


def end_job():
    _CTX.epoch = None
    PROGRESS["busy"] = False


def raise_if_cancelled():
    epoch = getattr(_CTX, "epoch", None)
    if epoch is not None and epoch != _EPOCH["n"]:
        raise Cancelled("cancelled")


def tick():
    """Called once per generated audio frame (cheap). Counts progress and honours Stop."""
    PROGRESS["steps"] += 1
    raise_if_cancelled()


def cpu_threads():
    """TTS_CPU_THREADS env override; otherwise None (PyTorch picks the physical core count)."""
    try:
        n = int(os.environ.get("TTS_CPU_THREADS", "0"))
        return n if n > 0 else None
    except ValueError:
        return None


def clean_reference(data, sr, max_seconds=None):
    """Makes a reference clip safe for cloning: removes DC offset and silence at both ends, normalises the level.

    Long, quiet or silence-padded clips are a common cause of garbled / "glitching" cloned speech: the model copies
    the silence and the noise floor of the clip as if they were part of the voice.
    """
    data = np.asarray(data, dtype=np.float32)
    if data.size == 0:
        return data
    peak = float(np.max(np.abs(data - np.median(data))))
    if peak < 1e-4:
        raise UserError("The reference audio is silent. Choose a clip with clear speech.")
    thresh = peak * 0.02  # about -34 dB below the peak
    loud = np.flatnonzero(np.abs(data - np.median(data)) > thresh)
    if loud.size:
        pad = int(sr * 0.15)
        data = data[max(0, loud[0] - pad): min(len(data), loud[-1] + pad)]
    if max_seconds:
        data = data[: int(sr * max_seconds)]
    data = data - float(np.mean(data))  # remove DC offset (after trimming, so silence padding cannot skew it)
    peak = float(np.max(np.abs(data))) or 1.0
    return np.ascontiguousarray(data * (0.95 / peak), dtype=np.float32)


def compact_silence(data, sr, max_gap=0.45, lead=0.08, tail=0.25):
    """Removes the dead air some models add: long silent gaps are shortened, the ends are trimmed.

    Indic Parler (and other models) sometimes do not emit their end-of-speech token and keep "speaking" silence for
    seconds, or stall in the middle of a sentence. In the finished track that is the multi-second pause the user hears.
    """
    data = np.asarray(data, dtype=np.float32)
    hop = max(1, int(sr * 0.01))
    n = len(data) // hop
    if n < 10:
        return data
    rms = np.sqrt((data[: n * hop].reshape(n, hop) ** 2).mean(axis=1))
    ref = float(np.percentile(rms, 95))
    if ref < 1e-5:
        return data
    voiced = rms > ref * 0.02  # about -34 dB below normal speech level
    idx = np.flatnonzero(voiced)
    if idx.size == 0:
        return data
    first, last = int(idx[0]), int(idx[-1])
    keep = np.ones(n, dtype=bool)
    keep[:first] = False
    keep[last + 1:] = False
    lead_f, tail_f, gap_f = int(lead * 100), int(tail * 100), int(max_gap * 100)
    out = []
    start = max(0, first - lead_f)
    end = min(n, last + 1 + tail_f)
    i = first
    pieces = []
    seg_start = start
    while i <= last:
        if not voiced[i]:
            j = i
            while j <= last and not voiced[j]:
                j += 1
            if (j - i) > gap_f:  # long internal silence: keep only max_gap of it
                pieces.append((seg_start, i + gap_f // 2))
                seg_start = j - gap_f // 2
            i = j
        else:
            i += 1
    pieces.append((seg_start, end))
    for a, b in pieces:
        out.append(data[a * hop: b * hop])
    return np.concatenate(out) if out else data
