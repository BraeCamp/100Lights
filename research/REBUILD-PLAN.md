# The Rebuild — build plan (2026-08-21)

Scope, per Brae's directives: (1) video program completely recreated on
the Resolve model keeping only a few pieces; (2) Beacon live/session
view completely recreated on the Ableton Session model; (3) arrangement
view foundation partially recreated around our best pieces; (4) AI
button removed. Apollo stays in-house and untouched as a product.

Specs: research/video-editor-resolve.md, beacon-session-view.md,
beacon-arrangement-ableton.md. Corpora in ~/video-watch/.

**Ordering principle:** front-load the architecture and engine work that
demands the most reasoning (timing engines, GPU pipeline, cross-cutting
refactors) into Batches 1–2 while Fable 5 credits last. Batches 3–4 are
substantial but pattern-following once the engines exist. Batches 5–6
are fill-in and polish, safe for a lighter model or next month.

Each batch = one working session: implement → QA (headless browser
scripts in job tmp, same style as the Apollo batches) → commit → push
`origin apollo:main`.

---

## Batch 1 — The two engines' foundations (MOST intensive)

The two hardest, most cross-cutting pieces. Everything later hangs off
these; getting them wrong is expensive, so they go first.

### 1a. Beacon session engine (in lib/daw-engine.ts + state)

- Data model (lib/daw-types.ts / daw-state.ts): `scenes: Scene[]` on the
  project; per-track `clipSlots` mapping sceneId → clip ref; clips get
  `launchMode` (loop | play-through) and follow-through into the
  existing MIDI/audio clip types. Reuse arrangement clips as the clip
  payload — a slot references clip content, not a copy.
- **Quantized launch scheduler** inside the engine: global launch
  quantize (default 1–2 bars), beat-accurate trigger/stop per track
  lane, independent per-track playback position (column independence is
  the whole point), stop slots, scene = row launch that tolerates
  heterogeneous clips (infinite loops + play-through in one row).
- Countdown state exposed for UI ("one two three four").
- **Session→arrangement recording**: global record captures launched
  clips into arrangement clips at their played positions — this is how
  a jam becomes a song (the bridge both directives share).
- QA: headless — schedule launches against `__dawEngine`, render, assert
  beat-grid alignment and per-track independence numerically.
- Risk note: keep the scheduler inside the existing transport (tempo-map
  aware — lib/tempo-map.ts is source of truth), not a parallel clock.

### 1b. Video program pages-shell + one-store architecture

- New shell: modes **Media / Edit / Color / Audio / Deliver** over ONE
  project store (the existing video project state, refactored to be
  page-agnostic). Page = mode, not layout: switching pages never
  serializes/round-trips anything.
- Establish the universal conventions as shared components now, since
  every page uses them: inspector (properties-of-selection), panel
  open/close headers, viewer(s), JKL + I/O transport, middle-drag pan,
  snapping toggle.
- Port the existing editor into the Edit page slot mostly as-is for now
  (its recreation is Batch 5); the point of this batch is the skeleton
  everything else slots into, plus the keep-list wired through:
  subject-lift, sceneTrack/Auto-Edit, title engine, export pipeline.
- QA: page switching preserves state instantly; existing editor
  functionality regression-checked inside the new shell.

## Batch 2 — Color engine + Color page (biggest net-new subsystem)

The single largest gap vs Resolve, and GPU/DSP-heavy — do while Fable
is available.

- **WebGL grading pipeline** applied per clip in preview AND export
  (parity rule from day one — reuse the video-export compositor path):
  lift/gamma/gain/offset wheels math, contrast+pivot, temp/tint,
  saturation, color boost; custom curves (luma S-curve) and the
  hue-vs-hue / hue-vs-sat / hue-vs-lum / lum-vs-sat curves.
- **Two-level grade**: per-clip node list (serial nodes, enable/label)
  + timeline-level node list (the "look"). Order-dependent, exactly the
  Resolve model.
- **Scopes** computed from the preview frame: waveform, RGB parade,
  vectorscope (downsampled; render on canvas).
- Clip thumbnail strip driven by the playhead (auto-select = the
  grading UX), graded/ungraded indicator.
- **Stills gallery**: grab still (grade preset + reference frame),
  middle-click copy grade clip→clip and still→clip, split-screen
  compare against a hero still.
- **Windows**: soft ellipse + linear gradient masks limiting a node;
  tracking v1 = attach a window to our existing sceneTrack/point data
  (subject-lift/MediaPipe as the Magic-Mask analog; full point tracker
  can come later).
- QA: golden-frame renders (render a graded frame, assert channel stats
  numerically — same discipline as analyze-mix for audio).

## Batch 3 — Session view UI + live workflow (heavy UI on a done engine)

- The grid: tracks as columns × scenes as rows, clip slots, scene
  launch column, stop buttons (per-slot presence), drag clips between
  slots and in from the browser/arrangement.
- Launch-quantize countdown display; play-state animation on clips.
- Per-song **column-group** affordance + track/clip colors by family
  (the Felix Raphael live-set structure: song groups + groove columns +
  live-instrument tracks).
- **Tab toggles Session ↔ Arrangement** — same project, one keystroke.
- Session record button → arrangement (engine from 1a).
- Clip warp basics surfaced on audio slots (tempo-lock uses existing
  stretch; sample-BPM correction field).
- Apollo/Helios devices, groups, sends all work identically in both
  views (they're the same tracks — verify, don't rebuild).
- QA: scripted live "performance" (launch intro rows, swap songs,
  record) → rendered output asserted; plus the qa-sweep click-everything
  smoke.

## Batch 4 — Arrangement foundation rebuild around the best pieces

- **Locators/sections**: right-click timeline → add locator, labeled,
  click-to-jump; section band rendering (Intro/Drop/Breakdown/…).
- **Automation rework**: automation mode toggle; touching any device
  parameter (incl. Apollo macros — wiring exists) creates a lane;
  override state (grayed line + re-enable); drawn-graph curves as the
  segment editor (our best piece, now the standard editor everywhere).
- **Loop brace + consolidate** (Ctrl+J prints a looping clip so single
  repeats become editable) and Ctrl+E split parity.
- Audio clip warping: sample-BPM field + tempo-follow, clip fades,
  reverse, ±12 transpose surfaced on the clip inspector.
- **Remove the AI button** (directive #4).
- Keep-list untouched and re-anchored: Helios engine + devices + Apollo
  Rack, groups, tempo map, step sequencer, piano-roll FX, scale system.
- QA: automation round-trip renders; locator jump; consolidate
  correctness vs loop repeats.

## Batch 5 — Video pages fill-in (moderate, pattern-following)

- **Media page**: media pool vs system import boundary, bins + bin
  list, hover-scrub thumbnails, list/thumbnail views, smart bins v1
  (keyword filters), metadata panel.
- **Edit page recreation**: proper trim suite (ripple/slip/slide with
  ghost outlines + multi-frame cut preview), razor/split-at-playhead,
  insert/overwrite/append edit actions, source viewer with I/O marks,
  inspector keyframe diamonds + curve easing (drawn-graphs again),
  audio clip volume lines + crossfade-as-ramp.
- **Audio page**: Beacon-as-Fairlight — embed the Beacon mixer surface
  against the video timeline's audio (DAW-mix-link work is the seed);
  range-select-inside-clip editing v1.
- QA: editing-operation unit tests on the store + visual sweep.

## Batch 6 — Deliver + polish (lightest; fine for a lighter model)

- **Deliver page**: render queue (stack jobs), format presets
  (YouTube/social/archive), archive export with per-track audio,
  up-res option.
- Browser upgrades in Beacon: key-labeled samples surfaced, similarity
  search on CLAP embeddings (already built for Lightning Bug).
- Tutorials/learn-content updates for the new surfaces; data-help-id
  anchors; UI-tier gating decisions.
- Legacy deletion soak review (old sound-settings panels, legacy FX
  paths per earlier deferrals) — only after everything above has soaked.

---

## Standing rules for every batch

- Worktree → implement → headless QA scripts → commit → push
  `origin apollo:main`; engine.js changes bump engine-version + build
  marker; never commit Brae's content/Audio; memory update after each
  batch.
- Preview↔export parity is a hard rule on all video work.
- Mobile/desktop parity flag: session view is desktop-first; mark
  mobile gaps rather than silently diverging.
- Nothing here needs Brae's external credentials; all batches are
  self-contained code work.
