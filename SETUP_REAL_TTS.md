# Local AI Voice Studio - setup

## Quick start (Windows / macOS / Linux)
1. `npm install --legacy-peer-deps`
2. `npm run electron:dev`   (a browser tab cannot run the models)
3. **Settings -> Voice Engines & Dependencies** -> open a model -> **Set up automatically**.
   Everything is installed once and **shared** between models whenever their libraries are compatible:
   - Microsoft Visual C++ runtime (Windows only, if missing; Windows asks permission)
   - ONE portable Python 3.11 for all models (SHA-256 verified)
   - ONE environment holding PyTorch (the right build for your PC: **CUDA 13**, **CUDA 12.6** or **CPU**; CUDA is bundled,
     no separate CUDA Toolkit) and the common libraries, reused by every compatible model
   - Only the packages a new model is *missing* are downloaded (e.g. adding a second model to an existing environment
     typically downloads a few MB instead of GB)
   - If a model needs **different versions** (a different PyTorch or `transformers`), it automatically gets its own
     environment, so models never break each other
   - A verification step that really imports every library

4. **Models** page -> download the model -> **Load Model** -> Generate.

If a voice engine is missing when you press Generate, the same installer appears right there.

## Downloads: fast and resumable
- Multi-connection (up to 8 per file, 16 total) chunked downloads, like a download manager.
- Progress is saved every second beside the partial file. **Pause, close the app, crash or lose power:**
  the next start continues from the saved chunks, never from zero.
- Automatic retry with back-off, stall detection, expired-link recovery.
- Hugging Face files are verified against their SHA-256; Python and pip packages too.
- Disk-space check before starting; optional speed limit (Settings).
- Slow Hugging Face? Set `HF_ENDPOINT` to a mirror before launching.
Note: several connections help when a server limits each connection. They cannot exceed your internet line speed.

## How sharing is decided
At install time the app asks pip's real resolver whether the new model fits into an environment you already have:
it must resolve **and** must not change any package already installed there. If it fits, it is added there; otherwise a
new environment is created. Real results at the time of writing:

| Environment | Models that can share it | Why |
|---|---|---|
| Shared (PyTorch latest, transformers 4.57.3) | Kokoro, Qwen3-TTS, XTTS-v2, F5-TTS | compatible pins |
| Own environment | Chatterbox | pins PyTorch 2.6.0 + transformers 5.2.0 |
| Own environment | Parler-TTS | pins transformers 4.46.1 |

Settings shows every environment, its models, PyTorch build, disk size, and lets you remove a model (shared libraries stay
while another model uses them) or delete a whole environment.

## Which models work
| Model | Needs |
|---|---|
| Kokoro 82M | nothing extra (preset voices) |
| Qwen3-TTS 0.6B Base | reference audio (3-20 s); transcript optional, improves quality |
| Qwen3-TTS 1.7B VoiceDesign | a voice description (Style Instruction box) |
| Chatterbox | optional reference audio |
| F5-TTS | reference audio + its exact transcript. The vocoder downloads once on first use |
| XTTS-v2 | optional reference audio (non-commercial licence) |
| Parler-TTS | a voice description |

## Incomplete models
A model counts as installed only when **all** the files it needs exist (for example Qwen3-TTS needs its `speech_tokenizer`
folder, Kokoro needs its `voices` folder). If a download was interrupted, the Models page shows
"Incomplete: N part(s) missing" and **Download** finishes only the missing files (finished files are kept, partial ones resume).
If the speech engine finds a model incomplete when generating, the Generate page offers **Repair model files**.

## If an install or download looks slow or stuck
- Open **Settings -> Voice Engines & Dependencies -> Test connection**. It checks Hugging Face, PyPI, PyTorch and GitHub and says
  in plain words why one is unreachable (DNS, firewall/VPN, proxy, antivirus certificate inspection).
- The installer shows live **speed (KB/s or MB/s and Mbit/s), a speed graph, time left, connections, average and peak speed,
  per-file progress**, and an elapsed timer on every step. **Show details** reveals the last lines of pip's output.
- "Work out the packages": older pip silently downloaded every package in full while planning (3.1 GB for Qwen3, in one
  slow, non-resumable stream, then downloaded again). The installer now upgrades pip first, which only reads package
  metadata (about 15 s and 16 MB in our test).
- Behind a proxy? The app uses your system proxy automatically (and passes it to pip).
- Disk full or no write permission is reported at once (nothing is lost; press Resume after freeing space).

## Troubleshooting
- Logs of every install: `<app data>/runtime/logs/<engine>.log`; "Open folder" in the installer opens the runtime folder.
- "Driver too old": update the NVIDIA driver, then press Repair. CPU works meanwhile.
- Chatterbox pins PyTorch 2.6, which has no kernels for RTX 50-series (Blackwell), so it runs on CPU there.
- XTTS reads reference clips with soundfile (torchaudio's loader needs FFmpeg since torchaudio 2.9).
- Advanced: set `TTS_PYTHON` to use your own Python instead of the managed one.

## Tests
`npm run test:downloads` (engine + model manager, offline) and `npm run test:electron` (boots the real app headless and drives its UI + IPC), `npm run test:runtime` and `npm run test:network` (need internet: real portable Python, real PyPI CDN).
