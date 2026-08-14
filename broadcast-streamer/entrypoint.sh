#!/usr/bin/env bash
# Bring up the virtual display + audio sink, then run the streamer. Runs as the non-root `pwuser`
# (from the Playwright base image) so Chromium keeps its sandbox and PulseAudio runs in user mode.
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export HOME="${HOME:-/home/pwuser}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-pwuser}"
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"

WIDTH="${WIDTH:-1280}"; HEIGHT="${HEIGHT:-720}"

# ── Virtual X display (Chromium draws here; ffmpeg x11grabs it) ────────────────
echo "[entrypoint] starting Xvfb on $DISPLAY at ${WIDTH}x${HEIGHT}"
Xvfb "$DISPLAY" -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp &
for i in $(seq 1 30); do xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break; sleep 0.2; done

# ── PulseAudio (user mode) + a null sink the browser plays into ────────────────
echo "[entrypoint] starting PulseAudio"
pulseaudio -D --exit-idle-time=-1 --disable-shm=true
for i in $(seq 1 30); do pactl info >/dev/null 2>&1 && break; sleep 0.2; done
pactl load-module module-null-sink sink_name=broadcast sink_properties=device.description=broadcast >/dev/null
pactl set-default-sink broadcast
pactl set-default-source broadcast.monitor
echo "[entrypoint] audio sink 'broadcast' ready (ffmpeg reads broadcast.monitor)"

# AGENT=1 → control-plane mode (dashboard-driven start/stop, status reporting). Else single-station.
if [ "${AGENT:-}" = "1" ]; then exec node agent.mjs; else exec node stream.mjs; fi
