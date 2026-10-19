"""Run: python3 tests/test_dub_analyze.py
Runs the REAL `analyze` stage of the dubbing worker on a synthetic two-person conversation; only the Whisper model is
replaced by a fake that returns known words/times (no AI weights are needed)."""
import io, json, sys, tempfile, types, contextlib
from argparse import Namespace
from pathlib import Path
import numpy as np, soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
ok = True
def check(l, c, x=""):
    global ok; print(("PASS  " if c else "FAIL  ") + l + (f"  - {x}" if x else "")); ok = ok and bool(c)

rng = np.random.default_rng(3)
def fake_voice(f0, formants, sec, sr=44100):
    n = int(sec * sr); t = np.arange(n) / sr
    f = f0 * (1 + 0.06 * np.sin(2 * np.pi * rng.uniform(1.5, 3.5) * t + rng.uniform(0, 6)))
    ph = 2 * np.pi * np.cumsum(f) / sr; out = np.zeros(n)
    for h in range(1, int(4500 / f0)):
        out += sum(np.exp(-0.5 * ((h * f0 - fm) / 220.0) ** 2) for fm in formants) / h ** 0.3 * np.sin(h * ph)
    out = out * (0.55 + 0.45 * np.abs(np.sin(2 * np.pi * rng.uniform(2.5, 4.5) * t))) + 0.005 * rng.standard_normal(n)
    return (0.3 * out / np.max(np.abs(out))).astype(np.float32)
A, B = (110, (700, 1200, 2600)), (210, (400, 2000, 3100))
SR = 44100
plan = [(0.5, 3.5, A, "hello and welcome to the show today."), (4.0, 6.5, B, "thanks for having me it is great."),
        (7.0, 10.0, A, "tell us about your new project please."), (10.5, 13.0, B, "sure it started last year in a small lab.")]
total = 14.0
audio = np.zeros(int(total * SR), dtype=np.float32)
for s, e, v, _ in plan:
    audio[int(s * SR): int(e * SR)] += fake_voice(*v, e - s)
work = Path(tempfile.mkdtemp(prefix="an-")); (work).mkdir(exist_ok=True)
sf.write(str(work / "source.wav"), np.stack([audio, audio], axis=1), SR, subtype="PCM_16")

# fake faster_whisper: words spread evenly inside each known sentence
class W:
    def __init__(s, w, a, b): s.word, s.start, s.end, s.probability = w, a, b, 0.95
class Seg:
    def __init__(s, a, b, text, words): s.start, s.end, s.text, s.words, s.avg_logprob = a, b, text, words, -0.2
class FakeModel:
    def __init__(self, path, device, compute_type): self.args = (path, device, compute_type)
    def transcribe(self, audio, language=None, vad_filter=True, beam_size=5, condition_on_previous_text=False, word_timestamps=False):
        assert word_timestamps is True and isinstance(audio, np.ndarray) and audio.dtype == np.float32
        segs = []
        for s, e, _, text in plan:
            ws = text.split(); step = (e - s) / len(ws)
            segs.append(Seg(s, e, " " + text, [W(" " + w, s + i * step, s + (i + 1) * step - 0.02) for i, w in enumerate(ws)]))
        return iter(segs), types.SimpleNamespace(language="en", language_probability=0.99)
sys.modules["faster_whisper"] = types.SimpleNamespace(WhisperModel=FakeModel)

from dub import worker as Wk
def run(speakers):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        Wk.cmd_analyze(Namespace(work=str(work), asr_model="fake", language="auto", separate=0, speakers=speakers))
    ev = [json.loads(l) for l in buf.getvalue().splitlines() if l.strip()]
    return [e for e in ev if e["event"] == "result"][0], [e for e in ev if e["event"] == "progress"]

res, prog = run("auto")
segs = res["segments"]
check("four sentences found with tight word-based timing", len(segs) == 4 and abs(segs[0]["start"] - 0.5) < 0.05 and abs(segs[3]["end"] - 12.98) < 0.1, str([(s["start"], s["end"]) for s in segs]))
check("two speakers detected and labelled S1/S2 in order of appearance", [s["speaker"] for s in segs] == ["S1", "S2", "S1", "S2"], str([s["speaker"] for s in segs]))
check("one voice sample per speaker", len(res["speakers"]) == 2 and all(Path(sp["reference"]["path"]).is_file() for sp in res["speakers"]))
check("each sample is that speaker's own voice (different files)", res["speakers"][0]["reference"]["path"] != res["speakers"][1]["reference"]["path"])
r1, sr1 = sf.read(res["speakers"][0]["reference"]["path"]); r2, _ = sf.read(res["speakers"][1]["reference"]["path"])
check("samples are 24 kHz mono, a few seconds long", sr1 == 24000 and r1.ndim == 1 and 2.0 < len(r1) / sr1 < 15, f"{len(r1)/sr1:.1f}s")
check("sample text is what that speaker said", "welcome" in res["speakers"][0]["reference"]["text"] and "great" in res["speakers"][1]["reference"]["text"], res["speakers"][1]["reference"]["text"])
check("main reference = speaker with the most speech", res["reference"]["path"] in (res["speakers"][0]["reference"]["path"], res["speakers"][1]["reference"]["path"]))
check("language reported", res["language"] == "english")

res1, _ = run("off")
check("speakers off: everything is S1 with one sample", {s["speaker"] for s in res1["segments"]} == {"S1"} and len(res1["speakers"]) == 1)
res2, _ = run("2")
check("speakers = 2 (user's choice) gives the same split", [s["speaker"] for s in res2["segments"]] == ["S1", "S2", "S1", "S2"])
print("\nALL DUB ANALYZE CHECKS PASSED" if ok else "\nSOME CHECKS FAILED"); sys.exit(0 if ok else 1)
