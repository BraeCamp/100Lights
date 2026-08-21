# Beacon live/session view — research corpus notes

Directive (2026-08-20): the Beacon live/session view will be COMPLETELY
recreated on the Ableton Live Session-view model. These notes distill the
watched tutorial corpora in `~/video-watch/` into the reference spec.

## Corpus 1: Felix Raphael — Preparing Session View for Playing Live (PML)

`~/video-watch/EidG8BobNS4/` — 19:46, organic-house artist's real live set,
including a full live jam. How working performers actually structure the grid:

### Grid structure (the core mental model)
- **Columns = tracks, grouped per song.** Song A occupies tracks 1–3
  (kick / drums / instruments as warped stems), Song B occupies tracks 4–6.
  Shared utility columns follow: **Groove 1 / Groove 2** (spice loops —
  percussion, shaker), then live-instrument tracks (piano/keys, vocal).
- **Rows = performance phases, not just "scenes."**
  - Row 1 = **Introduction row**: a short loop cut from the song's opening
    that runs as an *infinite loop* — "total freedom for jamming live &
    setting the mood," no rush to trigger the next thing.
  - Row 2 = **Main row**: clips start at a structural marker (his "timeline
    9") and play through the song's full arrangement, ending in a loop at
    the song's end section (end loops don't need to be perfect — "a lot of
    other stuff is going on").
- Stay within the hardware surface: he sizes the whole set to the APC's
  8-column window so he never pages. Grid-size awareness matters.

### Clip/audio behaviors the recreation needs
- **Warping**: every stem is warped to the set BPM; repitch mode preferred
  for sound quality. Warp once, then *duplicate the clip* so the warp
  settings carry (never re-warp per row).
- **Clip fades**: kick clips need the auto-fade OFF or it eats the
  transient. Per-clip fade toggle is required.
- **Launch quantization + pre-roll**: he uses 2-bar quantize ("two bars
  from pushing till they start"), globally set. Everything triggers on
  the grid — this is what makes jamming feel safe.
- **Stop buttons are deletable** (CPU/визual decluttering in Ableton; for
  us: stop-slot presence should be a per-slot property, not fixed chrome).

### Performance flow (what the UI must make effortless)
1. Launch Song A introduction row → jam over it with live devices
   (one-shots on pads, piano on keys) with no time pressure.
2. Trigger Song A main row (whole row at once) → full arrangement plays.
3. **Transition**: launch Song B's introduction row *while* Song A still
   plays; swap kick to Song B's; bring B's instruments in; leave stray
   percussion from A running "as long as I want" — per-column independence
   is the entire point.
4. Mix with per-track faders by ear (he pulls grooves −10 dB); sends live.
- Scenes (full rows) AND individual clips both need one-gesture launch.

### Implications for Beacon live view v1
- Clip grid where a track's clips are independent lanes; scene = row launch.
- Global launch quantize (with visible countdown — "one two three four").
- Infinite-loop clips + play-through clips (clip loop on/off per clip) in
  the same row: a "scene" is heterogeneous.
- First-class warp (BPM-lock) on audio clips with mode choice; duplicate
  preserves warp.
- Session→arrangement recording is the bridge (Ableton's global record
  captures the jam into the arrangement) — this is how a jam becomes a song.

## Corpus 2: Bound to Divide — Learn Ableton Live 12 FULL COURSE (8h38m)

`~/video-watch/dt9SFEFe8ho/` — processing; full-product reference (Session
+ Arrangement + devices + workflow). Notes to follow.

## Corpus 3: Casey Faris — Introduction to DaVinci Resolve Full Course (5h11m)

`~/video-watch/MCDVcQIA3UM/` — processing; foundation for the video-editor
recreation (see research/video-editor-resolve.md, to follow).
