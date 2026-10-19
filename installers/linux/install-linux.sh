#!/usr/bin/env bash
# Installs Local AI Voice Studio from the .tar.gz into a folder YOU choose (any disk: /home, /mnt/d, /media/..., /opt).
# Usage: ./install-linux.sh [path/to/Local-AI-Voice-Studio-*.tar.gz]
set -euo pipefail

ARCHIVE="${1:-$(ls ./Local-AI-Voice-Studio-*.tar.gz 2>/dev/null | head -n1 || true)}"
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "Put this script next to Local-AI-Voice-Studio-*.tar.gz, or pass the archive path as argument."; exit 1
fi

echo "Local AI Voice Studio - installer"
echo
echo "Available disks / mount points (free space):"
df -h --output=target,size,avail -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | sed 's/^/  /' || df -h
echo
DEFAULT="$HOME/LocalAIVoiceStudio"
read -r -p "Install folder [$DEFAULT]: " DEST
DEST="${DEST:-$DEFAULT}"
DEST="${DEST/#\~/$HOME}"
echo
echo "Models and voice engines are large (5-40 GB)."
read -r -p "Data folder for models/engines [$DEST/data]: " DATA
DATA="${DATA:-$DEST/data}"
DATA="${DATA/#\~/$HOME}"

mkdir -p "$DEST" "$DATA"
echo "Extracting to $DEST ..."
tar -xzf "$ARCHIVE" -C "$DEST" --strip-components=1 2>/dev/null || tar -xzf "$ARCHIVE" -C "$DEST"
EXE="$(find "$DEST" -maxdepth 2 -type f \( -iname 'local-ai-voice-studio' -o -iname 'local ai voice studio' \) | head -n1)"
[ -n "$EXE" ] || { echo "Could not find the program inside the archive."; exit 1; }
chmod +x "$EXE"
printf 'dataDir=%s\n' "$DATA" > "$(dirname "$EXE")/install-config.ini"

DESKTOP="$HOME/.local/share/applications/local-ai-voice-studio.desktop"
mkdir -p "$(dirname "$DESKTOP")"
cat > "$DESKTOP" <<DESK
[Desktop Entry]
Type=Application
Name=Local AI Voice Studio
Comment=Text-to-speech, voice cloning and dubbing on your own PC
Exec="$EXE" --no-sandbox
Terminal=false
Categories=AudioVideo;Audio;
DESK
echo
echo "Done. Start it from your application menu, or run:  \"$EXE\""
