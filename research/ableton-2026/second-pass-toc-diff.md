# Second pass — manual table-of-contents diff against README.md (2026-09-04)

Method: every chapter and section title in the Live 12 manual TOC
(`releases-and-manual.md` Appendix A, ch. 1–41) was checked against
`README.md` (§2 gap tables **and** the new §4b headline list), then against
`beacon-inventory.md` and the code under `lib/` and `components/editor/`.
Sections README clearly covers (Draw Mode, MIDI Tools, warping, stacked
views, racks/macros as a headline, Learn/Info View, etc.) are skipped; a
chapter appears below only where a section slipped through. The tips
sections of `interface-and-workflow.md` §16 and `midi-and-clip-view.md`
§17 and the 87-row corpus table (`tutorial-corpus.md` §2) are diffed at the
end.

Columns — **Already in README?**: `no` = not named anywhere in README;
`partial — §2 X` = a §2 gap-table row touches it without naming it;
`partial — §4b <bullet>` = the §4b headline list names it (detail lives in
`second-pass.md`). **Beacon status**: `have` / `part` / `no` / `n/a`, with
the file that proves it.

## Corrections to `second-pass.md` found while grepping

These rows in `second-pass.md` grade Beacon differently from what the code
shows; the table below uses the code.

| `second-pass.md` says | Code says |
|---|---|
| D — Collect All and Save: "n/a — everything is embedded or synced" | **Part.** Only custom presets embed (`components/editor/AudioEditor.tsx:2398-2415`); clip audio is stripped to `r2Key`/`libraryId` references (`lib/project-serializer.ts:194`), so a `.cfproj` opened without library sync / R2 access shows "Not loaded". `lib/firefly-bundle.ts` is a real collect-style zip, mobile only. |
| E — Convert to Mono: "No"; Render Start/Length: "verify" | Mono exists in the engine (`renderWav({ mono })`, `lib/daw-engine.ts:4990-4999`) but the modal never exposes it → **part**. The modal renders `startBeat: 0 → endBeat` (`AudioExportModal.tsx:313`) → no range from a selection. |
| G — "Nested racks; rack presets: No" | **Part.** `DeviceChain.tsx:1802-1822` has Factory racks / Saved racks (Apollo) / "Save as rack…" — the chain is translated to Apollo units and saved in `localStorage apollo_fx_racks_v1`. Chain presets exist; macros and parallel chains do not. |
| G — Extensions + SDK: "n/a" | **Part.** Beacon Plugin Format v1 accepts user-added manifest URLs (`PluginSource 'url'`, `lib/beacon-plugins/types.ts`); no context-menu/scripting extensions. |
| C — External Instrument / External Audio Effect: "n/a in a browser" | The Beacon **Bridge** (`lib/beacon-plugins/bridge.ts`) hosts native AU/VST3 out of process over a loopback WebSocket, surfaced in `PluginMenu.tsx:94-96`. So ch. 23.4/23.5 plug-ins are **part**; only *MIDI out to hardware* is truly absent (`lib/web-midi.ts` has no outputs). |
| B — File Type/Bit Depth for recordings: "No" | Sharper: takes are captured with `MediaRecorder` as Opus/WebM (`lib/daw-engine.ts:4804-4809`), i.e. **lossy**; there is no PCM take path (the only PCM capture is the dev `renderWav`). |
| L — buffer size etc.: "No" | **Part.** `audioLatencyHint()` reads a hidden `localStorage '100l.latency'` override (`lib/daw-engine.ts:156-175`); no UI. Input **device** choice exists and recognises loopback drivers (`lib/audio-capture.ts`); output device (`setSinkId`) does not. |

## Ch. 2 First Steps — Settings tabs

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 2.3.3 Audio | Audio device in/out, Input/Output Config (channel pairs, renaming), buffer size, sample rate, latency readout, Driver Error Compensation, Test Tone, CPU Usage Simulator | no (§4b "Resources" names CPU meter only) | part — input device chooser incl. BlackHole-style loopback (`lib/audio-capture.ts`), hidden latency override (`lib/daw-engine.ts:156`); no output device, no readout, no test tone | Tutorials' day-one setup; "128 will work" (corpus row 75) |
| 2.3.5 Tempo & MIDI | Control Surface / Input / Output slots (6), MIDI port Track/Sync/Remote/MPE switches, Sync Type, Sync Delay, MTC | no | no — `lib/web-midi.ts` is input-only, no port matrix, no MPE flag | Any hardware beyond a generic CC controller |
| 2.3.6 File & Folder | Save Current Set as Default, Create Analysis Files, Sample Editor app, Temporary Folder, Decoding Cache limits | partial — §4b "Files" (Default Set) | part — starter templates (`lib/templates.ts`), no default set; caches are IndexedDB (`waveformPeaks`) | Default Set is corpus row 2 (VH 18) |
| 2.3.7 Library | User Library location, Collect Files on Export, Packs folder, Show Cloud/Push/Splice labels | no | part — project-folder handle via FSAPI (`lib/local-folder.ts`), community packs | Where files live is the #1 "media files missing" complaint |
| 2.3.8 Plug-Ins | VST2/VST3/AU folders, rescan, Auto-Open / Auto-Hide / Multiple Plug-In Windows | no | part — Beacon Bridge for AU/VST3 (`lib/beacon-plugins/bridge.ts`), web plugins by URL; no window policy | Corpus row 83 (M 5) |
| 2.3.9 Record, Warp & Launch | File Type WAV/AIFF/FLAC + Bit Depth, Clip Update Rate, Record Session automation, Start Playback with Record, Loop/Warp Short Samples, Select on Launch | partial — §2 L (count-in, warp defaults) + §4b "Recording" | no — takes are Opus/WebM (`lib/daw-engine.ts:4804`); count-in only | Lossy takes are a quality gap, not just a missing menu |
| 2.3.10 Licenses & Updates | Authorization, auto-update, usage data | no | n/a — web app | — |

## Ch. 3 Live Concepts

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 3.5 / 3.21 Live Sets, Saving and Exporting | Set vs Project folder model; Save / Save As / Save a Copy | partial — §4b "Files" | no in the DAW — only the video editor has Save As (`components/editor/VideoEditor.tsx:3972`); autosave + `VersionHistory.tsx` snapshots | "Save As versions" is corpus row 59 (H 10) |
| 3.17 Recording New Clips | Recording as a first-class concept (arm → input → slot/arrangement) | partial — §2 B | have — `Transport.tsx` record, Session slot record | — |

## Ch. 4 Working with the Browser

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 4.7.1–4.7.2 Packs, Pack Info | Download/install Packs inside the browser; Pack Info pages (replaced lessons) | partial — §2 K "packs" | part — admin catalog streamed on demand (`lib/catalog.ts`), community `pack` kind | Content onboarding |
| 4.7.3 Splice + Search with Sound (12.3) | Splice pane in the browser; "Search with Sound" = query-by-example against Splice | partial — §2 K "Splice" (no Search with Sound) | no in studio — CLAP embeddings exist for Lightning Bug only | Corpus row 78 (M 8) |
| 4.7.5 Push 3 standalone transfer | Move Sets to/from Push 3 | no | n/a — mobile /m + Firefly sync via account instead | — |
| 4.7.7 Current Project | The open project's own files as a browser place | no | part — project-embedded presets appear in the roll's Presets tab; no "this project" folder in the library | Corpus row 59 |
| 4.8 Navigating in the Browser | Full keyboard navigation, `Ctrl+F` then Enter to load, sort columns incl. **Rank** and Date, hide categories, full-height browser | partial — §4b "Keyboard vocabulary" | part — search box + tags; no rank sort, no keyboard load | "Rank floats the sounds you use" (corpus row 5) |
| 4.10 Adding Content from the Browser | Drag a Set's tracks / returns / Main devices / grooves into the open Set | partial — §4b "Files" (merging) | no — `lib/project-merge.ts` is collab three-way merge only | Corpus row 60 (M 7): "album lives in one sonic world" |

## Ch. 5 Managing Files and Sets

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 5.1.1–5.1.2 Decoding cache, .asd analysis files | Cached decodes; per-sample defaults + warp markers travel in .asd | no | part — `waveformPeaks` on the clip; no per-sample defaults | Save Default Clip depends on it |
| 5.1.3 Exporting Audio and Video | Rendered Track, range from selection, Include Return/Main FX, Render as Loop, Convert to Mono, Normalize, bit depth, dither, WAV/AIFF/FLAC/MP3, Create Video | partial — §4b "Export dialog" | part — WebM/WAV(16-bit)/stems zip/MIDI, sample rate; 0→end only; mono in engine only (`lib/daw-engine.ts:4990`); podcast-only LUFS normalise | Corpus row 62 (M 8); 16-bit-only WAV with no dither is a mastering gap |
| 5.2.1 Exporting MIDI Files | Export one MIDI clip | partial — §3 "export stems/MIDI" | have / **ours** — per-clip *and* whole-project (`writeProjectMidi`, `lib/midi-file.ts:124`), which Live cannot | Keep |
| 5.3 Live Clips (.alc) | A clip **with its device chain** saved as a browser item | partial — §4b "Files" | part — patterns/recipes/samples to library, presets embed; no clip+chain item | Reuse across projects |
| 5.4.2 Undo History | Panel listing every undo step, click to jump | partial — §4b "Files" | no — `lib/daw-undo.ts` stack only; `VersionHistory.tsx` + construction-history are the adjacent thing | Corpus row 67 |
| 5.4.3 Merging Sets | Drag one Set into another | partial — §4b "Files" | no | see 4.10 |
| 5.4.4 Export Session Clips as New Sets | Selected slots → new Set | no | no | Niche |
| 5.4.5 Template Sets | Save as Template; New-from-template; Default Set | partial — §4b "Files" | part — `BUILT_IN_TEMPLATES` + community starters (`lib/templates.ts`); no user "save as template", no default set | Corpus row 2 (VH 18) — "not spending 20 minutes on the same skeleton" |
| 5.4.6 File References / 5.6 Locating Missing Files | Manage Files: view references, missing-file search, Locate, auto-repair | partial — §4b "Files" | part — "Not loaded" overlay (`lib/daw-state.ts:1054`), server loader remembers refusals; no locate/repair UI | "media files missing" is the classic Live nightmare |
| 5.7 Collecting External Files / 5.7.1 on Export | Collect All and Save; Collect Files on Export | partial — §4b "Files" | part — presets embed, audio by reference (`lib/project-serializer.ts:194`); Firefly zip bundle only | Portability of a `.cfproj` |
| 5.8 Finding Unused Files | Purge samples nothing references | no | part — `DuplicateCleanup.tsx` removes duplicates, not unused | Project hygiene (corpus row 59) |
| 5.9 Packing Projects into Packs | Create .alp | no | part — community `pack` kind | — |
| 5.10.3 Multiple versions of a Set | Save As inside one project | partial — §4b "Files" | part — snapshots/versions, not named copies | — |

## Ch. 6 Arrangement View

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 6.3 Transport and Playback | `Shift+Space` continue from stop point, play from selection, `Ctrl+Space` stop at selection end, **Time Ruler Format** (seconds / 24–30 fps / drop) | partial — §4b "Keyboard vocabulary" (Shift+Space) | part — HH:MM:SS field (`Transport.tsx:817`) and a seconds lane on the ruler (`ArrangementView.tsx:67-94`); no frames, no continue | Corpus row 70 (M 7); frames matter once video scoring exists |
| 6.7 Moving and Resizing Clips | `Shift+Alt`-drag slides the waveform inside the clip (slip), resize past loop = repeat, overlap rules | no | part — hold `E`/`L` drag types; no slip edit | Corpus row 25 mentions slip |
| 6.9 Selecting Clips and Time | Enter toggles clip/time selection, `Ctrl+Shift+L` select loop, `Alt` resize all lanes | partial — §2 C | part — marquee, `P` loop-to-selection | — |
| Track naming (6.1 layout) | `Ctrl+R` rename, Tab to next track, `#` auto-numbering | partial — §4b "Odds and ends" in second-pass only; README no | no — rename only (`TrackRow.tsx`, no Tab handler) | Corpus row 61; numbered tracks make sidechain picking faster |
| Assign Track Color to Clips / grouped tracks | One command recolours every clip on a track | partial — §4b "Mixer" | part — `clip.color` + track colour picker (`TrackRow.tsx:1308`); no assign command | Corpus row 41 (H 9) |

## Ch. 7 Session View

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 7.2.1 Scene tempo/time-signature | Fields on the scene (was the "120 bpm 3/4" name trick) | §2 D have | have — `Scene.tempo/timeSignatureNum/Den` | — |
| 7.4.1–7.4.3 Select on Launch, remove stop buttons, Capture and Insert Scene, select all clips in scene | Session grid housekeeping | partial — §4b "Launching" | no — `ADD/REMOVE/UPDATE_SCENE` only (`lib/daw-state.ts:374-390`) | "Capture and Insert Scene" is how jams become sections |

## Ch. 8 Clip View

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 8.1.3 Editor View Modes | Sample/Notes · Envelopes · MPE tabs; panel layout horizontal/vertical/auto | partial — §2 A stacked view | no | — |
| 8.2.2 Clip Time Signature | Per-clip meter independent of the song | no | no — meter is project + scene only (`lib/daw-types.ts:1003-1027`) | Polymetric clips |
| 8.3.2 MIDI Bank / Program Change | Per-clip bank/program sent to outboard | partial — §4b "Clip box" | no (no MIDI out) | Hardware users only |
| 8.10 Clip View Sample Details | File name, path, length, rate, bit depth, channels, size | no | part — native length only (`ClipSettingsModal.tsx:426-429`) | Cheap to add |
| 8.12 Replacing and Editing the Sample | Replace sample in place; Edit in external editor | partial — §2 H "Edit" | have (Replace Sample, `ClipView.tsx`) / no external editor | — |
| 8.13 Editing Clip Properties for Multiple Clips | Change gain/warp/launch on a multi-selection | partial — §2 F "multi-clip" (notes only) | part — `Knob` draws a multi-selection `spread` (`Knob.tsx:38`) but `ClipSettingsModal` is single-clip | "Import stems, set them all to Complex" |
| 8.14 Clip Defaults and Update Rate | Save Default Clip; Clip Update Rate | partial — §2 H, §4b "Clip box" | no | — |

## Ch. 9 Audio Clips, Tempo, and Warping

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 9.1.4 Clip Tempo Followers and Leaders | A clip's own tempo drives the Set ("Leader" button); video is a leader too | no (video-as-leader in §4b) | no | The sync-to-picture and DJ-mix workflows |
| 9.2.4 Warping Short Samples | Loop/Warp Short Samples preference (one-shot vs loop) | no | no | Drum hits vs loops on import |
| 9.2.6 Manipulating Grooves (with warp markers) | Drag warp markers to re-groove audio | partial — §2 H warp markers | no | — |

## Ch. 10 Editing MIDI

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 10.3 Creating a MIDI Clip | Insert Empty MIDI Clip(s) `Ctrl+Shift+M` sized to the selection | no | have — draw a clip in the lane; no sized-from-selection command | — |
| 10.5.1 Non-Destructive Editing | Notes outside the clip start/end survive, revealed by resizing | no | unverified — `MidiClip` keeps `notes` regardless of `durationBeats` | Confidence when trimming |
| 10.7.1 Cropping MIDI Clips | Crop a MIDI clip to its loop | partial — §2 C crop | no — crop is audio only (`ClipView.tsx:101`, `ClipCropModal.tsx`) | — |
| 10.7.2 …Time Commands inside the note editor | Insert/Delete/Duplicate Time within a clip | partial — §2 C (arrangement only) | no | Extending a 2-bar idea to 4 without moving notes |

## Ch. 11 MIDI Tools — 11.1.1 Max for Live MIDI Tools

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 11.1.1 | User-built generators/transformations (Max) | no | part — `PolyCodePanel` / `lib/poly-code.ts` (math-generated sounds, not notes); voice `stutter`/AI `write_part` are fixed tools | Extensibility of the note editor |

## Ch. 12 Editing MPE

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 12.5–12.6 MPE in plug-ins; MPE/Multi-channel Settings dialog (per-track MPE mode, channel range) | Route MPE controllers per track | partial — §2 F Expression tab | part — Apollo `lib/apollo/mpe.ts`; `lib/web-midi.ts` has no MPE/channel handling | Seaboard/Osmose owners |

## Ch. 13 Converting Audio to MIDI

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 13.1.1–13.1.2 Resequencing slices; effects on slices | Sliced pads are a Drum Rack: reorder, process per slice | partial — §2 H slice | part — Slice to Library; Apollo `sliceMap: 'keys'` (`lib/apollo/patch.ts:86`) | Corpus row 35 |
| 13.5 Optimizing for Better Conversion Quality | Guidance | partial | n/a | — |

## Ch. 14 Using Grooves — 14.3 Groove Tips

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 14.3.2 Non-Destructive Quantization | Groove with Quantize % as a soft, live quantise | partial — §2 K groove pool | part — grooves bake (`lib/voice/grooves.ts`), `project.swing` is live | Live's "quantize at 50 %" tip |

## Ch. 15 Using Tuning Systems — 15.3.2

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 15.3.2 MIDI Controller Layouts | Push layouts for non-12-tone tunings | partial — §2 K tuning | n/a | — |

## Ch. 16 Launching Clips

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 16.6 Clip Offset and Nudging | Nudge a running clip's playback position back/forward | partial — §4b "Launching" | no | Live-set recovery |
| 16.7 Follow Actions (A/B chance, Linked/Unlinked, Jump/Any/Other) | Two actions with a probability split | partial — §2 D "Have" overstated; §4b names A/B | part — single `followAction` + `followActionTime` (`lib/daw-types.ts:21,810`) | Generative sets need the A/B pair |

## Ch. 17 Routing and I/O

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 17.2.1 Mono/Stereo Conversions | Mono in → both channels; stereo → mono −6 dB; channel pairs | partial — §4b "Routing" | no | Mic recording lands on one side without it |
| 17.3.1 MIDI Port Inputs and Outputs | Per-track MIDI From/To with channel; MIDI **out** | no | no — input only (`lib/web-midi.ts`) | Hardware synths |
| 17.3.3 Connecting External Synthesizers | External Instrument device (MIDI out + audio in, latency comp) | no | no; Beacon Bridge covers plug-ins, not hardware | Hybrid studios |
| 17.5.1 Internal Routing Points | Pre FX / Post FX / Post Mixer taps, Sends Only | partial — §4b "Routing" | no — groups + sends only | Parallel processing, resampling |

## Ch. 18 Mixing

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 18.1.1 Split Stereo Pan mode | L/R positioned independently, or collapse to mono | partial — §4b "Mixer" | no — single `StereoPannerNode` (`lib/daw-engine.ts:3910`) | Corpus row 64 |
| 18.8 Keep Monitoring Latency in Recording | Per-track toggle so takes land on time | no (second-pass C names it) | no | Corpus row 57 (H 10) latency cluster |
| Sidechain-capable devices (18/28) | Compressor, Glue, Gate, Auto Filter, Roar, Shifter, Corpus, Multiband | partial — §2 I sidechain header | part — Compressor only (`lib/daw-types.ts:82`) + Unmask | Corpus row 20 (H 11) |
| Return track defaults / reorder / duplicate returns (12) | Reverb + Delay returns by default; reorder; returns inside Drum Racks | partial — §2 E "Have" | part — add/remove only (`lib/daw-state.ts:733-736`) | Corpus row 19 (H 11) |
| Multi-select faders | `Shift`-select tracks, move faders together | partial — §4b "Mixer" | part — `selectedTrackIds` exists (`TrackRow.tsx:818`); knob `spread` arc; faders don't gang | Mixing a stem group |

## Ch. 19 Recording New Clips

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 19.3.4 MIDI Step Recording | Stopped transport, arrows advance, preview on | partial — §2 F "verify step entry", §4b "Recording" | no hits (`PianoRoll.tsx` audition only) | Corpus row 30 |
| 19.5 Recording Quantized MIDI Notes | Record Quantization menu (record-time) | partial — §4b "Recording" | no | "Quantize as you play" |
| 19.7 Setting up File Types | WAV/AIFF/FLAC, 16/24/32-bit takes | partial — §4b "Recording" | no — Opus/WebM via `MediaRecorder` (`lib/daw-engine.ts:4804`) | Lossy takes |
| 19.9 Using Remote Control for Recording | Map arm/record/count-in | partial — §2 J MIDI map | part — MIDI learn targets are mixer/params (`lib/midi-mapping.ts`), not transport | Hands-free takes |
| 19.10.1 Capture MIDI starts a new Set | Detects tempo 80–160 from the played material and sets the loop | partial — §2 B Capture | no — jam capture is audio (`engine.captureJam`) | The "I played something good" moment |
| Push 34.3.7 Fixed Length Recording | Record exactly N bars | no | **have** — record-N-bars buttons in `SessionView.tsx` | Keep |

## Ch. 21 Comping

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 21.4 Inserting Samples into take lanes; 21.7 Source Highlights | Drop samples into lanes; used regions highlight | partial — §2 C takes | part — `lib/comping.ts` model, `TakeLane` UI | — |

## Ch. 22 Stem Separation — 22.2.1

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 22.2.1 Speed vs Quality | Two separation qualities | partial — §2 C | part — `lib/hpss.ts` | — |

## Ch. 23 Working with Instruments and Effects

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 23.2.6 Default Presets | Save as Default Preset per device / track type | partial — §4b "Devices/racks" | no | Corpus row 2 (VH 18) |
| 23.3–23.5 Plug-Ins, VST, Audio Units, plug-in windows, Configure mode, sidechain for plug-ins | Host third-party devices | no | **part** — Beacon Bridge AU/VST3 (`lib/beacon-plugins/bridge.ts`, `PluginMenu.tsx:94`) with reported latency; web plugins via manifest URL | README never mentions plug-ins at all |
| 23.6 Device Delay Compensation | Automatic PDC + toggle | partial — §4b "Devices/racks" | no — `SCHEDULE_LOOKAHEAD` only (`lib/daw-engine.ts:101`); no per-device latency | Bridge plugins add real latency |

## Ch. 24 Racks — sections README's "Racks: No" hides

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 24.5 Zones (Key / Velocity / Chain Select, fades) | Split and layer instruments by key/velocity | partial — §4b "Devices/racks" | part — Apollo multisample zones; Poly layers have no key/vel ranges | Keyboard splits, velocity layers |
| 24.7.2–24.7.3 Randomize Macros, Macro Variations | Rand + snapshot recall | §2 J | no (Apollo macros, no variations) | — |
| 24.8.1 Extracting Chains | Chain → its own track | no | no | — |
| Rack presets / saved chains | Save an effect rack | §2 I says "No" | **part** — Factory racks / Saved racks / "Save as rack…" (`DeviceChain.tsx:1802-1822`) | Correct README I |

## Ch. 25 Automation and Editing Envelopes

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 25.2.1 Session Automation Recording Modes | Armed-only vs all playing clips | partial — §4b "Recording" | no | — |
| 25.5.3 Stretching and Skewing Envelopes | Selection handles: stretch, skew, mirror | partial — §4b "Automation" | no — `AutomationPoint` has no handles (`lib/daw-types.ts:659`) | Corpus row 7 (VH 19) "flex points" |
| 25.5.7 Edit Menu Commands | Copy/paste envelopes between parameters | partial — §4b "Automation" | no | — |
| 25.5.8 Editing the Tempo Automation | Song Tempo lane with range boxes, ramps | partial — §2 C meter map | part — stepped tempo markers (`lib/tempo-map.ts`), no ramps | Ritardando |

## Ch. 26 Clip Envelopes — 26.3, 26.4

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 26.3.1–26.3.2 Modulating mixer volume / sends / pan per clip | Clip-relative mixer modulation | partial — §2 F Envelopes "Ours" | part — `volGraph`, `rollFx.pan`; no per-clip send modulation | — |
| 26.4 MIDI Controller Clip Envelopes | CC/pitch-bend lanes in the clip | partial — §2 F "MIDI CC" | no | Hardware users |

## Ch. 27 Working with Video

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 27.1–27.4 Import video, Video Window, video clips in Arrangement, matching sound to video, trimming tricks | Score to picture inside the audio DAW | partial — §4b "Video scoring" (added this pass) | no in the DAW — import keeps audio only; `components/editor/VideoEditor.tsx` is a separate editor with DAW-mix link the other way | Whole workflow absent from the studio |

## Ch. 28 Audio Effect Reference — devices README never names

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 28.1 / 28.6 / 28.28 / 28.27 / 28.13 Amp, Cabinet, Pedal, Overdrive, Dynamic Tube | Guitar/amp simulation family | no | no — Saturator + Apollo `distortion` only | Guitar players |
| 28.5 Beat Repeat | Real-time stutter/repeat device | no | part — voice `stutter` tool prints repeats into notes (`lib/voice/music-tools.ts:778`); no audio device | Glitch/build FX |
| 28.25 Looper | Live loop pedal with overdub, feedback routing | no | no — jam capture is not a looper | Performance |
| 28.7 Channel EQ | Simple 3-band + display | no | have — per-track `ToneParams` + `EqCurve.tsx` | Keep |
| 28.12 Drum Buss | Drive, crunch, boom, transients in one | no | part — Transient Shaper + Saturator separate | Corpus row 18 drum-bus tip |
| 28.14 Echo | Delay with modulation/character tabs | no | part — Delay + Apollo Echobode | — |
| 28.19 / 28.22 Filter Delay, Grain Delay | Three-band delay; granular pitch delay | no | no | — |
| 28.31 Resonators | Five tuned resonators | no | no | — |
| 28.35 Shifter | Pitch/frequency shifter with LFO + follower | no | part — Apollo Octaver/Echobode | — |
| 28.41 Vinyl Distortion | Crackle/tracing | no | no (Redux + Saturator) | Lo-fi tutorials |
| 28.18 External Audio Effect | Hardware insert with latency comp | no | no | see 17.3.3 |
| 28.40 Utility | Gain to −inf, width, mono bass, DC, phase | partial — §2 I "Utility phase" | have (`utility` effect) | Corpus row 56 (H 9) |

## Ch. 29 Live MIDI Effect Reference

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 29.2 / 29.4 / 29.5 / 29.6 CC Control, Note Length, Pitch, Random | The four MIDI effects Beacon lacks | no (§2 G names only arp/chord/scale/velocity as Beacon's) | no — `MidiEffectType = velocity|scale|chord|arp` (`lib/daw-types.ts:313`) | Corpus row 46 (H 11) |
| 29.3 Chord: Strum / Tension / Crescendo / Learn | Humanised chord device | no | no — Chord is an interval stack | "Natural piano chords" (corpus row 46) |
| Record MIDI-effect output to a new track (tip) | Print what Arp/Chord produced | no | no | Corpus row 48 (M 6) |

## Ch. 30 Live Instrument Reference

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 30.2 / 30.5 / 30.12 Collision, Electric, Tension | Physical-modelling instruments | no | part — one Karplus-Strong guitar (`lib/instrument-synth.ts:14`) | Timbre family missing from the palette |
| 30.6 External Instrument | Hardware synth as a device | no | no | — |
| 30.7 Impulse | 8-slot drum sampler with per-slot stretch/filter/sat | no | part — 16-pad drum instrument | — |
| 30.9 Operator | 4-op FM with algorithm display | no | have-ish — `fm4op` (`lib/fm-synth.ts`) | — |
| 30.10 Sampler: zones, round-robin, third-party multisample import | Deep multisample | no | part — SFZ import (`lib/apollo/sfz.ts`), Apollo zones; **no round-robin** (only video multicam has it) | Corpus row 50 (M 7) |
| 30.11 Simpler playback modes (Classic / One-Shot / Slice) + warp inside | Sample instrument modes | partial — §2 H slice | part — Apollo `sliceMap` | — |

## Ch. 31–32 Max for Live

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 31.x Max for Live (build/edit devices, MIDI tools, dependencies) | User-programmable devices | no | part — Beacon Plugin Format v1 by manifest URL (`lib/beacon-plugins/types.ts`); `PolyCode` for sounds; `__dawDispatch` dev hooks | README never says "Max" |
| 32.1 DS Clang/Clap/Cymbal/FM/HH/Kick/Snare/Tom | Synthesised drum instruments | no | have — `lib/drum-synth.ts` `synth` pack | Keep |
| 32.2.1 Align Delay | Speed-of-sound delay for PA alignment | no | n/a | — |
| 32.3.3 / 32.3.5 MIDI Monitor, Note Echo | Debug incoming MIDI; MIDI delay | no | no | — |

## Ch. 33 MIDI and Key Remote Control

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 33.1.1–33.1.2 Natively supported control surfaces, manual setup | Launchpad/APC/Push scripts, session ring ("red box"), device control | no | no — generic CC learn only (`lib/midi-bindings.ts`) | Any pad controller owner |
| 33.2.2–33.2.4 Mapping to notes / absolute / relative controllers | Endless-encoder support, note-as-button | partial — §2 J | part — absolute with linear/log/exp only (`lib/midi-mapping.ts:10`); no relative, no note-mapping | Encoders jump without it |

## Ch. 34–35 Push 1 / Push 2 (and Push 3, Move, Note)

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 34.3.2 / 34.3.3 16 Velocities Mode, 64-Pad Mode | Pad layouts | no ("Push" appears once in §2 K as a browser place) | part — `PadInput.tsx` 16 pads + keyboard | — |
| 34.4.1 Recording with Repeat (note repeat) | Held pad retriggers at a rate | no | no | Hi-hat rolls on hardware |
| 34.12 Step Sequencing Automation / per-step parameters | Per-step automation in the sequencer | no | part — `StepSequencer.tsx` velocity row only | — |
| 35.8 Working with Samples (Classic / One-Shot / Slicing) | Push sample modes | no | part — Apollo | — |
| Move / Note apps (hardware + iOS companions, sync to Cloud) | Portable sketching | no | **ours** — `/apps/firefly` + `/m` mobile sync to the account | Keep |

## Ch. 36 Synchronizing — 36.3

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 36.3.1–36.3.3 MIDI clock/MTC in and out, Sync Delay | Sync hardware sequencers | partial — §2 B "EXT sync" | no (no MIDI out) | — |

## Ch. 37 Computer Audio Resources and Strategies

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 37.1.2 CPU Load from Multichannel Audio; 37.2 Disk Load | Shed I/O channels; disk overload indicator; RAM mode | partial — §4b "Resources" | no — `lib/daw-diagnose.ts` is dev-only | Freeze memory says Helios render blocks paint |

## Ch. 38 Audio Fact Sheet

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 38.2.1 / 38.3.4 Undithered rendering vs Dithering; 38.2.6 32-bit internal recording | Neutral vs non-neutral operations | no | no — 16-bit WAV, no dither (`lib/wav-encoder.ts:3`), lossy takes | Mastering credibility |
| 38.4 Tips for optimal sound quality | Guidance | no | n/a (`check:determinism` exists) | — |

## Ch. 39 MIDI Fact Sheet

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 39.x MIDI timing, jitter, "Chase MIDI Notes" option (Options menu) | Notes already sounding when play starts mid-note | no | no hits for chase in `lib/daw-engine.ts` | Starting playback inside a pad chord |

## Ch. 40 Accessibility and Keyboard Navigation

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 40.1.3–40.1.4 Options › Accessibility: Speak Menu Commands, Speak Min/Max Slider Values, Speak Time in Seconds, Speak Help Text | Screen-reader hooks | partial — §2 A "screen readers" | no — `Knob.tsx` has no `role`, `aria-*`, `tabIndex` or key handler | Knobs are invisible to assistive tech |
| 40.5 Editing automation envelopes with the keyboard | Breakpoint navigation/selection by keys | partial — §2 C "keyboard breakpoints" | no | — |

## Ch. 41 Keyboard Shortcuts — categories with no README/Beacon analogue

| Manual section | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 41.3 Working with Sets and the Program | `Ctrl+N/O/S/Shift+S`, export, settings, quit | no | part — ⌘S only (`HelpButton.tsx:41-97`) | — |
| 41.14 Global Quantization | `Ctrl+6…9`, `Ctrl+0` none | no | no | — |
| 41.21 Audio Engine | `Ctrl+Alt+Shift+E` engine on/off | partial — §4b "Resources" | no | — |
| 41.23 Similar Sample Swapping | `Ctrl+←/→` through similar samples | partial — §2 K similarity | no | — |
| 41.25 Momentary Latching | Hold A/B/S/Z/F1–F8/Tab ~500 ms | partial — §4b "Keyboard vocabulary" | part — hold `E`/`L` during a drag only | Corpus row 8 (H 9) |
| 41.29 Context Menu | Right-click everywhere, Edit Info Text in it | no | part — clip/track context menus (`ClipView.tsx:490-660`, `TrackRow.tsx:1308`), no info text | — |
| User-remappable shortcuts (OS-level; corpus row 66) | Rebind keys | no | no — hardcoded (`beacon-inventory.md` §1) | Corpus row 66 (H 9) |

## `interface-and-workflow.md` §16 tips not in README

| Tip | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| §16.2 | Default Set + templates + track/device defaults | partial — §4b "Files"; §4 quote only | part — `lib/templates.ts` starters | VH 18 |
| §16.3 | Add Folder (Dropbox), hide unused labels, `Ctrl+F` then Enter loads | partial — §2 K | part — `lib/local-folder.ts` handle; no keyboard load | — |
| §16.5 | Deactivate (`0`) **clips and tracks**, not only notes | partial — §2 F notes; §4b "Clip box" | no — no `muted`/`active` on `AudioClip`/`MidiClip` (`lib/daw-types.ts:759-830, 910`) | Non-destructive auditioning |
| §16.7 | Edit Info Text as project notes; `#` numbering; Tab rename | partial — §2 A Info Text | part — `TimelineComments.tsx` (collab), no track notes field | — |
| §16.13 | `Shift+Space` continue; Ctrl-click multi-arm/solo; Shift-select faders; `Alt` resize all | partial — §4b "Keyboard vocabulary" | no / no / part / no | — |
| §16.17 | Options.txt (EnableMapToSiblings…) | §2 L n/a | n/a (hidden `100l.latency` is the one such switch) | — |

## `midi-and-clip-view.md` §17 tips not in README

| Tip | Feature in Ableton | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| §17.2 | Headphone preview → step entry when armed | §2 F "verify" | no hits for step entry | — |
| §17.14 | Pin neighbours: `Ctrl`-drag a warp marker moves only that region | partial — §2 H warp markers | no | The warping recipe's second step |
| §17.18 | Resample MIDI effects into clips to see what Arp/Chord produced | no | no | Corpus row 48 |

## `tutorial-corpus.md` §2 rows not named in README

| Corpus row | Feature | Already in README? | Beacon status from code | Why it matters |
|---|---|---|---|---|
| 2 (VH 18) | Defaults & templates | partial — §4b "Files" | part — templates only | Second-most-taught tip in the corpus |
| 11 (M 6) | Rolling Sampler (always-on 10-minute buffer) | partial — §2 B Capture | **have-ish** — `engine.captureJam(30)` rolling 30 s (`lib/daw-engine.ts:5115`) | Keep; lengthen |
| 19 (H 11) | Return defaults, reorder/duplicate returns | partial — §2 E | part | — |
| 20 (H 11) | Sidechain on many devices, LFO→Utility sidechain rack | partial — §2 I | part — Compressor + Unmask | — |
| 46 (H 11) | MIDI effects Note Length / Pitch / Random / CC Control; Chord Strum | no | no | — |
| 48 (M 6) | Record MIDI-effect output to new track | no | no | — |
| 50 (M 7) | Simpler/Sampler round-robin, slice modes | no | no round-robin | — |
| 57 (H 10) | Latency & CPU cluster: Reduced Latency When Monitoring, buffer size, plug-in latency readout, Keep Latency | no | part — hidden latency override; Bridge reports `getLatencyMs()` | — |
| 59 (H 10) | Collect All and Save, project folder, Save As versions | partial — §4b "Files" | part | — |
| 60 (M 7) | Import tracks/returns/Main devices from other Sets | partial — §4b "Files" (merging) | no | — |
| 61 (M 5) | `#` numbering, Tab rename | no | no | — |
| 62 (M 8) | Export options (stems with return/Main FX, dither, MP3) | partial — §4b "Export dialog" | part | — |
| 63 (M 8) | EQ Eight M/S mode, band audition, oversampling; reference via Ext. Out | partial — §2 I EQ Eight (spectrum only) | part — `ReferenceAB.tsx` covers reference; no M/S or band solo | — |
| 64 (L 3) | Split Stereo Pan | partial — §4b "Mixer" | no | — |
| 67 (L 1) | Undo History panel | partial — §4b "Files" | no | — |
| 70 (M 7) | `Shift+Space` continue, play from selection | partial — §4b "Keyboard vocabulary" | no | — |
| 72 (L 1) | Extensions (12.4.5 beta) | no | part — plugin manifests by URL | — |
| 78 (M 8) | Splice + Search with Sound | partial — §2 K Splice | no | — |
| 83 (M 5) | Plug-in windows (multiple, auto-hide, auto-open) | no | n/a — web plugins render in-panel; Bridge UI unknown | — |
| 84 (L 1) | Tap-to-transient navigation `Alt+←/→` | no | part — transients detected (`ArrangementView.tsx:505`) for splitting, not navigation | — |
