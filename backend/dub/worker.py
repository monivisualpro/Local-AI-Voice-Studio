"""Dubbing worker. One sub-command per stage; every line printed on stdout is a JSON event:
  {"event":"progress","stage":..,"pct":..,"message":..}   {"event":"result",...}   {"event":"error","message":..}
Run by the desktop app inside the managed "dub" Python environment.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402

from dub import pipeline as P  # noqa: E402

SR = P.SAMPLE_RATE


def emit(**kw):
    sys.stdout.write(json.dumps(kw, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def progress(stage, pct, message=""):
    emit(event="progress", stage=stage, pct=int(pct), message=message)


def ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def run_ffmpeg(args):
    r = subprocess.run([ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", *args],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg failed: " + r.stderr.decode("utf-8", "replace")[-600:])


def read_wav(path):
    import soundfile as sf
    x, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return x, sr


def write_wav(path, x, sr=SR):
    import soundfile as sf
    sf.write(str(path), x, sr, subtype="PCM_16")


def to_mono_sr(path, sr):
    """Any audio file -> mono float32 at `sr` (through ffmpeg: handles every format/rate)."""
    tmp = str(path) + f".{sr}.tmp.wav"
    run_ffmpeg(["-i", str(path), "-ac", "1", "-ar", str(sr), "-c:a", "pcm_f32le", tmp])
    x, _ = read_wav(tmp)
    os.remove(tmp)
    return x[:, 0]


# ------------------------------------------------------------------------------------------------ prepare
def cmd_prepare(a):
    work = Path(a.work)
    work.mkdir(parents=True, exist_ok=True)
    src = Path(a.input)
    if not src.is_file():
        raise RuntimeError(f"File not found: {src}")
    progress("prepare", 5, "Reading the file...")
    probe = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", str(src)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    info = probe.stderr.decode("utf-8", "replace")
    has_video = bool(re.search(r"Stream #\d+:\d+.*Video:", info)) and not re.search(r"Video: (mjpeg|png)", info)
    has_audio = bool(re.search(r"Stream #\d+:\d+.*Audio:", info))
    if not has_audio:
        raise RuntimeError("This file has no audio track.")
    run_ffmpeg(["-i", str(src), "-vn", "-ac", "2", "-ar", str(SR), "-c:a", "pcm_s16le", str(work / "source.wav")])
    x, sr = read_wav(work / "source.wav")
    emit(event="result", duration=round(x.shape[0] / sr, 3), hasVideo=has_video, source=str(work / "source.wav"))


# ------------------------------------------------------------------------------------------------ analyze
def separate_voice(work, device):
    """Demucs (htdemucs): voice vs everything else. Weights download once into TORCH_HOME."""
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    progress("separate", 8, "Loading the voice/music separator (first run downloads ~80 MB)...")
    model = get_model("htdemucs")
    model.eval()
    x, sr = read_wav(work / "source.wav")
    wav = torch.from_numpy(x.T.copy())
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    progress("separate", 15, "Separating voice from music and background (can take a while)...")
    with torch.inference_mode():
        sources = apply_model(model, wav[None], device=device, split=True, overlap=0.25, progress=False)[0]
    sources = sources * (ref.std() + 1e-8) + ref.mean()
    names = list(model.sources)
    vocals = sources[names.index("vocals")]
    background = sum(sources[i] for i, n in enumerate(names) if n != "vocals")
    write_wav(work / "vocals.wav", vocals.cpu().numpy().T, SR)
    write_wav(work / "background.wav", background.cpu().numpy().T, SR)
    return work / "vocals.wav", work / "background.wav"


def cmd_analyze(a):
    work = Path(a.work)
    try:
        import torch
        cuda = torch.cuda.is_available()
    except Exception:
        cuda = False
    device = "cuda" if cuda else "cpu"

    vocals = work / "source.wav"
    background = None
    if a.separate:
        vocals, background = separate_voice(work, device)

    progress("transcribe", 35, "Loading the speech recognizer...")
    from faster_whisper import WhisperModel
    audio16 = to_mono_sr(vocals, 16000)
    total = len(audio16) / 16000.0
    code = P.whisper_code(a.language)

    def transcribe(dev):
        model = WhisperModel(a.asr_model, device=dev, compute_type="float16" if dev == "cuda" else "int8")
        progress("transcribe", 45, "Listening to the speech...")
        segs, info = model.transcribe(audio16, language=code, vad_filter=True, beam_size=5,
                                      condition_on_previous_text=False, word_timestamps=True)
        out, words = [], []
        for sg in segs:  # a generator: GPU problems (missing cuDNN/cuBLAS) only show up here
            out.append({"start": float(sg.start), "end": float(sg.end), "text": sg.text, "avg_logprob": float(sg.avg_logprob)})
            for w in (sg.words or []):
                words.append({"start": float(w.start), "end": float(w.end), "word": w.word, "probability": float(w.probability)})
            progress("transcribe", 45 + 40 * min(1.0, sg.end / max(total, 1)), f"{len(out)} sentences...")
        return (out, words), info

    try:
        (raw, words), info = transcribe(device)
    except Exception as exc:
        if device != "cuda":
            raise
        progress("transcribe", 45, "The GPU could not run the recognizer (" + str(exc)[:80] + "). Using the CPU instead...")
        device = "cpu"
        (raw, words), info = transcribe("cpu")
    # exact word times give tight sentence bounds (the key to staying in sync); Whisper's own bounds are the fallback
    segments = P.segments_from_words(words) if words else P.merge_segments(raw)
    if not segments:
        raise RuntimeError("No speech was found in this file.")

    # ---- who is speaking (basic voice matching: pitch + timbre)
    labels = [0] * len(segments)
    mode = str(a.speakers or "auto").lower()
    if mode != "off" and len(segments) >= 2:
        progress("speakers", 88, "Telling the speakers apart...")
        feats = []
        for sg in segments:
            clip = audio16[int(sg["start"] * 16000): int(sg["end"] * 16000)]
            feats.append(P.voice_features(clip, 16000))
        labels = P.cluster_speakers(feats, n_speakers=int(mode) if mode.isdigit() else None)
    for sg, lab in zip(segments, labels):
        sg["speaker"] = f"S{lab + 1}"

    progress("reference", 92, "Choosing the voice sample to clone...")
    x, sr = read_wav(vocals)

    def build_reference(group, name):
        windows = P.choose_reference_windows(group)
        parts, texts = [], []
        for w in windows:
            parts.append(x[int(w["start"] * sr): int(w["end"] * sr)].mean(axis=1))
            parts.append(np.zeros(int(sr * 0.15), dtype=np.float32))
            texts.append(w["text"])
        ref = np.concatenate(parts) if parts else x.mean(axis=1)[: sr * 8]
        write_wav(work / f"{name}_44k.wav", ref, sr)
        run_ffmpeg(["-i", str(work / f"{name}_44k.wav"), "-ac", "1", "-ar", "24000", str(work / f"{name}.wav")])
        return {"path": str(work / f"{name}.wav"), "text": " ".join(texts), "duration": round(len(ref) / sr, 2)}

    speakers = []
    for lab in sorted(set(labels)):
        group = [sg for sg in segments if sg["speaker"] == f"S{lab + 1}"]
        secs = sum(sg["end"] - sg["start"] for sg in group)
        speakers.append({"id": f"S{lab + 1}", "count": len(group), "seconds": round(secs, 1),
                         "reference": build_reference(group, f"reference_S{lab + 1}")})
    main = max(speakers, key=lambda sp: sp["seconds"])
    for sp in speakers:  # a speaker with (almost) no clean speech borrows the main speaker's voice sample
        if sp["seconds"] < 2.0 and sp is not main:
            sp["reference"], sp["shared"] = main["reference"], True
    detected = P.WHISPER_TO_NAME.get(info.language, info.language)
    emit(event="result", language=detected, languageProbability=round(float(info.language_probability), 3),
         segments=segments, reference=main["reference"], speakers=speakers,
         background=str(background) if background else None, vocals=str(vocals), device=device)


# ------------------------------------------------------------------------------------------------ translate
def cmd_translate(a):
    import torch
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    segs = json.loads(Path(a.segments).read_text(encoding="utf-8"))
    src, tgt = P.nllb_code(a.src), P.nllb_code(a.tgt)
    cuda = torch.cuda.is_available()
    progress("translate", 5, "Loading the translator...")
    tok = AutoTokenizer.from_pretrained(a.mt_model, src_lang=src)
    model = AutoModelForSeq2SeqLM.from_pretrained(a.mt_model, torch_dtype=torch.float16 if cuda else torch.float32)
    model = model.to("cuda" if cuda else "cpu").eval()
    out, alts = [], []
    bos = tok.convert_tokens_to_ids(tgt)
    batch = 6
    k = max(1, int(a.candidates))
    for i in range(0, len(segs), batch):
        texts = [x["text"] for x in segs[i: i + batch]]
        enc = tok(texts, return_tensors="pt", padding=True, truncation=True, max_length=256).to(model.device)
        with torch.inference_mode():
            gen = model.generate(**enc, forced_bos_token_id=bos, num_beams=max(4, k + 2), num_return_sequences=k, max_new_tokens=300)
        dec = tok.batch_decode(gen, skip_special_tokens=True)
        for j in range(len(texts)):
            cands = []
            for c in dec[j * k: (j + 1) * k]:
                c = c.strip()
                if c and c not in cands:
                    cands.append(c)
            out.append(cands[0] if cands else "")
            alts.append(sorted(cands[1:], key=len))  # other wordings, shortest first: used to fit the time slot
        progress("translate", 10 + 85 * min(1.0, (i + batch) / len(segs)), f"{min(i + batch, len(segs))}/{len(segs)}")
    emit(event="result", translations=out, alternatives=alts)


# ------------------------------------------------------------------------------------------------ assemble
def cmd_assemble(a):
    plan = json.loads(Path(a.plan).read_text(encoding="utf-8"))
    work = Path(a.work)
    items = plan["segments"]  # [{index, start, end, wav}]
    total = float(plan["duration"])

    progress("assemble", 5, "Reading the synthesized sentences...")
    clips, durs = [], []
    for it in items:
        x = P.trim_silence(to_mono_sr(it["wav"], SR), SR)
        clips.append(x)
        durs.append(len(x) / SR)
    slots = [(float(it["start"]), float(it["end"])) for it in items]
    timeline = P.plan_timeline(slots, durs, total, max_speedup=float(plan.get("maxSpeedup", 1.4)),
                               lead_max=float(plan.get("leadIn", 0.35)), trail_max=float(plan.get("trail", 0.6)),
                               ease=bool(plan.get("ease", True)))

    progress("assemble", 30, "Fitting each sentence into its time slot...")
    length = int(max(total, timeline[-1]["start"] + timeline[-1]["duration"] + 0.5) * SR) if timeline else int(total * SR)
    dub = np.zeros(length, dtype=np.float32)
    for k, (it, clip, pl) in enumerate(zip(items, clips, timeline)):
        if pl["tempo"] > 1.01:
            tmp_in, tmp_out = work / f"fit_{k}_in.wav", work / f"fit_{k}_out.wav"
            write_wav(tmp_in, clip, SR)
            run_ffmpeg(["-i", str(tmp_in), "-filter:a", f"atempo={pl['tempo']:.4f}", "-ar", str(SR), "-ac", "1", str(tmp_out)])
            clip, _ = read_wav(tmp_out)
            clip = clip[:, 0]
            os.remove(tmp_in)
            os.remove(tmp_out)
        fade = int(SR * 0.012)
        if clip.size > 2 * fade:
            clip = clip.copy()
            clip[:fade] *= np.linspace(0, 1, fade, dtype=np.float32)
            clip[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
        s = int(pl["start"] * SR)
        e = min(length, s + clip.size)
        dub[s:e] += clip[: e - s]
        progress("assemble", 30 + 50 * (k + 1) / max(1, len(items)), f"{k + 1}/{len(items)}")

    bg = None
    if plan.get("keepBackground") and plan.get("background"):
        bg, sr = read_wav(plan["background"])
        if sr != SR:
            raise RuntimeError("Unexpected background sample rate.")
    progress("assemble", 88, "Mixing...")
    mix = P.mix_tracks(dub, bg, SR, background_gain=float(plan.get("backgroundGain", 0.8)), duck=bool(plan.get("duck", True)))
    out_path = Path(plan["output"])
    write_wav(out_path, mix, SR)
    emit(event="result", output=str(out_path), duration=round(mix.shape[0] / SR, 3),
         overflow=sum(1 for p in timeline if p["overflow"]), shifted=sum(1 for p in timeline if p["shifted"]),
         sped=sum(1 for p in timeline if p["tempo"] > 1.01), timeline=timeline)


# ------------------------------------------------------------------------------------------------ mux
def media_duration(path):
    r = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", str(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr.decode("utf-8", "replace"))
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0


def cmd_mux(a):
    progress("mux", 10, "Putting the new audio into the video...")
    v_dur, a_dur = media_duration(a.video), media_duration(a.audio)
    extra = a_dur - v_dur
    if extra > 0.15:
        # the dubbed speech is longer than the picture: hold the last frame instead of cutting the last words
        run_ffmpeg(["-i", a.video, "-i", a.audio, "-map", "0:v:0", "-map", "1:a:0",
                    "-vf", f"tpad=stop_mode=clone:stop_duration={extra + 0.1:.3f}", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", a.output])
    else:
        run_ffmpeg(["-i", a.video, "-i", a.audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
                    "-b:a", "192k", "-shortest", a.output])
    emit(event="result", output=a.output, extended=round(max(0.0, extra), 2))


# ------------------------------------------------------------------------------------------------ selftest
def cmd_selftest(a):
    """Runs every real component once on a tiny synthetic input and says which part works. Never raises."""
    import time
    checks = []
    total = 7

    def check(name, fn):
        t0 = time.time()
        try:
            detail = fn()
            checks.append({"name": name, "ok": True, "detail": str(detail or "works"), "seconds": round(time.time() - t0, 1)})
        except Exception as exc:  # noqa: BLE001 - the whole point is to report any failure in plain text
            checks.append({"name": name, "ok": False, "detail": f"{type(exc).__name__}: {exc}"[:500], "seconds": round(time.time() - t0, 1)})
        progress("selftest", 100 * len(checks) / total, name)

    work = Path(a.work)
    work.mkdir(parents=True, exist_ok=True)

    def voice16k(sec=3.0):
        t = np.arange(int(16000 * sec)) / 16000.0
        f0 = 140 * (1 + 0.05 * np.sin(2 * np.pi * 3 * t))
        ph = 2 * np.pi * np.cumsum(f0) / 16000.0
        x = sum(np.sin(h * ph) / h for h in range(1, 20)) * (0.6 + 0.4 * np.sin(2 * np.pi * 4 * t))
        return (0.3 * x / np.max(np.abs(x))).astype(np.float32)

    def t_ffmpeg():
        out = work / "selftest_tone.wav"
        run_ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=1", str(out)])
        x, sr = read_wav(out)
        if x.shape[0] < sr * 0.9:
            raise RuntimeError("ffmpeg produced a too short file")
        return "ffmpeg runs, audio files can be read and written"

    def t_libs():
        import importlib
        versions = []
        for mod in ("faster_whisper", "ctranslate2", "transformers", "demucs", "soundfile", "sentencepiece"):
            m = importlib.import_module(mod)
            versions.append(f"{mod} {getattr(m, '__version__', '')}".strip())
        return ", ".join(versions)

    def t_gpu():
        try:
            import torch
            import ctranslate2
            cuda = torch.cuda.is_available()
            n = ctranslate2.get_cuda_device_count()
            if cuda:
                return f"graphics card found: {torch.cuda.get_device_name(0)} (recognizer sees {n})"
            return "no usable graphics card: everything runs on the CPU (slower but works)"
        except Exception as exc:
            return f"could not look for a graphics card ({exc}); the CPU will be used"

    def t_asr():
        if not a.asr_model or not Path(a.asr_model).is_dir():
            raise RuntimeError("the speech recognition model is not downloaded yet (Models page)")
        import torch
        from faster_whisper import WhisperModel
        cuda = torch.cuda.is_available()
        used = "cuda" if cuda else "cpu"
        try:
            model = WhisperModel(a.asr_model, device=used, compute_type="float16" if cuda else "int8")
            segs, _ = model.transcribe(voice16k(), vad_filter=False, word_timestamps=True)
            list(segs)
        except Exception as exc:
            if not cuda:
                raise
            used = "cpu (the graphics card failed: " + str(exc)[:80] + ")"
            model = WhisperModel(a.asr_model, device="cpu", compute_type="int8")
            segs, _ = model.transcribe(voice16k(), vad_filter=False, word_timestamps=True)
            list(segs)
        return f"model loads and transcribes with word timestamps on {used}"

    def t_mt():
        if not a.mt_model or not Path(a.mt_model).is_dir():
            raise RuntimeError("the translation model is not downloaded yet (Models page)")
        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        tok = AutoTokenizer.from_pretrained(a.mt_model, src_lang=P.nllb_code("english"))
        model = AutoModelForSeq2SeqLM.from_pretrained(a.mt_model).eval()
        enc = tok(["Hello, how are you today?"], return_tensors="pt")
        with torch.inference_mode():
            gen = model.generate(**enc, forced_bos_token_id=tok.convert_tokens_to_ids(P.nllb_code("hindi")), num_beams=4, num_return_sequences=2, max_new_tokens=40)
        outs = tok.batch_decode(gen, skip_special_tokens=True)
        if not outs or not any("\u0900" <= ch <= "\u097f" for ch in outs[0]):
            raise RuntimeError(f"unexpected translation result: {outs!r}")
        return f"English -> Hindi works: {outs[0]}"

    def t_sep():
        if not a.separation:
            return "skipped (not requested)"
        import torch
        from demucs.apply import apply_model
        from demucs.pretrained import get_model
        model = get_model("htdemucs").eval()
        x = torch.randn(1, 2, SR * 3) * 0.1
        with torch.inference_mode():
            out = apply_model(model, x, device="cpu", split=True, progress=False)
        if out.shape[1] != len(model.sources) or "vocals" not in model.sources:
            raise RuntimeError(f"unexpected separator output {tuple(out.shape)}")
        return "voice/music separation works"

    def t_spk():
        v = P.voice_features(voice16k(), 16000)
        if v is None or not np.all(np.isfinite(v)):
            raise RuntimeError("could not compute a voice fingerprint")
        return "speaker detection works"

    check("Audio tools (ffmpeg)", t_ffmpeg)
    check("Python libraries", t_libs)
    check("Graphics card", t_gpu)
    check("Speech recognition model", t_asr)
    check("Translation model", t_mt)
    check("Voice and music separation", t_sep)
    check("Speaker detection", t_spk)
    emit(event="result", checks=checks, allOk=all(c["ok"] for c in checks))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare"); p.add_argument("--input", required=True); p.add_argument("--work", required=True)
    p = sub.add_parser("analyze"); p.add_argument("--work", required=True); p.add_argument("--asr-model", required=True)
    p.add_argument("--language", default="auto"); p.add_argument("--separate", type=int, default=1)
    p.add_argument("--speakers", default="auto")
    p = sub.add_parser("translate"); p.add_argument("--work", required=True); p.add_argument("--mt-model", required=True)
    p.add_argument("--src", required=True); p.add_argument("--tgt", required=True); p.add_argument("--segments", required=True)
    p.add_argument("--candidates", type=int, default=3)
    p = sub.add_parser("assemble"); p.add_argument("--work", required=True); p.add_argument("--plan", required=True)
    p = sub.add_parser("selftest"); p.add_argument("--work", required=True); p.add_argument("--asr-model", default=""); p.add_argument("--mt-model", default=""); p.add_argument("--separation", type=int, default=0)
    p = sub.add_parser("mux"); p.add_argument("--video", required=True); p.add_argument("--audio", required=True); p.add_argument("--output", required=True)
    a = ap.parse_args()
    try:
        {"prepare": cmd_prepare, "analyze": cmd_analyze, "translate": cmd_translate, "assemble": cmd_assemble, "mux": cmd_mux, "selftest": cmd_selftest}[a.cmd](a)
    except Exception as exc:  # the app shows this text to the user
        emit(event="error", message=str(exc), detail=traceback.format_exc()[-1500:])
        sys.exit(1)


if __name__ == "__main__":
    main()
