# Lightning Bug — 24/7 "Radio with Visuals" Streaming Plan

> **Status: the in-app system in §2 is now BUILT.** Broadcast URL mode, the `lib/stations.ts`
> registry, the playlist resolver (local files / Jamendo), and the CORS proxy all ship. The
> operator's guide — music sources + step-by-step YouTube setup — is in **[BROADCAST.md](./BROADCAST.md)**.
> This file remains the architecture / scale reference.


Goal: run Lightning Bug on a server as always-on livestreams to **YouTube Live** and **Twitch** —
themed "radio stations with visuals" (e.g. _D&D Ambience_, _Study / Focus_, more later). Each
station = a fixed audio playlist + a saved Lightning Bug scene, rendered and pushed to RTMP 24/7.

This is the plan + the exact hooks to build. Music/ambient collection is a separate track (yours);
the **licensing section is non-negotiable** before anything goes live.

---

## 1. The two ways to broadcast (pick per budget/effort)

### Path A — OBS + Browser Source (start here)
The fastest, most reliable v1. No custom rendering pipeline.
- Run OBS (or **OBS headless via `obs-cli`/`obs-websocket`**, or **Streamlabs**) on a always-on box.
- Add a **Browser Source** pointing at a Lightning Bug **broadcast URL** (below), sized 1920×1080.
- Audio: play the station's playlist **inside the page** (the visualizer already reacts to its own
  `<audio>`/WebAudio graph) OR route a desktop audio player into OBS. In-page audio is cleaner because
  the visuals then sync to the exact track OBS captures.
- OBS "Start Streaming" to YouTube/Twitch RTMP. Use OBS's built-in **multi-RTMP** plugin to push both
  at once, or one OBS instance per platform.
- Pros: trivial, robust, free, great encoder. Cons: needs a machine with a GUI/virtual display; one
  OBS process per station.

### Path B — Headless Chromium + ffmpeg (scale path)
Fully programmatic, containerizable, cheap to fan out to many stations.
- A Node service launches **headless Chromium with real audio** (Playwright/Puppeteer, flags
  `--autoplay-policy=no-user-gesture-required`; audio via a virtual sink — `pulseaudio`/`pipewire` in
  the container).
- Capture the tab: either Chrome's `--headless=new` + `chrome.tabCapture`/`getDisplayMedia` piped to a
  MediaRecorder, **or** simpler — capture the X virtual display with ffmpeg:
  `ffmpeg -f x11grab -r 30 -s 1920x1080 -i :99 -f pulse -i default -c:v libx264 -preset veryfast
   -b:v 4500k -maxrate 4500k -bufsize 9000k -pix_fmt yuv420p -g 60 -c:a aac -b:a 160k -ar 44100
   -f flv rtmp://<ingest>/<key>`
- One container per station; a supervisor restarts on crash. Push to N RTMP targets with `tee`.
- Pros: scales to many stations, no GUI babysitting, reproducible in Docker/K8s. Cons: more to build;
  headless audio+GPU-less canvas needs care (test the visualizer's framerate under `--use-gl=swiftshader`).

**Recommendation:** Path A for the first 1–2 stations (validate content + audience), then move the
winners to Path B when you want several stations 24/7 without per-stream hand-holding.

---

## 2. In-app hooks to build (small, enables both paths)

### 2a. A broadcast/kiosk URL mode
Add a query mode to `/apps/musicvideo` that boots straight into a clean full-frame live view with no
UI chrome, auto-starts a station, and never shows prompts:

```
/apps/musicvideo?station=dnd-tavern&broadcast=1
```

`broadcast=1` should: enter live mode immediately, hide the panel column + "Exit live" + eyebrow,
force the stage to fill the frame, disable pointer UI, and keep the wake-lock on. It reuses the
existing live view — just a chrome-less variant gated on the param.

### 2b. A station registry (`lib/stations.ts`)
Config-driven so new stations are data, not code:

```ts
export interface Station {
  slug: string            // 'dnd-tavern'
  title: string           // 'D&D Tavern — Ambience Radio'
  scene: Scene            // a saved Lightning Bug scene (look/filters/brightness/speed/idle…)
  playlist: string[]      // ordered track URLs (owned/licensed — see §4), shuffled or sequential
  loop: boolean
  crossfadeMs?: number
  overlay?: { nowPlaying?: boolean; logo?: string; caption?: string }  // optional on-screen text
}
export const STATIONS: Station[] = [ /* dnd-tavern, study-lofi, … */ ]
```

The broadcast view loads `STATIONS[slug]`, applies `station.scene` (the same `loadScene` path that
already exists), and plays `station.playlist` through the existing audio graph so the visualizer
reacts. The **idle/transition mode** already built is perfect between tracks. Brightness=Dark + the
Slow/transition clips make a calm D&D or study station trivially.

### 2c. A tiny "now playing" overlay (optional, later)
Reuse the caption overlay pattern; show the current track title/attribution — also helps satisfy
music-license attribution requirements.

**Scope note:** 2a + 2b are a few hours of work and unblock both broadcast paths. Do them once you've
collected the first playlist. I did not build them yet — the plan is to add them alongside real audio.

---

## 3. Stations (initial set — expand later)
| slug | vibe | scene defaults | audio |
|------|------|----------------|-------|
| `dnd-tavern` | warm tavern ambience | Cozy/Film look, **Dark** brightness, **Slow** speed, idle-calm on | tavern loops, lute, fire crackle, murmur |
| `dnd-dungeon` | tense exploration | Neon/Abstract dark, Dark, Slow-Standard | drones, drips, distant echoes |
| `study-lofi` | lofi focus | Lo-fi look, Mid brightness, Slow, gentle EQ | lofi beats / rain |
| `deep-focus` | minimal | None style + soft bg, Dark, Slow | ambient pads, brown noise |
| `synthwave-drive` | night drive | Neon, Mid/Bright, Standard-Fast | synthwave |

Each maps to a saved scene + a playlist. Start with 1–2, prove it, then add.

---

## 4. ⚠️ Music & sound licensing (do this FIRST — it's what gets channels struck)
YouTube Content ID and Twitch DMCA will flag/mute/strike unlicensed music on a 24/7 stream. Only use:
- **Original music** (yours or commissioned), or
- **Royalty-free / stream-safe libraries** with explicit livestream + monetization rights:
  Epidemic Sound, Artlist, Uppbeat, Pixabay Music, YouTube Audio Library, Chosic, Tabletop Audio
  (great for D&D — check their license), Syrinscape (licensing varies), Kevin MacLeod / Incompetech
  (CC-BY, **attribution required** — use the overlay), freesound.org (per-clip CC, verify each).
- Keep a **license ledger** (track → source → license → attribution text) per station; surface
  attribution in the "now playing" overlay and the video description.
- Ambient/foley (rain, fire, tavern murmur) is easiest to source stream-safe.

Never mix in commercial/pop tracks "just for now" — one strike risks the channel.

---

## 5. Operations (24/7)
- **Host:** a small always-on box. Path A: a mini-PC / cheap VPS with a virtual display, or a spare
  machine. Path B: a container on a VPS (Hetzner/Fly/OVH) — 2 vCPU + 4GB handles 1080p30 x264
  `veryfast` per station; add vCPU per extra station.
- **Uptime:** systemd/pm2/Docker `restart: always` + a watchdog that restarts the browser+ffmpeg if the
  RTMP drops or FPS stalls. YouTube "redundant stream" / reconnect settings on; Twitch auto-reconnect.
- **Playlist continuity:** loop the playlist; the app's idle-transition covers silence gaps. Rotate the
  order daily so it's not identical every loop (helps watch-time + avoids staleness).
- **Monitoring:** log encoder FPS + dropped frames; alert on RTMP disconnect. Cheap: a cron that curls
  the YouTube/Twitch API for "is live".
- **Perf:** confirm the visualizer holds 30fps headless (the RAF loop idles when hidden — make sure the
  broadcast tab is treated as visible; `page.bringToFront()` / disable throttling with
  `--disable-background-timer-throttling --disable-renderer-backgrounding`).

## 6. Cost (rough)
- Path A: one mini-PC (~$150 one-time) or ~$10–20/mo VPS w/ display, per 1–2 stations.
- Path B: ~$10–25/mo VPS per 2–3 stations (x264 veryfast, no GPU needed at 1080p30).
- Music: the biggest real cost — a library subscription (~$10–60/mo) that permits livestream +
  monetization, or original tracks.

## 7. Phased rollout
1. **Collect + license** the first station's audio (D&D tavern or study). Build the license ledger.
2. Build **2a broadcast URL** + **2b stations registry**; wire one station's scene + playlist.
3. **Path A**: OBS Browser Source → YouTube unlisted test stream. Verify 24h stability, audio sync,
   no Content-ID flags.
4. Go public with 1 station; watch retention/DMCA. Add the **now-playing overlay** + description
   attribution.
5. Add stations as data; when running 3+, migrate to **Path B** containers for hands-off 24/7.
6. Later: interactivity (Twitch chat requests, "!vibe dark", scene voting), a landing page listing the
   live stations, and pulling these stations into the site itself as embeds.

---
_Everything here builds on what Lightning Bug already has: saved scenes, the dark-room/brightness &
speed filters, the between-songs transition mode, and full-screen live mode. The only new code is the
broadcast URL mode + the stations registry (§2)._
