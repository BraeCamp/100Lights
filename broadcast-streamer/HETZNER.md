# Hetzner baseline — many channels, ~$6/mo, dashboard-controlled

The cheapest way to run a steady fleet: one Hetzner box runs several browserless channels, bandwidth
is included (uncapped on dedicated; ~20 TB on Cloud EU), and you start/stop each channel from
`/admin/lightning-bug` (Broadcasts). ~$2/channel/mo at density.

## 1. Get a box
- **Hetzner Cloud** (fastest): console.hetzner.cloud → new project → add server. Ubuntu 24.04,
  a **CPX31** (4 vCPU / 8 GB, ~€15/mo) comfortably runs ~6–8 × 720p channels; **CPX21** (~€8) does ~4.
  Add your SSH key. Note the IP.
- **Hetzner dedicated** (best value at scale): a 16-core box (~€60) runs ~30–40 channels with
  uncapped bandwidth. Same steps once you can SSH in.

## 2. Set up (SSH in: `ssh root@<IP>`)
```bash
curl -fsSL https://get.docker.com | sh          # install Docker
git clone <your repo> && cd 100lights/broadcast-streamer
cp .env.hetzner.example .env
nano .env    # set AGENT_TOKEN (same as the app) + KEYS { "slug":"youtube-key", … }
docker compose -f docker-compose.hetzner.yml up -d --build
docker compose -f docker-compose.hetzner.yml logs -f
```

## 3. In the app (once per fleet)
- Set **`BROADCAST_AGENT_TOKEN`** in Vercel to the same value as `AGENT_TOKEN`.
- In the radio admin, set each station's **RTMP URL** (default YouTube) + **Channel** label so you can
  tell which YouTube channel it targets.
- In **Broadcasts**, press **Go live** on the channels → the agent picks them up within ~10s, streams
  them, and reports status back (you'll see them go green + the worker id).

## Scale
- Raise `CAPACITY` for a bigger box, or run this compose on a **second box** with a different
  `WORKER_ID`. The control plane spreads live channels across all workers and keeps one per channel.
- Watch CPU: at high density use a lighter visual (`VIZ=spectrum` or `waves`) and 720p/30. Spread
  channels across a few boxes so one failure only drops its share.

## Cost (approx — verify current pricing)
| Box | Channels (720p) | ~$/mo | per channel |
|-----|-----------------|-------|-------------|
| CPX21 (Cloud) | ~4 | ~€8 + incl. bandwidth | ~$2 |
| CPX31 (Cloud) | ~6–8 | ~€15 + incl. bandwidth | ~$2 |
| 16-core dedicated | ~30–40 | ~€60, uncapped bandwidth | ~$2 |

Bandwidth is the reason Hetzner wins at scale: it's included/uncapped here, vs ~$16/channel/mo of
metered egress on Fly. Keep Fly for *elastic bursts*; Hetzner for the always-on baseline.
