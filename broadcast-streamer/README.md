# Lightning Bug — 24/7 Broadcast Streamer

Runs a Lightning Bug station as a live YouTube/Twitch stream **without OBS and with your own
computer off**. It's a small container: a headless Chromium loads the station's broadcast page,
and ffmpeg captures its video + audio and pushes to RTMP. Deploy it once to an always-on box and
it streams forever, restarting itself on any hiccup.

> **Why can't this live inside 100lights.com?** The app is on Vercel (serverless) — no long-running
> processes, no RTMP. A 24/7 encoder physically can't run there. It needs *one* always-on process,
> which is what this container is. Everything about *what* streams (stations, look, playlist) still
> lives in the app + the `/admin/lightning-bug/radio` panel — this just renders and pushes it.

## Run it for free

The container is light (720p30 by default). Any always-on Linux box with Docker works. Free options:

- **Oracle Cloud "Always Free" (recommended)** — a genuinely free-forever VM. Their Ampere/ARM shape
  (up to 4 vCPU / 24 GB) runs *several* streams at no cost. Create an Always-Free VM (Ubuntu),
  install Docker, and follow "Deploy" below.
- **A device you already leave on** — a Raspberry Pi 4/5, an old laptop, a home server. Same steps.
- A cheap VPS ($5–6/mo, Hetzner/DigitalOcean) if you'd rather not use the free tier — same steps.

A tiny 1-vCPU instance handles one 720p30 stream; scale down to `WIDTH=854 HEIGHT=480 VBITRATE=1200k`
if CPU is tight. Oracle's ARM free tier has plenty of headroom for 1080p.

## Get your YouTube stream key (one-time, your step)

1. youtube.com → **Create → Go live** (enable live streaming if first time — takes ~24h to activate).
2. Left tab **Stream**. Set title/description (paste the station's credits — copy them from the
   radio admin's **Credits** box). Category = Music.
3. Copy the **Stream key**. That's `STREAM_KEY`. Set the stream to **24/7 / never expire** and turn on
   **"Automatically start/stop"** off (keep it always-on), plus reconnect.

## Deploy

```bash
# on the always-on box (Docker + docker compose installed)
git clone <your repo> && cd 100lights/broadcast-streamer
cp .env.example .env
nano .env          # set STATION + STREAM_KEY (BASE_URL defaults to https://100lights.com)

docker compose up -d --build     # builds once, starts streaming, restarts on crash/reboot
docker compose logs -f           # watch it connect; ffmpeg prints frame= lines when live
```

That's it — the station appears on your YouTube Live within ~10–30s. Turn your computer off; the box
keeps streaming.

### More than one station
Each station is its own YouTube stream (its own key). Uncomment/duplicate the `study-lofi` service in
`docker-compose.yml`, give it its own `STATION` + `STREAM_KEY`, and `docker compose up -d` again.

### Without compose (single stream)
```bash
docker build -t lb-streamer .
docker run -d --restart always --shm-size=1g \
  -e BASE_URL=https://100lights.com -e STATION=cinematic \
  -e STREAM_KEY=xxxx-xxxx-xxxx-xxxx lb-streamer
```

## Tuning / knobs (all env, see `.env.example`)
| var | default | notes |
|-----|---------|-------|
| `STATION` | `cinematic` | which station slug to stream |
| `WIDTH`/`HEIGHT`/`FPS` | `1280`/`720`/`30` | 1080p → `1920`/`1080`; lower for tiny boxes |
| `VBITRATE` | `2500k` | 1080p30 ≈ `4500k`; 480p ≈ `1200k` |
| `RTMP_URL` | YouTube `live2` | Twitch: `rtmp://live.twitch.tv/app` |
| `STREAM_KEY` | — | **required** |

## Health / uptime
- The worker respawns ffmpeg if it drops and exits (→ container `restart: always` relaunches) if the
  browser crashes. `docker compose logs -f` shows `frame=…` while healthy.
- Turn on YouTube's **auto-reconnect / resume** and consider `docker update --restart always` so it
  survives reboots.

## What's NOT here yet (next phase)
Editing a broadcast as a **full Lightning Bug project** (all settings, saved server-side per
`BROADCAST_ID`) rather than the admin panel's subset. The worker already supports `BROADCAST_ID=` for
when that lands — it'll load `?broadcast=<id>` instead of `?station=<slug>&broadcast=1`.

## Note on testing
The browser-automation half was validated against the live broadcast page; the ffmpeg **x11grab +
PulseAudio** capture only runs inside this Linux container, so verify audio on first deploy: if the
stream is silent, check `docker compose logs` for the `audio sink 'broadcast' ready` line and that
ffmpeg shows a non-zero audio bitrate. (Audio routing is the one part that can vary by host kernel.)
