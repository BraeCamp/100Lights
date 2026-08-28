#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  Turn the rendered factory patches into web-servable demo audio.
#
#    scripts/build-plugin-demos.sh [source-dir]
#
#  The renderer writes 24-bit WAV, which is right for judging the sound and
#  wrong for a product page: 42 of them is about 73 MB. This converts them to
#  MP3, which is roughly a twentieth of that and plays everywhere.
#
#  Source defaults to the Luz project's docs/demos.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:-$HOME/Desktop/Plugins/Luz/docs/demos}"
OUT="public/demos"

if [ ! -d "$SRC" ]; then
  echo "No rendered patches at $SRC"
  echo "Render them first:  cd ~/Desktop/Plugins/Luz && ./build/LuzRender_artefacts/Release/LuzRender docs/demos"
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is not installed (brew install ffmpeg)"
  exit 1
fi

mkdir -p "$OUT"
rm -f "$OUT"/*.mp3

count=0
for f in "$SRC"/*.wav; do
  [ -e "$f" ] || continue
  name="$(basename "$f" .wav)"
  ffmpeg -y -loglevel error -i "$f" -codec:a libmp3lame -b:a 160k "$OUT/$name.mp3"
  count=$((count + 1))
done

echo "converted $count demos"
du -sh "$OUT"
