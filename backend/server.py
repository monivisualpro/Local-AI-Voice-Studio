"""
Local TTS backend for Local AI Voice Studio (Kokoro-82M).

Started automatically by Electron (electron/main.cjs). Can also be run by hand:

    python backend/server.py --model-dir "C:/path/to/models/kokoro-82m" --port 8765

Endpoints (all on 127.0.0.1 only):
    GET  /health      -> {"ok": true, "loaded": bool, "device": "cpu|cuda", "voices": [...]}
    POST /synthesize  -> audio/wav   body: {"text","voice","speed","lang"}
"""
import argparse
import io
import json
import os
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import soundfile as sf

from engines import common

SAMPLE_RATE = 24000
FRAMES_PER_SECOND = 12.5  # codec frame rate of Qwen3-TTS (used only for the live "seconds of audio so far" estimate)
GEN_LOCK = threading.Lock()  # one generation at a time: two at once fight for the GPU/CPU and both crawl
BACKEND_VERSION = 1  # keep in sync with electron/main.cjs
STATE = {"adapter": "kokoro", "engine": None, "pipelines": {}, "model": None, "device": "cpu", "model_dir": None, "error": None,
         "loading": False, "last_activity": time.time()}

LANG_CODES = {
    "english": "a", "american english": "a", "british english": "b",
    "spanish": "e", "french": "f", "hindi": "h", "italian": "i",
    "portuguese": "p", "japanese": "j", "chinese": "z",
}


def find_file(model_dir, suffixes):
    for root, _dirs, files in os.walk(model_dir):
        for f in files:
            if f.lower().endswith(suffixes):
                return os.path.join(root, f)
    return None


def progress(msg):
    print(f"[tts-progress] {msg}", flush=True)


def load_model(model_dir):
    progress("Loading PyTorch (first launch can take a few minutes)...")
    import torch
    progress("Loading Kokoro library...")
    from kokoro import KModel

    config = os.path.join(model_dir, "config.json")
    weights = find_file(model_dir, (".pth",))
    if not os.path.isfile(config):
        raise FileNotFoundError(f"config.json not found in {model_dir}")
    if not weights:
        raise FileNotFoundError(f"No .pth weight file (e.g. kokoro-v1_0.pth) in {model_dir}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    progress(f"Loading model weights on {device.upper()}...")
    model = KModel(config=config, model=weights).to(device).eval()
    STATE.update(model=model, device=device, model_dir=model_dir, error=None)
    print(f"[tts] loaded {weights} on {device}", flush=True)


def get_pipeline(lang_code):
    from kokoro import KPipeline

    if lang_code not in STATE["pipelines"]:
        # repo_id is only used as a label here: the model object is already loaded from disk.
        STATE["pipelines"][lang_code] = KPipeline(
            lang_code=lang_code, repo_id="hexgrad/Kokoro-82M", model=STATE["model"]
        )
    return STATE["pipelines"][lang_code]


def pick_device():
    import torch
    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    return "cpu"


def load_engine(adapter, model_dir):
    """Loads a non-Kokoro engine from backend/engines/<adapter>.py."""
    import importlib
    progress(f"Loading PyTorch (first launch can take a few minutes)...")
    device = pick_device()
    module = importlib.import_module("engines." + adapter.replace("-", "_"))
    engine = module.load(model_dir, device, progress)
    STATE.update(engine=engine, model=engine, device=device, model_dir=model_dir, error=None)
    print(f"[tts] {adapter} engine ready on {device}", flush=True)


def synthesize_engine(req):
    """Runs the loaded non-Kokoro engine -> WAV bytes."""
    engine = STATE["engine"]
    if engine is None:
        if STATE["loading"]:
            raise RuntimeError("The model is still loading - try again in a moment")
        raise RuntimeError(STATE["error"] or "Model not loaded")
    audio, sr = engine.synthesize(req)
    if audio is None or len(audio) == 0:
        raise RuntimeError("The model produced no audio for this text")
    if req.get("compact_silence"):  # Studio: no multi-second dead air inside a segment (dubbing keeps raw timing)
        audio = common.compact_silence(audio, int(sr))
    buf = io.BytesIO()
    sf.write(buf, audio, int(sr), format="WAV", subtype="PCM_16")
    return buf.getvalue()


def list_voices():
    if STATE["adapter"] != "kokoro":
        engine = STATE["engine"]
        return engine.voices() if engine is not None else []
    vdir = os.path.join(STATE["model_dir"] or "", "voices")
    if not os.path.isdir(vdir):
        return []
    return sorted(f[:-3] for f in os.listdir(vdir) if f.endswith(".pt"))


def resolve_voice(requested):
    voices = list_voices()
    if requested and requested in voices:
        return requested
    for fallback in ("af_heart", "af_bella", "am_michael", "af", "af_sarah"):
        if fallback in voices:
            return fallback
    if voices:
        return voices[0]
    raise FileNotFoundError("No voice files (voices/*.pt) found. Re-download the model.")


def synthesize(text, voice, speed, lang):
    if STATE["model"] is None:
        if STATE["loading"]:
            raise RuntimeError("The model is still loading - try again in a moment")
        raise RuntimeError(STATE["error"] or "Model not loaded")
    voice_name = resolve_voice(voice)
    # American 'a' / British 'b' are decided by the voice prefix (af_/am_ vs bf_/bm_).
    lang_code = voice_name[0] if len(voice_name) > 1 and voice_name[1] in "fm" else LANG_CODES.get((lang or "").lower(), "a")
    pipeline = get_pipeline(lang_code)
    voice_path = os.path.join(STATE["model_dir"], "voices", voice_name + ".pt")

    parts = []
    for _gs, _ps, audio in pipeline(text, voice=voice_path, speed=float(speed or 1.0)):
        common.raise_if_cancelled()
        common.tick()
        if audio is not None:
            parts.append(audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio))
    if not parts:
        raise RuntimeError("Model produced no audio for this text")
    wav = np.concatenate(parts)
    buf = io.BytesIO()
    sf.write(buf, wav, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        line = fmt % args
        if "/health" in line:  # polled every 0.5 s while loading: keep the log readable
            return
        print("[tts]", line, flush=True)

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            prog = common.PROGRESS
            busy = bool(prog["busy"])
            self._json(200, {"ok": True, "version": BACKEND_VERSION, "loaded": STATE["model"] is not None,
                             "loading": STATE["loading"], "adapter": STATE["adapter"],
                             "device": STATE["device"], "voices": list_voices(),
                             "error": STATE["error"],
                             "busy": busy, "steps": prog["steps"],
                             "audioSeconds": round(prog["steps"] / FRAMES_PER_SECOND, 1),
                             "elapsed": round(time.time() - prog["started"], 1) if busy else 0})
        else:
            self._json(404, {"error": "not found"})

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_POST(self):
        if self.path == "/cancel":
            common.cancel_all()  # stops the running segment within one audio frame
            return self._json(200, {"ok": True})
        if self.path != "/synthesize":
            return self._json(404, {"error": "not found"})
        STATE["last_activity"] = time.time()
        arrival = common.current_epoch()  # a Stop pressed after this moment also cancels us while we wait in the queue
        try:
            req = self._read_json()
            text = (req.get("text") or "").strip()
            if not text:
                return self._json(400, {"error": "text is empty"})
            with GEN_LOCK:
                common.begin_job(arrival, len(text))
                started = time.time()
                try:
                    if STATE["adapter"] == "kokoro":
                        wav = synthesize(text, req.get("voice"), req.get("speed", 1.0), req.get("lang"))
                    else:
                        req["text"] = text
                        wav = synthesize_engine(req)
                finally:
                    common.end_job()
                    STATE["last_activity"] = time.time()
            print(f"[tts] generated {len(text)} chars in {time.time() - started:.1f}s on {STATE['device']}", flush=True)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav)))
            self.end_headers()
            self.wfile.write(wav)
        except common.Cancelled:
            free_gpu_memory()
            print("[tts] generation cancelled", flush=True)
            try:
                self._json(499, {"error": "cancelled", "cancelled": True})
            except Exception:
                pass  # the client already hung up
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:  # report the real reason to the UI
            if type(exc).__name__ == "UserError":  # fixable by the user: no stack trace, plain message
                return self._json(400, {"error": str(exc), "userError": True})
            traceback.print_exc()
            self._json(500, {"error": f"{type(exc).__name__}: {exc}"})


def free_gpu_memory():
    """After an interrupted generation: hand the half-built tensors back to the GPU allocator."""
    try:
        import gc
        gc.collect()
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def parent_alive(pid):
    """True while the Electron process that started us is still running."""
    if pid <= 0:
        return True
    if os.name == "nt":
        import ctypes
        k32 = ctypes.windll.kernel32
        handle = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            if not k32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return True
            return code.value == 259  # STILL_ACTIVE
        finally:
            k32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


def watchdog(parent_pid, max_idle_minutes):
    """Backstops so a crashed Electron can never leave this process holding the model in RAM."""
    while True:
        time.sleep(15)
        if not parent_alive(parent_pid):
            print("[tts] parent process is gone - exiting", flush=True)
            os._exit(0)
        if max_idle_minutes > 0 and time.time() - STATE["last_activity"] > max_idle_minutes * 60:
            print(f"[tts] idle for {max_idle_minutes} min - exiting to free memory", flush=True)
            os._exit(0)


def load_in_background(model_dir, adapter):
    try:
        if adapter == "kokoro":
            load_model(model_dir)
        else:
            load_engine(adapter, model_dir)
    except Exception as exc:
        STATE["error"] = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
    finally:
        STATE["loading"] = False
        STATE["last_activity"] = time.time()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--adapter", default="kokoro")
    ap.add_argument("--parent-pid", type=int, default=0)
    ap.add_argument("--max-idle-minutes", type=float, default=60)
    args = ap.parse_args()

    # Bind the port FIRST (this shrinks the window in which another process could
    # steal the port), then load the model in the background.
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[tts] listening on 127.0.0.1:{args.port}", flush=True)

    STATE["adapter"] = args.adapter
    STATE["loading"] = True
    threading.Thread(target=load_in_background, args=(args.model_dir, args.adapter), daemon=True).start()
    threading.Thread(target=watchdog, args=(args.parent_pid, args.max_idle_minutes), daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    sys.exit(main())
