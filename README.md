# Local AI Voice Studio

A cross-platform desktop studio for local AI voice generation, with automated model setup, shared Python environments, and resumable downloads.

## Features

- **Text-to-Speech**: Multiple engines (Kokoro, Qwen3-TTS, Chatterbox, F5-TTS, XTTS-v2, Parler-TTS, Svara, Sooktam, Urdu Tortoise)
- **Voice Cloning**: Zero-shot cloning from 3-20 second reference clips
- **Voice Design**: Create voices from text descriptions (Qwen3-TTS 1.7B VoiceDesign)
- **Dubbing**: Translate and re-voice videos/audio (Whisper + NLLB + Demucs)
- **Local-First**: Everything runs on your hardware (GPU/CPU), no cloud required
- **Resumable Downloads**: Multi-connection, checksum-verified, pause/resume capable
- **Shared Environments**: Compatible models share Python/PyTorch installs to save space

## Quick Start

### Download Installers
| Platform | Download |
|----------|----------|
| Windows | `.exe` installer (chooses install + data folders) |
| macOS | `.dmg` (drag to Applications) / `.pkg` (standard installer) |
| Linux | `.AppImage` (run anywhere) / `.deb` / `.tar.gz` + install script |

**Latest Release**: [GitHub Releases](https://github.com/monivisualpro/local-ai-voice-studio/releases)

### First Run
1. Install the app
2. Open **Settings → Voice Engines & Dependencies**
3. Select a model → **Set up automatically** (installs Python + PyTorch for your GPU)
4. Go to **Models** page → Download a model → **Load Model**
5. Start generating on the **Generate** page

## Documentation

- [User Guide](USER_GUIDE.md) — Complete tutorial for all features
- [Building](BUILDING.md) — Build installers locally or via GitHub Actions
- [Packaging Guide](PACKAGING_GUIDE.md) — Quick reference for developers
- [Setup Guide](SETUP_REAL_TTS.md) — Technical setup details
- [License](LICENSE) — Source-Available License
- [Third-Party Models](THIRD_PARTY_MODELS.md) — AI model licenses & commercial-use restrictions
- [Third-Party Notices](THIRD_PARTY_NOTICES.md) — Software dependency licenses

## License

**Source-Available License** — Free for personal, educational, research, and commercial **use**.  
You may **not** sell, rent, or redistribute the software itself as a paid product.  
See [LICENSE](LICENSE) for full terms.

Third-party AI models have their own licenses — see [Third-Party AI Models.txt](Third-Party%20AI%20Models.txt).

## System Requirements

| | Minimum | Recommended |
|---|---|---|
| **OS** | Windows 10/11, macOS 12+, Linux (x64) | Same |
| **RAM** | 8 GB | 16 GB+ |
| **GPU** | None (CPU works) | NVIDIA 6+ GB VRAM |
| **Disk** | 15 GB | 40 GB+ |
| **Internet** | Required for downloads | |

## Building from Source

```bash
# Install dependencies
npm install --legacy-peer-deps

# Development (with hot reload)
npm run electron:dev

# Build installers (current platform)
npm run dist:win   # Windows
npm run dist:mac   # macOS (requires Mac)
npm run dist:linux # Linux

# Or build all via GitHub Actions (push tag v*)
git tag v1.0.0 && git push origin v1.0.0
```

See [BUILDING.md](BUILDING.md) for full build instructions.

## Support

- **Issues**: [GitHub Issues](https://github.com/monivisualpro/local-ai-voice-studio/issues)
- **Discussions**: [GitHub Discussions](https://github.com/monivisualpro/local-ai-voice-studio/discussions)
- **Website**: https://monivisualpro.web.app

---

**Copyright © 2026 Moni Visual Pro**