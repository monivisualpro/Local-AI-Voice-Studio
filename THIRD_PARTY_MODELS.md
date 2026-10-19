# Third-Party AI Models — Licenses & Commercial Use

This document lists every AI model integrated with Local AI Voice Studio, its official license, and whether commercial use and voice cloning are permitted.

**Last updated:** 2026-10-19  
**Rule:** This project's Source-Available License governs only the Local AI Voice Studio software. Each model remains under its own license. You must comply with each model's terms.

---

## Model License Summary

| Model | Engine/Adapter | License | Commercial Use | Voice Cloning | Gated/Terms Acceptance | Notes |
|-------|---------------|---------|----------------|---------------|------------------------|-------|
| **Kokoro 82M** | `kokoro` | Apache-2.0 | ✅ Yes | N/A (preset voices) | No | Fully permissive |
| **Qwen3-TTS 0.6B Base** | `qwen3` | Tongyi Qianwen License | ⚠️ Check terms | ✅ Allowed | Yes (HF repo) | Requires acceptance on Hugging Face |
| **Qwen3-TTS 1.7B VoiceDesign** | `qwen3` | Tongyi Qianwen License | ⚠️ Check terms | ✅ By description | Yes (HF repo) | Voice design from text |
| **Chatterbox TTS** | `chatterbox` | MIT | ✅ Yes | ✅ Allowed | No | |
| **F5-TTS** | `f5tts` | MIT | ✅ Yes | ✅ Allowed | No | Requires reference audio + exact transcript |
| **XTTS-v2** | `xtts` | Coqui TTS License (CC-BY-NC-4.0) | ❌ **Non-commercial only** | ✅ Allowed | No | **Cannot use commercially** |
| **Parler-TTS** | `parler` | Apache-2.0 | ✅ Yes | ✅ Allowed | No | |
| **Indic Parler-TTS** | `parler` | Apache-2.0 | ✅ Yes | ✅ Allowed | Yes (HF repo) | Indian languages; gated on HF |
| **Svara-TTS** | `svara` | Apache-2.0 | ✅ Yes | ✅ Allowed | No | Llama-3.2-3B + SNAC |
| **Sooktam-2** | `sooktam` | Custom (check repo) | ⚠️ Check terms | ✅ Allowed | No | Indic languages; pins torch 2.6 |
| **Urdu Tortoise TTS** | `urdu-tortoise` | Custom (check repo) | ⚠️ Check terms | ✅ Allowed | No | Urdu language; tortoise-tts 3.0.0 |
| **Whisper (faster-whisper)** | `dub` | MIT | ✅ Yes | N/A (ASR) | No | Speech recognition |
| **NLLB-200** | `dub` | CC-BY-NC-4.0 | ❌ **Non-commercial only** | N/A (Translation) | No | **Cannot use commercially** |
| **Demucs** | `dub` | MIT | ✅ Yes | N/A (Separation) | No | Voice/music separation |

---

## Key for Commercial Use Column

| Symbol | Meaning |
|--------|---------|
| ✅ Yes | License permits commercial use of model outputs |
| ❌ Non-commercial only | License explicitly forbids commercial use (CC-BY-NC, etc.) |
| ⚠️ Check terms | Custom license or ambiguous terms — read the model's license file |

---

## Model Repository Links

| Model | Hugging Face / Repository |
|-------|---------------------------|
| Kokoro 82M | `hexgrad/Kokoro-82M` |
| Qwen3-TTS 0.6B Base | `Qwen/Qwen3-TTS-0.6B` |
| Qwen3-TTS 1.7B VoiceDesign | `Qwen/Qwen3-TTS-1.7B` |
| Chatterbox TTS | `resemble-ai/chatterbox` |
| F5-TTS | `SWivid/F5-TTS` |
| XTTS-v2 | `coqui-ai/TTS` (XTTS-v2 folder) |
| Parler-TTS | `parler-tts/parler-tts-mini-v1` |
| Indic Parler-TTS | `ai4bharat/indic-parler-tts` (gated) |
| Svara-TTS | Check `snac` + `transformers` integration |
| Sooktam-2 | Check repository for license |
| Urdu Tortoise | Check repository for license |
| Whisper large-v3-turbo | `Systran/faster-whisper-large-v3-turbo` |
| NLLB-200 | `facebook/nllb-200-distilled-600M` |
| Demucs | `facebookresearch/demucs` |

---

## Compliance Checklist for Users

Before using any model commercially:

- [ ] Read the model's license on its official repository
- [ ] Accept any required terms (gated models: click "Agree / Access repository" on HF)
- [ ] Verify voice cloning is permitted for your specific use case
- [ ] Ensure you have legal rights to any reference audio you provide
- [ ] Do not impersonate real people without explicit consent
- [ ] For NC-licensed models (XTTS-v2, NLLB-200): restrict to personal/research/educational use only

**When in doubt, assume non-commercial only and consult the model publisher.**

---

## Voice Cloning Ethics

This software enables voice cloning technology. You are responsible for ethical use:

- ✅ Clone **your own voice** or voices you have explicit permission to use
- ✅ Use for accessibility, content creation, localization with proper rights
- ❌ Do not impersonate real people without consent
- ❌ Do not create misleading, deceptive, or harmful content
- ❌ Do not violate personality rights, publicity rights, or privacy laws

The license terminates automatically for material violations (see LICENSE Section 7).