# Third-Party Software Notices

Local AI Voice Studio includes and depends on the following third-party software. Each component retains its own license. This file satisfies attribution requirements for bundled/linked dependencies.

---

## Electron & Node.js Runtime

| Component | License | Repository |
|-----------|---------|------------|
| Electron 44.x | MIT | https://github.com/electron/electron |
| Node.js 22.x | MIT | https://github.com/nodejs/node |
| Vite 8.x | MIT | https://github.com/vitejs/vite |
| TypeScript 7.x | Apache-2.0 | https://github.com/microsoft/TypeScript |

---

## Frontend Dependencies (React 19)

| Package | License | Repository |
|---------|---------|------------|
| React 19 | MIT | https://github.com/facebook/react |
| React DOM 19 | MIT | https://github.com/facebook/react |
| Motion (Framer Motion) 12.x | MIT | https://github.com/framer/motion |
| Lucide React | ISC | https://github.com/lucide-icons/lucide |
| Tailwind CSS 4.x | MIT | https://github.com/tailwindlabs/tailwindcss |
| @tailwindcss/vite | MIT | https://github.com/tailwindlabs/tailwindcss |

---

## Build & Packaging

| Package | License | Repository |
|---------|---------|------------|
| electron-builder 26.x | MIT | https://github.com/electron-userland/electron-builder |
| @vitejs/plugin-react | MIT | https://github.com/vitejs/vite-plugin-react |
| autoprefixer | MIT | https://github.com/postcss/autoprefixer |
| concurrently | MIT | https://github.com/open-cli-tools/concurrently |
| wait-on | MIT | https://github.com/jeffbski/wait-on |
| tsx | MIT | https://github.com/privatenumber/tsx |

---

## Python Runtime (Bundled via python-build-standalone)

| Component | License | Source |
|-----------|---------|--------|
| CPython 3.11 (python-build-standalone) | PSF-2.0 | https://github.com/astral-sh/python-build-standalone |
| pip / setuptools / wheel | MIT / PSF-2.0 | https://github.com/pypa/pip |

---

## Python Packages (Installed at Runtime per Model)

These are downloaded into isolated virtual environments per model family. Licenses apply to each package individually.

### Core ML Stack
| Package | License | Notes |
|---------|---------|-------|
| torch / torchaudio | BSD-3-Clause | PyTorch; CUDA wheels include NVIDIA CUDA Runtime (BSD-3-Clause) |
| transformers | Apache-2.0 | Hugging Face |
| accelerate | Apache-2.0 | Hugging Face |
| safetensors | Apache-2.0 | Hugging Face |
| huggingface-hub | Apache-2.0 | Hugging Face |
| tokenizers | Apache-2.0 | Hugging Face |

### Audio & Speech
| Package | License | Notes |
|---------|---------|-------|
| soundfile | BSD-3-Clause | libsndfile wrapper |
| librosa | ISC | Audio analysis |
| pydub | MIT | Audio manipulation |
| vocos | MIT | Neural vocoder |
| x-transformers | MIT | Transformer components |
| snac | MIT | Audio codec |
| demucs | MIT | Source separation |
| imageio-ffmpeg | BSD-2-Clause | FFmpeg wrapper |
| faster-whisper | MIT | CTranslate2 Whisper |
| ctranslate2 | MIT | Transformer inference |
| parler-tts | Apache-2.0 | Parler-TTS |
| chatterbox-tts | MIT | Chatterbox |
| f5-tts | MIT | F5-TTS |
| kokoro | Apache-2.0 | Kokoro TTS |
| qwen-tts | Tongyi Qianwen License | Qwen3-TTS |
| tortoise-tts | Custom | Urdu Tortoise |
| coqui-tts | Coqui TTS License (CC-BY-NC-4.0) | XTTS-v2 — **Non-commercial** |

### NLP & Tokenization
| Package | License | Notes |
|---------|---------|-------|
| sentencepiece | Apache-2.0 | Google |
| protobuf | BSD-3-Clause | Google |
| indic-nlp-library | Custom | Indic languages |
| indic-unified-parser | Custom | Indic parsing |
| indo-arabic-transliteration | Custom | Transliteration |
| indic-numtowords | Custom | Number to words |
| jieba | MIT | Chinese tokenization |
| pypinyin | MIT | Chinese pinyin |
| unidecode | GPL-2.0+ | Unicode transliteration |

### Utilities
| Package | License | Notes |
|---------|---------|-------|
| numpy | BSD-3-Clause | |
| numpy<2 | BSD-3-Clause | Pinned for compatibility |
| scipy | BSD-3-Clause | |
| tqdm | MIT / MPL-2.0 | Progress bars |
| click | BSD-3-Clause | CLI framework |
| pydantic | MIT | Data validation |
| pydantic<=2.10.6 | MIT | Pinned for compatibility |
| ema-pytorch | MIT | EMA for PyTorch |
| hydra-core | MIT | Config framework |
| datasets | Apache-2.0 | HF Datasets |
| cached-path | MIT | Cached downloads |
| tomli | MIT | TOML parser |
| zhon | MIT | Chinese punctuation |

---

## System Libraries (Linked at Runtime)

| Library | License | Purpose |
|---------|---------|---------|
| libsndfile | LGPL-2.1 | Audio file I/O (soundfile) |
| FFmpeg | LGPL-2.1 / GPL-2.0 | Audio/video processing (imageio-ffmpeg, pydub) |
| CUDA Runtime | NVIDIA EULA | GPU acceleration (bundled in PyTorch wheels) |
| cuDNN | NVIDIA EULA | Deep learning primitives (bundled in PyTorch wheels) |
| OpenBLAS | BSD-3-Clause | BLAS implementation (bundled in PyTorch) |
| MKL | Intel EULA | Math kernel library (bundled in PyTorch) |

---

## Build-Time Only (Not Distributed)

| Package | License | Purpose |
|---------|---------|---------|
| @types/node | MIT | TypeScript definitions |
| @types/react | MIT | TypeScript definitions |
| @types/react-dom | MIT | TypeScript definitions |
| electron (dev) | MIT | Development runtime |
| typescript | Apache-2.0 | Type checker |

---

## Attribution Summary

This software includes code from the above projects. Full license texts for each dependency are available in their respective repositories. The Local AI Voice Studio Source-Available License applies only to the original code authored by Moni Visual Pro.

**If you redistribute this application**, you must:
1. Include this THIRD_PARTY_NOTICES.md file
2. Include the LICENSE file (Source-Available License)
3. Include THIRD_PARTY_MODELS.md for AI model licenses
4. Not imply endorsement by any third-party project
5. Comply with all third-party licenses listed above

---

## Contact

For questions about third-party licensing compliance:
- Project: Local AI Voice Studio
- Copyright holder: Moni Visual Pro
- Website: https://monivisualpro.web.app