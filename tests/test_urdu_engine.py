"""Run: python3 tests/test_urdu_engine.py - checks the Urdu Tortoise engine wiring with a fake tortoise (no weights)."""
import sys, types, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
ok = True
def check(l, c, x=""):
    global ok; print(("PASS  " if c else "FAIL  ") + l + (f"  - {x}" if x else "")); ok = ok and bool(c)

captured = {}
class FakeInner:
    def __init__(self, vocab_chars): self.vocab = vocab_chars
    def token_to_id(self, t): return 0 if t == "[UNK]" else 1
class FakeTok:
    def __init__(self, chars): self.tokenizer = FakeInner(chars); self.chars = chars
    def encode(self, txt): return [1 if c in self.chars else 0 for c in txt if c != " "]
class FakeTTS:
    def __init__(self, **kw):
        captured.update(kw)
        chars = set("اردوزبانکخصیہ") if kw.get("tokenizer_vocab_file") and "urdu" in kw["tokenizer_vocab_file"] else set("abc")
        self.tokenizer = FakeTok(chars)
api = types.ModuleType("tortoise.api"); api.TextToSpeech = FakeTTS; api.get_model_path = None
pkg = types.ModuleType("tortoise"); pkg.api = api
sys.modules["tortoise"] = pkg; sys.modules["tortoise.api"] = api
from engines import urdu_tortoise as U

def make(tok_name=None):
    d = Path(tempfile.mkdtemp())
    (d / "models/urdu-multispeaker").mkdir(parents=True)
    (d / "models/urdu-multispeaker/ar-model.pth").write_bytes(b"x")
    (d / "base").mkdir()
    for n in U.BASE_FILES: (d / "base" / n).write_bytes(b"x")
    if tok_name:
        (d / "models/urdu-multispeaker" / tok_name).write_text("{}")
    return d

d = make("urdu_tokenizer.json")
eng = U.load(str(d), "cpu", progress=lambda *_: None)
check("custom tokenizer is passed to Tortoise", captured["tokenizer_vocab_file"].endswith("urdu_tokenizer.json"))
check("custom tokenizer => BASIC cleaners (English cleaner would transliterate Urdu to ASCII)", captured["tokenizer_basic"] is True)
check("redaction (needs a separate wav2vec download) stays off", captured["enable_redaction"] is False)
check("the stock Tortoise files are used from base/", api.get_model_path("clvp2.pth").endswith("base/clvp2.pth") or api.get_model_path("clvp2.pth").endswith("base\\clvp2.pth"))
check("the fine-tuned autoregressive model replaces autoregressive.pth", api.get_model_path("autoregressive.pth").endswith("ar-model.pth"))

d = make()  # no custom tokenizer: stock vocabulary, English cleaner (degraded Roman transliteration)
captured.clear(); U.load(str(d), "cpu", progress=lambda *_: None)
check("no custom tokenizer => defaults kept", captured["tokenizer_vocab_file"] is None and captured["tokenizer_basic"] is False)

# a vocabulary without Urdu letters must be refused
class BadTTS(FakeTTS):
    def __init__(self, **kw):
        super().__init__(**kw); self.tokenizer = FakeTok(set("abc"))
api.TextToSpeech = BadTTS
d = make("tokenizer.json")
try: U.load(str(d), "cpu", progress=lambda *_: None); bad = False
except FileNotFoundError as e: bad = "Urdu letters" in str(e)
check("a tokenizer without Urdu letters is refused with a clear message", bad)
print("\nALL URDU ENGINE CHECKS PASSED" if ok else "\nSOME CHECKS FAILED"); sys.exit(0 if ok else 1)
