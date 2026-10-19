"""Indic Parler: a take that never stops (cap hit / far too long) is retried; dead air is compacted; pieces end in a mark."""
import os, sys, types
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from engines import parler, common

SR = 44100
eng = parler.ParlerEngine.__new__(parler.ParlerEngine)
eng.indic = True
eng.model = types.SimpleNamespace(config=types.SimpleNamespace(
    sampling_rate=SR, audio_encoder=types.SimpleNamespace(frame_rate=86.0), decoder=types.SimpleNamespace(num_codebooks=9)))

def speech(sec):
    t = np.arange(int(SR * sec)) / SR
    return (0.3 * np.sin(2 * np.pi * 200 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 4 * t))).astype("float32")

piece = "क्या आपने महसूस किया है कि आपकी टांगें अब पहले जैसी मजबूत नहीं रहीं?"   # ~68 chars -> ~5 s of speech
runaway = np.concatenate([speech(4), np.zeros(SR * 10, "float32"), speech(20)])    # stalls 10 s, then rambles
calls = []
def fake_generate(d, m, text, temp, budget=None):
    calls.append((text, temp, budget))
    return [runaway, speech(4.5)][min(len(calls) - 1, 1)]
eng._generate = fake_generate
out = eng._piece(None, None, piece, 0.7)
assert len(calls) == 2, len(calls)
assert calls[1][1] < calls[0][1], "retry must use calmer sampling"
assert 3.5 < len(out) / SR < 6, len(out) / SR
print("runaway take retried with calmer sampling: OK")

stall = np.concatenate([speech(2), np.zeros(SR * 5, "float32"), speech(2.5)])
calls.clear(); eng._generate = lambda *a, **k: stall
out = eng._piece(None, None, piece, 0.7)
assert len(out) / SR < 6.5, len(out) / SR    # the 5 s stall became <0.5 s
print("long silent stall compacted: OK")

assert parler._ensure_terminal("यह बिना चिह्न का वाक्य").endswith("\u0964")
assert parler._ensure_terminal("hello there,").endswith(".")
assert parler._ensure_terminal("पूरा वाक्य है।") == "पूरा वाक्य है।"
assert eng._token_budget(piece) < 1100
print("terminal marks + token cap: OK")
