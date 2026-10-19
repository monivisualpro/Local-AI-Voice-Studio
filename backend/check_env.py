"""Imports the modules an engine needs for real and reports the PyTorch build. Prints ONE JSON line.

A module that merely exists on disk is not enough (e.g. coqui-tts raises ImportError on import when
torchcodec is missing), so every module is actually imported here.
"""
import importlib
import json
import sys

modules = [m for m in (sys.argv[1].split(",") if len(sys.argv) > 1 else []) if m]
out = {"ok": True, "modules": {}, "errors": {}, "torch": None, "python": sys.version.split()[0]}

# torch first: it is the usual source of "DLL load failed" / missing runtime problems
try:
    import torch  # noqa: F401
    out["torch"] = {
        "version": torch.__version__,
        "cuda": bool(torch.cuda.is_available()),
        "cudaVersion": torch.version.cuda,
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
    }
except ModuleNotFoundError:
    out["torch"] = None  # some engines do not need torch
except Exception as exc:  # broken install (missing VC++ runtime, wrong wheel...)
    out["torch"] = {"error": f"{type(exc).__name__}: {exc}"}
    out["ok"] = False

for name in modules:
    try:
        importlib.import_module(name)
        out["modules"][name] = True
    except BaseException as exc:  # noqa: BLE001 - report everything, never crash the check
        out["modules"][name] = False
        out["errors"][name] = f"{type(exc).__name__}: {str(exc)[:160]}"

if not all(out["modules"].values()):
    out["ok"] = False
print(json.dumps(out))
