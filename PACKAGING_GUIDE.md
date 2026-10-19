# Packaging Local AI Voice Studio

Each platform is built into its **own folder** under `release/`:

| Command | Output folder | Files |
|---|---|---|
| `npm run dist:win`   | `release/windows/` | `Local-AI-Voice-Studio-Setup-<version>.exe` - wizard with **Choose Install Location** (any drive) and **Choose Data Folder** (drive for models/engines) |
| `npm run dist:mac`   | `release/macos/`   | `.dmg` (drag to any folder/disk) and `.pkg` (**Change Install Location** = choose the disk), for Intel (x64) and Apple Silicon (arm64) |
| `npm run dist:linux` | `release/linux/`   | `.AppImage` (runs from any disk), `.deb`, `.tar.gz`, and `install-linux.sh` (asks for install folder and data folder) |
| `npm run dist:all`   | all three          | skips macOS when not on a Mac |

## Requirements
- Node.js 20+ and `npm install --legacy-peer-deps`.
- **Windows installer** can be built on Windows, macOS or Linux.
- **macOS installers can only be built on a Mac.** No Mac? Use the GitHub Actions workflow `.github/workflows/build.yml` (Actions tab -> *Build installers* -> *Run workflow*): it builds Windows, macOS and Linux on their own machines and gives you three downloadable folders.
- Linux installers can be built on Linux (or in the workflow).

## Notes
- Installers are **not code-signed**, so Windows SmartScreen and macOS Gatekeeper show a warning the first time (see USER_GUIDE.md). To remove the warning you need a code-signing certificate (Windows) / an Apple Developer ID (macOS); add them to `electron-builder.json` (`win.certificateFile`, `mac.identity`, notarize).
- Windows icon/version info: when the Windows installer is built on Linux the .exe keeps the default Electron icon (editing it needs Wine). Build it on Windows (or in the workflow) for the branded icon.
- The Windows custom page lives in `build/installer.nsh`; it writes `install-config.ini` next to the app, which the app reads on first start to place models and engines on the chosen drive.
- Alternative Windows installer with Inno Setup: `build-inno-installer.bat` (uses `installer.iss`).

## Icons
`python3 tools/generate-icons.py` (Pillow) redraws the logo and writes every icon: favicons (16/32/48, .ico, .svg), apple-touch-icon, PWA icons + `site.webmanifest`, the window icon, and the installer icons `build/icon.ico` (Windows), `build/icon.icns` (macOS), `build/icon.png` (Linux).
