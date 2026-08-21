# Video editor recreation — DaVinci Resolve reference notes

Directive (2026-08-20): the 100Lights video program will be COMPLETELY
recreated with Resolve's model as the foundation, keeping only a few
existing pieces. Corpus: Casey Faris, "Introduction to DaVinci Resolve —
Full Course (2026)" (5h11m, Resolve 20), fully watched:
`~/video-watch/MCDVcQIA3UM/` (900 frames, 8,793-line transcript, chapters
for every page). These notes distill the whole course into the reference
spec for the rebuild.

## The architectural thesis: pages over panels

Resolve is "several programs in one," split into **pages** along the
post-production workflow, in workflow order: **Media → Cut → Edit →
Fusion → Color → Fairlight → Deliver**. The critical properties:

1. **One shared timeline, zero round-tripping.** Every page operates on
   the same project state. A Fusion composite or a color grade is
   instantly live back in the edit page — no render, no export/import.
   (Casey: "in basically every other app ever, you can't do that.")
2. **A page is a MODE, not a layout.** Same project, different way of
   working; some panels (media pool, inspector, effects, viewer,
   timeline) recur on every page with identical behavior.
3. **Universal conventions across pages**: panel headers toggle open/
   closed (bright = open); the **inspector** always shows properties of
   the selection; JKL transport everywhere; middle-mouse-drag pans
   everything (timeline, viewer, node graph); a viewer pair =
   "pick up and look at" (source) vs "what the audience sees" (output).

**For our rebuild**: this is the model — mode-based pages over one
project store (our reducer already is one store; the multi-page shell is
the new part). Our current single-screen editor with side panels becomes
the "Edit page" of a multi-mode program.

## Media page (media management as a first-class mode)

- **Media storage (system browser) vs media pool (in project)** — an
  explicit import boundary. Hover-scrub thumbnails to preview before
  importing.
- **Bins** (folders) + **bin list** tree; dragging OS folders onto the
  bin list recreates the folder structure as bins (dragging into the
  pool flattens — deliberate distinction).
- Views: thumbnail / list / metadata; zoom slider; right-click the list
  header to choose metadata columns.
- **Metadata panel**: scene/take/angle/keywords/notes per clip;
  **smart bins** = live filters (auto one-per-keyword, plus custom rule
  builders, e.g. "scene contains 4").
- **Audio autosync**: select video+audio clips → sync by waveform →
  replaces camera audio in the video clip, batchable across the whole
  shoot; synced-audio column shows what matched.

## Edit page (the hub)

- Media pool ("cabinet") → **source viewer** ("pick it up") → timeline
  ("plate") → **timeline viewer** (what the audience sees).
- **Source tape mode**: all clips in a bin become one scrubbable tape.
- **I/O in-out marks** in the source viewer pre-trim before insert; JKL
  (L×2 = 2× speed).
- **Edit actions**: insert (ripple at playhead), overwrite, replace,
  place-on-top, **append at end** (gather-then-arrange workflow); drag
  source viewer onto the timeline viewer to get an edit-action overlay.
- **Trimming**: edge-drag with the full-clip ghost outline; snapping
  magnet toggle; razor tool vs split-at-playhead (Ctrl+\); **trim mode**
  (T): ripple trims, **slip** (drag mid-clip top), **slide** (drag
  mid-clip bottom), with a multi-frame preview of both sides of every
  affected cut; ripple-trim-to-playhead shortcuts (his QWS setup: Q =
  trim start to playhead, W = trim end, S = split — "cut silence by
  waveform" podcast workflow).
- **Keyboard customization** panel with app presets (Premiere/FCP/Avid)
  and conflict detection.
- Audio in the timeline: waveforms with per-clip volume line, alt-click
  control points, crossfade on an edit = smooth volume ramp when it's
  the same clip, corner fade handles on both audio and video.
- Link/unlink a/v; alt-click selects one side only; "delete through
  edit" heals pointless splits.
- **Inspector** = transform (zoom/position/rotate), crop w/ softness,
  composite modes + opacity, **stabilization** (one button), lens
  correction, **retime** (right-click retime controls, speed points for
  variable speed).
- **Effects panel**: transitions (drag onto an edit; swap type in
  inspector), open-fx, **generators** (gradients, patterns), **titles**
  (basic + Fusion-powered), each with inspector controls.
- **Keyframing**: diamond buttons next to any inspector property; a
  keyframes panel under the clip (track per property) + a **curves view**
  with easing handles ("flatten handle" = ease-in). Keyframe spacing =
  speed.

## Cut page (same data, speed-optimized second editing mode)

- **Dual timeline**: upper = entire movie always fully zoomed out,
  lower = zoomed detail at the playhead — navigation without zooming.
- **Smart insert**: edits land at the *nearest edit point* (highlighted
  green), not the playhead; one-click transition buttons per edit point.
- Single switching viewer; "fast" inspector variant with big controls.
- **Sync bin multicam**: select clips → sync by audio → clips carry a
  sync tag; then, from a wide anchor shot, the sync bin shows all camera
  angles live at the playhead; press the angle number → auto in/out set
  → place-on-top = perfect cut. A hybrid of multicam and layer-stacking.
- Verdict he gives: great for fast one-track work (vlog/news) and
  multicam; the edit page for fine work. Notable that Blackmagic ships
  BOTH — two editing modes over one timeline.

## Fusion page (node compositing — per-clip effects world)

- Per-clip node graph: **MediaIn → [nodes] → MediaOut**, instantly live
  in the edit page.
- Nodes = single-job boxes; inputs color-coded (yellow = background,
  green = foreground, **blue = mask**); drag a node onto a wire to
  insert; drag output onto a node's output to auto-create a **Merge**.
- Merge node = image-over-image with blend/opacity; masks (ellipse/
  rectangle/polygon pen paths) limit ANY node's job to a shape; soft
  edge; invert; ⚠️ masks auto-keyframe on first draw (remove polyline
  animation unless you want it).
- Generators (fast noise → fog/smoke), brightness/contrast, color
  corrector, transform node; per-node enable toggle; F2 rename;
  Shift+Space = searchable all-nodes menu (~370 nodes).
- **Tracker**: point tracker follows a feature; operation "match move"
  glues a foreground (text, box graphics) to motion, or produces an
  animated mask that can feed the blue input of any effect (blur
  everything except the tracked box, etc.). **Magic Mask** (paid):
  draw-a-stroke subject segmentation, tracked both directions — put
  text/graphics BEHIND a person.
- Viewer pair, view any node by dragging it to a viewer or pressing 1/2.
- **Relevant existing 100Lights assets**: our drawn-graphs/FX-motion
  work, subject-lift (MediaPipe segmentation = our Magic Mask
  equivalent), video-scenes detector, title text engine — these are the
  "best pieces" candidates that survive the rebuild as node types.

## Color page (the crown jewel — this is our biggest gap)

- **Model**: no effect-dragging. The playhead's clip is auto-selected in
  a thumbnail strip; palettes below always operate on THAT clip. Rainbow
  clip number = graded, gray = untouched.
- **Per-clip node graph** (simpler than Fusion): each node = a *group*
  of corrections; serial (Alt+S) / parallel (Alt+P) nodes; click node
  number to toggle; label nodes ("warm", "contrast"); order matters.
- **Clip grade vs timeline grade**: a second node graph applies to the
  ENTIRE timeline — this is where "the look" lives. Workflow he
  teaches: (1) color-manage everything, (2) build the creative look in
  timeline nodes on a hero shot, (3) match all clips under that look in
  clip nodes, (4) only then do per-shot beauty work.
- **Color management**: log footage + input-color-space tag per clip
  (camera's "instructions") → scientifically correct starting point,
  no slider guessing. Timeline color science: DaVinci YRGB Color Managed
  (wide-gamut intermediate).
- **Primaries palette**: lift/gamma/gain/offset color wheels + master
  wheels (dark/mid/bright/global), contrast+pivot, temp/tint,
  saturation, color boost, shadows/highlights. "The Swiss Army knife" —
  90% of grading.
- **Custom curves**: brightness curve (S-curve = filmic contrast) plus
  hue-vs-hue, hue-vs-sat, hue-vs-lum, lum-vs-sat, sat-vs-sat, sat-vs-lum
  — and you can click-drag ON THE IMAGE to place curve control points.
- **Scopes**: waveform, RGB **parade** (white-balance by equalizing
  channels), vectorscope (saturation targets, skin line), histogram.
  Rationale: eyes adapt in ~10s; scopes don't. First-impression
  grading + constant hero-still comparison ("slow drift" trap).
- **Stills gallery**: grab still = color preset + reference frame;
  middle-click applies a grade from a still or another clip; play-still
  = split-screen wipe compare against the hero shot.
- **Secondaries**: **windows** (masks — the "big soft circle" does 90%),
  gradient windows for sky/side-of-frame; **qualifier** (eyedropper HSL
  key + matte finesse clean-black/white) for skin; **one-click tracker
  on any window** ("locks onto his eye and tracks it in 1 second");
  mid-detail slider for skin softening; log wheels / HDR wheels = range-
  limited tonal zones (advanced).
- Highlight mode to view the current selection as a matte.

## Fairlight page (audio mode — for us, Beacon IS this)

- Same timeline as edit, switch freely; per-track mixer (input, effects
  inserts, dynamics, EQ, bus routing, pan, fader); huge zoom (to sample
  level); loudness meters.
- **Range mode** selects *regions inside clips* (in/out on the clip):
  delete a breath, raise a word's gain line — no splitting;
  "focus mode" = range on the clip's top half, move on the bottom half.
- Automation: keyframe any mixer parameter (fader, etc.) on a per-track
  lane picker.
- **Tracks are the magic**: one track per sound category, name + color
  them; **groups** (linked faders) vs **buses** (submix routing: body
  bus → bus 1; effects on the bus process everything routed through it).
- Per-CLIP effects (drag from list, floating plugin UI + inspector
  mirror), per-TRACK effects, per-BUS effects; built-in strip EQ
  (double-click the EQ line: muffle-through-a-door = cut highs) and
  dynamics (compressor with threshold/ratio/makeup + "dialogue
  compression" preset).
- **Sound library**: index folders of SFX, search "toilet"/"door",
  preview with JKL, set in/out, drag to a new track. Sound-design
  workflow: marker pass (M) for every missing sound, then layer (5
  body-hit tracks), group, bus, EQ for distance.
- **For our rebuild**: Beacon replaces Fairlight — the audio "page" of
  the video program should BE a Beacon surface on the shared timeline
  (our DAW mix-link work is the seed of exactly this).

## Deliver page

- Presets (YouTube/Vimeo/TikTok/ProRes/H.264/H.265) just fill the
  settings; video/audio/file tabs; single clip vs individual clips.
- Codec-vs-container teaching (quality/size/playback triangle); archive
  master = ProRes + linear PCM with **each timeline track as a separate
  audio track in one file** (future-proof remix); up-res to UHD for
  YouTube's better bitrate ladder.
- **Render queue**: stack multiple jobs (YT master, computer copy,
  archive) and render all. We should adopt the queue + presets +
  per-track-audio archive concept (our .cfproj already beats this for
  editability, but exported deliverables need the preset ladder).

## What this implies for the rebuild (synthesis)

1. **Pages shell**: Media / Edit / (maybe Cut later) / FX / Color /
   Beacon / Deliver over the one project store; page = mode; instant
   cross-page liveness is non-negotiable.
2. **Keep (the "few things")**: render/export fidelity pipeline,
   subject-lift, sceneTrack + Auto-Edit, title text engine, song-video
   engine, Beacon audio integration, .cfproj/library round-trip.
3. **Biggest net-new**: the Color page (clip-strip + wheels/curves/
   scopes + windows with tracking + look-vs-clip two-level grading),
   proper trim tools (ripple/slip/slide + ghost outlines), inspector-
   with-keyframe-diamonds + curves easing, bins/smart-bins media pool,
   node-based per-clip FX (our drawn-graph FX as nodes), sound-library
   indexer, render queue.
4. **Conventions to copy exactly**: panel-header toggles, universal
   inspector, JKL + I/O everywhere, middle-drag pan, snapping magnet,
   viewer gain/gamma preview adjust, auto-keyframe warnings.
