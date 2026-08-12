# Lightning Bug — Broadcasting: setup, music sources, and YouTube

The 24/7 "radio with visuals" mode is **built**. This is the operator's guide: where to get music you
can legally stream, how the pieces fit, and the exact steps to go live on YouTube. High-level
architecture and the scale path are in [STREAMING.md](./STREAMING.md).

---

## What's built

- **Broadcast URL:** `/apps/lightningbug?station=<slug>&broadcast=1` — a chrome-less, full-frame live
  view that loads a station's visual scene + playlist and plays it, with a "now playing" card.
- **Stations:** `lib/stations.ts` — `dnd-tavern`, `dnd-dungeon`, `study-lofi`, `deep-focus`. Each is
  a visual scene + a way to get audio. Add more by editing that file (data only).
- **Playlist resolver:** `/api/broadcast/playlist?station=<slug>` picks audio in this order:
  1. **files in `public/broadcast/<slug>/`** (drop your licensed tracks here — most reliable),
  2. the station's hard-coded `tracks`,
  3. the **Jamendo API** (needs `JAMENDO_CLIENT_ID`) using the station's tags.
- **CORS-safe proxy:** `/api/broadcast/audio?src=…` streams remote audio through our origin so the
  visualizer can analyse it. Host-allowlisted (Jamendo, Pixabay, FMA, Archive.org…). Local files
  don't use it.

**Fastest start:** drop a few mp3s into `public/broadcast/study-lofi/`, open
`/apps/lightningbug?station=study-lofi&broadcast=1`, and it plays with visuals. (Verified end-to-end.)

---

## Where to get music you can legally stream

⚠️ 24/7 streaming is the strictest case for copyright — YouTube Content ID and Twitch DMCA will mute
or strike unlicensed music. Use only the sources below, and keep an attribution/licence note per
track (the "now playing" card shows attribution; also put it in the video description).

### ⭐ US-based vendors (recommended — avoids EU-licensing questions; download → local folder)
This is the cleanest approach: subscribe to a **US** company, download stream-safe tracks, and drop
them in `public/broadcast/<slug>/`. No API, no CORS, no EU-law ambiguity — the licence is a plain
US contract and the files play locally (most reliable for 24/7). Confirm the plan tier permits
**livestreaming + monetisation** (creator/commercial tiers do).
| Vendor | HQ | ~Cost | Library | Notes |
|--------|----|-------|---------|-------|
| **Pond5** | New York | pay-per-track or sub | **~1.6M (biggest)** | Huge marketplace; per-track can add up. Has an API. |
| **Storyblocks** | Arlington, VA | unlimited-download sub | 100k+ | Best value for **volume** — download as much as you want. Has an API. |
| **Soundstripe** | Nashville, TN | ~$119/yr unlimited | curated tens of thousands | Simplest, clean licence; used by Amazon/Microsoft. |
| **PremiumBeat** | US (Shutterstock) | per-track | curated | Higher-end, per-track royalty-free. |

**Free + US:** **YouTube Audio Library** (Google — free, guaranteed safe *on* YouTube), **Free Music
Archive** (per-track CC), **Incompetech / Kevin MacLeod** (CC-BY — the built-in `cinematic` station
streams these). All US-based.

### Cheap, high-volume (also fine — note some are EU)
| Source | ~Cost | Notes |
|--------|-------|-------|
| **Jamendo** (API, wired in) | Free API; **commercial "radio" licence** is the paid part | 500k+ tracks, streams by tag. EU company (Luxembourg) — a licence is valid globally, but if that's a concern prefer the US vendors above. Set `JAMENDO_CLIENT_ID`. |
| **Pretzel Rocks** | Free (w/ chat credit) / **$5/mo** | Purpose-built DMCA-safe player for streamers, 50k+ tracks. Not an API — run its app on the broadcast box and capture its audio in OBS (Path A). |
| **Epidemic Sound** | ~$10–20/mo | Owns all rights, safe on monetised streams. Download tracks → drop in `public/broadcast/<slug>/`. |
| **Uppbeat** | Free (credit) / ~$7/mo | Free tier with attribution; download → local files. |
| **Artlist / Soundstripe** | ~$10–20/mo | Subscription, broad catalogue, download → local. |

### Free / Creative Commons (attribution required — put it in the description)
- **YouTube Audio Library** (studio.youtube.com → Audio Library) — free, and **guaranteed safe on
  YouTube** since it's YouTube's own. Download → local files. Best free option for a YT station.
- **Pixabay Music** (pixabay.com/music) — Pixabay Content License, free, commercial OK, no
  attribution required. Download → local (host `cdn.pixabay.com` is allow-listed for the proxy too).
- **Free Music Archive** (freemusicarchive.org) — per-track CC; check each licence.
- **Incompetech / Kevin MacLeod** — CC-BY, download → local. Attribution required.
- **ccMixter** — CC remixes/instrumentals; check each licence.

### D&D ambience specifically
- **Tabletop Audio** (tabletopaudio.com) — superb tavern/dungeon/battle beds. **Check their licence
  for streaming** before use.
- **Freesound** (freesound.org, has an API) — CC foley: fire crackle, rain, murmur, drips. Verify
  each clip's licence. Great layered under music for `dnd-tavern` / `dnd-dungeon`.
- Ambient/foley is the easiest to source stream-safe.

**Rule of thumb:** cleanest path — subscribe to a **US vendor** (Storyblocks for volume, Soundstripe
for simplicity), download stream-safe tracks, drop them in `public/broadcast/<slug>/`. Free start:
**YouTube Audio Library**. Never drop in commercial/pop tracks "just to test" — one strike can take
the channel down.

### Crediting a shuffled radio (the video description)
A shuffle has no fixed order, and a YouTube description is **static** — you can't auto-change it per
song. You don't need to. Two things together are fully compliant:
1. **The on-screen "now playing" card changes per song automatically** (it shows each track's stored
   attribution live), so viewers always see the current credit.
2. **List the whole playlist once in the description.** Since the station's tracklist is known, that
   covers every song no matter the order. On the broadcast launcher (`/apps/lightningbug/broadcast`)
   each station has a **"Copy credits"** button that pulls the station's actual playlist and builds a
   ready-to-paste block (every track + the CC-BY notice + link). Paste it into the description once.

So: don't just point vaguely at "Kevin MacLeod" — paste the full generated list. (Auto-rewriting the
description per song via the YouTube API is possible but clunky and pointless — the on-screen card
already handles "what's playing right now".) For CC-BY (Kevin MacLeod etc.) the description credit is
the part that actually satisfies the licence; keep the on-screen card too.

---

## Connect it to YouTube (OBS → YouTube Live)

This is the reliable v1 (Path A). You need OBS Studio (free) on an always-on machine.

**1. Enable live streaming on YouTube** (one-time)
- Go to **studio.youtube.com → Create (top-right) → Go live**. First time, YouTube verifies your
  account and there's a **~24-hour wait** before live streaming unlocks. Do this a day ahead.

**2. Create the stream in YouTube Studio**
- **Go live → Stream** tab. Set title (e.g. "D&D Tavern Ambience — 24/7 Radio"), description (put
  your **music attributions** here), category, thumbnail, and "not made for kids".
- Under **Stream settings**, copy the **Stream key** (keep it secret) and note the **Stream URL**
  (`rtmp://a.rtmp.youtube.com/live2`). Turn on **"Enable auto-start" / "Enable auto-stop"** if you
  want it hands-off, and set **Stream latency: Low** or **Normal**.

**3. Point OBS at your Lightning Bug station**
- In OBS, **Sources → + → Browser**. URL:
  `https://100lights.com/apps/lightningbug?station=dnd-tavern&broadcast=1`
  Width **1920**, Height **1080**. Tick **"Control audio via OBS"** so the station's audio goes into
  your stream. (Locally you can use `http://localhost:3001/...`.)
- If the page shows a "Tap to start" overlay (browser autoplay block), either **click it once** in an
  Interact window (right-click the source → Interact), or add
  `--autoplay-policy=no-user-gesture-required` to OBS's browser-source flags / launch args so it
  auto-plays with no gesture.
- Set the OBS **Canvas + Output resolution to 1920×1080**, **30fps**.

**4. Connect OBS to YouTube**
- **Settings → Stream**: Service **YouTube - RTMPS**, and either **"Connect Account"** (recommended)
  or **"Use Stream Key"** and paste the key from step 2.
- **Settings → Output**: **x264**, **veryfast**, bitrate **~4500 Kbps**, keyframe interval **2s**,
  audio **160 Kbps**. **→ Start Streaming.** YouTube Studio shows the preview going live.

**5. 24/7 hardening**
- OBS: Settings → General → tick **"Automatically reconnect"**. Consider a watchdog (OBS is
  scriptable via `obs-websocket`) that restarts on disconnect.
- YouTube: enable **auto-start/stop** and **redundant/backup ingest** if you use a second encoder.
- Keep the browser-source tab "visible" (don't minimise a headful box) so the visualiser stays at
  full frame-rate. On a headless box, launch Chrome with
  `--disable-background-timer-throttling --disable-renderer-backgrounding`.
- **Twitch** is the same flow: OBS **Settings → Stream → Twitch**, connect account. Same browser
  source. (Twitch VODs are the DMCA-sensitive part — licensing above still applies.)

That's it — one OBS scene, one browser source, one station URL. Duplicate the scene with a different
`?station=` for each channel. When you're running several 24/7, move to the headless-container path
in STREAMING.md.
