# Session capture

An isolated layer that emits **one self-contained artifact directory per AI
music-generation run**. It only writes artifacts — no marketing, publishing,
network calls, or media editing. A separate process consumes these outputs.

Disable the whole layer with one flag: `SESSION_CAPTURE=0` (or `{ enabled:false }`).

## Directory layout

```
sessions/
  2026-08-04T03-10-26-783Z/          ← completed (atomic rename target)
    manifest.json                    ← the contract (validated before rename)
    session.json                     ← header/footer (replay source)
    events.jsonl                     ← one event per line (crash-safe, append-only)
    roi.jsonl                        ← one ROI entry per line
    spec.json / capture.mp4 / final_mix.wav / stems/   ← attached artifacts
  2026-08-04T…Z.partial/             ← in-flight (a watcher must ignore these)
  2026-08-04T…Z.failed/              ← aborted or crashed (never left as .partial)
```

Writes go to `<name>.partial/` and are atomically renamed to `<name>/` on
success or `<name>.failed/` on abort/crash. A watcher never sees a half-written
directory, and a `.partial` is never left behind.

## Usage

```js
import { createSession } from '@/lib/session-capture'

const s = createSession({ root: './sessions', sessionId })
s.setMusical({ bpm, key, time_signature, genre_tags, instrument_list })
 .setGeneration({ model, prompt_or_seed, total_takes, rejected_takes })

s.event('take_started', { index, seed })
// take_rejected / retry payloads MUST include reason + changed (schema-enforced):
s.event('take_rejected', { reason: 'too flat — density never breaks', changed: 'seed 42 → 7961: new form' })
s.roi({ x, y, w, h, panel })          // capture-pixel coords when focus changes
s.setCapture({ path, fps, width, height, started_at })   // browser adapter only
s.end('completed')                     // or s.abort(reason) / s.fail(err)
```

`started_at` (and `capture.started_at`) are absolute UTC; every event `t` is
**relative seconds** from the session start, so events map to video frames.

## Manifest

`schema_version, session_id, started_at, duration_s, capture, audio, musical,
generation, events[], roi[], roi_fallback, outcome`. Versioned JSON Schema in
`manifest-schema.mjs` (draft-07, validated with ajv). `capture`/`audio` are
nullable — a headless run (the Node composer) has no video or bounce.

**The `reason` field is the point.** For `take_rejected` and `retry`, the schema
*requires* a natural-language `reason` and what `changed` on the next attempt.

## Replay CLI

Regenerate `manifest.json` from stored logs without re-running generation
(use after a schema bump):

```
node lib/session-capture/replay.mjs <sessionDir> [--check]
node lib/session-capture/replay.mjs --all ./sessions
```

## Adapters

- **Composer** (`scripts/compose.mjs --capture[=root]`) — built. Headless, so no
  video/bounce; best-of-K candidates become takes and self-select rejections
  carry real reasons from the arrangement analyzer.
- **Browser DAW** (`lib/session-capture/browser.ts` + `app/api/session/route.ts`)
  — built. `BrowserSessionRecorder` collects events/ROI live, drives
  `lib/screen-recorder.ts` for the video, takes an optional WAV bounce + stems,
  and POSTs everything to `POST /api/session`, which calls `ingestSession()` to
  write the directory atomically (the browser can't write the FS itself).
  - Client vs server: the browser shares **no** server-only code; the route
    assembles + validates + stamps the manifest. Ingest is admin/DEV_OPEN-gated.
  - **VFR caveat:** `MediaRecorder` is variable-frame-rate and may emit `.webm`
    (Chrome) or `.mp4` (Safari); we store the real container + name it honestly,
    and keep the manifest clock authoritative (absolute `capture.started_at` +
    relative event `t`). Any CFR re-encode is the downstream consumer's job —
    this layer does no media editing.
  - **ROI:** `autoTrackPanels()` emits an ROI whenever focus/pointer moves to a
    `[data-session-panel]` element, mapping its CSS-px rect into capture-px via
    `panelRectToCapture` (best-effort tab-capture; the fallback rect covers gaps).
  - **Dev entry:** `window.__sessionCapture()` (dev only, in `AudioEditor`)
    returns a recorder pre-primed with the project's musical metadata. A
    generation flow wraps its run: `startCapture()` → `event(...)` → `end()`.

Tests: `npm run test:session` (atomic writes, schema validation, ROI coverage,
replay idempotency, disable flag, server-side ingest, ROI transform).
