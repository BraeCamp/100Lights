# Lightning Bug — 24/7 Broadcast Streamer

Runs a Lightning Bug station as a live YouTube/Twitch stream **without OBS and with your own
computer off**. It's a small container: a headless Chromium loads the station's broadcast page,
and ffmpeg captures its video + audio and pushes to RTMP. Deploy it once to an always-on box and
it streams forever, restarting itself on any hiccup.

> **Why can't this live inside 100lights.com?** The app is on Vercel (serverless) — no long-running
> processes, no RTMP. A 24/7 encoder physically can't run there. It needs *one* always-on process,
> which is what this container is. Everything about *what* streams (stations, look, playlist) still
> lives in the app + the `/admin/lightning-bug/radio` panel — this just renders and pushes it.

## Fastest path — browserless, no Docker (recommended to start)

There are two renderers. The **browserless** one (`render.mjs`) makes the visuals with **ffmpeg alone**
— no Chromium, no Docker, no display. It's light enough for a free micro box (or a Pi, or your Mac),
and it's the quickest way to actually go live:

```bash
# on any machine with node + ffmpeg (macOS: brew install ffmpeg node)
cd broadcast-streamer
STREAM_KEY=your-youtube-stream-key ./golive.sh          # streams "cinematic" 24/7
STREAM_KEY=xxx STATION=study-lofi ./golive.sh           # a different station
```

That's the whole thing — it pulls the station's playlist + palette from 100lights.com, loops the audio,
renders a reactive visual, and pushes to YouTube. Leave it running (a free VM, or `nohup`/pm2 on any
box) and it's a 24/7 channel. Trade-off vs the browser renderer: it does the audio-reactive visual
(constant-Q bars / spectrum / waves via `VIZ=`), not the full Lightning Bug video-background looks —
but it costs a fraction and runs almost anywhere.

The **browser** renderer (`stream.mjs`, the Docker container below) reproduces the exact Lightning Bug
page — every look — but is heavier and needs the Linux capture stack.

## Run the browser renderer for free

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

## Agent mode — control it from the dashboard (recommended for scale)

Instead of hard-coding one `STATION`, run the box as a **control-plane agent**: it registers with
100Lights and streams whatever the **Broadcasts dashboard** (`/admin/lightning-bug`) assigns it —
remote Start/Stop, live status, no redeploy.

1. In the app env set `BROADCAST_AGENT_TOKEN=<a long secret>`.
2. On the box, set `AGENT=1`, `CONTROL_URL=https://100lights.com`, `AGENT_TOKEN=<same secret>`,
   a stable `WORKER_ID`, and a stream key per broadcast it may run (`KEY_CINEMATIC=…`, or
   `KEYS={"cinematic":"…"}`). `docker compose up -d`.
3. In the dashboard, press **Go live** on a broadcast → the agent picks it up within ~10s.

**Scale:** one container = one stream (each has its own display + audio sink). Run several agent
containers (unique `WORKER_ID`) — the control plane spreads live broadcasts across them and keeps
exactly one worker on each. Keys stay on the workers; the app/DB never sees them.

## Full-interface broadcasts
A broadcast's whole look is authored in the real Lightning Bug UI (`?broadcastEdit=<slug>` from the
admin) and saved server-side; the streamer renders it automatically (via `?station=` or
`?broadcast=<id>`). Nothing to configure here.

## Note on testing
The browser-automation half was validated against the live broadcast page; the ffmpeg **x11grab +
PulseAudio** capture only runs inside this Linux container, so verify audio on first deploy: if the
stream is silent, check `docker compose logs` for the `audio sink 'broadcast' ready` line and that
ffmpeg shows a non-zero audio bitrate. (Audio routing is the one part that can vary by host kernel.)
