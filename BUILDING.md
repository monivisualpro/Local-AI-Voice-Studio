# Building Local AI Voice Studio

This document describes how to build installers for Windows, macOS, and Linux, both locally and via GitHub Actions.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Local Build Commands](#local-build-commands)
3. [GitHub Actions Workflow](#github-actions-workflow)
4. [Release Process](#release-process)
5. [Output Filenames](#output-filenames)
6. [Platform Limitations](#platform-limitations)
7. [Signing & Notarization](#signing--notarization)
8. [Python Backend Provisioning](#python-backend-provisioning)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 22.x | Frontend build, Electron, electron-builder |
| npm | 10.x | Package manager |
| Python | 3.11+ | Backend server (only for local dev; packaged apps use portable Python) |
| Git | latest | Version control |

**Windows only:** Visual Studio Build Tools (for native modules, if any).

**macOS only:** Xcode Command Line Tools (`xcode-select --install`).

**Linux only:** Build dependencies for electron-builder:
```bash
sudo apt-get update && sudo apt-get install -y \
  libnss3-dev libatk-bridge2.0-dev libdrm2 libxkbcommon-dev \
  libgbm-dev libasound2-dev
```

---

## Local Build Commands

### 1. Install Dependencies
```bash
npm install --legacy-peer-deps
```
The `--legacy-peer-deps` flag is required because some dependencies have peer dependency conflicts that are known to be harmless.

### 2. Build Frontend (Required Before Packaging)
```bash
npm run build
```
This runs `vite build` and outputs to `dist/`. The Electron app loads `dist/index.html` via `file://` protocol, so this step is mandatory.

### 3. Run Tests (Recommended Before Packaging)
```bash
# TypeScript type check
npm run lint

# All download engine + model manager tests (offline, fast)
npm run test:downloads

# IPC tests (offline, fast)
npm run test:ipc

# UI tests (offline, fast)
npm run test:ui

# Audio/voice tests (offline, fast)
npm run test:fx

# Electron smoke tests (needs built frontend, runs headless)
npm run test:electron

# Network tests (requires internet, real downloads)
npm run test:network

# Runtime tests (requires internet, real portable Python + PyPI)
npm run test:runtime

# Python dubbing tests (requires internet)
npm run test:dub
```

### 4. Build Installers Per Platform

| Platform | Command | Output Folder |
|----------|---------|---------------|
| Windows | `npm run dist:win` | `release/windows/` |
| macOS | `npm run dist:mac` | `release/macos/` |
| Linux | `npm run dist:linux` | `release/linux/` |
| All | `npm run dist:all` | All three (skips macOS if not on Mac) |

**Note:** The `dist:*` scripts internally run `npm run build` first, so you can run them directly without a separate build step.

### 5. Cross-Platform Build Limitations

| Building On | Windows (.exe) | macOS (.dmg/.pkg) | Linux (.AppImage/.deb) |
|-------------|----------------|-------------------|------------------------|
| Windows | ✅ Full support | ❌ Cannot build | ❌ Cannot build* |
| macOS | ✅ Full support | ✅ Full support | ❌ Cannot build* |
| Linux | ✅ Full support | ❌ Cannot build | ✅ Full support |

\* Linux/macOS can technically cross-compile Windows with Wine, but icons/version info may be wrong. **Use GitHub Actions for reliable cross-platform builds.**

---

## GitHub Actions Workflow

The workflow at `.github/workflows/build.yml` provides automated cross-platform builds.

### Triggers
| Trigger | Behavior |
|---------|----------|
| Push tag `v*` (e.g., `v1.0.0`) | Runs tests, builds all 3 platforms, uploads artifacts, **creates GitHub Release** |
| Manual `workflow_dispatch` | Runs tests, builds all 3 platforms, uploads artifacts (no release) |
| Pull Request | Runs tests only (no build, no artifacts) |

### Job Structure
```
test (ubuntu-latest)
  ├─ TypeScript check
  ├─ Frontend build
  ├─ Download engine tests
  ├─ IPC tests
  ├─ UI tests
  └─ Audio/voice tests
      ↓ (only on tag push or manual dispatch)
build-windows (windows-latest)
build-macos (macos-latest)
build-linux (ubuntu-latest)
      ↓ (all three complete)
build-all (summary, fails if any platform failed)
```

### Artifacts
- Each platform job uploads its `release/<folder>/*` as a separate artifact named `windows`, `macos`, `linux`
- Artifacts retained for **30 days**
- On tag pushes, artifacts are also attached to the GitHub Release

### Release Creation
On tag pushes (`v*`):
- Uses `softprops/action-gh-release@v2`
- Attaches all platform artifacts
- Auto-generates release notes from commits
- Creates a **non-draft, non-prerelease** release

---

## Release Process

### For Maintainers

1. **Ensure all changes are on `main` branch**
2. **Update version** in `package.json` (follow semantic versioning)
3. **Commit and push**:
   ```bash
   git add package.json
   git commit -m "chore: release v1.0.0"
   git push origin main
   ```
4. **Create and push tag**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
5. **Monitor GitHub Actions** → "Build installers" workflow
6. **Verify Release** at `https://github.com/monivisualpro/local-ai-voice-studio/releases/tag/v1.0.0`
   - Should have 3+ assets (Windows `.exe`, macOS `.dmg`/`.pkg`, Linux `.AppImage`/`.deb`/`.tar.gz` + `install-linux.sh`)

### For Contributors (Testing Builds)
- Go to **Actions** → **Build installers** → **Run workflow**
- Select branch (default: `main`)
- Wait for completion
- Download artifacts from the workflow run summary

---

## Output Filenames

### Windows (`release/windows/`)
```
Local-AI-Voice-Studio-Setup-${version}.exe
LICENSE
THIRD_PARTY_MODELS.md
THIRD_PARTY_NOTICES.md
```
- NSIS installer with custom "Choose Data Folder" page
- Asks for install location (app ~400 MB) and data folder (models/engines 5-40 GB)
- Writes `install-config.ini` next to app; app reads it on first start
- Creates Desktop + Start Menu shortcuts
- **Not code-signed** → Windows SmartScreen warning on first run
- **Includes LICENSE, THIRD_PARTY_MODELS.md, THIRD_PARTY_NOTICES.md** in the installer resources

### macOS (`release/macos/`)
```
# Intel (x64)
Local-AI-Voice-Studio-${version}-x64.dmg
Local-AI-Voice-Studio-Installer-${version}-x64.pkg

# Apple Silicon (arm64)
Local-AI-Voice-Studio-${version}-arm64.dmg
Local-AI-Voice-Studio-Installer-${version}-arm64.pkg
LICENSE
THIRD_PARTY_MODELS.md
THIRD_PARTY_NOTICES.md
```
- `.dmg`: Drag to Applications (or any folder/disk)
- `.pkg`: Standard installer with "Change Install Location" for disk selection
- **Not notarized** → Gatekeeper warning on first run (right-click → Open)
- **Includes license files** in the app bundle resources

### Linux (`release/linux/`)
```
Local-AI-Voice-Studio-${version}-linux-x64.AppImage
local-ai-voice-studio_${version}_amd64.deb
Local-AI-Voice-Studio-${version}-linux-x64.tar.gz
install-linux.sh
LICENSE
THIRD_PARTY_MODELS.md
THIRD_PARTY_NOTICES.md
```
- `.AppImage`: Run from any disk (`chmod +x && ./file.AppImage`)
- `.deb`: `sudo apt install ./local-ai-voice-studio_${version}_amd64.deb`
- `.tar.gz` + `install-linux.sh`: Interactive installer asking for install folder and data folder
- **AppImage not signed** → No auto-update; user must replace file manually

---

## Platform Limitations

| Platform | Limitation |
|----------|------------|
| Windows | No code signing (SmartScreen warning). Building on non-Windows produces default Electron icon. |
| macOS | No notarization (Gatekeeper warning). Requires Apple Developer ID ($99/yr) for notarization. |
| Linux | No auto-update for AppImage. `.deb` installs system-wide but no repository. |
| All | Large AI models **not bundled** (downloaded on first use). No secrets in build. |

---

## Signing & Notarization

### Windows (Code Signing)
1. Obtain a **Microsoft Authenticode certificate** (EV preferred for instant SmartScreen trust)
2. Add to `electron-builder.json`:
   ```json
   "win": {
     "certificateFile": "path/to/cert.p12",
     "certificatePassword": "env: CSC_KEY_PASSWORD",
     "signAndEditExecutable": true
   }
   ```
3. Set `CSC_KEY_PASSWORD` as a GitHub Actions secret

### macOS (Notarization)
1. Obtain **Apple Developer ID Application** certificate ($99/yr Apple Developer Program)
2. Add to `electron-builder.json`:
   ```json
   "mac": {
     "identity": "Developer ID Application: Your Name (TEAM_ID)",
     "hardenedRuntime": true,
     "gatekeeperAssess": true
   }
   ```
3. Configure notarization (see [electron-builder docs](https://www.electron.build/configuration/mac)):
   ```json
   "afterSign": "tools/notarize.mjs"
   ```
4. Set `APPLE_ID`, `APPLE_ID_PASS` (app-specific password), `APPLE_TEAM_ID` as GitHub Actions secrets

### Linux
- AppImage: No standard signing mechanism
- `.deb`: Can be signed with `dpkg-sig` and a GPG key for repository distribution

---

## Python Backend Provisioning

**Critical:** The Python backend is **NOT bundled** as a standalone executable. Instead:

### How It Works
1. **Portable Python 3.11** (python-build-standalone) is downloaded on first use per platform:
   - Windows: `cpython-3.11.x+date-x86_64-pc-windows-msvc-install_only.tar.gz`
   - macOS (Intel): `cpython-3.11.x+date-x86_64-apple-darwin-install_only.tar.gz`
   - macOS (Apple Silicon): `cpython-3.11.x+date-aarch64-apple-darwin-install_only.tar.gz`
   - Linux: `cpython-3.11.x+date-x86_64-unknown-linux-gnu-install_only.tar.gz`
   - SHA-256 verified against pinned releases

2. **Per-model-family virtual environments** are created in the user's data folder:
   - Shared environment for compatible models (Kokoro, Qwen3, XTTS, F5-TTS)
   - Separate environments for conflicting dependencies (Chatterbox, Parler, Sooktam, Dubbing)
   - PyTorch wheel selected at install time: CUDA 13.0, CUDA 12.6, or CPU

3. **Backend server (`backend/server.py`)** is packaged as an **extraResource** by electron-builder:
   - Included in `resources/backend/` in the packaged app
   - Launched by Electron main process with `--model-dir`, `--port`, `--adapter`

### What This Means for Builds
- **No Python compilation during build** — the build only packages `backend/` source files
- **No platform-specific Python binaries in the repo** — they're downloaded at runtime
- **CUDA compatibility is handled at runtime** — the installer detects GPU/driver and picks the right PyTorch wheel
- **Model weights are never bundled** — downloaded from Hugging Face on demand (respects licenses)

### Verifying Backend Packaging
After building, check that `resources/backend/` exists in the unpacked installer:
```bash
# Windows: extract with 7zip or run installer to a temp folder
# macOS: hdiutil attach *.dmg; ls /Volumes/Local\ AI\ Voice\ Studio/Local\ AI\ Voice\ Studio.app/Contents/Resources/backend/
# Linux: ./*.AppImage --appimage-extract; ls squashfs-root/resources/backend/
```

Expected contents:
```
resources/backend/
├── server.py
├── check_env.py
├── engines/
│   ├── common.py
│   ├── kokoro.py
│   ├── qwen3.py
│   ├── chatterbox.py
│   ├── f5tts.py
│   ├── xtts.py
│   ├── svara.py
│   ├── sooktam.py
│   ├── urdu_tortoise.py
│   ├── parler.py
│   └── dub/
│       └── worker.py
└── requirements/
    ├── kokoro.txt
    ├── qwen3.txt
    ├── chatterbox.txt
    ├── f5tts.txt
    ├── xtts.txt
    ├── svara.txt
    ├── sooktam.txt
    ├── urdu-tortoise.txt
    ├── parler.txt
    └── dub.txt
```

---

## Troubleshooting

### Build Fails: "electron-builder not found"
```bash
npm install --legacy-peer-deps
```
Ensures devDependencies (including electron-builder) are installed.

### Build Fails: "Python not found" (Windows)
- The build itself doesn't need Python; only the runtime does.
- If `npm run dist:win` fails on Python, check that `backend/` files are being copied (see `extraResources` in `electron-builder.json`).

### macOS Build: "icon.icns not found"
- Run `python3 tools/generate-icons.py` to regenerate all icons including `build/icon.icns`
- Requires Pillow: `pip install pillow`

### Linux Build: "AppImage not running"
- Ensure `libfuse2` is installed: `sudo apt install libfuse2`
- AppImage requires FUSE; some minimal containers lack it

### Tests Fail: "Port 3000 in use"
- `vite.config.ts` uses `strictPort: true`
- Kill existing process: `lsof -ti:3000 | xargs kill -9` (Linux/macOS) or `netstat -ano | findstr :3000` (Windows)

### Tests Fail: "xvfb-run not found" (Linux)
```bash
sudo apt-get install -y xvfb
```
Required for headless Electron tests.

### GitHub Actions: "macOS build skipped"
- The workflow only runs macOS on `macos-latest` runner
- Local builds on non-macOS will skip macOS with a message
- **This is expected** — use GitHub Actions for macOS builds

### GitHub Actions: Release not created
- Only triggers on **tag push** (`git push origin v1.0.0`), not on branch push
- Check workflow run: "Release" step only runs when `startsWith(github.ref, 'refs/tags/v')`

### App Won't Start After Install: "White screen"
- Verify `vite.config.ts` has `base: './'` (required for Electron `file://` protocol)
- Check that `dist/index.html` exists and references assets with relative paths

### Models Not Downloading After Install
- The app downloads models on demand from Hugging Face
- Check **Settings → Test Connection** for network diagnostics
- Corporate networks may need proxy config (app uses system proxy automatically)

---

## Verified Build Matrix

| Platform | Locally Tested | CI Tested | Notes |
|----------|----------------|-----------|-------|
| Windows (x64) | ✅ | ✅ | Full installer with custom NSIS page |
| macOS (x64) | ❌ | ✅ | Requires Mac hardware |
| macOS (arm64) | ❌ | ✅ | Requires Apple Silicon Mac |
| Linux (x64) | ✅ | ✅ | AppImage, .deb, .tar.gz + install script |

**Legend:**
- ✅ = Verified working
- ❌ = Not locally tested (requires specific hardware/OS)

**Last verified:** 2026-10-19 (this document creation)

---

## Quick Reference Card

```bash
# One-time setup
npm install --legacy-peer-deps
python3 tools/generate-icons.py  # if icons missing

# Development
npm run electron:dev

# Full test suite (offline)
npm run lint && npm run test:downloads && npm run test:ipc && npm run test:ui && npm run test:fx

# Build all (local platform only)
npm run dist:all

# Build specific platform
npm run dist:win
npm run dist:mac
npm run dist:linux

# Release (maintainer only)
# 1. Update version in package.json
# 2. git commit -m "chore: release vX.Y.Z"
# 3. git tag vX.Y.Z
# 4. git push origin main && git push origin vX.Y.Z
# 5. Watch GitHub Actions → Build installers
```

---

## Support

- **Issues:** https://github.com/monivisualpro/local-ai-voice-studio/issues
- **Discussions:** https://github.com/monivisualpro/local-ai-voice-studio/discussions
- **Documentation:** README.md, USER_GUIDE.md, SETUP_REAL_TTS.md, PACKAGING_GUIDE.md