# Ableton Live 12 → Beacon integration plan (2026-09-04)

Brae: "let's make a plan to integrate all of the new things that we don't
have. If we have it in a way that's missing something, then let's plan to
add the new parts."

Scope: every gap in `README.md` §2 and §4b, `second-pass.md` and
`second-pass-toc-diff.md`. A partial item lists only its missing parts.
Nothing here is built yet. Format follows `research/REBUILD-PLAN.md`:
batches = working sessions, architecture-heavy work first, each batch
ends with headless QA, a commit and a memory note.

## 0. Principles

1. **Keep the best pieces.** Drawn-graph suite, FX Motion, overlays, UI
   tiers, Workshop theme, voice + AI, Liveblocks collaboration, tempo map,
   construction-history replay, Apollo's depth, whole-project MIDI export,
   record-N-bars, the jam buffer. Where Live has the same idea in a
   different shape, the plan adds Live's *gesture* on top of ours rather
   than replacing ours (automation shapes on top of drawn graphs, Groove
   Pool over the groove templates).
2. **Lift Apollo into Beacon before building new.** Macros, the mod
   matrix, the scope/analyser, knob modulation rings, tunings and
   multisample zones already exist in `components/apps/apollo/*` and
   `lib/apollo/*`; the device-level features below reuse them.
3. **Engine first, UI second, discoverability always.** Every feature
   ships with its reducer action, engine path, palette command, help
   entry, tier, hover text, voice hook where it is speakable, and a test
   — see §12 (definition of done). "Findable, not just built."
4. **No regressions in the render path.** Anything that touches
   `lib/daw-engine.ts` scheduling (warp map, modulation bus, launch modes)
   is verified with `npm run check:determinism` and the render suites
   before it merges.
5. **Ordering principle** (as in the rebuild plan): the cross-cutting
   foundations and the engine changes go first while the most capable
   model is available; UI fill-in and device count follow.

## 1. Batch 0 — Foundations every later batch needs

These are small on their own and unlock several batches each.

| # | Foundation | Where | Why first |
|---|---|---|---|
| 0.1 | **Clip and track `active` flag** (Live's Clip Activator / Deactivate, key `0`): `active?: boolean` on `AudioClip`, `MidiClip`, `DawTrack`; engine skips inactive; arrangement draws them dimmed; reducer `SET_CLIP_ACTIVE` / `SET_TRACK_ACTIVE` | `lib/daw-types.ts:759,910`, `lib/daw-state.ts`, `lib/daw-engine.ts` scheduling, `ClipView.tsx`, `TrackRow.tsx` | "Deactivate, don't delete" is a top-tier tip; needed by B2, B4, B5 |
| 0.2 | **Param spec on the Knob**: `spec?: AutomatableParam` (`lib/daw-effect-params.ts:35`) so one popover gives typed entry, unit, curve, default; add `role="slider"`, `aria-valuenow/min/max/text`, `tabIndex`, arrow-key nudge (`Shift` = fine), `Delete` = default, right-click → MIDI learn | `components/editor/daw/Knob.tsx` (140 call sites, so the prop is optional and the 30 device/mixer sites adopt it first) | Knob grammar (B7), accessibility (B10), typed values in every batch |
| 0.3 | **Central key map** `lib/keymap.ts`: one table of `{ key, when, command, momentary? }` replacing the three keydown handlers (`AudioEditor.tsx:2614`, `ArrangementView.tsx:1289`, `PianoRoll.tsx:1264`); momentary latching (hold ≥500 ms toggles back on release — Live's A/B/S/Z/F1–F8/Tab); `HelpButton.SHORTCUT_GROUPS` and the palette read from it | new `lib/keymap.ts`, `HelpButton.tsx:41` | Every batch adds keys; `B` currently means Library, which must move before Draw Mode can take it |
| 0.4 | **PCM take recorder**: an AudioWorklet (or the `renderWav` ScriptProcessor pattern, `lib/daw-engine.ts:5001`) that writes float32 frames to a ring and produces a WAV take; `MediaRecorder` stays for the jam buffer only | `lib/daw-engine.ts:4795–4853`, new `lib/pcm-recorder.ts`, `AudioEditor.tsx:2085` (`onRecordingComplete`) | Lossless takes (B9), resampling input (B6), punch and record-quantize (B5) all need a sample-accurate take |
| 0.5 | **Modulation bus** in the engine: a `mod:` parameter namespace evaluated every scheduler tick beside `_automationLanes` (`lib/daw-engine.ts:2974`), pushing through `_applyAutomation` → `handle.setParam` (`:3001`); a per-device "modulated value" readout for the UI ring | `lib/daw-engine.ts`, `lib/daw-effects.ts:8` (`EffectHandle` gains `getParam`/`setModulated`) | Modulator devices, macros, clip modulation (B7); note the tick-rate limit — audio-rate LFOs wait for AudioParam exposure |
| 0.6 | **Detail area container**: a two-pane bottom stack (`clip` above `device`) with its own `useResizable` keys, view toggles bottom-right, `Shift+Tab` focus flip, `Cmd+Alt+3/4` show/hide, `Cmd+Alt+E` full-size | `AudioEditor.tsx:3953–4010`, `useResizable.tsx` | B1, B2, B3 all render into it |
| 0.7 | **Per-device latency** on `EffectHandle` (`latencySamples`) + chain sum + a delay-compensation toggle; Bridge plug-ins already report `getLatencyMs()` | `lib/daw-effects.ts`, `lib/beacon-plugins/bridge.ts`, `lib/daw-engine.ts:101` (`SCHEDULE_LOOKAHEAD`) | Track delay (B6), Keep Latency, bounce accuracy (B5) |

QA: unit tests for keymap resolution and momentary latching; a headless
check that `0` deactivates a clip and it is silent in `renderWav`; PCM
recorder round-trip (record a known tone → sample-exact WAV).

## 2. Batch 1 — The screen (layout, mixer strip, info, UI scale)

The items Brae saw first. Research: `video-observations.md` §1–2,
`interface-and-workflow.md` §1–3, §14; releases §2.7.

1. **Clip View pane** (in the detail container): hosts `PianoRoll` /
   `StepSequencer` for MIDI clips and the new audio Sample Editor (B3)
   for audio clips; selection follows the selected clip; move
   `PianoRoll` out of `TrackRow.tsx:2337` (keep the inline mode as a
   Display setting "Clip editor: bottom pane / inline" for a release, then
   retire inline). Tabs top-right: Notes | Envelopes | Expression (the
   Envelopes tab shows the clip's drawn graphs and clip-effect bars —
   ours — plus clip envelopes from B5).
2. **Device View pane** below it: the existing `DeviceChain` with level
   meters between devices (B7 fills the visuals).
3. **Mixer in Arrangement**: embed `Mixer` in a height-bounded wrapper
   under the arrangement with a **section drop-down** (In/Out, Sends,
   Returns, Mixer, Track Options, Crossfader, Performance Impact) stored
   per view; make `ChannelStrip`/`ReturnChannelStrip` exportable
   (`Mixer.tsx:156/594`); `Cmd+Alt+M`. Arrangement track headers gain the
   input chooser, monitor, numbered activator, volume field, pan, meter
   (what Live calls Arrangement Track Controls).
4. **Overview strip** above the arrangement (minimap with a zoom box,
   drag to scroll/zoom, double-click fits) — `ArrangementView.tsx`
   header; **Follow** (Page / Scroll) with pause-on-edit; **H / W**
   optimise height/width; the **waveform vertical zoom** slider gains a
   ×/dB toggle.
5. **Info View + Status Bar**: bottom-left hover text for every control
   with a `data-help-id` (reuse `HelpButton.FEATURES` text) + **Edit Info
   Text** on tracks/clips/devices (`infoText?: string`); bottom-right
   status readout of the selection (start/end/length in bars and time).
6. **UI scale ("Zoom Display")**: a root font-size/token scale 50–200 %
   applied through CSS custom properties and `rem`, *never* CSS `zoom`
   (pointer math, `lib/ui-tiers.ts:119`); `Cmd +/−` and a slider in the
   Appearance panel's new **Display & Input** section (B10 fills the rest).
7. **Second window** for the mixer or clip view (`window.open` +
   `PopOut.tsx` pattern already used by Apollo) — last in the batch.

QA: headless — open a project, assert the clip pane shows the selected
clip's notes and the device pane its chain at once, the mixer strip
toggles sections, H/W fit, follow scrolls; `contrast-check`-style
assertions that the strip and info view use theme tokens; `inventory`
shows the new controls reachable from the palette.

## 3. Batch 2 — Draw Mode and the note editor

Research: `midi-and-clip-view.md` §2–§15, video-observations §3, §6.

1. **Draw Mode**: `B` toggles, hold-`B` momentary (keymap 0.3); click =
   grid-length note; horizontal drag = one note per grid step; vertical
   drag while drawing = velocity; next note inherits last velocity;
   drawing back over notes erases; **Pitch Lock** setting + `Alt` flip;
   the same pencil draws in the velocity and chance lanes and in
   automation (steps as wide as the grid). Library toggle moves off `B`.
2. **Lanes** under the note editor with a lane selector: Velocity (exists)
   + **Velocity Deviation** (`deviation?`), **Release Velocity**, **Chance**
   (`chance?: number` on `MidiNote`, engine rolls per trigger — Apollo's
   `ClipNote.chance` is the model), **Probability Groups** (Play All /
   Play One, `Cmd+G`), Randomize + Amount + Ramp sliders under the lane;
   type `0–127` velocity, `Cmd+↑↓`, `Cmd+Shift+↑↓` deviation,
   `Cmd+Alt+↑↓` chance.
3. **Fold** (`F`), **Highlight Scale** (`K`), **Fold to Scale** (`G`),
   **Focus** (`N`); note preview toggle → **step entry** when the track
   is armed (arrow keys advance the insert marker).
4. **Pitch & Time utilities** completed: Invert, Reverse, Add Interval
   (with Interval Size), Stretch knob, Duration chooser + Set Length,
   Humanize Amount; Transpose in scale degrees when scale is on.
5. **Note operations**: Split (`E`-drag, `Cmd+E`), Chop (`Cmd+E` on a
   selection, ±parts), Join (`Cmd+J`), Fit to Time Range (`Cmd+Alt+J`),
   Deactivate note (`0`), stretch markers with the pseudo marker and
   mirror; overlap rules; **Find & Select** filters (pitch, time, chance,
   condition, count, duration, scale, velocity) with Invert.
6. **Quantize dialog** (`Cmd+Shift+U`): start/end/both, grid incl.
   triplets, Amount %; keep `Q` as quantize.
7. **Loop brace ops**: Set Start/End buttons, `Cmd+D` **Duplicate Loop**,
   F9–F12, arrow ops, Run Into Loop.
8. **Multi-clip editing** (up to 8 clips with coloured loop bars) +
   Focus semantics; **MIDI clip crop** and **in-clip time commands**
   (insert/delete/duplicate time inside the clip); **clip time
   signature**.
9. Keyboard-only editing map from the manual's Accessibility chapter.

QA: `voice-commands`-style fixture tests for every operation on a known
clip (invert/reverse/add-interval/chop/join produce exact note sets);
headless: draw a bar of 16ths with the pencil and read them back via
`__dawProject()`; chance renders statistically (many renders, count
triggers).

## 4. Batch 3 — The audio clip editor and warping

Research: `midi-and-clip-view.md` §16, video-observations §2, corpus
"warping" (VH), `second-pass-toc-diff.md` ch. 9.

1. **Sample Editor pane** (Clip View for audio): full-width waveform,
   loop brace, Start/End/Position/Length, Sample/Envelopes tabs, and the
   clip panel: Warp on/off, warp mode, **Seg BPM** with ÷2 ×2, Gain fader
   (dB), Pitch (st) + Detune (ct), Reverse, Fade toggle, RAM/Hi-Q (Hi-Q
   maps to our resampler quality; RAM is n/a), **Save Default Clip**
   (per-sample defaults keyed by library id — the `.asd` idea), sample
   details (rate, bit depth, channels, length).
2. **Warp markers + transient markers**: `warpMarkers: {beat, sampleTime}[]`
   on `AudioClip`; engine builds a piecewise beat→source map and either
   segments one `AudioBufferSourceNode` per span or pre-renders one WSOLA
   buffer from the map (`lib/daw-engine.ts:3211–3274`; cache key from the
   marker list, `stretchedBufferCache:238`); transient detection from
   `lib/voice/onsets.ts:56` (move it to `lib/onsets.ts`; the ClipView
   detector becomes a caller); context commands **Set 1.1.1 Here**, **Warp
   From Here (Straight / Start)**, **Warp N Bars From Here**, **Warp as
   N-Bar Loop**, **Quantize** audio, pin neighbours with `Cmd`-drag,
   `Cmd+I` insert marker, `Cmd+Shift+I` insert transient.
3. **Warp modes**: Re-Pitch (= resample, exists), Complex (= WSOLA,
   exists — rename), **Beats** (transient-sliced with Preserve
   Transients/Beats and the Transient Envelope/Loop-off gate), **Tones**
   (WSOLA with a larger grain and pitch-tracking window), **Texture**
   (granular via Apollo's granular engine, Grain Size/Flux), Complex Pro
   with Formants (phase-vocoder — last, optional).
4. **Clip tempo leader** (a clip's own tempo drives the set; video uses
   it in B11); Loop/Warp Short Samples setting (one-shot vs loop on
   import).
5. **Slice to New MIDI Track** (dialog: transient / 1/16 / warp markers →
   a drum track with pads from the slices); **Convert Harmony / Melody /
   Drums to MIDI** as clip commands wrapping `lib/audio-to-midi.ts`;
   **Extract Groove** to the Groove Pool (B8).
6. **Slip edit** (`Shift+Alt`-drag the waveform inside the clip), **Crop**
   (`Cmd+Shift+J`), clip **Edit** in the spectral editor, multi-clip
   property editing (gain/warp/launch across a selection —
   `ClipSettingsModal` becomes multi-clip).

QA: warp a drum loop with two markers and assert onset positions in
`renderWav` land on the grid; Beats mode gate test; slice-to-MIDI count
equals detected transients; determinism check.

## 5. Batch 4 — Session view completion

Research: `second-pass.md` A, manual ch. 16, corpus rows 39/41.

1. **Launch modes** per clip: Trigger / Gate / Toggle / Repeat; **Legato**
   (inherit the playing clip's position — `_launchSessionSlot` computes
   the offset); **Velocity Amount**; launch offset **nudge** on a running
   clip. Types at `lib/daw-types.ts:809/964` (both clip shapes — add a
   shared `LaunchSettings` type instead of duplicating), engine
   `queueSession*`/`_sessionTick` (`lib/daw-engine.ts:1604–1625,1918`).
3. **Follow actions** moved into the engine (`SessionView.tsx:259` today):
   actions A and B with **Chance A/B**, Linked/Unlinked + Follow Action
   Time, Jump (target), Any, Other, Play Again; **Enable Follow Actions
   Globally**; `Shift+Enter` toggle, `Cmd+Shift+Enter` create a chain;
   **scene follow actions** (Unlinked/Longest) in a **Scene View** panel.
4. **Housekeeping**: Select on Launch, Select Next Scene on Launch, Start
   Recording on Scene Launch, Clip Record buttons in empty armed slots,
   **Add/Remove Stop Button** (`Cmd+E`), **Capture and Insert Scene**
   (`Cmd+Shift+I`), Insert Scene (`Cmd+I`), select all clips in a scene,
   drop browser clips as a scene, narrow track width.
5. **Track Status fields** (what is playing, remaining loops), keyboard
   launching (Enter, arrows, Page Up/Down, `Ctrl+Enter` stop track, `0`),
   the **New** button for key/MIDI-mapped sets.
6. **Crossfader UI** in the session mixer (types exist, no UI — `Mixer.tsx`
   has zero hits) with A/B assign per track and the seven curves.

QA: scripted performance in the headless engine — gate mode stops on
release, toggle alternates, legato keeps position, A/B chances converge
to their ratio over 200 launches; capture-and-insert scene reproduces the
running set.

## 6. Batch 5 — Arrangement, transport, automation, bounce

Research: `interface-and-workflow.md` §1, §3; `second-pass.md` B, J;
manual ch. 6, 19, 25; corpus rows 7, 10, 21, 40.

1. **Time commands**: Insert Silence (`Cmd+I`), Cut/Copy/Paste/Duplicate/
   Delete Time (`Cmd+Shift+X/C/V/D/Delete`) across all tracks incl.
   automation, sections and markers (tempo-map aware); **Crop** clip;
   Enter+arrows resize; `Shift+Space` continue, `Cmd+Space` stop at
   selection end, `Cmd+Shift+Space` marker to playhead.
2. **Punch in / out** on the loop brace; **Nudge ±** on the control bar;
   **Record Quantization** (record-time) menu; metronome **Enable Only
   While Recording**, sound and rhythm choices; count-in shown as
   negative bars.
3. **Automation recording**: **Automation Arm** in the control bar; touch
   (mouse) vs latch (MIDI) semantics; **Session automation recording**
   (armed / all playing clips); automation LEDs on automated controls;
   **Delete Automation** per control (`Cmd+Backspace`) and per-parameter
   Re-Enable; **Show Automated Parameters Only**; hide lane without
   deactivating.
4. **Envelope editing**: multi-point selection + marquee in
   `AutomationLaneView.tsx`; **selection handles** (stretch vertically/
   horizontally, skew, mirror with `Alt`); **Insert Shape** (sine,
   triangle, saw, inverse saw, square, ramps, ADSR — generated from the
   drawn-graph curve primitive so our graphs and lanes share one editor);
   **Simplify Envelope**; **Lock Envelopes**; Edit Value dialog; copy/paste
   envelopes between parameters and time ranges; keyboard breakpoint
   editing; **tempo ramps** (Song Tempo lane with range boxes) on top of
   the tempo map.
5. **Linked-track editing** (edits on one track apply to its linked set).
6. **Bounce family**: Bounce to New Track (`Cmd+B`, post-FX/pre-mixer,
   source deactivated via 0.1), Bounce Track in Place (freeze + flatten),
   Bounce Group, **Paste Bounced Audio** (`Cmd+Alt+V`, into take lanes
   too), **Flatten** as a command beside Freeze; **stem separation** UI
   command over `lib/hpss.ts` (vocals/drums/bass/other into a group,
   original deactivated; merge selected stems; speed vs quality).
7. **Naming and notes**: `Cmd+R` rename with Tab to the next track, `#`
   auto-numbering, Edit Info Text; **Undo History** panel from
   `UndoEntry.label/group` (`lib/daw-undo.ts:150`), `Cmd+Alt+Z`.
8. Global quantization keys `Cmd+6…0`; grid keys `Cmd+1…5`.

QA: time-command round-trips on a fixture (insert then delete restores
the project byte-for-byte); punch renders only the brace; bounce-to-new-
track equals `renderWav` of the source; shapes produce the expected
point sets; Undo History lists grouped voice requests as one row.

## 7. Batch 6 — Mixer and routing

Research: `second-pass.md` C, F; manual ch. 17, 18; corpus rows 18–20,
56–57, 64.

1. **Pan modes**: Stereo Pan (exists) + **Split Stereo Pan** (two
   `GainNode`s per side replacing the single `StereoPannerNode`,
   `lib/daw-engine.ts:3910`); mono bass/width live in Utility already.
2. **Exclusive Arm / Exclusive Solo** settings; `Cmd`-click to add;
   solo in place; solo with/without returns; sends on returns; disable
   sends; **multi-select faders** move together (`selectedTrackIds`
   exists, `TrackRow.tsx:818`).
3. **Monitor In / Auto / Off** per track (0.4 recorder); **input choosers**:
   Ext. In (device + channel pair, mono/stereo conversion), **Resampling**
   (main bus tap), any track **Pre FX / Post FX / Post Mixer**
   (`_routeTrackOutput`, `:971`), No Input; **outputs**: Main, Sends Only,
   any track, No Output; **per-channel MIDI routing** between tracks;
   **Drum Rack individual outs** (B7) route to tracks.
4. **Cue output**: a cue bus (second gain + `MediaStreamDestination` →
   `<audio>` with `setSinkId`) with Cue Out chooser, Solo/Cue switch,
   Cue Volume; library preview through cue.
5. **Track delay** (ms, needs 0.7), **Keep Monitoring Latency**,
   **Performance Impact** (per-track render cost from the engine's
   per-tick timing) and a control-bar **CPU meter** (average/current) +
   "loading/disk" indicator from the server-loading state.
6. **Numbered activators** + F1–F8, **Assign Track Color to Clips**, group
   solo half-lit, return reorder/duplicate, sidechain input on Gate,
   Multiband, Auto Filter (B7), meters with input while monitoring,
   numeric peak field, clip LED, reset.

QA: split-pan renders L/R independently; resampling records the master;
cue preview does not reach the main render; exclusive solo/arm state
machine tests; latency compensation aligns a delayed device to sample
accuracy.

## 8. Batch 7 — Devices, racks, modulation, visuals, OTT

Research: `devices-modulation-visuals.md` §1–§5; `second-pass.md` G;
`second-pass-toc-diff.md` ch. 23–24, 28–30, 32.

1. **Device title bar**: activator (exists), **fold** (double-click),
   **hot-swap** (`Q`, browser filtered to this device's presets), **Save
   Preset** / **Save as Default Preset** (per device type; Defaults also
   for new audio/MIDI tracks and drum racks), **A/B compare** (`P`, two
   parameter sets, Copy A→B), **Show Options**, expanded-view toggle,
   **sidechain header** with source picker (extend
   `CompressorParams.sidechainTrackId` to Gate, Multiband, Auto Filter),
   scale-aware toggle on the MIDI effects, right-click Device View
   selector → device tree.
2. **Racks**: `type: 'rack'` effect holding **chains** (parallel, each a
   sub-chain with activator/solo/hot-swap/volume/pan), **chain selector**,
   **Key / Velocity / Chain-Select zones with fades** (instrument racks;
   Poly layers get key/velocity ranges), **Auto Select**, **Group to Rack**
   (`Cmd+G`) / Ungroup / Extract Chain, nesting, **rack presets** (extend
   the existing Factory/Saved racks, `DeviceChain.tsx:1802`), chains shown
   in the mixer. **Macros** 8–16 with **Map mode** overlays, mapping
   browser Min/Max + invert, names/colours, **Rand** with exclusions,
   **Variations** (New/Launch/Overwrite/Delete) — lifted from Apollo's
   `MacroPanel` (`components/apps/apollo/MacroPanel.tsx`).
3. **Modulator devices** on the 0.5 bus: LFO, Shaper (drawn — reuse
   `MotionCurve`), Envelope Follower, Envelope MIDI, Expression Control,
   MPE Control; up to 8 targets; **Mod** (relative, knob stays adjustable)
   vs **Remote** modes; the knob draws a **blue modulation ring** and a
   **red automation ring**; clip **modulation** envelopes (relative,
   scaled, unlinked loop = LFO) beside clip automation in the Envelopes
   tab; map macros/modulators to Apollo params through the existing
   `apollo:` namespace.
4. **Device visuals** (from Apollo's `ScopeView` analyser): spectrum
   behind the EQ3 / Dynamic EQ / Filter / Auto Filter curves; EQ band
   audition + Adaptive Q; Compressor **transfer curve + activity view**;
   gain-reduction meters on Glue-style, Limiter, Multiband, Gate (level
   history with a draggable threshold); Saturator curve with live level;
   Erosion-style spectrum on Redux; **Spectrum** device; **Tuner** device
   (strobe/histogram from `PadTuner`); level meters between devices; dry/
   wet on every generic device; MIDI meters flash on per-note data.
5. **OTT**: Multiband Dynamics gains **upward compression** (Below
   threshold/ratio per band), the **block display** (edges = threshold,
   middles = ratio, `Cmd` = all bands, `Alt` = both blocks, `Shift` =
   fine, double-click reset), T/B/A column, **Time** and **Amount**
   scalers, Soft Knee, RMS/Peak, and the **OTT preset** with the numbers
   in `devices-modulation-visuals.md` §2.3.
6. **Missing devices** (order by corpus weight): Beat Repeat, Looper
   (overdub/feedback, performance-mapped), Drum Buss (drive/crunch/boom/
   transients), Vinyl Distortion, Resonators, Grain Delay, Filter Delay,
   Shifter (pitch/frequency shift with LFO + follower), Amp / Cabinet /
   Pedal, Echo-style delay with modulation tabs, Vocoder, Corpus, Hybrid
   Reverb (IR + algorithmic; our Convolve exists), Spectral Time /
   Spectral Resonator (Apollo's spectral engine), Auto Pan-Tremolo modes
   (16th/triplet/dotted, attack shape), Auto Filter's Comb / Notch+LP /
   Resampling / Dispersion modes + stereo LFO + envelope follower +
   sidechain EQ.
7. **MIDI effects**: Note Length, Pitch, Random, CC Control, Note Echo,
   MIDI Monitor; **Chord** gains Strum / Tension / Crescendo / Learn;
   **Arpeggiator** pattern display + scale awareness; **record a MIDI
   effect's output into a clip**; **Expressive Chords**-style device
   (chord bank + Tilt / Invert / Strum articulation / randomise).
8. **Drum instrument**: 128-pad **Pad View** with Pad Overview (groups
   of 16), per-pad **Receive / Play / Choke**, 16 choke groups (have),
   pad mute/solo/hot-swap, **six return chains** with sends, Copy Value
   to Siblings, **similar-sample swap** (`Cmd+←→`, B8), individual outs;
   **Simpler modes** Classic / One-Shot / Slice (Apollo `sliceMap`);
   **round-robin** in the sampler; Impulse-style per-slot stretch/filter/
   saturation.
9. **Device delay compensation** toggle (0.7); smart deactivation of idle
   devices (skip processing when the input is silent, tails excepted).

QA: modulation ring reads back the modulated value; OTT preset renders
within 0.5 dB of a reference; each new device has a `fx-audit` entry and
a render snapshot; racks: a two-chain rack sums to the sum of its chains;
macro variation recall is exact.

## 9. Batch 8 — Browser, grooves, tuning, files

Research: `interface-and-workflow.md` §7, §9; `second-pass.md` D, H, N;
`second-pass-toc-diff.md` ch. 4–5, 14.

1. **Show Similar** (`Cmd+Shift+F`) on any library row using
   `spectralDistance`/`hitToVec` (`lib/beat-analyzer.ts:312/391`, unused
   today) over `libraryGetAll()`; **Similar Sample Swapping** in drum pads
   and the sample preset (`Cmd+←→`, save/return to reference); CLAP
   embeddings for user samples remain the later, offline job.
2. **Collections** (colour labels 1–7) and Favourites in the local
   library; **hot-swap into a device slot**; browser **history**
   (`Cmd+[ ]`); **Rank** / date / size sort; **Current Project** place;
   keyboard: `Cmd+F` then Enter loads, Shift+Enter previews; preview
   **tempo-synced** and through **cue**; Raw toggle; **key labels**
   (Camelot) in rows from the stored `key`.
3. **Groove Pool** panel (`Cmd+Alt+6`): Base, Quantize %, Timing %,
   Random %, Velocity ±100, **Global Amount** to 130 %; groove chooser +
   hot-swap + **Commit** on the clip; **Extract Groove** from any audio/
   MIDI clip (`lib/voice/onsets.ts`); non-destructive application in the
   engine at note-scheduling time (today's templates bake — keep bake as
   Commit). Grooves on audio clips through warp markers (B3).
4. **Tuning panel**: `.ascl`/Scala import, Set-level tuning, per-track
   bypass, hides scale controls — Apollo's `lib/apollo/tuning.ts` as the
   engine.
5. **Files**: **Save as Template** / **Default Set** / default track /
   default device presets; **Live Clip** equivalent (a clip *with* its
   device chain as a library item; drag out to save, drag in to
   recreate); **merge a project into the open project** (drag a `.cfproj`
   from the library: tracks, returns, master devices, grooves); **File
   Manager** (missing files → Locate/auto-search, unused files, "this
   project" view — the "Not loaded" overlay is the seed); **Collect All**
   = a self-contained `.cfproj` export (audio embedded, via
   `lib/project-serializer.ts:194`); Save a Copy / named versions.
6. **Splice** and **Search with Sound** — partnership work, out of scope;
   note only.

QA: similar-search returns the same-kit hats above other kits on a
fixture; groove extract → commit reproduces the source timing within
1 ms; merged project keeps ids unique; a collected `.cfproj` opens
offline with every clip loaded.

## 10. Batch 9 — Export and audio quality

Research: `second-pass.md` E; `second-pass-toc-diff.md` ch. 5, 19, 38.

1. **Lossless takes** (0.4) stored as WAV in the library with the chosen
   **bit depth** (16/24/32f); the jam buffer stays Opus.
2. **WAV encoder** to 24-bit and 32-bit float with **dither**
   (Triangular / Rectangular / Pow-r-style noise-shaped) in
   `lib/wav-codec.ts`; **FLAC** and **AIFF** encoders; **MP3** (CBR 320)
   via a small encoder library.
3. **Export dialog**: Rendered Track (Main / All Individual Tracks /
   Selected Tracks / one track), **Render Start/Length** from the
   selection, **Include Return and Main Effects**, **Render as Loop**
   (two-pass tail wrap), **Convert to Mono** (engine has it), **peak
   Normalize** (and keep LUFS normalise as an option), sample rate, PCM
   format/bit depth/dither, MP3, **Create Video** (hand to Prism's
   exporter with the mixdown), real-time render with **Auto-Restart on
   drop-outs**; unify stems on `renderWav({stems:true})` instead of the
   MediaRecorder taps (`AudioExportModal.tsx:165`).
4. Import: Loop/Warp Short Samples default, Auto-Warp Long Samples,
   Create Fades on Clip Edges (4 ms) defaults (B10 settings).

QA: bit-exact export of a known signal at each depth; dither noise floor
measured; render-as-loop tail continuity; stems sum to the master within
−60 dB.

## 11. Batch 10 — Learn, settings, accessibility, resources

Research: `interface-and-workflow.md` §12, §14; `second-pass.md` L, M;
manual ch. 2, 37, 40, 41.

1. **Settings** (in `AppearancePanel` → rename "Settings" with tabs):
   **Display & Input** (Zoom Display, Follow Page/Scroll, Pen Tablet
   Mode, Permanent Scrub Areas, Draw with Pitch Lock, Use Tab to Move
   Focus, arrow keys move clips, show UI labels, restore dialogs);
   **Theme & Colors** (exists; add Grid Line Intensity, Tone, High
   Contrast, colour rules); **Audio** (input device exists; **output
   device** via `setSinkId`, buffer/latency hint surfaced from the hidden
   `100l.latency`, latency readout, **Test Tone**, CPU meter mode);
   **Record, Warp & Launch** (file type/bit depth, count-in, exclusive
   arm/solo, record session automation, start playback with record,
   short-sample warp, default warp mode, create fades, default launch
   mode/quantization, select on launch); **Library** (collect on export,
   folders); MIDI ports (B11).
2. **Learn View**: lessons with embedded video (pop-out picture-in-
   picture), text and progress, on the existing tutorials + StudioGuide;
   `Cmd+Alt+7`.
3. **Accessibility**: Knob role/aria/tab/keys (0.2) rolled out to every
   control; **focus keys** `Alt+0…8` between Control Bar / Session /
   Arrangement / Clip / Device / Browser / Groove Pool / Learn; Tab-to-
   move-focus; keyboard breakpoint editing; "Speak" options where the
   platform allows.
4. **Resources**: CPU meter (average/current/off), loading indicator,
   per-track Performance Impact (B6), **audio engine on/off**, RAM mode
   per clip (decode ahead), smart device deactivation (B7), multi-thread
   rendering note: Helios DSP in a Worker is the real fix for freeze
   stalls (memory: freeze blocks main thread).
5. **Menus**: a menu bar or a searchable menu (`Cmd+?`) listing every
   command with its key, generated from `lib/keymap.ts` + the palette.

QA: settings round-trip through localStorage; every `Knob` passes an
axe-style role/aria check; focus keys land where they should; Learn View
opens a lesson and marks it complete.

## 12. Batch 11 — Video scoring, MIDI out, control surfaces (stretch)

1. **Video in the DAW**: import `.mov`/`.mp4` to an arrangement track with
   a floating **Video Window** (full screen, second monitor), the video
   clip as **tempo leader**, **warp markers as hit points**, sprocket-hole
   clips, Consolidate/Reverse/Crop drop to audio, Export Audio/Video.
   Reuse Prism's decoder/compositor; the DAW-mix link already goes the
   other way.
2. **MIDI out** through Web MIDI: per-track MIDI To (port + channel),
   **program/bank change** per clip, **MIDI clock** out, an **External
   Instrument** device (MIDI out + audio in from a loopback/Bridge input
   with latency compensation), MPE over Web MIDI, **relative encoders**
   and note-as-button mapping, Takeover modes.
3. **Control-surface scripts**: Launchpad/APC-style session ring ("red
   box"), device control, transport mapping; **Push**-style note repeat.

QA: video hit point aligns a downbeat to a frame; MIDI clock jitter
measured against a loopback; Launchpad script drives the session grid in
a headless MIDI simulation.

## 13. Definition of done (every batch)

- Reducer action(s) in `lib/daw-state.ts` + engine path + migration in
  `lib/schema-version.ts` when the project shape changes.
- `useRegisterCommands` entry (label + keywords) and a row in
  `scripts/check-discoverable.mjs` `EXPECTED` **before** building.
- `data-help-id` on every new control; `HelpButton.FEATURES` +
  `SHORTCUT_GROUPS` (generated from `lib/keymap.ts` after 0.3); Info View
  text; `ELEMENT_MIN_TIER` tier for anything non-essential; tutorial step
  where a beginner would meet it.
- Theme tokens only (`--accent-contrast` on accent fills; see the
  contrast check); mobile/desktop parity flagged rather than silently
  diverged.
- Voice: if speakable, a `MUSIC_TOOLS` tool + `planVoiceCall` case +
  local rule + `COMMAND_SUMMARIES` entry + contract probe; verify on the
  real path (`__lightHear`) or say "unit-tested only".
- Tests: a `scripts/apollo-tests/*.test.mjs` appended to the
  `test:apollo` chain, a headless `.claude/*-check.mjs` that drives the
  real UI/engine, and `npm run check:discoverable && npm run inventory
  && npm run check:determinism` green.
- Commit → push `apollo` → PR into `main` (Brae merges) → fast-forward →
  memory note.

## 14. Effort and order at a glance

| Batch | Size | Depends on | First user-visible win |
|---|---|---|---|
| 0 Foundations | M | — | `0` deactivates a clip; typed values on knobs |
| 1 The screen | L | 0.3, 0.6 | clip + devices + mixer on one screen |
| 2 Draw Mode & notes | L | 0.1, 0.3 | `B` pencil, chance lane |
| 3 Audio clip editor & warp | XL | 0.6 | warp markers, Beats mode |
| 4 Session | M | 0.1 | gate/toggle launch, A/B follow actions |
| 5 Arrangement & automation & bounce | L | 0.1, 0.4, 0.7 | time commands, bounce to new track, Undo History |
| 6 Mixer & routing | L | 0.4, 0.7 | resampling input, split pan, cue |
| 7 Devices & racks & OTT | XL | 0.2, 0.5 | spectrum behind the EQ, OTT, macros |
| 8 Browser, grooves, files | L | — | Show Similar, Groove Pool, templates |
| 9 Export & quality | M | 0.4 | 24-bit dithered WAV, MP3, render as loop |
| 10 Learn, settings, a11y | M | 0.2, 0.3 | Zoom Display, Learn View |
| 11 Video, MIDI out, surfaces | XL | 3, 6 | score to picture |

Sizes: M = one session, L = two, XL = three or more.

## 15. Risks and constraints to design around

- **Main thread**: offline renders and Helios DSP already stall paint
  (memory: freeze blocks main thread). The warp map, modulation bus and
  device visuals must not add per-frame main-thread work; analysers
  downsample and paint at ≤30 fps; consider the Worker move before B7's
  visuals land on every device.
- **Machine memory**: batches that need the dev server plus headless
  browsers should run one at a time (renders were killed for memory
  this week).
- **Pointer math**: UI scale via tokens/`rem`, never CSS `zoom`.
- **Two clip shapes**: `AudioClip` and `MidiClip` duplicate launch
  fields; introduce shared sub-types before adding more.
- **Follow actions in React**: move to the engine before adding chance,
  or timing will drift.
- **Two stem paths** in export; unify on `renderWav` before adding
  options.
- **`B` and `F` keys** are taken (Library, Fit); the keymap batch
  reassigns with a one-release notice in the Help panel.
- **Tiers**: default new pro-level controls to `intermediate` or `full`
  so Simple stays simple; the stacked detail area itself is Standard.
- **Voice coverage** grows with every batch; the contract test enforces
  probes, and the local rules need examples for the new verbs (launch
  mode, warp, bounce, groove).
