"""Run: python3 tests/test_dub_pipeline.py   (needs numpy, soundfile, imageio-ffmpeg; no AI models)"""
import json, os, subprocess, sys, tempfile
from pathlib import Path
import numpy as np, soundfile as sf, imageio_ffmpeg

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from dub import pipeline as P

ok = True
def check(label, cond, extra=""):
    global ok
    print(("PASS  " if cond else "FAIL  ") + label + (f"  - {extra}" if extra else ""))
    ok = ok and bool(cond)

FF = imageio_ffmpeg.get_ffmpeg_exe()
def sh(*a): subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", *a], check=True)
def worker(*args):
    r = subprocess.run([sys.executable, str(ROOT / "backend/dub/worker.py"), *args], capture_output=True, text=True)
    events = [json.loads(l) for l in r.stdout.splitlines() if l.strip()]
    return r.returncode, events

# ---------- languages
check("language codes", P.whisper_code("Hindi") == "hi" and P.nllb_code("Urdu") == "urd_Arab" and P.nllb_code("Indian English") == "eng_Latn")
check("auto-detect -> None", P.whisper_code("Auto") is None)
try: P.whisper_code("Odia"); bad = False
except ValueError: bad = True
check("Odia is not a Whisper language (clear error)", bad)

# ---------- sentence merging
raw = [{"start": 0.0, "end": 1.0, "text": "आज हम"}, {"start": 1.1, "end": 3.0, "text": "एक कहानी सुनेंगे।"},
       {"start": 3.2, "end": 5.0, "text": "यह बहुत पुरानी है।"}, {"start": 12.0, "end": 13.5, "text": "Next one."}]
m = P.merge_segments(raw)
check("mid-sentence pieces are joined, sentence ends kept", len(m) == 3 and m[0]["text"].endswith("सुनेंगे।") and m[0]["end"] == 3.0, f"{len(m)} sentences")
check("ids restart at 0", [s["id"] for s in m] == [0, 1, 2])
check("empty text dropped", len(P.merge_segments([{"start": 0, "end": 1, "text": "  "}])) == 0)

# ---------- reference choice
segs = [{"id": i, "start": i * 10.0, "end": i * 10.0 + d, "text": f"s{i}", "avg_logprob": lp}
        for i, (d, lp) in enumerate([(1.0, -0.1), (4.0, -0.9), (5.0, -0.2), (6.0, -0.3), (12.0, -0.05)])]
w = P.choose_reference_windows(segs)
tot = sum(s["end"] - s["start"] for s in w)
check("reference: 2-9 s sentences only, best confidence first", [s["id"] for s in w] == [2, 3] and 9 <= tot <= 14, f"ids={[s['id'] for s in w]} total={tot}")
check("reference: falls back when all sentences are short", len(P.choose_reference_windows([{"id": 0, "start": 0, "end": 1.0, "text": "a"}])) == 1)

# ---------- trim
sr = P.SAMPLE_RATE
x = np.concatenate([np.zeros(sr // 2), 0.3 * np.sin(np.linspace(0, 400, sr)), np.zeros(sr // 2)]).astype(np.float32)
t = P.trim_silence(x, sr)
check("silence trimmed from both ends", 0.95 < len(t) / sr < 1.15, f"{len(t) / sr:.2f}s")

# ---------- word-based sentences
def W(txt, a, b): return {"word": txt, "start": a, "end": b, "probability": 0.9}
words = [W(" Hello", 1.0, 1.4), W(" there.", 1.45, 1.9), W(" How", 2.0, 2.2), W(" are", 2.25, 2.4), W(" you", 2.45, 2.7),
         W(" today", 4.0, 4.4), W(" my", 4.45, 4.6), W(" friend?", 4.65, 5.1)]
ss = P.segments_from_words(words)
check("sentences end at punctuation and at long pauses", [x["text"] for x in ss] == ["Hello there.", "How are you", "today my friend?"], str([x["text"] for x in ss]))
check("sentence bounds are the first/last WORD (no silence)", ss[0]["start"] == 1.0 and ss[0]["end"] == 1.9 and ss[2]["end"] == 5.1)
run = [W(f" w{i}", i * 0.5, i * 0.5 + 0.4) for i in range(30)]
run[14]["end"] = 7.0; run[15]["start"] = 7.8  # a pause in the middle of a 15 s run without punctuation
cut = P.segments_from_words(run, max_len=8.0)
check("over-long run is cut at its biggest pause, nothing over max_len", all(x["end"] - x["start"] <= 8.5 for x in cut) and len(cut) >= 2, str([(x["start"], x["end"]) for x in cut]))
check("ids restart at 0", [x["id"] for x in ss] == [0, 1, 2])
frag = P.segments_from_words([W(" Yes.", 1.0, 1.3), W(" Okay", 1.5, 1.7), W(" then.", 1.75, 2.3)])
check("no word is ever lost or invented", " ".join(x["text"] for x in frag) == "Yes. Okay then.", str([x["text"] for x in frag]))

# ---------- timeline
slots = [(0.0, 2.0), (3.0, 5.0), (5.2, 7.0)]
pl = P.plan_timeline(slots, [1.5, 2.0, 1.7], 10.0)
check("fits: natural speed, starts at its original time", all(p["tempo"] == 1.0 for p in pl) and pl[0]["start"] == 0.0 and pl[1]["start"] == 3.0 and pl[2]["start"] == 5.2, str([(p["start"], p["tempo"]) for p in pl]))
pl = P.plan_timeline(slots, [2.6, 2.0, 1.7], 10.0)
check("longer than slot but the pause after it is free: no speed-up", pl[0]["tempo"] == 1.0 and not pl[0]["overflow"])
pl = P.plan_timeline([(0, 2.0), (3.0, 5.0), (5.1, 7.0)], [1.8, 2.2, 1.5], 10.0)
check("a sentence starts earlier (inside the pause before it) when it would otherwise end too late", pl[1]["start"] < 3.0 and pl[1]["early"] and pl[1]["tempo"] == 1.0, str(pl[1]))
pl = P.plan_timeline([(0, 2.0), (2.2, 4.0)], [3.0, 1.5], 10.0)
check("no room: sped up (pitch-preserving), within the limit", 1.0 < pl[0]["tempo"] <= 1.65, f"tempo={pl[0]['tempo']}")
long_all = P.plan_timeline([(i * 3.0, i * 3.0 + 2.0) for i in range(6)], [2.8] * 6, 20.0)
check("whole translation longer than the original: gentle uniform speed-up instead of a few extreme ones", 1.05 <= min(p["tempo"] for p in long_all) and max(p["tempo"] for p in long_all) <= 1.4, str([p["tempo"] for p in long_all]))
pl = P.plan_timeline([(0, 2.0), (2.2, 4.0), (4.2, 6.0)], [6.0, 3.0, 2.0], 12.0)
ends = [p["start"] + p["duration"] for p in pl]
check("sentences never overlap", all(pl[i + 1]["start"] >= ends[i] for i in range(len(pl) - 1)))
check("overflow and lateness are flagged", pl[0]["overflow"] and pl[1]["shifted"])
check("the dub catches up: later sentences are sped up more while behind", pl[1]["tempo"] > 1.0)
last = P.plan_timeline([(0, 2.0)], [2.5], 3.0)
check("last sentence may use the time up to the end of the file", last[0]["tempo"] == 1.0 and not last[0]["overflow"])
drift = P.plan_timeline([(i * 4.0, i * 4.0 + 3.0) for i in range(8)], [3.6] * 8, 40.0)
check("no accumulating drift on a long file", max(abs(p["drift"]) for p in drift) < 1.0, str([p["drift"] for p in drift]))

# ---------- ducking / mix
dub = np.zeros(sr * 4, dtype=np.float32); dub[sr: 2 * sr] = 0.3 * np.sin(np.linspace(0, 3000, sr))
bg = np.full((sr * 4, 2), 0.2, dtype=np.float32)
out = P.mix_tracks(dub, bg, sr, background_gain=1.0)
quiet, loud = np.abs(out[int(1.5 * sr), 0] - dub[int(1.5 * sr)]), 0.2
under = float(np.abs(out[int(1.2 * sr): int(1.8 * sr), 0] - dub[int(1.2 * sr): int(1.8 * sr)]).mean())
pause = float(np.abs(out[int(3.2 * sr): int(3.8 * sr), 0]).mean())
check("background is ducked under speech and back to full in pauses", under < 0.12 and pause > 0.19, f"under={under:.3f} pause={pause:.3f}")
hot = P.mix_tracks(np.full(1000, 0.9, np.float32), np.full((1000, 2), 0.9, np.float32), sr)
check("limiter prevents clipping", np.max(np.abs(hot)) <= 0.97 + 1e-6)

# ---------- speakers (basic voice matching on synthetic voices)
rng = np.random.default_rng(7)
def fake_voice(f0, formants, sec, sr_=16000):
    n = int(sec * sr_); tt = np.arange(n) / sr_
    f = f0 * (1 + 0.06 * np.sin(2 * np.pi * rng.uniform(1.5, 3.5) * tt + rng.uniform(0, 6)) + rng.uniform(-0.05, 0.05))
    phase = 2 * np.pi * np.cumsum(f) / sr_
    out = np.zeros(n)
    for h in range(1, int(4500 / f0)):
        amp = sum(np.exp(-0.5 * ((h * f0 - fm) / 220.0) ** 2) for fm in formants) / h ** 0.3
        out += amp * np.sin(h * phase)
    env = 0.55 + 0.45 * np.abs(np.sin(2 * np.pi * rng.uniform(2.5, 4.5) * tt))
    out = out * env + 0.01 * rng.standard_normal(n)
    return (0.3 * out / np.max(np.abs(out))).astype(np.float32)
VA = (110, (700, 1200, 2600)); VB = (210, (400, 2000, 3100)); VC = (150, (550, 1500, 2300))
def feats(plan): return [P.voice_features(fake_voice(f0, fm, sec)) for (f0, fm), sec in plan]
two = feats([(VA, 2.5), (VB, 3.0), (VA, 2.0), (VB, 2.2), (VA, 3.1), (VB, 1.8), (VB, 2.6), (VA, 2.4)])
lab = P.cluster_speakers(two)
check("two voices (low/high pitch) are told apart automatically", lab == [0, 1, 0, 1, 0, 1, 1, 0], str(lab))
one = feats([(VA, 2.0 + 0.3 * i) for i in range(7)])
check("one voice stays ONE speaker (no invented speakers)", set(P.cluster_speakers(one)) == {0}, str(P.cluster_speakers(one)))
three = feats([(VA, 2.5), (VB, 2.5), (VC, 2.5), (VA, 2.5), (VB, 2.5), (VC, 2.5), (VA, 2.2), (VC, 2.2)])
lab3 = P.cluster_speakers(three, n_speakers=3)
check("three voices when the user says 3", lab3 == [0, 1, 2, 0, 1, 2, 0, 2], str(lab3))
check("too-short sentences (no features) take the neighbour's speaker", P.cluster_speakers([two[0], None, two[1], two[2]])[1] in (0, 1))
check("a single sentence is one speaker", P.cluster_speakers([two[0]]) == [0] and P.cluster_speakers([]) == [])
check("silence / too short audio gives no features instead of crashing", P.voice_features(np.zeros(16000, np.float32)) is None and P.voice_features(np.zeros(100, np.float32)) is None)

# ---------- worker end to end (prepare -> assemble -> mux) with synthetic audio / video
tmp = Path(tempfile.mkdtemp(prefix="dub-"))
video = tmp / "in.mp4"
sh("-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=8", "-f", "lavfi", "-i", "sine=frequency=300:duration=8", "-shortest", "-pix_fmt", "yuv420p", str(video))
work = tmp / "work"
rc, ev = worker("prepare", "--input", str(video), "--work", str(work))
res = [e for e in ev if e["event"] == "result"][0]
check("prepare: video file decoded, audio found", rc == 0 and abs(res["duration"] - 8.0) < 0.3 and res["hasVideo"] is True, str(res))
mp3 = tmp / "in.mp3"; sh("-f", "lavfi", "-i", "sine=frequency=440:duration=3", str(mp3))
rc, ev = worker("prepare", "--input", str(mp3), "--work", str(tmp / "w2"))
check("prepare: audio-only file", rc == 0 and [e for e in ev if e["event"] == "result"][0]["hasVideo"] is False)
rc, ev = worker("prepare", "--input", str(tmp / "nope.wav"), "--work", str(tmp / "w3"))
check("prepare: missing file -> clear error event", rc == 1 and ev[-1]["event"] == "error" and "not found" in ev[-1]["message"].lower())

def tts(path, dur, f):  # fake "synthesized sentence": 0.3 s of silence + tone + 0.3 s silence
    t_ = np.linspace(0, dur, int(24000 * dur), endpoint=False)
    x_ = np.concatenate([np.zeros(7200), 0.3 * np.sin(2 * np.pi * f * t_), np.zeros(7200)]).astype(np.float32)
    sf.write(str(path), x_, 24000)
items = []
for i, (s, e, d) in enumerate([(0.5, 2.5, 1.5), (3.0, 4.2, 2.6), (4.4, 6.0, 1.2)]):
    p = work / f"tts_{i}.wav"; tts(p, d, 300 + 100 * i)
    items.append({"index": i, "start": s, "end": e, "wav": str(p)})
bgfile = work / "background.wav"
sf.write(str(bgfile), np.full((8 * sr, 2), 0.15, dtype=np.float32), sr, subtype="PCM_16")
plan = {"duration": 8.0, "segments": items, "keepBackground": True, "background": str(bgfile), "backgroundGain": 0.8,
        "maxSpeedup": 1.4, "output": str(work / "dubbed.wav")}
(work / "plan.json").write_text(json.dumps(plan))
rc, ev = worker("assemble", "--work", str(work), "--plan", str(work / "plan.json"))
res = [e for e in ev if e["event"] == "result"][0]
y, ysr = sf.read(str(work / "dubbed.wav"))
check("assemble: stereo 44.1 kHz file of the right length", rc == 0 and ysr == 44100 and y.ndim == 2 and abs(len(y) / ysr - 8.0) < 0.6, f"{len(y) / ysr:.2f}s")
check("assemble: the too-long sentence was sped up, report says so", res["sped"] >= 1 and res["timeline"][1]["tempo"] > 1.0, f"sped={res['sped']} tempo={res['timeline'][1]['tempo']}")
seg2 = y[int(res["timeline"][1]["start"] * ysr) + 2000: int(res["timeline"][1]["start"] * ysr) + 8000, 0]
check("assemble: sentence 2 is audible at its planned time", np.abs(seg2).max() > 0.2)
gap = y[int(2.45 * ysr): int(2.6 * ysr), 0]
check("assemble: background continues in the pauses (not muted)", 0.05 < np.abs(gap).mean() < 0.14, f"{np.abs(gap).mean():.3f}")
rc, ev = worker("mux", "--video", str(video), "--audio", str(work / "dubbed.wav"), "--output", str(tmp / "out.mp4"))
r2 = subprocess.run([FF, "-hide_banner", "-i", str(tmp / "out.mp4")], capture_output=True, text=True).stderr
check("mux: new audio inside the original video", rc == 0 and "Video:" in r2 and "Audio: aac" in r2)
long_wav = work / "long.wav"; sf.write(str(long_wav), np.zeros((12 * sr, 2), dtype=np.float32) + 0.01, sr, subtype="PCM_16")
rc, ev = worker("mux", "--video", str(video), "--audio", str(long_wav), "--output", str(tmp / "ext.mp4"))
r3 = subprocess.run([FF, "-hide_banner", "-i", str(tmp / "ext.mp4")], capture_output=True, text=True).stderr
import re as _re
dm = _re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", r3); dur_ext = int(dm.group(1)) * 3600 + int(dm.group(2)) * 60 + float(dm.group(3))
check("mux: audio longer than the video is NOT cut (last frame is held)", rc == 0 and dur_ext >= 11.9 and [e for e in ev if e["event"] == "result"][0]["extended"] > 3.5, f"{dur_ext:.2f}s")

# ---------- self-test stage (what the "Check my setup" button runs)
rc, ev = worker("selftest", "--work", str(tmp / "st"), "--asr-model", "", "--mt-model", "", "--separation", "0")
res = [e for e in ev if e["event"] == "result"][0]
byname = {c["name"]: c for c in res["checks"]}
check("selftest: always finishes and lists every component", rc == 0 and len(res["checks"]) == 7, ", ".join(byname))
check("selftest: ffmpeg and speaker detection work here", byname["Audio tools (ffmpeg)"]["ok"] and byname["Speaker detection"]["ok"], byname["Audio tools (ffmpeg)"]["detail"])
check("selftest: a model that is not downloaded is reported in plain words, not as a crash", (not byname["Speech recognition model"]["ok"]) and "not downloaded" in byname["Speech recognition model"]["detail"] and "not downloaded" in byname["Translation model"]["detail"])
check("selftest: optional separation is skipped when not requested", byname["Voice and music separation"]["ok"] and "skipped" in byname["Voice and music separation"]["detail"])
check("selftest: missing libraries are named", (byname["Python libraries"]["ok"]) or ("No module named" in byname["Python libraries"]["detail"]), byname["Python libraries"]["detail"][:80])
check("selftest: overall flag matches", res["allOk"] == all(c["ok"] for c in res["checks"]))

print("\nALL DUB PIPELINE CHECKS PASSED" if ok else "\nSOME CHECKS FAILED")
sys.exit(0 if ok else 1)
