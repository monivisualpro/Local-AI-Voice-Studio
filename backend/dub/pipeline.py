"""Pure logic of the dubbing pipeline (no model imports) so it can be tested anywhere.

Stages: prepare (decode) -> analyze (separate voice/background, transcribe, pick a voice reference)
        -> translate -> [app synthesizes every sentence with a cloning TTS] -> assemble (fit timing, mix) -> mux (video).
"""
import re

import numpy as np

SAMPLE_RATE = 44100

# language name (as shown in the app) -> (Whisper code, NLLB-200 code)
LANGUAGES = {
    "english": ("en", "eng_Latn"), "hindi": ("hi", "hin_Deva"), "urdu": ("ur", "urd_Arab"),
    "tamil": ("ta", "tam_Taml"), "telugu": ("te", "tel_Telu"), "bengali": ("bn", "ben_Beng"),
    "marathi": ("mr", "mar_Deva"), "gujarati": ("gu", "guj_Gujr"), "kannada": ("kn", "kan_Knda"),
    "malayalam": ("ml", "mal_Mlym"), "punjabi": ("pa", "pan_Guru"), "odia": (None, "ory_Orya"),
    "nepali": ("ne", "npi_Deva"), "assamese": ("as", "asm_Beng"), "sanskrit": ("sa", "san_Deva"),
    "arabic": ("ar", "arb_Arab"), "spanish": ("es", "spa_Latn"), "french": ("fr", "fra_Latn"),
    "german": ("de", "deu_Latn"), "italian": ("it", "ita_Latn"), "portuguese": ("pt", "por_Latn"),
    "russian": ("ru", "rus_Cyrl"), "turkish": ("tr", "tur_Latn"), "chinese": ("zh", "zho_Hans"),
    "japanese": ("ja", "jpn_Jpan"), "korean": ("ko", "kor_Hang"), "indonesian": ("id", "ind_Latn"),
    "dutch": ("nl", "nld_Latn"), "polish": ("pl", "pol_Latn"), "swahili": ("sw", "swh_Latn"),
}
ALIASES = {"indian english": "english", "american english": "english", "british english": "english"}
WHISPER_TO_NAME = {v[0]: k for k, v in LANGUAGES.items() if v[0]}


def _key(name):
    k = (name or "").strip().lower()
    return ALIASES.get(k, k)


def whisper_code(name):
    """None = let Whisper detect the language."""
    k = _key(name)
    if k in ("", "auto", "detect"):
        return None
    if k not in LANGUAGES or not LANGUAGES[k][0]:
        raise ValueError(f"Whisper cannot transcribe \"{name}\". Pick another source language or use Auto-detect.")
    return LANGUAGES[k][0]


def nllb_code(name):
    k = _key(name)
    if k not in LANGUAGES:
        raise ValueError(f"The translator does not know the language \"{name}\".")
    return LANGUAGES[k][1]


# ---------------------------------------------------------------------------------------------------------------------
# sentences
# ---------------------------------------------------------------------------------------------------------------------
_END = re.compile(r"[.!?\u2026\u0964\u0965\u06d4\u061f\u3002\uff01\uff1f][\"'\u201d\u2019)\]]*\s*$")


def merge_segments(raw, max_gap=0.7, max_len=14.0, min_len=1.2):
    """Whisper cuts at pauses, often mid-sentence. Join neighbours until a sentence end / long pause / max length.

    raw: [{start, end, text, ...}] -> [{id, start, end, text}] (ids restart at 0)."""
    out = []
    cur = None
    for s in raw:
        text = (s.get("text") or "").strip()
        if not text:
            continue
        s = {**s, "text": text}
        if cur is None:
            cur = dict(s)
            continue
        gap = s["start"] - cur["end"]
        joined_len = s["end"] - cur["start"]
        finished = bool(_END.search(cur["text"]))
        too_short = (cur["end"] - cur["start"]) < min_len
        if (not finished or too_short) and gap <= max_gap and joined_len <= max_len:
            cur["text"] = f'{cur["text"]} {text}'
            cur["end"] = s["end"]
            if "avg_logprob" in s:
                cur["avg_logprob"] = min(cur.get("avg_logprob", 0), s["avg_logprob"])
        else:
            out.append(cur)
            cur = dict(s)
    if cur is not None:
        out.append(cur)
    return [{"id": i, "start": round(x["start"], 3), "end": round(x["end"], 3), "text": x["text"],
             "avg_logprob": x.get("avg_logprob")} for i, x in enumerate(out)]


def segments_from_words(words, max_len=8.0, max_gap=0.55, min_len=0.6):
    """Tight sentence timings from word timestamps (Whisper's own segment bounds include silence and can be 30 s long).

    words: [{start, end, word, probability?}] -> [{id, start, end, text, avg_logprob}].
    A sentence ends at sentence punctuation, at a pause longer than max_gap, or when it would exceed max_len
    (then at the biggest pause inside, so the cut falls between words people actually pause at)."""
    ws = [w for w in words if (w.get("word") or "").strip()]
    sentences, cur = [], []

    def flush(part):
        if part:
            sentences.append(part)

    def split_long(part):
        # cut an over-long run at its largest internal pause
        if len(part) < 2 or part[-1]["end"] - part[0]["start"] <= max_len:
            return [part]
        gaps = [(part[i + 1]["start"] - part[i]["end"], i) for i in range(len(part) - 1)]
        _, k = max(gaps)
        return split_long(part[: k + 1]) + split_long(part[k + 1:])

    for i, w in enumerate(ws):
        cur.append(w)
        nxt = ws[i + 1] if i + 1 < len(ws) else None
        ends = bool(_END.search(w["word"].strip()))
        long_pause = nxt is not None and nxt["start"] - w["end"] > max_gap
        if ends or long_pause or nxt is None:
            for piece in split_long(cur):
                flush(piece)
            cur = []
    # a tiny fragment (one short word) is joined to its neighbour
    merged = []
    for sent in sentences:
        dur = sent[-1]["end"] - sent[0]["start"]
        if merged and dur < min_len and sent[0]["start"] - merged[-1][-1]["end"] <= max_gap:
            merged[-1] = merged[-1] + sent
        else:
            merged.append(sent)
    out = []
    for i, sent in enumerate(merged):
        text = "".join(w["word"] for w in sent).strip()
        text = re.sub(r"\s+", " ", text)
        probs = [w["probability"] for w in sent if w.get("probability") is not None]
        conf = float(np.mean(np.log(np.clip(probs, 1e-4, 1.0)))) if probs else None
        out.append({"id": i, "start": round(sent[0]["start"], 3), "end": round(sent[-1]["end"], 3), "text": text, "avg_logprob": conf})
    return out


def choose_reference_windows(segments, target=10.0, max_total=14.0, min_seg=2.0, max_seg=9.0):
    """Which parts of the (separated) voice to use as the cloning reference: the clearest sentences
    (best ASR confidence = least noise/music), 2-9 s long, up to ~10 s in total, returned in time order."""
    cands = [s for s in segments if min_seg <= (s["end"] - s["start"]) <= max_seg]
    if not cands:  # very short sentences only: take whatever is longest
        cands = sorted(segments, key=lambda s: s["end"] - s["start"], reverse=True)[:3]
    cands = sorted(cands, key=lambda s: (s.get("avg_logprob") if s.get("avg_logprob") is not None else -1.0), reverse=True)
    chosen, total = [], 0.0
    for s in cands:
        d = s["end"] - s["start"]
        if total + d > max_total:
            continue
        chosen.append(s)
        total += d
        if total >= target:
            break
    return sorted(chosen, key=lambda s: s["start"])


# ---------------------------------------------------------------------------------------------------------------------
# timing
# ---------------------------------------------------------------------------------------------------------------------
def trim_silence(x, sr, threshold=0.01, pad=0.03):
    """Cut dead air from both ends of a synthesized sentence (TTS models add 0.2-0.6 s), keep a tiny pad."""
    if x.size == 0:
        return x
    loud = np.flatnonzero(np.abs(x) > threshold)
    if loud.size == 0:
        return x[: int(sr * 0.05)]
    p = int(sr * pad)
    return x[max(0, loud[0] - p): min(x.size, loud[-1] + 1 + p)]


def plan_timeline(slots, durations, total_duration, max_speedup=1.4, gap=0.06, lead_max=0.35, trail_max=0.6,
                  catchup=0.2, ease=True):
    """Where every dubbed sentence starts and how much it is sped up, so the dub stays in step with the picture.

    slots: [(start, end)] of the original sentences; durations: seconds of each synthesized sentence.
    For every sentence the usable window is: its own slot + part of the pause BEFORE it (it may start up to lead_max
    earlier) + part of the pause AFTER it (up to trail_max later), never touching the neighbours.
      * fits the window            -> natural speed; starts at its slot, or earlier if it would end too late
      * a bit too long             -> sped up (pitch-preserving) just enough to fit the window
      * still too long at max_speedup -> flagged overflow; the next sentences are pushed back, and they get
        `catchup` extra speed-up while they are behind so the dub returns to the picture quickly.
    ease: when the whole translation is systematically longer than the original (e.g. English -> Hindi), a gentle uniform
    speed-up (up to 1.12x) is applied to everything first, which sounds far more natural than a few sentences at 1.4x.
    """
    n = len(slots)
    base = 1.0
    if ease and n >= 3:
        ratios = sorted(d / max(0.2, e - s) for (s, e), d in zip(slots, durations))
        median = ratios[len(ratios) // 2]
        base = float(min(1.12, max(1.0, median / 1.05)))
    plan, cursor = [], 0.0
    for i, ((s, e), d0) in enumerate(zip(slots, durations)):
        d = d0 / base
        prev_end = slots[i - 1][1] if i > 0 else 0.0
        lead = min(lead_max, max(0.0, s - prev_end) * 0.5)
        if i + 1 < n:
            next_start = slots[i + 1][0]
            trail = min(trail_max, max(0.0, next_start - e - gap))
            latest_end = min(e + trail, next_start - gap)
        else:
            latest_end = max(e + trail_max, total_duration)  # the last sentence may also run a little past the end
        earliest = max(cursor, s - lead)
        window = max(0.25, latest_end - earliest)
        behind = earliest - s
        cap = max_speedup + (catchup if behind > 0.4 else 0.0)
        overflow = False
        if d <= window:
            start = min(max(earliest, s), latest_end - d)
            start = max(start, earliest)
            extra, dur = 1.0, d
        else:
            need = d / window
            extra = min(cap, need)
            dur = d / extra
            start = earliest
            overflow = need > cap + 1e-6
        tempo = d0 / dur
        plan.append({"index": i, "start": round(start, 3), "tempo": round(tempo, 4), "duration": round(dur, 3),
                     "shifted": (start - s) > 0.15, "early": (s - start) > 0.05, "overflow": overflow,
                     "drift": round(start - s, 3), "slotStart": round(s, 3), "slotEnd": round(e, 3), "natural": round(d0, 3)})
        cursor = start + dur + gap
    return plan


def duck_envelope(dub, sr, duck_gain=0.35, attack=0.04, release=0.35):
    """Gain curve for the background: quiet while someone speaks, back to full in the pauses (smooth, no pumping)."""
    win = max(1, int(sr * 0.02))
    active = np.convolve(np.abs(dub), np.ones(win) / win, mode="same") > 0.01
    target = np.where(active, duck_gain, 1.0).astype(np.float32)
    a = np.exp(-1.0 / (sr * attack))
    r = np.exp(-1.0 / (sr * release))
    env = np.empty_like(target)
    g = 1.0
    # one-pole smoother with different attack/release; vectorised in blocks for speed
    step = 256
    for i in range(0, target.size, step):
        t = float(target[i: i + step].min())
        coef = a if t < g else r
        g = t + (g - t) * (coef ** min(step, target.size - i))
        env[i: i + step] = g
    return env


def mix_tracks(dub, background, sr, background_gain=0.8, duck=True):
    """dub: mono float32; background: (n, 2) float32 or None. Returns (n, 2) float32, peak-limited."""
    n = dub.size if background is None else max(dub.size, background.shape[0])
    out = np.zeros((n, 2), dtype=np.float32)
    if background is not None:
        bg = background[:n]
        gain = np.full(bg.shape[0], background_gain, dtype=np.float32)
        if duck:
            gain = gain * duck_envelope(np.pad(dub, (0, max(0, bg.shape[0] - dub.size)))[: bg.shape[0]], sr)
        out[: bg.shape[0]] = bg * gain[:, None]
    out[: dub.size, 0] += dub
    out[: dub.size, 1] += dub
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 0.97:
        out *= 0.97 / peak
    return out


# ---------------------------------------------------------------------------------------------------------------------
# speakers (basic voice matching: pitch + timbre; no extra model download)
# ---------------------------------------------------------------------------------------------------------------------
def _mel_filterbank(n_mels, n_fft, sr, fmin=60.0, fmax=7600.0):
    def hz2mel(f): return 2595.0 * np.log10(1.0 + f / 700.0)
    def mel2hz(m): return 700.0 * (10.0 ** (m / 2595.0) - 1.0)
    pts = mel2hz(np.linspace(hz2mel(fmin), hz2mel(min(fmax, sr / 2 - 1)), n_mels + 2))
    bins = np.floor((n_fft + 1) * pts / sr).astype(int)
    fb = np.zeros((n_mels, n_fft // 2 + 1), dtype=np.float32)
    for m in range(1, n_mels + 1):
        l, c, r = bins[m - 1], bins[m], bins[m + 1]
        for k in range(l, c):
            fb[m - 1, k] = (k - l) / max(1, c - l)
        for k in range(c, r):
            fb[m - 1, k] = (r - k) / max(1, r - c)
    return fb


def voice_features(x, sr=16000):
    """A small fingerprint of a voice from one sentence: MFCC mean/std over the loud frames + typical pitch (log F0).
    Returns None when there is not enough voiced audio (< ~0.5 s)."""
    x = np.asarray(x, dtype=np.float32)
    frame, hop, n_fft = int(0.025 * sr), int(0.010 * sr), 512
    if x.size < frame * 4:
        return None
    n = 1 + (x.size - frame) // hop
    idx = np.arange(frame)[None, :] + hop * np.arange(n)[:, None]
    frames = x[idx] * np.hanning(frame).astype(np.float32)
    energy = np.sqrt(np.mean(frames ** 2, axis=1))
    keep = energy > max(0.1 * float(energy.max()), 1e-4)
    if keep.sum() < 30:
        return None
    spec = np.abs(np.fft.rfft(frames[keep], n=n_fft)) ** 2
    mel = np.log(spec @ _mel_filterbank(26, n_fft, sr).T + 1e-8)
    k = np.arange(26)[None, :]
    dct = np.cos(np.pi / 26 * (k + 0.5) * np.arange(1, 13)[:, None]).astype(np.float32)  # c1..c12 (c0 = loudness, dropped)
    mfcc = mel @ dct.T
    # pitch: normalized autocorrelation peak per voiced frame, 70-400 Hz
    lo, hi = int(sr / 400), int(sr / 70)
    f0 = []
    for fr in frames[keep][::2]:
        fr = fr - fr.mean()
        ac = np.fft.irfft(np.abs(np.fft.rfft(fr, n=2 * frame)) ** 2)[: frame]
        if ac[0] <= 1e-8:
            continue
        seg = ac[lo:hi] / ac[0]
        j = int(np.argmax(seg))
        if seg[j] > 0.35:
            f0.append(np.log(sr / (lo + j)))
    if len(f0) < 8:
        f0m, f0s = 0.0, 0.0
        has_pitch = 0.0
    else:
        f0m, f0s, has_pitch = float(np.median(f0)), float(np.subtract(*np.percentile(f0, [75, 25]))), 1.0
    return np.concatenate([mfcc.mean(axis=0), mfcc.std(axis=0), [f0m, f0s, has_pitch]]).astype(np.float32)


# Fixed scales (not the data's own spread: with a single speaker the data's spread is only noise and would be inflated).
# Calibrated so sentences of one voice are < ~9 apart and different voices (even 110 Hz vs 150 Hz men) are > ~11 apart.
_SCALE = np.array([3.0] * 12 + [1.5] * 12 + [0.10, 0.08, 1.0])


def _scaled(E):
    return np.asarray(E, dtype=np.float64) / _SCALE


def cluster_speakers(features, n_speakers=None, max_speakers=6, merge_threshold=10.0):
    """Average-linkage clustering. n_speakers=None -> clusters are merged while they are closer than merge_threshold.
    features: list of vectors (None allowed = unknown; gets the label of its time-neighbour).
    Returns labels (0 = the speaker who talks first)."""
    n = len(features)
    known = [i for i, f in enumerate(features) if f is not None]
    if n == 0:
        return []
    if len(known) < 2:
        return [0] * n
    Z = _scaled([features[i] for i in known])
    m = len(known)
    D = np.linalg.norm(Z[:, None, :] - Z[None, :, :], axis=2)
    clusters = {i: [i] for i in range(m)}
    heights, history = [], []
    active = list(range(m))
    link = {(i, j): D[i, j] for i in range(m) for j in range(i + 1, m)}
    nxt = m
    while len(active) > 1:
        (a, b), h = min(link.items(), key=lambda kv: kv[1])
        new = clusters[a] + clusters[b]
        clusters[nxt] = new
        active = [c for c in active if c not in (a, b)]
        for c in active:
            da = link.get((min(a, c), max(a, c)), link.get((c, a)))
            db = link.get((min(b, c), max(b, c)), link.get((c, b)))
            link[(c, nxt)] = (da * len(clusters[a]) + db * len(clusters[b])) / (len(clusters[a]) + len(clusters[b]))
        for key in [k for k in link if a in k or b in k]:
            del link[key]
        active.append(nxt)
        heights.append(float(h))
        history.append(list(active))
        nxt += 1
    if n_speakers:
        k = max(1, min(int(n_speakers), m))
    else:
        below = sum(1 for h in heights if h <= merge_threshold)  # merges that are allowed
        k = max(1, min(m - below, max_speakers))
    members = history[m - k - 1] if k < m else list(range(m))
    labels_known = [0] * m
    for lab, cid in enumerate(members):
        for leaf in clusters[cid]:
            labels_known[leaf] = lab
    labels = [None] * n
    for pos, i in enumerate(known):
        labels[i] = labels_known[pos]
    for i in range(n):  # unknown (too short) segments: nearest known neighbour in time
        if labels[i] is None:
            d, j = min((abs(i - k2), k2) for k2 in known)
            labels[i] = labels[j]
    # number speakers by first appearance
    order, out = {}, []
    for lab in labels:
        order.setdefault(lab, len(order))
        out.append(order[lab])
    return out
