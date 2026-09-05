# Second pass — items the first pass did not mention (2026-09-04)

Brae: "Are there any more items that we're missing? … Not the things already
said and we'll add the new things to that."

Method: read the manual chapters the first pass leaned on least (Managing
Files and Sets, Launching Clips, Routing and I/O, Recording New Clips,
Mixing, Using Grooves, Working with Instruments and Effects, Session View,
Automation and Editing Envelopes, Clip View, Video, Computer Audio
Resources, Instrument/Drum/Effect Racks, and the whole keyboard-shortcut
appendix), plus Sonic Bloom's "25 hidden features", plus a check for
anything after 12.4.5 (none — 12.4.5 of 26 Aug 2026 is current, no 12.5
beta announced). Every row below is **absent from README.md** or only named
there in passing; Beacon status is from grepping the code today. A full
table-of-contents diff is in `second-pass-toc-diff.md`.

Beacon column: **No** = nothing found; **Part** = something adjacent exists
(file named); **Have** = exists.

## A. Launching clips and scenes (manual ch. 16, 7)

| Ableton | Beacon | Note |
|---|---|---|
| Launch Mode per clip: Trigger / Gate / Toggle / Repeat | No | Beacon clips have quantization only |
| Legato Mode (new clip inherits the playing clip's position) | No | the "seamless switch" tutorials rely on |
| Velocity Amount (MIDI velocity → clip volume, 0–100 %) | No | |
| Nudge Backward/Forward buttons on a running clip, scrub in MIDI Map | No | |
| Follow Action A **and** B with Chance A/B %, Linked vs Unlinked time, Jump (with target), Any, Other; Enable Follow Actions Globally; `Shift+Enter` toggle, `Ctrl+Shift+Enter` create a chain | Part — one follow action + time (`lib/daw-types.ts`) | the A/B chance pair is the whole point of generative sets |
| Scene follow actions (12.2, Unlinked/Longest), Scene View panel, Select on Launch, Select Next Scene on Launch | No | |
| Start Recording on Scene Launch; Clip Record buttons appear in empty armed slots | Part — slot recording exists (`SessionView.tsx:301`) | |
| Add/Remove Stop Button per slot (`Ctrl+E`), Stop Clips in Track (`Ctrl+Enter`) | No | the earlier session-view note asked for this |
| Capture and Insert Scene (`Ctrl+Shift+I`), Insert Scene (`Ctrl+I`), scene from browser drop, select all clips in a scene | Part — add scene only (`session.addScene`) | |
| Track Status fields (what each track is playing, remaining loops) | No | |
| Keyboard launching: Enter launches the selected slot, arrows move, Page Up/Down eight scenes, `0` deactivates a clip | No | |
| "New" button (stop clips, select a fresh scene — for key/MIDI map) | No | |
| Narrow session tracks showing only essentials | No | |

## B. Recording (ch. 19)

| Ableton | Beacon | Note |
|---|---|---|
| Exclusive Arm / Exclusive Solo settings, `Ctrl`-click to arm several, `C` arms, `S` solos | No | |
| Monitor In / Auto / Off per track | No — `inputSource` only | |
| Start Playback with Record; Shift+F9 arm arrangement record; F9 record; `Ctrl+Shift+F9` record to session | Part | |
| Loop recording keeps every pass; unroll via Undo or take lanes | Part — takes exist | |
| Record Quantization menu (record-time, separate from edit-time) | No | |
| Metronome: Enable Only While Recording, sound, rhythm Auto; count-in shown as −2.1.1 → 1.1.1 | Part — count-in only | |
| Step recording: transport stopped, arrow keys advance the insert marker, preview on, armed track | No | |
| Capture MIDI: tempo detection 80–160 BPM, adjusts loop, overdubs into the existing clip on the same track | Part — jam capture is 30 s of audio | |
| Session Automation Recording (armed / all playing clips); Automation Arm; touch vs latch by input; automation LEDs on controls | No | |
| Delete Automation on a control (`Ctrl+Backspace`), Re-Enable per parameter from the context menu | Part — global re-enable | |
| File Type WAV/AIFF/FLAC and Bit Depth for recordings; Keep Monitoring Latency in Recording | No — takes are recorded through `MediaRecorder` as Opus/WebM (`lib/daw-engine.ts:4804`), i.e. lossy, and WAV export is 16-bit with no dither (`lib/wav-encoder.ts`) | a quality gap, not just a settings gap |

## C. Routing and I/O (ch. 17)

| Ableton | Beacon | Note |
|---|---|---|
| Input Type + Input Channel choosers: Ext. In, **Resampling**, any track (Pre FX / Post FX / Post Mixer), No Input | No | resampling is a top-tier tip |
| Output: Main, Sends Only, any track, No Output; return tracks with Audio To | Part — sends/returns only | |
| Per-channel MIDI routing between tracks (MIDI From a track/device) | No | |
| External Instrument / External Audio Effect devices | Part — Beacon Bridge hosts native AU/VST3 out of process (`lib/beacon-plugins/bridge.ts`, `PluginMenu.tsx`) plus web plug-ins by manifest; no MIDI out, so no external hardware instrument | |
| Individual outputs from multi-output instruments (Drum Rack pads out) | No | |
| Cue Out chooser, Solo/Cue Mode switch, Cue Volume, Main Out chooser | No | |
| Mono/stereo pair configuration, mono→stereo duplication, stereo→mono −6 dB | No | |
| Keep Latency track option, delay-compensation toggle | No | |

## D. Files, sets, projects (ch. 5)

| Ableton | Beacon | Note |
|---|---|---|
| Collect All and Save; Collect Files on Export (Always/Ask/Never) | Part — custom presets embed (`AudioEditor.tsx:2398-2415`) but clip audio is stripped to `r2Key`/`libraryId` references on save (`lib/project-serializer.ts:194`), so a .cfproj is not self-contained | |
| Save a Copy; Save as Template; Save as Default Set; Default Audio/MIDI Track; Default Drum Rack | Part — templates in `lib/templates.ts`; no default set/track | tutorials' #2 tip |
| File Manager: Manage Set / Project / User Library, View Files, unused files, missing-file search with Locate and hot-swap | No | |
| Live Clips (.alc): a clip **with its device chain** as a browser item | Part — community "clip" is a recording; presets embed | |
| Packs (.alp): Create Pack, install by drag | n/a | |
| Merging Sets: drag a Set (or its tracks / grooves / groups / devices) into the open Set | No | |
| Export selected Session clips as a Set | No | |
| **Undo History** panel (`Cmd+Alt+Z`), greyed-out redo tail | No — undo/redo only; construction-history replay exists | |
| Analysis files (.asd) carrying default clip settings + warp markers; Save Default Clip | No | |
| Decoding cache limits, Temporary Folder | n/a | |

## E. Export dialog (ch. 5)

| Ableton | Beacon (`AudioExportModal.tsx`) | Note |
|---|---|---|
| Rendered Track: Main / All Individual Tracks / Selected Tracks Only / one track | Part — WAV, stems zip | |
| Render Start / Render Length from the selection | verify | |
| Include Return and Main Effects (for stems) | No | |
| Render as Loop (two passes so the tail wraps) | No | |
| Convert to Mono | Part — the engine's `renderWav({mono})` can, the modal never offers it | |
| Normalize (peak) | Part — LUFS normalise in podcast mode only | |
| Create Analysis File | n/a | |
| Sample Rate up/down | Have | |
| Encode PCM: WAV / AIFF / FLAC, Bit Depth 16/24/32, Dither Triangular / Rectangular / Pow-r 1–3 | Part — WAV only, no dither | |
| Encode MP3 (320 CBR) | No | |
| Create Video + encoder settings | No (Prism exports video separately) | |
| Real-time render with Auto-Restart on drop-outs, Skip wait, attempt counter | Part — realtime capture exists for renders | |
| Export MIDI File `Cmd+Shift+E` | Have (per clip) | |

## F. Mixer extras (ch. 18)

| Ableton | Beacon | Note |
|---|---|---|
| Pan Mode: Stereo Pan vs **Split Stereo Pan** | No | |
| Solo in Place option; solo with/without returns; sends disable; sends on returns | Part — soloSafe on returns | |
| Meters show input while monitoring; numeric peak field; clip LED; reset | Part | |
| Track Activator numbered buttons, F1–F8 toggle tracks 1–8 | No | |
| Multi-select faders move together (`Shift`-select) | No | |
| Group solo half-lit when a child is soloed; Assign Track Color to Grouped Tracks and Clips | No | |
| Performance Impact six-segment CPU meter per track | No | |
| Cue volume, Main Out / Cue Out choosers | No | |

## G. Devices and racks (ch. 23, 24)

| Ableton | Beacon | Note |
|---|---|---|
| Default presets: Save as Default Preset loads instead of generic settings; Defaults folder | No | |
| Hot-Swap Presets (`Q`), Save Preset per device, Enter loads a device from the browser | No | |
| Configure mode (pick plug-in parameters to show), Multiple Plug-In Windows, Auto-Hide | n/a (in-app plugins) | |
| Device Delay Compensation toggle; "smart" deactivation of idle devices | No | |
| Group to Rack `Cmd+G`, Ungroup, Group to Drum Rack | No | |
| Right-click the Device View selector → tree of the track's devices | No | |
| Extensions + SDK (12.4.x) | n/a | |
| Rack zones: Key Zone, Velocity Zone, Chain Select Zone with fades; Auto Select | No | |
| Chain list with activator / solo / hot-swap / volume / pan; chains shown in the Session mixer | No | |
| Drum Rack: 128-pad Pad View + Pad Overview (groups of 16), Receive / Play / Choke per pad, 16 choke groups, six return chains with sends, "Multi" chains, Copy Value to Siblings / Map to Siblings, similar-sample swap, individual outs | Part — 16 pads, choke groups (`lib/drum-*.ts`) | |
| Nested racks; rack presets | Part — Factory / Saved racks and "Save as rack…" exist (`DeviceChain.tsx:1802-1822`, a chain saved as Apollo units); no macros, no parallel chains, no nesting | |

## H. Grooves (ch. 14)

| Ableton | Beacon | Note |
|---|---|---|
| Groove Pool (`Cmd+Alt+6`): Base, Quantize %, Timing %, Random %, Velocity −100…+100 (negative inverts), Global Amount to 130 % | Part — swing + baked templates + drawn groove | |
| Extract Groove from **any audio or MIDI clip** | No | |
| Commit (writes notes, or warp markers on audio) vs non-destructive | Part — templates bake immediately | |
| Hot-swap grooves while the clip plays; grooves on audio clips (warp on) | No | |

## I. Clip box extras (ch. 8)

| Ableton | Beacon | Note |
|---|---|---|
| Clip Activator (deactivate a clip, `0`) | No — no disabled state on clips | |
| Save Default Clip (audio), Clip Update Rate, Edit in external editor, RAM, Hi-Q, Fade toggle | No | |
| MIDI Bank / Sub-Bank / Program Change per clip | No | |
| Follow toggle inside the clip view; Clip View Selector overview | Part | |
| Editor tab shortcuts `Ctrl+Tab`, `Alt+Shift+1/2/3` | No | |

## J. Automation extras (ch. 20 in v11 numbering, "Automation and Editing Envelopes")

| Ableton | Beacon (`AutomationLaneView.tsx`) | Note |
|---|---|---|
| Show Automated Parameters Only; hide a lane without deactivating | No | |
| Breakpoint Edit Value dialog; `Shift` constrains axis; `Alt`-drag curve, `Alt`-double-click straight | Part — freehand draw | |
| Selection handles: stretch vertically/horizontally, skew, mirrored with `Alt` | No | |
| Simplify Envelope; Insert Shape (sine, triangle, saw, inverse saw, square, ramps, ADSR) | No — drawn graphs have bezier handles, lanes do not | |
| Lock Envelopes (stay at song position when clips move) | No | |
| Tempo automation on the Main track (Song Tempo lane with range boxes) | Part — tempo map markers | |
| Copy/paste envelopes between parameters or time ranges | No | |
| Keyboard breakpoint editing (12.2) | No | |

## K. Video in the DAW (ch. "Working with Video")

| Ableton | Beacon | Note |
|---|---|---|
| Import .mov into the Arrangement; floating Video Window (full screen, second monitor); video is the tempo leader; warp markers as **hit points**; sprocket-hole clips; Consolidate/Reverse/Crop turn the clip audio-only; pre-roll trick; Export Audio/Video | No — Prism is a separate editor; the DAW-mix link goes the other way | scoring to picture is a whole workflow Beacon can't do in the audio studio |

## L. Computer audio resources (ch. 36)

| Ableton | Beacon | Note |
|---|---|---|
| CPU Load meter (Average / Current / off), disk overload indicator, per-track Performance Impact | No | `__dawDiagnose` is dev-only |
| Multicore, smart device deactivation, channel configuration to shed I/O, RAM mode, audio engine on/off (`Ctrl+Alt+Shift+E`), CPU Usage Simulator, Test Tone, Driver Error Compensation, plug-in latency readout | No | |

## M. Keyboard vocabulary the appendix has that Beacon's help lists do not

Beacon's `HelpButton.tsx` documents ~40 keys. Live's appendix (ch. 41) has
~29 categories. Categories with **no Beacon equivalent at all**: view
show/hide (`Ctrl+Alt+B/O/I/S/M/3/4/6/7`, F11 full screen, second window),
keyboard focus (`Alt+0…8`), adjusting values (arrows, `Shift`+arrows,
Delete = default, type digits, `.`/`,` next field), loop brace and markers
(F9–F12, arrow ops, `Ctrl+Shift+L` select loop contents), clip-view tab
switching, sample-editor markers (`Ctrl+I` insert warp marker, `Ctrl+Shift+I`
transient), MIDI-editor value entry (type 0–127 velocity, `Ctrl+Alt+↑↓`
chance, `Ctrl+Shift+↑↓` deviation, `Ctrl+Enter` apply MIDI tool,
`Ctrl+Shift+F` note filters), global quantization (`Ctrl+6…0`), session
launching (Enter, `Ctrl+E` stop button, `Ctrl+Shift+I` captured scene,
`Shift+Enter` follow actions), arrangement time commands
(`Ctrl+Shift+X/C/V/D/Delete`, `Ctrl+I` silence, `Ctrl+Shift+J` crop,
Enter+arrows resize, `Shift+Alt`-drag slide waveform, `Ctrl+Space` play
from marker), comping (`Ctrl+Alt+U`, `T` audition, Enter add, `Ctrl+↑↓`
swap takes), bounce (`Ctrl+B`, `Ctrl+Alt+V`), tracks (`Ctrl+T`,
`Ctrl+Shift+T`, `Ctrl+Alt+T`, `+`/`−` grouped, `C` arm, F1–F8 activators,
`Ctrl+Alt+Shift+F` freeze), transport (`Shift+Space` continue, `Ctrl+Space`
stop at selection end, F10 back to arrangement, `O` metronome), audio
engine toggle, browser (Shift+Enter preview, 1–7 colours, `Ctrl+[`/`]`
history, `Ctrl+Shift+F` similar), similar-sample swap (`Ctrl+←→`),
key/MIDI map (`Ctrl+K/M`, `M` keyboard, `Z/X` octave, `C/V` velocity),
**momentary latching** (hold A/B/S/Z/F1–F8/Tab ~500 ms), Tab-to-move-focus,
menu search (`Cmd+?`). Beacon's `B` already means Library, not Draw.

## N. Small things tutorials call "hidden" (Sonic Bloom's 25)

Full-height browser; browser icons on/off; show/hide filter groups; sort
by date/size/type/rank/place; show project in Finder; locate or remove
greyed-out Places; reset library order; Tap tempo settings; record
settings for session and arrangement; audio settings from the control
bar; CPU display settings; CPU overload setting; track-arming behaviour;
solo with/without returns; split-stereo panning; disable sends; enable
sends on returns; recording latency setting; select all clips in a
scene; two scene-launch behaviours; tempo and time signature for all
scenes. Beacon status: none, except sorting/search in the library.

## O. Odds and ends from other chapters

- Edit Info Text on tracks, clips and devices (project notes that show in Info View); `Ctrl+R` rename with Tab to the next track; `#` auto-numbering in names. Beacon: rename only.
- Computer MIDI keyboard with `Z`/`X` octave and `C`/`V` velocity; Beacon's pads have octave, no velocity keys.
- Insert MIDI clip `Ctrl+Shift+M`; Insert Silence `Ctrl+I`; Options.txt hidden switches (e.g. EnableMapToSiblings).
- Second Window (`Ctrl+Shift+W`) for two monitors; Beacon pops out only the Apollo rack.
- Video Window and Learn View both have their own show/hide keys.
