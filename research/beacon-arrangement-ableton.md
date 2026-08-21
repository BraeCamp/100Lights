# Beacon arrangement view — Ableton Live 12 reference notes

Directive (2026-08-20): the arrangement version of Beacon gets "some of
the foundation recreated around our best pieces." Corpus: Bound to
Divide, "Learn Ableton Live 12 FULL COURSE" (8h38m, three full tracks
built start-to-finish): `~/video-watch/dt9SFEFe8ho/` (1,100 frames,
8,526-line transcript, chaptered). The course works almost entirely in
Arrangement view, so it is the arrangement-workflow reference; the
Session-view spec lives in research/beacon-session-view.md.

## Global shell

- **Tab toggles Session ↔ Arrangement** — two views over one set of
  tracks, one keystroke apart. This is the model for Beacon: the new
  live view and the arrangement are the same project, not two apps.
- Mixer is a collapsible panel in Arrangement (Live 12 addition).
- Browser on the left: library/sounds/samples/instruments, search,
  drill into instrument racks, **key-labeled samples** (drones/vocals
  tagged "Am"), **similarity search** ("find sounds like this one"),
  favorites (right-click → set as favorite). Drag-to-track with
  type errors surfaced inline ("only audio effect can be inserted into
  an audio track" in the status bar).
- MIDI vs audio tracks; right-click → insert MIDI track; Ctrl+Shift+T
  new track.
- **Global scale setting** (e.g. A minor) highlights in-scale rows in
  every piano roll — we have this via our scale system; keep it
  first-class in the rebuild.

## Piano roll (clip editor) mechanics observed in anger

- Highlight a range on a track → right-click → insert empty MIDI clip.
- **Clip loop mode + loop brace** (Ctrl+L): edits inside a looping clip
  affect every repetition — the teacher repeatedly **consolidates
  (Ctrl+J)** to "print" the loop before editing single repeats. Split =
  Ctrl+E. Duplicate = Ctrl+D. ×2/÷2 length buttons.
- Note ops: double-click add; arrows transpose; **Shift+arrow = octave**;
  Ctrl+drag copy; Alt+drag on notes = velocity; select-bottom-notes →
  copy down an octave to fatten chords.
- Status bar shows selection duration (he sizes song sections by
  highlighting and reading the duration).

## Arrangement workflow (the actual craft loop)

1. Build a 1-minute loop of all elements.
2. **Duplicate it across the full song length** (3–3.5 min target),
   then **sculpt by deletion**: strip elements per section (intro =
   chords only; drop = chords+bass+kick; breakdown = pad+melody, no
   kick; climax = everything; outro = strip back down).
3. **Locators**: right-click the timeline → add locator; label sections
   (Intro / Drop / Breakdown / Build / Climax / Outro); clicking a
   locator jumps playback there. This is the section-labeling feature
   our arrangement view needs (ties into our tension-arc rules).
4. Teasers and tension: bring one note of a pad in early; hold a single
   long filtered note through the breakdown; repeat the first melody
   note through the build; loop-brace only a sub-phrase for outros.
5. **Ear-candy pass**: one-shot FX, sweeps, reversed clips (Shift+R),
   crash + huge reverb, drones under sections — always warped/tuned.
6. Color discipline: assign track colors by element family (low end
   orange, drums green, harmony pink), "assign track color to clips."

## Automation (their model — adopt most of it)

- **Automation-arm button** puts Arrangement in automation mode; a red
  dotted line appears on the touched parameter's lane; touching ANY
  device control creates a lane for it ("show all parameters" vs
  "automated only" gotcha).
- Draw straight segments; **Alt+drag bends a segment into a curve**
  (our MotionCurve/drawn-graph system already exceeds this — keep it as
  a best piece and expose it on every device parameter the way Live
  does, incl. Apollo macros which we already wired).
- Overridden automation grays the line; a re-enable button "repairs" it
  (manual tweak vs written automation distinction — we need this
  state).
- The workhorse move: **auto filter (lowpass) on a track or group,
  automated open across a section** — confirms our filter-motion
  arrangement rules; the rebuild should make "filter open/close over
  section" a one-gesture operation.

## Audio clips / warping

- Sample BPM field = "what the sample IS" (Ableton guesses, often
  wrong; fix the guess, warp on, clip follows project tempo).
- Clip fades via corner squares; clip transpose (Shift+up = +12 st);
  reverse (Shift+R).
- Sweeps get warped so their peak lands exactly on the drop.

## Mixing / routing observed

- **Sidechain compression UI**: compressor → expand arrow → sidechain
  ON → audio-from source picker (pick the kick track) → detector-only
  EQ (highpass ~1kHz so only the transient triggers) → threshold ~-51,
  release ~50ms. Copy the configured device across tracks (Ctrl+X/V on
  devices between tracks is normal workflow). Matches our Helios
  sidechain (B1); the rebuild needs the same source-picker UX.
- **Groups (Ctrl+G)**: group tracks, name it, drop one device (auto
  filter) on the group to affect all — our track-groups feature
  already models this; keep as a best piece.
- Utility (gain) as a teaching/automation device; per-track pan dial;
  velocity-reduced ghost notes.

## Synthesis for the Beacon arrangement rebuild

- **Keep (best pieces to rebuild around)**: Helios/Apollo engine +
  devices + Apollo Rack, drawn-graph automation curves, track groups,
  scale system, piano-roll FX cascade, tempo map, step sequencer,
  library sync.
- **Recreate on the Ableton model**: Tab-paired Session/Arrangement over
  one project; locator/section labels with click-to-jump; automation
  mode with touch-to-create lanes + override/re-enable state; clip loop
  brace + consolidate; warping with sample-BPM correction; browser with
  key-labeled/similarity search (we have CLAP embeddings — use them);
  duplicate-then-sculpt arrangement affordances (per-section element
  muting reads as deletion, not mixer state).
- **Remove**: the AI button (per directive).
