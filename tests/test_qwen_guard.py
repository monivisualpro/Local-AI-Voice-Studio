"""The 'glitching voice' guard: a runaway/NaN take is retried with calmer sampling; references are cleaned."""
import os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from engines import qwen3, common

eng = qwen3.Qwen3Engine.__new__(qwen3.Qwen3Engine)
SR = 24000
text = "Hello there, this is a short test sentence."          # ~2.5 s of speech
good = np.zeros(int(SR * 3), dtype="float32")
babble = np.zeros(int(SR * 40), dtype="float32")             # 40 s for 42 chars = runaway
nan = good.copy(); nan[100] = np.nan
calls = []

def run(gen):
    calls.append(dict(gen))
    return [babble, nan, good][len(calls) - 1], SR

gen = {"max_new_tokens": 400, "repetition_penalty": 1.1, "temperature": 0.7, "subtalker_temperature": 0.7}
wav, sr = eng._guarded(text, gen, run)
assert len(calls) == 3 and len(wav) == len(good), len(calls)
assert calls[2]["temperature"] < calls[0]["temperature"] and calls[2]["repetition_penalty"] > 1.1, calls
print("guard retries runaway + NaN takes with calmer sampling: OK")

# a good first take is returned untouched, no retry
calls.clear(); run2 = lambda g: (calls.append(1) or good, SR)
eng._guarded(text, gen, run2); assert len(calls) == 1
print("good take is not retried: OK")

# reference cleanup: silence padding removed, level normalised, DC removed
t = np.arange(SR * 2) / SR
voice = (0.05 * np.sin(2 * np.pi * 180 * t) + 0.1).astype("float32")
clip = np.concatenate([np.zeros(SR * 3, "float32"), voice, np.zeros(SR * 3, "float32")])
out = common.clean_reference(clip, SR)
assert 1.8 < len(out) / SR < 2.6, len(out) / SR
assert abs(float(np.max(np.abs(out))) - 0.95) < 0.01 and abs(float(out.mean())) < 0.05
try:
    common.clean_reference(np.zeros(SR, "float32"), SR); raise SystemExit("silent clip accepted")
except common.UserError:
    pass
print("reference cleanup: OK")
