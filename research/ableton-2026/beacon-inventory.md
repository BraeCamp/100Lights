# Beacon feature inventory (from code, 2026-09-04)

Produced by a read-only sweep of the repository so the Ableton notes in this
folder can be diffed against what Beacon actually has. File paths are the
evidence; "NOT found" means the sweep looked and did not find it.

## 1. Views & layout

**Exists**
- **Three views** — `session | arrangement | mixer` (`DawView` in `lib/daw-types.ts:1081`), switched in `components/editor/AudioEditor.tsx` (`data-help-id="view-*"`, commands `audio.view.session/arrangement/mixer`). Implementations: `components/editor/daw/SessionView.tsx`, `ArrangementView.tsx`, `Mixer.tsx`.
- **Session view**: clip grid + scenes, per-track stop, Stop All, launch/queue indicator, crossfader A/none/B per track, Session Record (all armed), **Capture to Arrangement**, **MIDI Overdub**, "Back to Arrangement", scene tempo/meter (`Scene.tempo/timeSignatureNum/Den`), record-N-bars buttons (`SessionView.tsx:609,1038,1050,1063,1086,1094`).
- **Arrangement view**: ruler with bars from the meter map, sections/arranger lane, tempo markers, comments, take lanes, clip-effect (FX) lane rows, marquee select, ripple edit, snap.
- **Mixer**: per-track strip with 4-band tone EQ + drawable EQ curve, volume/pan knobs, M/S, arm, sends, MIDI-learn on the fader, LevelMeter, return strips (A/B…), MASTER strip (`Mixer.tsx:161-177,339,471-578,613-704`).
- **Piano roll** — `components/editor/daw/PianoRoll.tsx`, rendered inline under the track row (not a fixed bottom pane). **Step sequencer** alternative — `StepSequencer.tsx`.
- **Bottom detail panel** — appears when a track/return is selected; tabs **Devices** / **Instrument** (`data-help-id="bottom-devices"/"bottom-instrument"`), plus a Pads toggle, resizable via `useResizable.tsx` (`AudioEditor.tsx:~3955-4005`). The Apollo rack can be **popped out into an OS window** (`PopOut.tsx`, `AudioEditor.tsx:~3930`).
- **Left sidebar + icon rail** — tabs `library` (Sound Library) and `code` (`PolyCodePanel`); podcast mode swaps in `setup/episode/guests`. Toggle with **B** (`AudioEditor.tsx:3655-3707`; command `audio.library`, `audio.view.sidebar`).
- **UI complexity tiers** — **`lib/ui-tiers.ts`** (NOT `lib/editor-types.ts`; that file is the *video* editor's types). `UITier = 'beginner'|'intermediate'|'full'` labelled **Simple / Standard / Everything**, `ELEMENT_MIN_TIER` gates by `data-help-id`/`data-ui-el` via generated CSS (`tierVisibilityCss`). Gated ids: `snap, time-sig, tap-tempo, fx-lane, capture, versions, view-mixer, view-session, automation` (intermediate); `key-scale, jam, perf-fx, swing, varispeed, tuner, masking, ripple, split-transients, morph, wf-zoom, sound-code, my-mix, takes, add-return, inspect, duplicate-cleanup` (full). Provider: `components/editor/UITierProvider.tsx`; switcher: `daw/UITierSwitcher.tsx`. A separate **"graphs" UI dimension** toggle lives in `lib/draw-graphs.ts` (`GRAPHS_LS_KEY`).
- **Workshop theme / customisation** — `lib/workshop-theme.ts` + `components/editor/WorkshopThemeProvider.tsx` + `daw/AppearancePanel.tsx`. Theme colour tokens, background patterns (`PATTERN_TYPES`), track palette, contrast warnings, import/export, user presets, 5 built-ins (Studio Gray, Midnight Purple, Sunset, Forest, Mono). Command `audio.view.appearance` "Change the studio's colours".
- **Zoom** — horizontal beat-width zoom in/out + **Fit to window** (`F`) in Arrangement (`data-help-id="zoom-in"/"zoom-out"/"fit-window"`, `ArrangementView.tsx:1497-1499`); piano-roll zoom in/out + **vertical row zoom** (⌥-scroll); **waveform vertical zoom** 1–8 (`SET_WAVEFORM_ZOOM`, `data-help-id="wf-zoom"`). `lib/ui-density.ts` exists for density. A per-tier CSS `zoom` was deliberately removed (comment in `lib/ui-tiers.ts`).
- **Command palette** — `components/editor/CommandPalette.tsx`, registry `lib/commands.ts` (`registerCommands` / `useRegisterCommands` / **`listCommands()`**), fuzzy ranking `lib/command-palette.ts` (`scoreCommand`/`rankCommands`). Open **⌘K / Ctrl-K**, fallback **⌘⇧P**.

**Every command id + label found** (all registrations: `AudioEditor.tsx`, `daw/Transport.tsx`, `daw/Mixer.tsx`, `daw/PianoRoll.tsx`, `daw/SessionView.tsx`, `ProjectEditor.tsx`):

| id | label | group |
|---|---|---|
| `audio.save` | Save (⌘S) | Audio |
| `audio.view.session` | Switch to Session view | Audio |
| `audio.view.arrangement` | Switch to Arrangement view | Audio |
| `audio.view.mixer` | Switch to Mixer view | Audio |
| `audio.library` | Open Sound Library (B) | Audio |
| `audio.transport.play` | Play / stop (Space) | Audio |
| `audio.transport.top` | Go to start | Audio |
| `audio.track.add` | Add track | Audio |
| `audio.freeze` | Freeze synth tracks to audio (faster playback) | Sound |
| `audio.thaw` | Unfreeze — back to editable synth clips | Sound |
| `audio.track.mute` | Mute/Unmute *{track}* | Track |
| `audio.track.solo` | Solo/Unsolo *{track}* | Track |
| `audio.track.apollo` | Edit *{track}* in Apollo | Sound |
| `audio.transport.loopClip` | Loop over the selected clip | Transport |
| `audio.transport.metronome` | Turn on/off the metronome | Transport |
| `audio.transport.end` | Go to the end of the song | Transport |
| `audio.transport.toClip` | Go to the selected clip | Transport |
| `audio.edit.undo` / `audio.edit.redo` | Undo / Redo | Edit |
| `audio.edit.selectAll` | Select every clip | Edit |
| `audio.edit.deselect` | Deselect everything | Edit |
| `audio.edit.deleteClip` | Delete *{clip}* | Edit |
| `audio.edit.duplicateClip` | Duplicate *{clip}* | Edit |
| `audio.edit.splice` | Split *{clip}* at the playhead | Edit |
| `audio.edit.renameClip` | Rename *{clip}* | Edit |
| `audio.clip.reverse` | Reverse / Un-reverse *{clip}* | Clip |
| `audio.clip.fadeIn` / `audio.clip.fadeOut` | Fade in / Fade out *{clip}* | Clip |
| `audio.clip.consolidate` | Flatten *{clip}*'s loop into real notes | Clip |
| `audio.clip.louder` / `audio.clip.quieter` | Turn *{clip}* up / down 1 dB | Clip |
| `audio.clip.normalize` | Normalise *{clip}* | Clip |
| `audio.clip.roll` | Open *{clip}* in the piano roll | Clip |
| `audio.track.duplicate` / `.remove` / `.rename` / `.arm` | Duplicate / Delete / Rename / Arm *{track}* | Track |
| `audio.track.soloClear` | Clear all solos | Track |
| `audio.track.unmuteAll` | Unmute every track | Track |
| `audio.project.timesig` | Change the time signature | Project |
| `audio.project.rename` | Rename this project | Project |
| `audio.project.marker` | Drop a marker at the playhead | Project |
| `audio.project.section` | Start a new section here | Project |
| `audio.fx.{type}` ×18 | Add *{EQ3/Compressor/Reverb/…}* to *{track}* | Effects |
| `audio.track.automation` | Draw volume automation on *{track}* | Track |
| `audio.import` | Import an audio file | Audio |
| `audio.view.pads` | Show/Hide the pads | View |
| `audio.view.sidebar` | Hide the sidebar | View |
| `audio.view.appearance` | Change the studio's colours | View |
| `transport.record` | Record a take / Stop recording | Transport |
| `transport.loop` | Turn looping on/off | Transport |
| `transport.loopAll` | Loop the whole song | Transport |
| `transport.countin.{0,1,2}` | No count-in / Count in N bars before recording | Transport |
| `transport.tempo` | Change the tempo (now N BPM) | Project |
| `transport.swing` | Change the swing (now N%) | Project |
| `transport.master` | Set the master volume (now N%) | Project |
| `transport.screenrec` | Record the screen | Share |
| `transport.historyrec` | Record how this project gets built | Share |
| `mixer.addReturn` | Add a return track | Mixing |
| `roll.quantize` / `roll.quantize.half` | Quantise / Half-quantise *{scope}* | Notes |
| `roll.humanize` | Humanise *{scope}* | Notes |
| `roll.legato` | Join *{scope}* end to end (legato) | Notes |
| `roll.fitScale` | Pull *{scope}* into key | Notes |
| `roll.octaveUp/Down`, `roll.semitoneUp/Down` | Move *{scope}* up/down an octave / a semitone | Notes |
| `roll.louder` / `roll.softer` | Play *{scope}* harder / softer | Notes |
| `roll.longer` / `roll.shorter` | Make *{scope}* twice as long / half as long | Notes |
| `roll.selectAll` / `roll.deselect` / `roll.delete` / `roll.duplicate` | note selection ops | Notes |
| `roll.close` | Close the piano roll | Notes |
| `session.stopAll` | Stop all clips | Session |
| `session.addScene` | Add a scene | Session |
| `nav.dashboard` / `nav.projects` | Go to Dashboard / Projects | Navigate |
| `global.perf-mode` | performance mode toggle | (ProjectEditor) |

**Keyboard shortcuts** — canonical list lives in `SHORTCUT_GROUPS` in `components/editor/daw/HelpButton.tsx:41-97` (opened with **H** or **?**): Space, R, M, ←/→, ⌘Z, ⇧⌘Z, ⌘S, Delete, B, **I** (inspect mode), hold **E**/**L** during edge-drag, H/?; arrangement: box-select, ⌘-click, ⇧-click, ⌥-drag copy, ←/→ nudge, ↑/↓ move track, ⌘C/V, ⌘D, ⌘A, Esc, **S** split, Home, **L** loop, **P** loop-to-selection, **G** ripple, **F** fit, **1–5** snap mode, ⌥-drag bypass snap; piano roll: Delete, ⌘A, plus (in code) **Q** quantize, ⌘C/X/V/D, arrows nudge/transpose. Also **⌘J** consolidate (`AudioEditor.tsx:~2706`). Handlers: `AudioEditor.tsx:2614-2733`, `ArrangementView.tsx:1289-1420`, `PianoRoll.tsx:1264-1330`.
- **Info / hover help** — `data-help-id` on ~60 controls; `HelpButton.tsx` searchable feature catalogue (62 features across groups Transport / Views & Layout / Arrangement Tools / Tracks & Mixing / Session View / Clips / Instruments & Effects / Collaboration / Podcast) with a 7 s glow highlight (`highlightHelpTargets`), tier-locked entries. **Inspect mode** (`I`) — `daw/InspectMode.tsx`, hover anything for name/details. Tooltip components `editor/Tooltip.tsx`, `TooltipMode.tsx`.
- **Tutorials** — `lib/tutorials.ts` (27 slugs: fx, transport, tempo, views, sounds, export, swing, tracks, returns, key-scale, code, jam, record-session, tuner, time-signature, navigate, snap, masking, varispeed, piano-roll, automation, session, instrument, ai-video, auto-edit, multicam…), each tier-tagged and Pro-gated above beginner; live in-studio mode via `components/editor/StudioGuide.tsx`; screenshot capture via `scripts/capture-tutorials.mjs`. Mini-app tours in `lib/app-tour.ts`.
- **"Overlay" view filters** (no Ableton analogue) — `OVERLAYS` in `lib/daw-state.ts:1054-1071`: Not loaded, Not synced, Other sections, Tempo changes, Out of key, No automation, No effects, Not frozen, Quiet, Not being edited, Silent.

**Looked for, NOT found**
- No **overview / minimap strip** above the arrangement.
- No **follow / auto-scroll** of the playhead (no `scrollIntoView`/`followPlayhead` in `ArrangementView.tsx`); only `lib/daw-view.ts` `centerOnBeat`/`requestArrangement` used by voice control.
- No user-editable **keybinding remap** (shortcuts are hardcoded; `HelpButton` only documents them).
- No detachable/second-window arrangement or mixer (only the Apollo rack pops out).
- No global UI scale/zoom setting (explicitly removed — see comment in `lib/ui-tiers.ts`).

## 2. Transport & control bar
`components/editor/daw/Transport.tsx`

**Exists**
- Rewind, Play/Stop (Space), Record (R), Loop button (click-then-drag to set region; double-click = whole song), master volume, project-name rename inline.
- **Tempo** — click BPM to type (`data-help-id="bpm"`), **TAP tempo** (`data-help-id="tap-tempo"`).
- **Tempo map** — `lib/tempo-map.ts`: `TempoMarker`/`MeterMarker`, `tempoSegments`, piecewise beat↔seconds, `MIN_BPM 40`/`MAX_BPM 300`; "Tempo by section" editor (`Transport.tsx:1465`) with add/remove tempo changes; `meterMarkers` change the bar grid + snap. Actions `ADD/UPDATE/REMOVE_TEMPO_MARKER`, `ADD/REMOVE_METER_MARKER`.
- **Time signature** — click to edit num/den (`data-help-id="time-sig"`), plus per-scene meter.
- **Metronome** — toggle, key **M**. **Count-in** — 0/1/2 bars in the record-setup box (`countInBars`, `engine.countIn`), tempo-map aware.
- **Loop brace** — `loopStart/loopEnd/loopEnabled` on the project; `L` toggle, `P` set to selection, "Loop the whole song".
- **Jam capture** — `data-help-id="jam"`, `engine.captureJam(30)`, rolling 30 s buffer that starts on first Play (`daw-engine.ts:5152`).
- **Record modes** — record-setup box with input monitoring toggle, per-take FX chain (`recFx`), mic-permission errors; Session Record (all armed tracks) and **Capture to Arrangement** in Session view; per-track arm.
- **Automation "re-enable"** — `SET_LANE_OVERRIDDEN` / `REENABLE_ALL_AUTOMATION` with an Ableton-style override indicator ("Automation was overridden by hand — click to follow the written curves again", `Transport.tsx:1120`).
- **Automation arm/record** — knob-move recording exists but is Apollo-scoped: `daw/ApolloMotion.tsx` + `InstrumentPicker.tsx:1092` "Record the moves you make here as automation on this track — each pass adds to the take"; cumulative passes, per-parameter revert. Also `daw/ApolloLfoBake.tsx`.
- **Key & scale** — root + scale selectors (`data-help-id="key-scale"`), `SET_KEY_SCALE`.
- **Swing** — global `project.swing` slider with groove-preset cycling ("straight → light → classic swing → triplet feel → hard shuffle").
- **Varispeed** — tape speed 25–200 %, pitch follows (`engine.setPlaybackRate`).
- **Tuner** (`daw/PadTuner.tsx`), **Masking detector** (`daw/MaskingPanel.tsx`), **Performance FX** pad (`daw/FxControls.tsx`, "hold a pad to sweep the master"), **Capture menu** (screenshot → `ScreenshotAnnotator.tsx`; session recording → `ScreenRecorder.tsx`; project-build history recording).
- **MIDI mapping / MIDI learn** — `lib/midi-bindings.ts` (one CC registry shared by Beacon + Apollo, localStorage `midi-bindings-v1`), `lib/midi-learn.ts` React surface (right-click a control to learn/unbind, shown on mixer faders), `lib/midi-mapping.ts` (targets: masterVolume, bpm, laneLevel/Pan/Reverb/Delay, fxParam, automPoint; linear/log/exp curves), `lib/web-midi.ts`.
- Open project / import MIDI (`.cfproj`, `.mid`) directly from the transport.

**Looked for, NOT found**
- **No punch-in/punch-out** (zero hits for "punch" anywhere in `lib/` or `components/editor/`).
- **No key-mapping mode** (computer-keyboard → control assignment). MIDI-learn only.
- No arrangement-record automation modes (latch/touch/write); no global "Automation Arm" button.
- No nudge / phase / global groove-amount control beyond `swing`.

## 3. Clips & editing

**Audio clips** (`AudioClip` in `lib/daw-types.ts:759`)
- **Warp** — `warpEnabled` + `warpMode: 'repitch' | 'stretch'` (WSOLA, `lib/wsola.ts`), edited in `daw/ClipSettingsModal.tsx` (Sample / Warp / Pitch / Fade / Loop sections). Only **two** warp modes.
- `gain` + **multi-point gain envelope** `gainPoints`, `fadeIn`/`fadeOut`, `trimStart`/`trimEnd`, `reverse`, `boomerang` (ping-pong), `pitchSemitones`/`pitchCents`, `loopEnabled`, `waveformPeaks`, per-clip colour, `launchQuantization`, `followAction`, `followActionTime`.
- **Crop** (`daw/ClipCropModal.tsx`), **Isolate on Playhead** (`daw/IsolateModal.tsx`), **Replace Sample**, **Spectral Editor** (`daw/SpectralEditorModal.tsx`), **Split at Transients**, **Slice to Library**, **Spectral Morph** between two selected clips (`lib/spectral-morph.ts`), Normalise, ±1 dB, Splice at playhead (`lib/daw-splice.ts`), Consolidate (`lib/daw-consolidate.ts`), Save Sample to Library, Share to Community. Menu: `daw/ClipView.tsx:490-660`.
- **Waveform display** — in the arrangement lane (`daw/Waveform.tsx` + `ClipView.tsx`, vertical zoom 1–8) and in the crop/spectral/settings modals; `daw/AudioWaveform.tsx` in the editor shell.
- **"Change Dragging Type → Loop / Expand"** per clip; hold **E**/**L** to force during a drag.

**MIDI / piano roll** (`daw/PianoRoll.tsx`)
- Tools: **Edit** (click-empty draws, drag moves, ⇧-click multi-select, ⇧-drag box) and **Erase**. Quant grid buttons (`2, 1, 0.5, 0.25`), **Quantize** button + **Q**, half-quantize, **Humanise**, **Legato**.
- **Velocity lane** with drag + draw-across (`VelocityLane`, `PianoRoll.tsx:220-340`).
- **Scale lock** — highlights in-key rows and snaps drawn notes to the project key/scale (`snapToScale`, `getInScalePitches`).
- **Root selector** — transposes the whole pattern relative to `clip.rootNote`, and applies across **multiple selected clips** (`transposeTargets`).
- Transpose ±octave / ±semitone, velocity ×1.15/×0.87, ×2 / ÷2 length, select-all/deselect/delete/duplicate, copy/cut/paste notes (⌘C/X/V), ⌘D duplicate, arrow-key nudge/transpose.
- **Note expression** — per-note `MidiNote.fx?: RollFx` override, cascading preset → clip → note (`lib/roll-fx.ts`).
- **Preset / sample browser inside the roll** (Presets / Samples tabs, search, per-root audition, range warnings).
- **Voice map** — a sung pitch trace overlaid as reference (`MidiClip.voiceMap`, `daw/VoiceMapKit.tsx`).
- **Step sequencer** for drum clips: kits, patterns, save/delete kit+pattern, **dice** random groove, **Smart Drums** (density × loudness), 1–16 bars, velocity draw row, convert to/from piano roll.
- **Export MIDI (.mid)** per clip (`lib/midi-file.ts`); MIDI import with a tempo/meter-change report.

**Grooves & swing**
- Global `project.swing` (scheduling-time).
- **`lib/voice/grooves.ts`** — named groove templates: 16-step **offsets + accents** tables, **baked into the notes** (visible in the roll, survives export, undoable). Includes Straight, Light swing, and more.
- **Drawn groove** per clip — `MidiClip.groove` (one bar of micro-timing, up = laid-back, down = pushed) via `GRAPH_AREAS.groove`.

**Clip launch / scenes / follow actions**
- `LaunchQuantization = 'none'|'beat'|'bar'|'2bar'|'4bar'`; `FollowAction = 'stop'|'again'|'next'|'prev'|'first'|'last'|'random'|'none'` + `followActionTime` — on both audio and MIDI clips.
- Scenes with per-scene tempo/meter/colour; `SessionGrid`.

**Take lanes / comping**
- `TakeLane { id, trackId, name, clips }` on the project + `ADD/REMOVE/UPDATE_TAKE_LANE`; UI in `TrackRow.tsx` ("Delete take", `data-help-id="takes"`, full tier only).
- **`lib/comping.ts`** — `Take`, `TakeRegion`, `CompGroup`, `normalizeRegions`, take colours: a real comping model for loop-recorded takes.

**Looked for, NOT found**
- **No note probability / chance** in Beacon (`MidiNote` has no `chance`; only Apollo's internal `ClipNote.chance`).
- **No fold-to-scale row folding** in the roll (scale lock highlights/snaps but does not hide out-of-key rows).
- No **note invert / reverse / retrograde** command (transpose/legato/stretch exist; invert & reverse do not).
- No **draw/pencil mode** as a distinct tool (drawing is click-in-empty inside Edit); no line/paint tool.
- No **multi-clip piano-roll editing** except the Root/transpose case — one clip is open at a time.
- Only 2 warp modes — no Beats/Tones/Texture/Complex/Complex Pro, no warp markers, no transient/warp-marker grid on the waveform.
- No clip **crop-to-selection / consolidate-time-to-new-clip** in the arrangement (Consolidate is MIDI loop-printing only).

## 4. Mixer & routing
`components/editor/daw/Mixer.tsx`, `lib/daw-engine.ts`

**Exists** — volume, pan (bipolar knob, double-click centres), mute, solo, arm; **returnTracks** with `sendAmounts` per return and **pre/post-fader `sendModes`**, return `soloSafe`, return FX chains; **groups** (`DawTrack.kind: 'group'`, `groupId`, collapse folds children, group volume/pan/FX apply to children, `GROUP_TRACKS` action); **crossfader** (`project.crossfaderValue`, per-track `crossfader: 'A'|'B'|'none'`, "Center crossfader", visual dimming in Session view); **master strip** (`masterVolume`); **per-track 4-band tone EQ** (`ToneParams` sub/bass/mid/treble) with a drawable curve (`daw/EqCurve.tsx`); **metering** — `daw/LevelMeter.tsx` computes **RMS in dB with a peak-hold** marker, RAF-gated on playback; **sidechain** — `CompressorParams.sidechainTrackId` with a key-track picker in `DeviceChain.tsx:409`, engine in `lib/sidechain.ts` (envelope-follower VCA); **spectral ducking** `lib/spectral-duck.ts` and the **Unmask** device (per-band ducking under another track); **"My mix"** — per-collaborator personal balance that doesn't move anyone else's (`TrackRow.tsx`, `data-help-id="my-mix"`); MIDI-learn on faders; volume-automation pencil per strip.

**Looked for, NOT found**
- **No track delay / latency-compensation offset** (`trackDelay` has zero hits).
- **No cue / preview output or headphone bus** (no second output device selection; "cue" only exists as `CueMarker`, i.e. timeline markers).
- No input/output routing matrix (`inputSource` is just `'mic' | 'system' | null`); no track-to-track audio routing beyond groups and sends.
- No peak/dB numeric readouts or clip indicators on the meters; no master spectrum.
- No mixer strip for the crossfader curve/shape.

## 5. Devices, effects & instruments

**Track effect catalogue** — `lib/daw-effect-catalog.ts` `ADD_OPTIONS` (18): EQ3, Compressor, Reverb, Delay, Filter, Saturator, Redux (Bit Crush), Auto Pan, Utility, LFO, Noise Gate, De-esser, Chorus/Flanger, Transient Shaper, Multiband Comp, Limiter, Dynamic EQ, **Unmask (duck under another track)**. Types in `lib/daw-types.ts:25`; params `lib/daw-effect-params.ts`; engine `lib/daw-effects.ts` + `lib/daw-engine.ts`.
**Apollo-native devices** — `APOLLO_ADD_OPTIONS` (6): Hyper/Dimension, Phaser, Flanger, Echobode (freq-shift delay), Octaver, Convolve (IR reverb) — carried as `type: 'helios'` wrapping an Apollo `FxUnit` (`lib/apollo/daw-fx.ts`). Apollo's full `FxType` list has 22 incl. three splitters (`splitLH/splitLMH/splitMS`) that are deliberately **not** addable in Beacon (no nested-chain UI). Reverb also carries a **custom impulse-response upload** (`ReverbParams`, data-URL so it travels with the project).

**MIDI effects** — `MidiEffectType = 'velocity' | 'scale' | 'chord' | 'arp'` (`lib/daw-types.ts:313`): Velocity (min/max/random), Scale (root + major/minor/penta-maj/penta-min/dorian/chromatic), Chord (interval stack; 7 presets in the roll: Major, Minor, Power, Maj7, Min7, Octave ±1), Arp (up/down/updown/random, rate, 1–3 octaves, gate). `ADD/REMOVE/UPDATE_MIDI_EFFECT`; `daw/NoteFxSettings.tsx`.

**Instruments** — `InstrumentType = 'none' | 'drum' | 'fm' | 'poly' | 'sampler' | 'fm4op' | 'wavetable' | 'apollo' | 'plugin'` (`daw/InstrumentPicker.tsx`). Poly: multi-oscillator layers with octave/detune/**unison 1–7**/spread/level, filter, LFO, ADSR, sample-source layers. Drum: 16 pads with sampleId/volume/pitch/pan/mute/**choke groups** + baked-in one-shot samples, packs `synth`/`808` (`lib/drum-synth.ts`, `lib/drum-samples.ts`, `lib/drum-presets.ts`, `lib/pad-presets.ts`). FM (`lib/fm-synth.ts`), Wavetable (`lib/wavetable-synth.ts`), Sampler (`lib/sampler-engine.ts`, `lib/sampler-presets.ts`, SFZ via `lib/apollo/sfz.ts`), Sample presets (`lib/sample-preset.ts`, `lib/sample-pack.ts`, `lib/default-samples.ts`).
**Apollo** — full hybrid synth as a Beacon instrument (`lib/apollo/patch.ts`, rack card `daw/ApolloTrackItem.tsx` + `components/apps/apollo/*`). 9 modules (`lib/apollo/modules.ts`): Oscillators (3 osc × 5 engines: wavetable/sample/multisample/granular/spectral), Sub/Noise, Filters (2 per voice, serial/parallel, 31 types), Envelopes (4, curve per stage), LFOs (10 drawable incl. 2D paths + chaos: lorenz/rossler/S&H), **Macros (8)**, Arp (9 modes + pattern + scale-lock + hold + swing), Clips (in-instrument sequencer with per-note `chance` and automation), Global (voice mode, glide, tuning, master). **MPE** (`lib/apollo/mpe.ts`), tunings (`lib/apollo/tuning.ts`), slicing, spectral, multisample zones, offline render.
**Plugins** — `lib/beacon-plugins/{registry,host,bridge,types}.ts` (in-app plugin instruments, `daw/PluginPanel.tsx`, `daw/PluginMenu.tsx`); `lib/plugins-catalog.ts` is the *sold* AU/VST3/CLAP/Standalone product catalogue (external, not hosted in-browser).

**Device visualisations**
- Beacon device chain: **EQ3 frequency-response canvas** (`DeviceChain.tsx:196-252`), a shared **`ResponseCurve`** biquad plot for `filter` and `eq3` (`DeviceChain.tsx:1141,1538`), and a **gain-reduction bar meter with dB readout** for compression (`DeviceChain.tsx:~1525`). Mixer strip: **drawable 4-band EQ curve** (`EqCurve.tsx`). Track/return meters: `LevelMeter.tsx`.
- Apollo: **`ScopeView.tsx` — master oscilloscope + spectrum analyser** (wave / spectrum / both), plus `WavetableView`, `WavetableEditor`, `SpectralView`, `GranularView`, `SampleView`, `ModMatrixPanel` + `CurveEditor`, `ModSourcesStrip`, `FilterPanel`, `EnvPanel`, `LfoPanel`, `MacroPanel`, `ArpPanel`, `ClipPanel`, `MixerPanel`, `FxRack`, `KeyboardStrip`, `LearnMode`.

**Knob behaviour** — `components/editor/daw/Knob.tsx`: Apollo geometry (−135°, 270° sweep), **vertical drag** (0.01 × range per px), **Shift = fine** (0.002, 5× slower), **double-click = reset to `defaultValue`**, label swaps to the live value on hover/drag, `bipolar` mode, **`spread` arc for multi-selection disagreement**, pointer capture on the SVG, `touchAction: none`. Explicitly *not* copied from Apollo: modulation ring, quick-mod button, patch-path binding.
**NOT found on the knob**: no type-a-value entry, no right-click context menu, no MIDI-learn built into `Knob` itself (learn is wired separately on mixer faders via `useMidiLearn`).

**Looked for, NOT found**
- **No racks / device groups / macro knobs in Beacon** (macros exist only inside Apollo; no Audio Effect Rack, Instrument Rack, chains, or chain selector). No device grouping, no rack presets.
- No spectrum analyser, oscilloscope, or waveform display on Beacon's own track effects (only the EQ/filter curve and the compressor GR bar).
- No device presets/save-a-device-preset; no per-device dry/wet on the generic devices (only Apollo units carry `mix`).
- No vocoder, no pitch-shift/harmonizer device, no granular/resonator/corpus-style devices on the Beacon chain (granular lives inside Apollo only).

## 6. Modulation & automation

- **Automation lanes** — `AutomationLane` (`lib/daw-types.ts:659`): `parameter` = `'volume' | 'pan' | 'fx:{effectId}:{paramKey}'` (plus `apollo:{patchPath}`), min/max/default, `expanded`, **`overridden`** (Ableton "automation was overridden" semantics — playback stops following, points preserved), **`curve: 'log'`** for frequency lanes. UI: `daw/AutomationLaneView.tsx` with a **freehand draw mode** ("Drawing — drag to paint the curve"), add/remove lane, clear, per-device parameter picker ("Which parameter of this device to edit — the rest stay drawn behind"). Actions: `ADD/REMOVE/UPDATE_AUTOMATION_LANE`, `ADD/REMOVE/UPDATE_AUTOMATION_POINT`, `CLEAR_AUTOMATION_LANE`, `SET_LANE_OVERRIDDEN`, `REENABLE_ALL_AUTOMATION`. Automation repair: `lib/automation-repair.ts`.
- **Drawn-graphs suite** — `lib/draw-graphs.ts` is the single registry (`GRAPH_AREAS`), rendered by `daw/DrawnGraphModal.tsx` + the freehand primitive `daw/MotionCurve.tsx`. Six areas: **amplitude** (per-note volume shape, replaces ADSR sliders), **lfo** (custom one-cycle LFO shape driving tremolo/auto-pan/wah/vibrato), **pitch** (per-note bend ±12 st), **volume** (across the clip), **groove** (micro-timing across a bar), **fxmotion** (**FX Motion** — chosen effects morph neutral→target along one drawn curve, `perNote` optional). Plus `eq` area → `daw/EqCurve.tsx` and `pitch` area → `daw/PitchGraphEditor.tsx`. Whole suite is its own UI dimension (`GRAPHS_LS_KEY`, toggled in `UITierSwitcher`).
- **Pitch graphs** — `PitchGraph` / `PitchGraphTarget` / `PitchGraphPoint` (`lib/daw-types.ts:873-892`): a preset-level curve mapping **pitch or velocity → an FX parameter** (keyboard/velocity tracking), edited in `PitchGraphEditor.tsx`.
- **Per-parameter graphs** — `fxGraphs: Partial<Record<keyof RollFx, ClipParamGraph>>`: any Sound-panel slider can be switched to "graph" mode and drawn per clip or per note.
- **Clip effects lane** — `ClipEffect` (`lib/daw-types.ts:599`) = beat-anchored "effect bars" over a track (`row` for stacking) exposing a `RollFx` target + one `graph` (0..1) that all active params follow; legacy single-effect model migrates on load. Editing: `daw/RollSettings.tsx` + `ArrangementView.tsx` FX lane (`data-help-id="fx-lane"`), copy/paste of effect bars (`lib/fx-clipboard.ts`, ⌘C/⌘V, Delete). `lib/clip-effect-utils.ts`, `lib/effect-bar.ts`.
- **Roll FX** — `lib/roll-fx.ts`: one flat parameter bag (envelope, gain/pan/width, tremolo, auto-pan, highpass/lowpass/Q, drive & crush, pitch, space/reverb/delay, 4-band tone EQ, articulation/legato) resolved by cascading **preset → clip → note**, with `FX_CATEGORIES` and per-field `toNorm/fromNorm/fmt` metadata shared by every editor. `lib/articulation.ts` for legato phrasing.
- **Apollo modulation matrix** — `ModRoute` (`lib/apollo/patch.ts:247`): source → dest param path, amount ±1, bipolar, **aux source scaling** (`aux`, `auxAmount`), **per-route remap curve**, bypass. `MOD_SOURCES`: env1-4, lfo1-10 (+ their `y` outputs for 2D LFOs), vel, note, modwheel, pitchwheel, aftertouch, rand, gate, **follower** (envelope follower), macro1-8. UI: `components/apps/apollo/ModMatrixPanel.tsx` + `ModSourcesStrip.tsx`. Apollo automation into Beacon lanes via `daw/ApolloMotion.tsx`; LFO baking via `daw/ApolloLfoBake.tsx`.
- **Global/track LFO device** — `LfoParams` as a track effect (`defaultLfo`).

**Looked for, NOT found**
- No modulation matrix or mod sources for **Beacon's own** track devices (only Apollo's).
- No automation "record/latch/touch" arm in the arrangement (Apollo knob-move recording is the only motion capture).
- No automation curve shapes/handles on `AutomationPoint` (only `AutoPoint`, used by the drawn graphs, has bezier handles `h1/h2/smooth`).

## 7. Browser / library
`components/editor/SoundLibrary.tsx` (2402 lines), `lib/sound-library.ts`, `lib/sound-tags.ts`, `lib/library-tags.ts`, `lib/catalog.ts`

**Exists** — two browse modes (**Instruments** vs **Folders**); **search** box; **tag chips with counts** (`components/editor/TagFilterBar.tsx` — type tags + character tags, AND-combined, clear-all); **user folders** with drag-to-move, drag-to-reorder, collapse/expand, auto-expand while filtering; per-entry **user tags** (private, never overwritten by catalog refresh) alongside shared catalog `tags`; audition/play, rename, delete, category change; **admin-curated global catalog** streamed on demand (`catalogUrl`, materialised as `catalog_*`, ~7,600 drums + a 2,178-sound built-in set per `MODULE_DEFS`); **community-linked entries** (`communityRef`, author attribution, Share to Community); **cross-device library sync** (`lib/user-library-sync.ts`, `synced` flag); metadata `key`, `bpm`, `duration`, **`spectral` perceptual fingerprint** (`HitSpectral`); import audio *or* video (audio kept); record straight into the library; **Open in Apollo ↗** per sample; **Recipes** tab (searchable, `lib/practice-recipes.ts` + DB-backed `lib/daw-recipes.ts` chord/bass/melody patterns) and **Patterns** tab (drum patterns, `lib/drum-patterns-extra.ts`), both with TagFilterBar; **presets** (`lib/midi-presets.ts`, `lib/tone-presets.ts`, `lib/preset-variants.ts`, project-embedded `DawProject.presets` so user sounds travel with the `.cfproj`); **Community** (`lib/community.ts` — kinds song/sample/preset/recipe/pack/project/theme/kit/pattern/post/clip/patch/patchpack/wavetable/sketch/station/video, votes, reactions, comments, collections, remix lineage via `remixedFrom`).

**Looked for, NOT found**
- **No "similar sounds" / find-similar** action in the UI (the `spectral` fingerprint exists in the data model and `lib/track-embeddings.ts` exists, but no browser control uses them).
- No hot-swap / preview-in-place browsing, no browser preview-volume control, no collections/favourites in the *local* library (collections are community-side only), no "Places"/OS folder browsing (`lib/local-folder.ts` exists but isn't a browser panel).

## 8. Anything else notable

- **Voice control** — `daw/VoiceControl.tsx` (4139 lines) + `lib/voice/*` (~40 modules): wake words, hold-or-toggle, VAD, echo guard, calibration, spoken parameter names, macros, `music-tools` tool schema, read-back of every executed edit, matching against **`listCommands()`** labels, library samples exposed as nameable sounds. Panels: `VoicePanel`, `VoiceHud`, `VoiceCaption`, `VoiceTranscript`, `VoiceLibrary`, `VoiceMacros`, `VoiceMapKit`, `VoiceUsageLog`.
- **AI assistant** — `lib/ai-assist.ts` (Claude + a tool loop over `MUSIC_TOOLS`, metered against credits), `components/editor/AiAssistant.tsx`, `GenerateMusicModal.tsx`, `lib/music-ai.ts`, `lib/audio-to-midi.ts`, `lib/autotune.ts`, `lib/hpss.ts` (stem separation), `lib/key-detect.ts`, `lib/chord-analysis.ts`, `lib/beat-analyzer.ts`, `lib/pitch-detect.ts`.
- **Collaboration** — Liveblocks (`lib/liveblocks.config.ts`): `CollabPeer` presence (selected track/clip, playhead, **editing-clip soft lock** via `clipLockedBy`), `daw/CollabLayer.tsx`, `CollabPresence.tsx`, `CollabChat.tsx`, `CollabInvite.tsx`, `GuestPanel.tsx`, **timeline comments** with replies/resolve (`TimelineComments.tsx`), `MergeReview.tsx` + `lib/project-merge.ts`, `SessionRecap.tsx` (what changed while you were away), `VersionHistory.tsx`, "My mix" personal balance.
- **Freeze** — `DawTrack.frozen` + `SET_TRACK_FROZEN`, commands `audio.freeze` / `audio.thaw`, Apollo freeze cache (`lib/apollo/daw-freeze.ts`, `freeze-cache.ts`). No separate "Flatten".
- **Export** — `daw/AudioExportModal.tsx`: WebM, **WAV**, **Stems (zip)**, **MIDI (.mid)**; sample rates 44.1/48/88.2/96 kHz; Pro gating; one-click simple export in beginner tier; save-in-place to an existing asset. `lib/exporter.ts`, `lib/wav-encoder.ts`, `lib/wav-codec.ts`, `lib/zip.ts`, `lib/loudness.ts`.
- **Project format & history** — `.cfproj` (`lib/project-serializer.ts`, `lib/schema-version.ts`, migrations), undo/redo (`lib/daw-undo.ts`), autosave (`lib/autosave.ts`), snapshots, **construction-history replay** (`DawHistoryEntry`, "Record how this project gets built"), `lib/session-capture/`.
- **Other studio surfaces** — `PolyCodePanel` (generate/edit sounds with math, `lib/poly-code.ts`), `PracticeButton` / Practice Room lessons, `ReferenceAB.tsx` (A/B against a reference track), `DuplicateCleanup.tsx`, `InspectorBridge`/`Inspector`, `ClickHighlighter`, `daw/EpisodePanel.tsx` + podcast mode (guests, chapters, publish), `AdminMenu`, `daw/PadInput.tsx` (pads + computer keyboard + Web MIDI input), `daw/TrackInputCard.tsx`, mobile shell (`components/mobile/MobileDawProvider.tsx`), Electron desktop build.

## Headline gaps against Live 12 (from this sweep alone)

No racks/macros/chains for Beacon devices, no punch in/out, no cue output or track delay, no note probability, no fold-to-scale, no follow/auto-scroll or minimap, no warp-marker editing or the Beats/Tones/Texture/Complex warp modes, no user-remappable keys or key-mapping mode, no automation write/latch/touch arm, no draw/pencil tool, no multi-clip editing, no find-similar in the browser, no spectrum/oscilloscope on Beacon's own devices (only Apollo's ScopeView), no typed value entry on knobs.
