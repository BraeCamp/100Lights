# What Beacon is missing against Ableton Live 12 — research notes (2026-09-04)

Brae: "look at some modern Ableton tutorials and see what else we could be
missing… more buttons, a more condensed screen, more modulated sections,
visuals that exist in Apollo but not in Beacon that are in Ableton… pencil
mode, wave visuals on the bottom of the screen, UI size settings, OTT
settings, knobs, and much more… only do the research right now."

Research only. Nothing in the studio was changed. Everything below is
cited to a note in this folder, and every note cites its sources.

## The corpus

| file | what it is | evidence |
|---|---|---|
| `video-observations.md` | seven Live 12.x videos watched frame by frame with `scripts/watch-video.mjs` (Ableton's 12.3 and 12.4 overviews, the stacked-view tip, an interface tour, Seed To Stage on 12.2, a 20-minute beginner navigation tutorial, an OTT tutorial) | frames + captions in `~/video-watch/` |
| `releases-and-manual.md` | Live 12.0 → 12.4.5 (Aug 2026) release-by-release, the 42-chapter manual map, every device by edition | 41 URLs |
| `midi-and-clip-view.md` | every control in the Clip View, Draw Mode, lanes, MIDI Tools, warping, the Sample Editor | ~55 URLs |
| `interface-and-workflow.md` | the Control Bar left to right, view selectors, Arrangement, Session, mixer sections, browser, menus, every Settings tab, shortcuts | 75 URLs |
| `devices-modulation-visuals.md` | modulation model, modulators, macros, the real OTT numbers, which of ~45 devices draw what, knob grammar | 50 URLs |
| `tutorial-corpus.md` | which features and tips tutorials repeat, and why | see file |
| `beacon-inventory.md` | what Beacon has today, from the code, with file paths | repo sweep |

Older notes still valid: `research/beacon-arrangement-ableton.md` (the 8-hour
Bound to Divide course) and `research/beacon-session-view.md` (Felix
Raphael's live set).

Two facts that frame everything: **there is no Live 13** — the current
release is 12.4.5 and 12.1–12.4 were free updates — and the **stacked
Clip-plus-Device view and the Mixer in Arrangement are Live 12.0
features**, so every tutorial from 2024 onward assumes them.

## 1. Brae's named items, answered

**"Pencil mode."** Live's Draw Mode (`B`, or hold `B` for a moment, or the
pencil in the Control Bar). Click = a grid-length note; drag sideways =
a note per grid step; drag up/down while drawing = velocity; the next note
inherits the last velocity; drawing back over notes erases; a Pitch Lock
setting (or `Alt`) keeps a drag on one pitch for drum lanes; the same
pencil draws velocity, chance, MPE lanes and envelopes as grid steps.
Beacon: drawing is "click in empty space" inside the Edit tool, plus an
Erase tool; there is no pencil mode, no step-painting, no velocity-while-
drawing, no pitch lock (`beacon-inventory.md` §3). → `midi-and-clip-view.md`
§2, `interface-and-workflow.md` §8.

**"Wave visuals on the bottom of the screen."** Two things. (a) The
**Clip View for an audio clip**: a full-width waveform of the selected
clip along the bottom with warp markers and transient markers on its top
ruler, the loop brace above, and the clip panel on the left (Warp, Seg
BPM ÷2 ×2, warp mode, Gain fader, Pitch dial, Reverse, Edit, RAM, Hi-Q,
fades). (b) The **arrangement overview strip** across the top and the
**waveform vertical zoom** (× or dB) with H/W optimise buttons at the
bottom right. Beacon draws waveforms in the arrangement lane and in
modals, has waveform vertical zoom 1–8, but the piano roll opens inline
under the track row rather than in a fixed bottom detail pane, and audio
clips have no bottom detail editor at all (`ClipSettingsModal` is a modal).
→ `video-observations.md` §2, `midi-and-clip-view.md` §16.

**"More buttons, a more condensed screen."** Live's Control Bar is one
~24 px row of ~30 icon-sized controls; below it three editors stack —
Arrangement, Clip View, Device View — each ~150–250 px tall and dense;
track headers on the right carry input chooser, monitor, activator, S,
arm, volume field, pan and a meter. The condensing devices are: (1) the
stacked detail view, (2) the Mixer in Arrangement as a strip with
show/hide sections, (3) one-key toggles for everything (`B F K G N Z X H W
Tab Shift+Tab`), (4) values as draggable text fields, (5) the Info View
replacing labels. Beacon has a resizable bottom Devices/Instrument panel,
a left sidebar, and a command palette, but no stacking, no strip mixer in
the arrangement, no section show/hide, no H/W, and inline panels instead
of a fixed detail area. → `video-observations.md` §1, `interface-and-workflow.md` §1–2.

**"UI size settings."** Settings › Display & Input › **Zoom Display**
50–200 % for the main window and separately for a second window; since
12.1 `Ctrl/Cmd +/−` zooms the whole UI; Theme & Colors has Theme,
Light/Dark + follow the OS, Tone (warm/cool/neutral), High Contrast, Grid
Line Intensity, Brightness, Color Intensity, Color Hue, track/clip colour
rules. Beacon has the Workshop theme (tokens, patterns, presets), the three
UI tiers and `lib/ui-density.ts`, but **no global UI scale** — a per-tier
CSS zoom was removed on purpose (comment in `lib/ui-tiers.ts`). Learn View's
very first lesson tells users to "adjust the Zoom Level until the interface
is comfortable". → `interface-and-workflow.md` §14, `video-observations.md` §5.

**"OTT settings."** OTT is a preset of Multiband Dynamics. The decompressed
factory preset: crossovers 88 Hz / 2.5 kHz; above-thresholds −33.75 /
−30.25 / −35.5 dB; below-thresholds −40.75 / −41.75 / −40.75 dB; attacks
47.8 / 22.4 / 13.5 ms; releases 282 / 282 / 132 ms; band out gains +10.3 /
+5.7 / +10.3 dB; global Output +19.1 dB; Soft Knee on; RMS; ratios near
limiting above and strong upward compression below. The UI is the block
display: drag a block **edge** for threshold, a block **middle** for ratio,
`Cmd` = all bands, `Alt` = both blocks, `Shift` = fine; the global **Amount**
scales every ratio (this is the "Depth" tutorials set to 15–50 %) and
**Time** scales every attack/release. Beacon has a Multiband Comp device
but no block display, no upward compression and no OTT preset.
→ `devices-modulation-visuals.md` §2.

**"Knobs."** Live's grammar (manual §41.6): drag; `Shift` = finer; arrow
keys nudge; **Delete or double-click resets**; type digits then Enter;
`Q` hot-swaps the device; `P` toggles A/B (12.3); modulation shows as a
blue ring segment on the knob and automation as red; a mapped macro target
greys out. Beacon's `Knob.tsx` has drag, Shift-fine, double-click reset and
a live-value label, but **no typed entry, no keyboard nudge, no
modulation/automation ring, no right-click menu**. → `devices-modulation-visuals.md` §4, `beacon-inventory.md` §5.

**"More modulated sections."** Live 12 has no single modulation panel;
modulation lives in four places: the clip **Envelopes tab** (Automation
vs Modulation toggle, unlinked loop length turns an envelope into an LFO),
**modulator devices** (LFO, Shaper, Envelope Follower, Envelope MIDI,
Shaper MIDI, Expression Control, MPE Control — up to 8 targets each, Mod
or Remote mode), **device-internal modulation** (Auto Filter's stereo LFO
+ envelope follower + sidechain, Roar's matrix, Delay's LFO, Auto
Pan-Tremolo), and **Rack macros** (16, Map mode overlays, Min/Max with
invert, Rand, Variations). Beacon has all of this *inside Apollo* (mod
matrix with aux scaling and remap curves, 10 LFOs, 8 macros) and its own
drawn-graph suite, but **nothing modulates Beacon's own track devices**:
no modulator devices, no racks/macros, no per-knob modulation display.
→ `devices-modulation-visuals.md` §1, `beacon-inventory.md` §6.

**"Visuals that exist in Apollo but not in Beacon."** Apollo has a master
oscilloscope + spectrum (`ScopeView`), wavetable/spectral/granular views,
envelope and LFO editors. Beacon's own device chain draws only an EQ3
curve, a shared biquad response curve for the filter, and a compressor
gain-reduction bar. Live draws a spectrum behind the curve on EQ Eight,
Auto Filter, Saturator and (12.4) Erosion; transfer curve + activity
history on Compressor and Gate; needle + LED on Glue; GR meters on
Limiter; spectrograms on the Spectral devices; a Tuner strobe; and the
Spectrum device. → `devices-modulation-visuals.md` §3.

## 2. Gap table

Legend — **Have**: Beacon has it (file in `beacon-inventory.md`). **Part**:
partial. **No**: absent. **Ours**: Beacon has something Live does not.
"Since" is the Live version.

### A. Layout and detail views

| Ableton | Since | Beacon | Notes |
|---|---|---|---|
| Stacked Clip View above Device View; triangle toggles bottom-right; `Ctrl/Cmd+Alt+3/4`; `Shift+Tab` flips | 12.0 | **No** — bottom panel is Devices/Instrument only; piano roll opens inline under the track | The single most-cited layout change in 2024–26 tutorials |
| Resizable detail area (drag split), full-size Clip View `Cmd+Option+E` | old | **Part** — bottom panel resizable via `useResizable` | |
| Mixer in Arrangement as a strip + section drop-down (In/Out, Sends, Returns, Mixer, Track Options, Crossfader, Performance Impact) stored per view | 12.0 | **No** — Mixer is a separate view | Frames: `K2LdpamvXJ0` f00005 |
| Arrangement overview strip (minimap with zoom box) | old | **No** | |
| Optimise Height / Width (`H` / `W`), waveform vertical zoom ×/dB slider | 12.0 | **Part** — `F` fit, wf-zoom 1–8; no H/W | |
| Follow (Page / Scroll), pauses on edit | old | **No** follow/auto-scroll | |
| Second window, full screen, video window | old | **No** — only the Apollo rack pops out | |
| Corner view controls (Browser / Session-Arrangement / Mixer / Info) | 12.0 | **Part** — view buttons exist; no Info toggle | |
| Track headers with I/O chooser, monitor In/Auto/Off, activator number, S, arm, volume field, pan, meter | old | **Part** — TrackRow has M/S/arm/volume; no input chooser, monitor or numbered activator | |
| Info View (hover text for every control) + Edit Info Text on tracks/clips/devices; Status Bar selection readout | old | **Part** — `data-help-id` help catalogue + Inspect mode (`I`); no always-on hover text or status bar | Tutorials say "keep Info View on while learning" |
| Learn View (lessons + PiP video + progress) replaces Help View | 12.4 | **Ours/Part** — 27 tutorials + StudioGuide; no video, no progress | |
| Navigate menu, `Alt+0…7` view focus, Tab navigation, screen readers | 12.0 | **No** | |

### B. Control bar / transport

| Ableton | Since | Beacon | Notes |
|---|---|---|---|
| Tap, tempo drag/type, **nudge ±**, time signature | old | **Part** — no nudge | |
| Metronome menu: count-in, sound, rhythm, only-while-recording | old | **Part** — count-in 0/1/2; no sound/rhythm choice | |
| Link, Tempo Follower, EXT sync, Link Audio | 12.4 | **No** | Collaboration is via Liveblocks instead |
| Keys & Scale in the bar; Scale Mode per clip | 12.0 | **Have** — root + scale selectors, scale lock | |
| Position fields, play/stop/record, double-click stop = home | old | **Have** | |
| MIDI arrangement overdub, **automation arm**, re-enable automation | old | **Part** — re-enable exists; no automation arm/write for Beacon devices (Apollo only) | |
| **Capture MIDI** (retroactive) | 9.7+ | **Have** — Jam capture (30 s audio) + Capture to Arrangement; not MIDI-specific retro capture | |
| Session Record, global launch quantization | old | **Have** | |
| **Punch in / punch out** | old | **No** | |
| Draw mode toggle, computer-keyboard-as-MIDI toggle, **Key map / MIDI map** modes | old | **Part** — pads + Web MIDI + MIDI learn; no key-map mode, no draw toggle | |
| CPU meter (average/current), disk overload, MIDI LEDs | old | **No** | Performance Impact per track too |

### C. Arrangement

| Ableton | Since | Beacon | Notes |
|---|---|---|---|
| Locators with Set/Prev/Next, rename `Ctrl+R`, loop to next locator | old | **Have** — markers + sections lane | |
| Time commands: Insert Silence, Cut/Copy/Paste/Duplicate/Delete Time | old | **No** — clip-level only | Every tips list includes these |
| Split `Ctrl+E`, Consolidate `Ctrl+J`, Reverse `R`, fades `Ctrl+Alt+F`, crossfades, Crop | old | **Part** — split at playhead, consolidate (MIDI loops), reverse, fades; no crossfade drag, no crop-to-selection | |
| Grid modes: `Ctrl+1/2` narrow/widen, `Ctrl+3` triplets, `Ctrl+4` snap off, `Ctrl+5` fixed/adaptive; `Alt` bypasses | old | **Part** — snap modes 1–5, `Alt`-drag bypass | |
| Automation lanes: chooser, `+`/`−` lanes, lock envelopes, shapes, keyboard breakpoints (12.2) | old/12.2 | **Have** — lanes, override semantics, freehand draw; no lane lock, no shapes on lane points | |
| Linked-track editing | 11 | **No** | |
| Take lanes, comping, audition, draw-to-comp | 11 | **Have** — `lib/comping.ts`, TakeLane (full tier) | Verify the comp-by-drawing gesture |
| Time-signature markers, fragmentary bars | old | **Have** — meter map | |
| Bounce to New Track `Ctrl+B`, Bounce in Place, Bounce Group, Paste Bounced Audio | 12.2/12.3 | **Part** — Freeze/Thaw exist; no flatten, no bounce-to-new-track, no paste-bounced | Tutorials: "fire off a bunch of edits" |
| Stem separation (local) into a group | 12.3 | **Part** — `lib/hpss.ts` exists; no UI command | |

### D. Session view

| Ableton | Since | Beacon | Notes |
|---|---|---|---|
| Clip grid, scenes with tempo/meter, Stop All, Back to Arrangement | old | **Have** | |
| Follow actions per clip; **scene follow actions** (Unlinked/Longest) | 11/12.2 | **Part** — clip follow actions; no scene follow actions | |
| Launch modes (Trigger/Gate/Toggle/Repeat), legato, velocity → launch | old | **Part** — quantization only | |
| Scene View panel, status fields | 12 | **No** | |
| Session mixer strip (In/Out, sends, pan, fader, meter, activator, S, arm, crossfader) | old | **Have** — mostly | |

### E. Mixer and routing

| Ableton | Since | Beacon | Notes |
|---|---|---|---|
| Peak + RMS meters, resizable, numeric peak hold, dB scale, colour stripe | 12.0 | **Part** — RMS + peak-hold; no numeric readout, no clip LED | |
| Solo in place / exclusive solo, exclusive arm | old | **Part** | |
| **Cue output** + preview volume + browser preview through cue | old | **No** | |
| Crossfader A/B with 7 curves | old | **Part** — A/B, no curves | |
| **Track delay** | old | **No** | |
| Sends pre/post, return solo-safe | old | **Have** | |
| Groups, nested groups | old | **Have** (nesting: verify) | |
| Performance Impact column | 12.0 | **No** | |
| Input/output routing chooser (external, resampling, track-to-track) | old | **No** — `inputSource` is mic/system | Resampling is a top-5 tip |

### F. Clip View: MIDI editing

| Ableton | Since | Beacon | Notes |
|---|---|---|---|
| Draw Mode as above (`B`, hold-B, step painting, velocity-by-drag, pitch lock, erase) | old/12 | **No** | |
| Fold (`F`), Highlight Scale (`K`), Fold to Scale (`G`), Focus (`N`) | 12.0 | **Part** — scale lock highlights/snaps; no folding | |
| Lanes: Velocity, Velocity Deviation, Release Velocity, **Chance**, Probability Groups (Play All / Play One) | 11/12 | **Part** — velocity lane only | `MidiNote` has no `chance` |
| Pitch & Time utilities: Transpose, Fit to Scale, Invert, Add Interval, Stretch ×2 ÷2, Set Length, Humanize, Reverse, Legato | 12.0 | **Part** — transpose, fit to scale, ×2 ÷2, humanise, legato; no Invert, Add Interval, Reverse, Set Length | |
| Split (`E`-drag / `Ctrl+E`), Chop, Join `Ctrl+J`, Fit `Ctrl+Alt+J`, Deactivate `0` | 12.0/12.1 | **No** | |
| Find & Select filters (pitch, time, chance, condition, count, duration, scale, velocity) | 12.1 | **No** | |
| Stretch markers (proportional, pseudo, mirror) | old | **No** | |
| Quantize dialog: start/end/both, meter incl. triplets, Amount % | old | **Part** — full/half quantize | |
| Loop brace ops: Set buttons, `Ctrl+D` Duplicate Loop, Run Into Loop, F9–F12 | old | **Part** — loop + duplicate clip | |
| Multi-clip editing (8 clips) + Focus | 11 | **No** — one clip at a time (transpose across clips only) | |
| Note preview (headphone) toggle → step entry when armed | old | **Have** (audition) — verify step entry | |
| Envelopes tab: automation vs modulation, unlinked loop = LFO, Insert Shape, Simplify, curves, MIDI CC | old | **Ours** — drawn graphs (amplitude, LFO, pitch, volume, groove, FX motion) cover much of this differently | Live's unlinked-loop-as-LFO is a repeated tip |
| Expression tab (MPE Pitch/Slide/Pressure/Velocity/Release), Glissando + LFO tools | 11/12.1 | **Part** — per-note `RollFx`; Apollo MPE; no MPE lanes | |
| Keyboard-only editing map | 12.0 | **Part** | |

### G. MIDI Tools

| Ableton | Since | Beacon | Notes |
|---|---|---|---|
| Generators: Rhythm, Seed, Shape, Stacks (+ Euclidean, chord banks) | 12.0 | **Part** — Smart Drums, step-sequencer dice, recipes/patterns, AI write_part | Different shape: ours are presets/AI, Live's are parametric with Auto-apply |
| Transformations: Arpeggiate, Chop, Connect, Glissando, LFO, Ornament, Quantize, Recombine, Span, Strum, Time Warp, Velocity Shaper | 12.0/12.1 | **Part** — arp/chord/scale/velocity MIDI *effects* and grooves; no note-transform panel | Recombine, Strum, Ornament are the ones tutorials love |
| Auto Apply / Apply `Ctrl+Enter` / Reset, scale-degree awareness, works inside the loop brace | 12.0 | **No** | |

### H. Audio clips and warping

| Ableton | Since | Beacon | Notes |
|---|---|---|---|
| Six warp modes (Beats, Tones, Texture, Re-Pitch, Complex, Complex Pro) with parameters | old | **Part** — repitch + WSOLA stretch | |
| Warp markers, transient markers, Set 1.1.1 Here, Warp From Here (Straight/Start), Warp as N bars, Quantize audio | old | **No** | The warping recipe is in every course |
| Seg BPM ÷2 ×2, Gain, Pitch + Detune, RAM, Hi-Q, Reverse, Edit, Fade, Save default clip | old | **Part** — gain, pitch, reverse, fades, trim | |
| Slice to New MIDI Track, Convert Harmony/Melody/Drums to MIDI | old | **Part** — slice to library, `lib/audio-to-midi.ts` (no track command) | |
| Clip gain envelope, transposition envelope, sample-offset envelope | old | **Part** — gain envelope points | |

### I. Devices and visualisations

| Ableton | Since | Beacon | Notes |
|---|---|---|---|
| Device title bar: activator, breakout, sidechain header (12.2), scale-aware toggle, Learn, lock, hot-swap, save preset, options button, A/B (12.3), fold | 12.x | **Part** — on/off, remove; no hot-swap, save-preset, A/B, fold | |
| Racks (Instrument/Audio Effect/Drum/MIDI), chains, chain selector, 16 macros, Map mode, Rand, Variations | old/11 | **Part** — saved chain presets ("Save as rack…", `DeviceChain.tsx:1802`); no macros, parallel chains or nesting; Apollo has macros | corrected by the second pass |
| Spectrum behind the curve (EQ Eight, Auto Filter, Saturator, Erosion) | 12.1–12.4 | **No** — EQ3/filter curve without spectrum | Apollo has the analyser code |
| Compressor transfer curve + activity view + GR; Glue needle; Limiter GR; Gate history | old | **Part** — GR bar with dB | |
| Spectrum, Tuner (strobe/histogram), Utility phase | old | **Part** — PadTuner exists; no Spectrum device | |
| Drum Rack 128-pad view, Drum Sampler X/Y | 12.1 | **Part** — 16 pads | |
| OTT block display, upward compression | old | **No** | numbers in §1 |
| Auto Filter (comb, notch+LP, resampling, dispersion; stereo LFO; env follower; sidechain) | 12.2 | **Part** — Filter + LFO device | |
| Roar, Meld, Granulator III, Expressive Chords, Auto Shift, Drum Sampler, Auto Pan-Tremolo, Erosion/Chorus-Ensemble/Delay redesigns, Spectral Time/Resonator, Hybrid Reverb, Vocoder, Corpus | 11–12.4 | **Part** — Apollo covers granular/spectral/wavetable; Beacon chain has 18 + 6 Apollo devices, no vocoder/resonator/corpus/hybrid reverb | |
| Level meters between every device in a chain | old | **No** | |

### J. Modulation, automation, macros

| Ableton | Since | Beacon | Notes |
|---|---|---|---|
| Modulation (blue, relative, scales the knob) vs automation (red, absolute) drawn on the same knob | 12.0 | **No** on Beacon devices | |
| Modulator devices (LFO, Shaper, Envelope Follower, Envelope/Shaper MIDI, Expression Control, MPE Control), Mod vs Remote, 8 targets | 12.0 | **Part** — one LFO *effect*; Apollo matrix | |
| Macro Variations + Rand | 11 | **No** — Apollo has macros, no variations | |
| Automation shapes / Insert Shape / Simplify; curve by `Alt`-drag | old | **Ours** — drawn graphs go further (FX Motion), automation lanes have no shape tools | |
| MIDI map / Key map with mapping browser, takeover modes | old | **Part** — MIDI learn + bindings; no key map, no takeover mode | |

### K. Browser / library

| Ableton | Since | Beacon | Notes |
|---|---|---|---|
| Filter groups + tag chips (Content, Type, Sounds, Drums, Character), auto-tags, quick tags, `#tag` search, saved labels | 12.0–12.4 | **Have** — TagFilterBar with counts, user tags, search | Close match |
| Similarity search / Show Similar Files `Ctrl+Shift+F`; similar-sample swapping in Simpler/Drum Rack | 12.0 | **No** in UI — spectral fingerprints + `track-embeddings.ts` exist | |
| Collections (colour labels), Places, packs, Cloud, Splice, Push | old/12.3 | **Part** — folders; no favourites/collections locally | |
| Preview: raw/tempo-synced, scrub, through cue out, volume | old | **Part** — audition; no tempo-sync preview | |
| Hot-swap into a device slot; search history back/forward | old/12.0 | **No** | |
| Key labels on samples (Camelot) | 12 | **Part** — `key` metadata stored | |
| Groove Pool (extract groove from clip, Base/Quantize/Timing/Random/Velocity, Global Amount) | old | **Part** — grooves bake into notes, drawn groove; no pool panel or extract-from-audio | |
| Tuning panel / tuning systems (.ascl), per-track bypass | 12.0 | **Part** — Apollo tunings only | |

### L. Settings, themes, help

| Ableton | Since | Beacon | Notes |
|---|---|---|---|
| Zoom Display 50–200 %, `Ctrl +/−` UI zoom | 12.0/12.1 | **No** | |
| Theme & Colors: Light/Dark/follow OS, Tone, High Contrast, Grid Intensity, Brightness, Intensity, Hue, colour rules | 12.0 | **Have** — Workshop theme (more freedom); no grid-intensity/tone dials | |
| Display & Input: Follow Page/Scroll, Pen Tablet, Permanent Scrub, Pitch Lock, Tab navigation | 12 | **No** equivalents | |
| Record/Warp/Launch: default warp mode, auto-warp long samples, create fades on edges, exclusive arm/solo, count-in, default launch | old | **Part** — count-in | |
| Options.txt hidden switches | old | n/a | |

## 3. What Beacon has that Live does not (do not regress)

Drawn-graph suite (amplitude, LFO shape, pitch, volume, groove, FX
Motion, per-parameter graphs, clip-effect bars); Overlays (Not loaded,
Out of key, Quiet, Silent…); UI complexity tiers; Workshop theme; voice
control and the AI tool loop; Liveblocks collaboration with soft clip
locks, comments, merge review, session recap and "My mix"; tempo map with
retempo of markers; construction-history replay; community sharing with
remix lineage; Apollo's 5-engine oscillators, 31 filters, 10 drawable
LFOs, chaos sources, aux-scaled mod routes; masking detector; spectral
morph; project-embedded presets; browser tag counts; export stems/MIDI.
Several Live gaps are best closed by *lifting Apollo pieces into Beacon*
(scope, macros, mod matrix) rather than building new.

## 4. Ranked shortlist (research verdict, not a plan)

Ranked by how often the corpus teaches it × how visible it is on screen ×
how far it is from what Beacon has. The weight in brackets is the
tutorial-corpus tier from `tutorial-corpus.md` §2 (87 rows over 49 videos
and 45 articles): **VH** = 15 or more sources, **H** = 9–12, **M/L**
below. The corpus's own "table stakes" list (§5) is: hover help with
shortcut names; a single-key vocabulary with momentary/latching keys;
defaults at device/track/set level; a browser with search, tags,
favourites and "similar"; scale highlight/fold/fit-to-scale in the note
editor; freeze/flatten and bounce in place; return tracks by default;
automation with curves, insert-shape, handle scaling, lock and typed
values; consolidate/split/insert-time; grid shortcuts; H/W fit; clip fades
on hover; warp markers with per-material modes. What creators rave about
most in Live 12 specifically: clip editor + devices + mixer visible at
once (VH 15); similarity swap inside a drum rack (VH 15); generators and
transforms living inside the clip (VH); the real-time humanize/quantize
sliders (H); paste-bounced-audio (H 12); A/B on any device.

Weights on the list below: 1 stacked views VH · 2 draw mode H · 3 mixer
strip VH (same row as 1) · 4 device visuals M (implicit in Roar/Meld VH and
device rows) · 5 knob grammar H (shortcuts VH) · 6 note lanes/tools H (scale
awareness VH, humanize/chance H, split/chop H) · 7 UI scale M (settings
lists) · 8 OTT M · 9 racks & macros VH · 10 modulators H · 11 time
commands/punch/nudge H · 12 warping VH · 13 bounce family H · 14 MIDI Tools
VH · 15 similarity VH · 16 Info View/Learn View M · 17 cue/track delay/
crossfader L.

1. **Stacked detail area at the bottom** — a fixed, resizable Clip View
   (piano roll or audio waveform with warp controls) above the Device
   View, with Clip/Device/Mixer toggles at the bottom right and
   `Shift+Tab`. This is the "wave visual at the bottom" and most of the
   "condensed" feel in one move.
2. **Draw Mode** — `B` and hold-`B`, grid-length notes, step painting,
   velocity-by-drag, pitch lock, erase-by-draw; the same pencil in the
   velocity lane and automation.
3. **Mixer in Arrangement** strip with the section show/hide menu
   (In/Out, Sends, Returns, Mixer, Track Options, Crossfader,
   Performance Impact) and the overview strip.
4. **Device visuals on Beacon's own chain** — spectrum behind the EQ and
   filter curves, compressor transfer curve + activity, a Spectrum device
   and level meters between devices; Apollo's `ScopeView` already has the
   analyser.
5. **Knob grammar** — typed entry, arrow nudge, Delete reset,
   modulation/automation ring, right-click learn.
6. **Note lanes and tools** — Chance + Velocity Deviation + probability
   groups; Invert, Reverse, Add Interval, Set Length; Split/Chop/Join;
   Fold and Fold to Scale; Find & Select.
7. **UI scale** — a Zoom Display setting (50–200 %) plus `Ctrl +/−`;
   Beacon removed per-tier zoom, so this needs a real design.
8. **OTT** — a Multiband Dynamics with upward compression, the block
   display and the preset numbers above.
9. **Racks and macros for Beacon devices** — 8–16 macro knobs with Map
   mode, Min/Max + invert, Rand, Variations; lift Apollo's macro layer.
10. **Modulator devices** (LFO / Envelope Follower / Shaper) that target
    any Beacon device parameter, drawn as the blue ring on the knob.
11. **Time commands** (Insert Silence, Cut/Paste/Duplicate/Delete Time),
    punch in/out, nudge, automation arm.
12. **Warp markers and warp modes** — the warping recipe every course
    teaches (Set 1.1.1 Here, Warp From Here, Beats/Tones/Texture/Complex).
13. **Bounce to New Track / Paste Bounced Audio / Flatten** on top of
    Freeze.
14. **MIDI Tools** — Transformations first (Recombine, Strum, Ornament,
    Connect, Span, Velocity Shaper), then Generators, with Auto-apply
    inside the loop brace.
15. **Similarity search** in the library — the fingerprint data already
    exists.
16. **Info View + Status Bar**, Learn View-style lessons with video.
17. **Cue output**, track delay, crossfader curves, scene follow actions,
    launch modes, Groove Pool panel with extract-from-audio, tuning
    panel, key/MIDI-map mode, Link.

## 4b. Second pass — what the first pass missed

Brae asked for another sweep because each pass has found more. The
second pass read the chapters the first pass leaned on least, the whole
keyboard-shortcut appendix and a "hidden features" list, and diffed the
manual's full table of contents against this file. New items live in
`second-pass.md` (grouped, with Beacon status from the code) and
`second-pass-toc-diff.md` (the chapter-by-chapter diff). The headline
additions, none of which appear above:

- **Launching**: Launch Mode Trigger/Gate/Toggle/Repeat, Legato,
  Velocity Amount, follow actions with **A/B chances**, Linked/Unlinked
  time, Jump/Any/Other, scene follow actions, Select on Launch, Capture
  and Insert Scene, add/remove stop buttons, keyboard launching, track
  status fields.
- **Recording**: exclusive arm/solo, Monitor In/Auto/Off, record-time
  quantization, step recording with arrow keys, session automation
  recording (touch vs latch), metronome only-while-recording.
- **Routing**: Resampling as an input, track-to-track Pre/Post FX/Post
  Mixer, Sends Only, per-channel MIDI routing, cue out with cue volume,
  individual outs from a drum rack.
- **Files**: Undo History panel, Save as Default Set / default track /
  default device presets, Live Clips (a clip with its device chain as a
  file), merging one Set into another, File Manager for missing/unused
  files.
- **Export dialog**: Include Return and Main Effects, Render as Loop,
  Convert to Mono, peak Normalize, Bit Depth + Dither (Triangular /
  Rectangular / Pow-r), AIFF/FLAC, MP3, Create Video, real-time render
  with auto-restart.
- **Mixer**: Split Stereo pan mode, solo with/without returns, numbered
  activators + F1–F8, multi-select faders, Assign Track Color to Clips,
  per-track Performance Impact.
- **Devices/racks**: hot-swap `Q`, Save Preset / Default Preset, Group to
  Rack, key/velocity/chain-select zones with fades, Auto Select, Drum
  Rack 128-pad view with Receive/Play/Choke and six return chains, Copy
  Value to Siblings, device delay compensation toggle.
- **Grooves**: Groove Pool parameters (Base/Quantize/Timing/Random/
  Velocity/Global Amount), Extract Groove from any clip, Commit.
- **Clip box**: Clip Activator (deactivate with `0`), Save Default Clip,
  Bank/Program change, RAM/Hi-Q/Fade toggles.
- **Automation**: Show Automated Parameters Only, selection handles
  (stretch/skew), Simplify Envelope, Insert Shape, Lock Envelopes,
  envelope copy/paste, Delete Automation per control.
- **Video scoring in the DAW**: video window, video as tempo leader,
  warp markers as hit points, Export Audio/Video.
- **Resources**: CPU meter, disk overload, Performance Impact, audio
  engine on/off, RAM mode, smart device deactivation.
- **Keyboard vocabulary**: ~29 shortcut categories including momentary
  latching (hold A/B/S/Z ~500 ms), value entry by typing, loop-brace
  keys F9–F12, view show/hide keys, focus keys `Alt+0…8`.

The chapter-by-chapter diff (`second-pass-toc-diff.md`) added these and
corrected three of the rows above:

- **Corrections**: Beacon *does* host native AU/VST3 through the Beacon
  Bridge and web plug-ins by manifest; it *does* have saved rack presets
  (a chain saved as Apollo units — still no macros, parallel chains or
  nesting); Collect All is partial — presets embed, clip audio stays as
  references, so a `.cfproj` is not self-contained.
- **Quality, not settings**: takes are recorded lossy (Opus/WebM via
  MediaRecorder) and WAV export is 16-bit without dither; Live records
  WAV/AIFF/FLAC at a chosen bit depth.
- **MIDI is input-only**: no MIDI out, no External Instrument, no
  program/bank change, no MIDI clock or MTC, no control-surface scripts,
  no relative encoders, no MPE over Web MIDI.
- **Devices never named in the first pass**: Beat Repeat (Beacon has a
  note-level voice "stutter"), Looper, Amp / Cabinet / Pedal, Drum Buss,
  Resonators, Grain Delay and Filter Delay, Vinyl Distortion, Shifter;
  MIDI effects Note Length, Pitch, Random, CC Control and Chord's Strum;
  no round-robin sampling; physical modelling is one Karplus-Strong
  guitar.
- **Audio settings**: a hidden latency override exists in localStorage
  and the input chooser recognises loopback drivers, but there is no
  output-device choice, test tone or latency readout.
- **Smaller "no" items with a manual home**: clip time signature,
  tempo-leader clip, MIDI clip crop, in-clip time commands, slip edit,
  return-track reorder, Chase MIDI Notes, per-clip send modulation, Rank
  sort, `#`/Tab renaming.
- **Accessibility**: the Knob has no role, aria attributes, tabIndex or
  key handler, so it is unreachable by keyboard or screen reader; Live 12
  made every control keyboard-navigable.
- **Keep**: whole-project MIDI export, record-N-bars, the rolling 30 s
  jam capture, the tone strip, the drum synths, Firefly/mobile as the
  Move/Note analogue.

## 5. Things the crawler could not verify (check in-app or ask)

- reddit.com and help.ableton.com blocked the fetches; the tips there
  are from search snippets only.
- View-menu ordering in `interface-and-workflow.md` §13 is compiled from
  manual references, not read from a screen.
- The OTT numbers come from a user's backed-up `.adv` (Amount may have been
  touched; every other value matches the published descriptions).
- Whether Beacon's comping supports the draw-to-comp gesture and whether
  its note preview does step entry when armed were not confirmed.

## 5b. The plan

`INTEGRATION-PLAN.md` turns every gap above and in the second pass into
twelve batches: a foundations batch (clip/track active flag, knob param
spec, one key map with momentary latching, a PCM take recorder, an
engine modulation bus, the detail-area container, per-device latency),
then the screen, Draw Mode and the note editor, the audio clip editor
and warping, session completion, arrangement/automation/bounce, mixer
and routing, devices/racks/modulation/OTT, browser/grooves/files, export
and quality, learn/settings/accessibility, and video/MIDI-out/control
surfaces as the stretch. Each batch names its files, its QA and its
first visible win; §13 there is the definition of done.

## 6. Where this fits

`research/REBUILD-PLAN.md` set the direction (Session/Arrangement as two
views of one project, locators, automation modes). These notes are the
next layer down: the editors and devices *inside* those views, at the
level of buttons and gestures. Nothing here has been built.
