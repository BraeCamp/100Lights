#!/usr/bin/env bash
# Go live in one command — the BROWSERLESS renderer, no Docker, no browser. Just node + ffmpeg.
# Works on this Mac, a Linux box, a Pi, a free VM — anything with those two installed.
#
#   STREAM_KEY=your-youtube-key ./golive.sh                 # stream "cinematic" to YouTube 24/7
#   STREAM_KEY=xxx STATION=study-lofi ./golive.sh           # a different station
#   STREAM_KEY=xxx BASE_URL=http://localhost:3001 ./golive.sh   # test against a local dev app
#
# Get the key: youtube.com → Create → Go live → Stream → "Stream key". Ctrl-C to stop.
set -euo pipefail
cd "$(dirname "$0")"

command -v ffmpeg >/dev/null || { echo "ffmpeg not found — install it (macOS: brew install ffmpeg)"; exit 1; }
command -v node   >/dev/null || { echo "node not found — install Node 18+"; exit 1; }
[ -n "${STREAM_KEY:-}" ] || { echo "Set STREAM_KEY (your YouTube/Twitch stream key). See the header of this file."; exit 1; }

export BASE_URL="${BASE_URL:-https://100lights.com}"
export STATION="${STATION:-cinematic}"
echo "▶ Streaming '${STATION}' from ${BASE_URL} to ${RTMP_URL:-rtmp://a.rtmp.youtube.com/live2} — Ctrl-C to stop."
exec node render.mjs
