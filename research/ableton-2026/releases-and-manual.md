# Ableton Live 12.x — official feature set, release by release (state as of 2026-09-04)

Research for the Beacon (100Lights) gap analysis. Research only; no code touched.
Primary source is Ableton's own Live 12 release-notes page (downloaded in full, 280 KB of text, all
versions 12.0 → 12.4.5) plus the Live 12 manual (index + individual chapters), Ableton launch blog
posts, and press (Sound on Sound, MusicRadar, CDM, Sonic Bloom, Synth Anatomy). Feature names below
are Ableton's own, as they appear in release notes / manual / UI.

Conventions: **[v]** = version that introduced it. "UI:" = where it lives. "Manual:" = chapter/section.
Editions: Lite < Intro < Standard < Suite. Manual base URL: `https://www.ableton.com/en/live-manual/12/<slug>/`.

---

## 0. Headline findings

1. **There is no Live 13.** As of 2026-09-04 the current release is **Live 12.4.5 (26 Aug 2026)**. Ableton has
   shipped four big free point releases on the 12 line — **12.1 (8 Oct 2024)**, **12.2 (11 Jun 2025)**,
   **12.3 (25 Nov 2025)**, **12.4 (5 May 2026)** — and keeps delivering major features that way. Press pieces
   about "Live 13" are speculation only.
2. **Live 12.0 (5 Mar 2024)** was the platform release: MIDI Tools (Transformations + Generators), Scale
   Awareness, Tuning Systems, browser Filters/Tags + Similarity Search, Meld/Roar/Granulator III, Mixer in
   Arrangement, stacked Clip View + Device View, keyboard navigation + screen readers, new UI styling.
3. **12.1**: Auto Shift, Drum Sampler, new Limiter/Saturator, Find and Select Notes, Chop/Glissando/LFO MIDI
   Tools, MIDI Tool chaining, Undo History, Full-Height Browser, Auto Tagging, scale on audio clips,
   Apply Grooves Instantly.
4. **12.2**: Bounce to New Track / Bounce Track in Place, Auto Filter redesign, keyboard editing of automation
   breakpoints, Quick Tags + Filter View redesign + content columns + custom icons, Expressive Chords (M4L),
   Roar/Meld/Resonators/Spectral Resonator updates, device header redesign (sidechain header, breakout arrow,
   context-menu button), Scene Follow Actions Unlinked/Longest, take-lane show/hide.
5. **12.3**: Stem Separation (Suite, local), Splice in the browser (+ Search with Sound, Apply Key from DAW),
   Bounce Group to New Track / Bounce Group in Place, Paste Bounced Audio, Device A/B Comparison,
   Auto Pan-Tremolo, smarter MIDI-clip creation in Arrangement, smaller mixer minimum height.
6. **12.4**: Link Audio (multichannel audio over Link between Live/Note/Move/Push), Learn View (replaces Help
   View), Erosion/Chorus-Ensemble/Delay redesigns, Separate Stems for Time Selection + Merge to Single Track,
   Quick Tags can create tags/groups, Copy Time command, Move 2.0 audio tracks.
7. Live still has **no "Arrangement sections"/song-parts feature** — structure is Locators + Arrangement Loop
   (+ Performance Pack's *Arrangement Looper*). Nothing in 12.x changed that.
8. Live 11 features that Beacon should treat as baseline because 12.x builds on them: MPE editing, Chance /
   Velocity Deviation, Follow Actions (per clip + per scene), Macro Variations + Randomize macros,
   Take Lanes / Comping (now in every edition incl. Lite since 12.0), Linked-Track Editing, Tempo Follower,
   Capture MIDI, Scene tempo/time signature, Hybrid Reverb / Spectral devices.

---

## 1. Version timeline (from ableton.com/en/release-notes/live-12/)

| Version | Date | Headline content |
|---|---|---|
| 12.0 | 5 Mar 2024 | Platform release (see §2) |
| 12.0.5 | 5 Jun 2024 | Accessibility batch; Arrangement mixer shortcuts; Crop shortcut; plug-in Group by Vendor; reorder Library labels; Settings rename; scene tempo fields visible by default; tuning lowest/highest note; 17-hour recordings; HiDPI Windows installer |
| 12.0.10 | 28 Jun 2024 | JSON unlock file |
| 12.0.15 / 12.0.20 | Jul/Aug 2024 | Push-only |
| 12.0.25 | 29 Aug 2024 | Control surfaces (KeyLab mk3, Launchkey mk4) |
| **12.1** | 8 Oct 2024 | Auto Shift, Drum Sampler, Limiter, Saturator, Find and Select Notes, Chop/Glissando/LFO tools, Undo History, Full-Height Browser, Auto Tagging, Move control surface (see §3) |
| 12.1.5 | 12 Dec 2024 | Browser filtering refinements, `#` search for all filter groups, Scale filter always available, VST2/VST3 icons, big Arrangement scroll/zoom perf win |
| 12.1.10 | 25 Feb 2025 | Native devices sort before plug-ins, filter count above content pane, X/bookmark buttons, `Track.create_midi_clip` API |
| 12.1.11 | 14 Apr 2025 | Bugfixes (duplicate note IDs) |
| **12.2** | 11 Jun 2025 | Bounce to New Track / in Place, Auto Filter, automation keyboard workflow, browser Quick Tags/columns/icons, device header redesign, Roar/Meld/Resonators, Expressive Chords (see §4) |
| 12.2.1 / 12.2.2 / 12.2.5 / 12.2.6 / 12.2.7 | Jun–Nov 2025 | Control-surface support (Launch Control XL 3, MPK mini IV, KK S MK3 improvements), Capture buffer fix, screen-reader fixes |
| **12.3** | 25 Nov 2025 | Stem Separation, Splice, Bounce Groups, Paste Bounced Audio, Device A/B, Auto Pan-Tremolo (see §5) |
| 12.3.1 / 12.3.2 | Dec 2025 | Bugfixes |
| 12.3.5 | 26 Jan 2026 | Bounced tracks get unique track numbers; Ctrl/Cmd-F clears search + filters |
| 12.3.6 / 12.3.7 / 12.3.8 | Mar–Apr 2026 | Launch Control 3 / Osmose control surfaces; GPU stem separation on macOS 26.4+ |
| **12.4** | 5 May 2026 | Link Audio, Learn View, Erosion, Chorus-Ensemble, Delay, stems for time selection / merge, Quick Tags creation, Copy Time (see §6) |
| 12.4.1 / 12.4.2 / 12.4.3 | May–Jul 2026 | NKS Connect, MiniLab 37, Re-Pitch warp respects clip groove, single-track render appends track name, 12-tone tunings in MIDI Tools, Tempo Follower down to 10 BPM |
| 12.4.5 | 26 Aug 2026 | Screen-reader focus in Learn View/Splice; Ctrl-F selects existing search text; Launchkey MK4 88; Max 9.1.5 |

---

## 2. Live 12.0 (March 2024) — the platform release

### 2.1 MIDI Tools — Transformations and Generators **[12.0]**
- **What**: scale-aware note processors that live in the Clip View. **Transformations** rewrite the selected
  notes; **Generators** create notes into the time selection / clip loop (replacing overlapping notes).
  Each tool has an **Auto Apply** toggle (labelled "Auto" since 12.1), an **Apply** button (labelled
  "Transform"/"Generate"), and **Reset**. Tool parameter changes are saved with the Set.
- **UI**: Clip View → **Transform** and **Generate** panels/tabs (next to Notes/Envelopes/MPE editor view
  modes), with a **Transformation/Generator Selector** chooser. Manual: ch. 11 *MIDI Tools*; 8.6 *Transform and
  Generate Panels*; 10.5.10.
- **Built-in Transformations (12.0)**: **Arpeggiate**, **Connect**, **Ornament** (flams/grace notes),
  **Quantize** (replaces the old Quantize dialog for MIDI), **Recombine**, **Span** (legato/tenuto/staccato),
  **Strum**, **Time Warp** (accel/rit speed curves). Max for Live: **Velocity Shaper**.
- **Built-in Generators (12.0)**: **Rhythm**, **Seed**, **Shape** (draw a contour), **Stacks** (1–4 chords from
  chord rules; scale-aware). Max for Live: **Euclidean** ("Rhythm Euclidean").
- **12.1 additions**: **Chop** transformation (up to 64 parts, gap/emphasis patterns, random variation);
  MPE transformations **Glissando** and **LFO** (write pitch-bend / pressure / slide curves onto notes);
  **MIDI Tool chains** (apply a Generator then stack Transformations; every tool in the chain stays editable;
  chain shown in the Status Bar); tools are **Key/MIDI-mappable**; **Set Pitch for Generators** by clicking/
  dragging in the piano ruler (or Alt-drag in the editor); tracks remember last-used tool; Stacks accepts
  **custom chord banks (JSON)** and negative inversions; Recombine redesigned (one parameter at a time, can
  rotate positions, Rotate Step Up/Down buttons).
- **12.2**: Transformation/Generator Selector shows which tools have been applied. **12.4.3**: 12-tone tuning
  systems work in MIDI Tools.
- **Max for Live MIDI Tools**: build your own with `live.miditool.in/out`; templates in the selector; custom
  tools must be saved in a Places folder. Browser filters *MIDI Transformation* / *MIDI Generator*
  (Device Function group) and, since 12.2, a **MIDI Tools filter group** (Generator / Transformation / Stacks).
- Packs of extra tools: **MIDI Tools Pack** (Philip Meyer: Phase Pattern, Polyrhythm, Stages, Retrigger,
  Slice Shuffler), **Sequencers Pack** (StepArp, SQ, Rhythmic Steps), **Generators by Iftah** [12.3]
  (Sting acid-bass generator, Patterns percussion generator).

### 2.2 Pitch and Time Utilities **[12.0]**
- The Live 11 "Notes" tab became the **Pitch and Time Utilities** panel with two sections.
  Pitch: **Fit to Scale**, **Invert**, **Transpose** (semitones or scale degrees), **Add Interval**.
  Time: **Double/Halve** (×2, /2), **Stretch Factor** (÷10..×10), **Set Length**, **Humanize**, **Reverse**,
  **Legato**. Manual 8.5 / 10.5.9.

### 2.3 MIDI note editing operations **[12.0]**
- **Split** (hold E + click, or Ctrl/Cmd-E), **Chop** (E+Ctrl/Alt drag, or Ctrl/Cmd-E then arrow keys),
  **Join** (Ctrl/Cmd-J, preserves MPE), **Span / Fit to Time Range** (Ctrl/Cmd-Alt-J), **Invert Selection**
  (Ctrl/Cmd-Shift-A), **Crop Clip to Time Selection**, Narrow/Widen Grid shortcuts, **Step Input Mode**
  (Options menu), **MIDI Note Number** labelling instead of accidentals, **Normalize Clip Sample**.
- **Editor View Modes**: Clip editor tabs **Notes / Envelopes / MPE** (audio: **Sample / Envelopes**);
  cycle with Alt-Tab. Velocity/Chance lanes toggle via drop-down; **Randomize** + **Randomize Range** moved to
  the editor footer; **Velocity Range renamed Velocity Deviation**; Release Velocity gets its own lane [12.1].
- Keyboard: adjust velocity (Alt/Cmd ↑↓), velocity deviation, chance from the keyboard; resize an Arrangement
  clip from the keyboard (Enter + arrows).
- **MIDI Note Probability Groups**: **Group Notes (Play All)** / **Group Notes (Play One)** (Ctrl/Cmd-G) —
  one Chance value for a group; Play One plays exactly one note of the group (random chord tones).
  Hovering a grouped note highlights the whole group. Manual 10.5.13.
- **12.1 Find and Select Notes**: magnifying-glass button in the Clip Content Editor settings (next to Fold).
  Filters: **Pitch, Time (repeatable), Velocity, Chance, Duration, Count (every nth), Condition, Scale**;
  Shift-click multiple piano-ruler keys; **repeated time selection** with Shift-drag. Manual 10.5.3.
- **12.2**: Shift-drag over notes to add them to the selection. **12.4**: wider note-resize grab area; resize
  from just before note start.

### 2.4 Keys and Scales — "Scale Awareness" **[12.0]**
- **UI**: **Scale Mode** toggle + **Current Scale Root Note** + **Current Scale Name** choosers in the
  **Control Bar**; the same controls in each clip's Main Clip Properties panel (8.2.4 *Clip Scale*). Scale is
  stored **per clip**; the Control Bar reflects whichever clip is playing/selected (asterisks for mixed
  selections; multi-clip edit applies to all).
- In the MIDI Note Editor: **Highlight Scale** (purple key tracks) and **Fold to Scale** (G key) alongside
  **Fold to Notes** (F key). Manual 10.6 *Folding and Scales*; concepts 3.13.
- Scale-aware devices via a **Use Current Scale** title-bar toggle: MIDI effects **Arpeggiator, Chord, Pitch,
  Random, Scale**; **Meld** (oscillators / resonator filters); **12.2** adds **Meld Chord oscillator**,
  **Resonators**, **Spectral Resonator** (Quantize harmonics to scale). Pitch parameters switch from semitones
  to scale degrees. MIDI Tools and Pitch/Time Utilities follow the scale.
- **12.1**: **Scale Awareness for Audio Clips** (set a scale on an audio clip; forwarded to devices — Auto Shift
  is the first scale-aware audio effect); scale on **Drum Rack tracks**. **12.3**: Splice **Apply Key from
  DAW**. Push follows the Set's scale.

### 2.5 Tuning Systems **[12.0]**
- **What**: load **Scala (.scl)** or Ableton **.ascl** files to leave 12-TET. Core Library ships a **Tunings**
  label in the browser. All built-in instruments follow the tuning; MPE plug-ins / M4L instruments follow it
  if pitch-bend range = 48 st. Drum Racks bypass tuning automatically.
- **UI**: **Tuning** entry in the View menu / double-click an .ascl → **Tuning section/panel** in the browser
  (reference pitch, octave, expanded details: Source, Link, notes per octave; save as .ascl). Per-track
  **Bypass Tuning** toggle and **Track Tuning MIDI Mapper** chooser in the mixer's I/O section. Loading a
  tuning **hides the Scale controls** and disables Use Current Scale. Piano roll shows the tuning's notes;
  hovering shows pitch/frequency and the Status Bar shows the controller input key. Delete the loaded tuning to
  return to 12-TET. Manual ch. 15 *Using Tuning Systems*.
- **12.0.5**: set lowest/highest note (ranges < 128 notes). **12.1**: 12-note tunings work with Live's
  built-in scales; **Tuner** device supports tunings; Max for Live API `live_set tuning_system`; MPE pitch
  bend tuned per tuned step; apply tuning to MPE plug-ins via device-header context menu. **12.2**: Resonators
  / Spectral Resonator tuning support. **12.4.3**: better 12-tone tuning support inside MIDI Tools.

### 2.6 Browser: Filters, Tags, Similarity Search **[12.0]**
- **Browser Filtering and Tags**: **Filter Groups** (Sounds, Drums, Instruments, Audio Effects, MIDI Effects,
  Modulators, Devices, Type, Character, Content, Creator, Format, Function…) shown per label; Ctrl/Cmd multi-
  select within a group; `#tag` search syntax with autocomplete; **Add Label** saves a filtered result as a
  **custom label** in the sidebar (auto-updating); **Tags Editor** (Add Tag…, Add Group…, rename/delete user
  tags). Tags replaced folder groups inside category labels. New **All** label (flat search across everything).
  **Browser History** (Browse Back/Forward, Ctrl/Cmd-[ ]). Multi-select almost everywhere; unfold a Set to
  drag in its tracks' device chains (incl. returns + Main). Async browser loading. **Browser File Preview**
  option (Options menu). Manual ch. 4 (4.2 Search Bar, 4.2.1 custom labels, 4.3 History, 4.4 Filters and
  Tags → 4.4.1 Filter Groups, 4.4.2 Tags, 4.4.3 Tag Editor, 4.4.4 Quick Tags, 4.5 Collections).
- **Similarity Search** (a.k.a. Sound Similarity Search): click the **Similar Files** icon on a sample /
  instrument preset / drum preset, or right-click → **Show Similar Files**, or Ctrl/Cmd-Shift-F. Results
  (≤60 s samples) listed most→least similar in the All label with a similarity bar; reference shown in the
  search field; custom labels remember their reference. Background analysis states shown in the Status Bar
  (Scanning / Pending / Processing / Paused / Done, with Pause/Resume). Manual 3.4 *Sound Similarity*.
- **Similar Sample Swapping**: in **Simpler** (Swap to Previous/Next Similar Sample buttons by Hot-Swap;
  Ctrl/Cmd ←→; **Return to Reference**, **Save as Similarity Reference**) and in **Drum Rack**
  (**Show/Hide Sample Swap Buttons** in the title bar; **Swap All Pads to Previous/Next Similar Sample**;
  per-pad swap; **Lock Pad for Similar Sample Swapping**; hold Alt to reveal). Manual 41.23.
- Point releases: 12.0.5 **Group by Vendor** for plug-ins, reorder Library labels; 12.1 **Auto Tagging**
  (samples < 60 s get analysed tags; VST3 tagged from metadata; **Include Auto Tags** toggle; blue vs yellow
  checkmarks), **reorder tags/tag groups**, **tag folders**, **subtags** (one level) + folding, **Full-Height
  Browser**; 12.1.5 `#` searches all filter groups incl. Content/Function/Format/Creator, VST2/VST3 icons;
  12.1.10 native devices before plug-ins, filter count above content pane.

### 2.7 Layout / views / mixer **[12.0]**
- **Toggle Clip View Alongside Device View** (press coverage: "**Stacked Detail Views**"): both detail views can
  be open at once — Clip View stacked above Device View. **UI**: triangle toggles next to the Clip View and
  Device View selectors at the bottom-right (left of the Mixer View toggle); Ctrl/Cmd-Alt-3 / -4; Alt-click a
  toggle opens both; Shift-Tab moves focus between the two. Device View width no longer limited by the
  browser. Manual 23.1 *Device View*; 3.12 *Clip and Device View*. (Ableton's marketing lists this under
  Live 12; nothing in 12.1's notes changes it.)
- **Mixer in Arrangement**: the Session mixer is now available in Arrangement View. **Mixer View toggle**
  bottom-right + drop-down to choose sections (In/Out, Sends, Returns, Volume, Track Delay, Crossfader,
  Performance Impact); enabled sections stored per view; View → Mixer (Ctrl/Cmd-Alt-M). Old per-section
  show/hide buttons removed; Arrangement's right-hand controls renamed **Arrangement Track Controls**.
  Manual 6.15; ch. 18.
- **Mixer Improvements**: bigger fader handles left of the meters, dB values right; higher-contrast rounded
  meters; taller max mixer; new gradient from −16 dB to 0 dB; better peak/RMS ballistics; 6-px **track-colour
  stripe** under each strip; 12.0.5 peak hold 10 s→2 s, resizable Arrangement volume section;
  12.1 mixer has its own focus frame; **12.3 reduced minimum mixer height** (pan hides, activators compress).
- **UI View Styling**: new corner **view controls** (Browser, Session/Arrangement, Mixer, Info View);
  new **Themes** (warm/cool tone, contrast, high-contrast, **Follow System** light/dark) under new
  **Theme & Colors** settings; borderless rounded views; redesigned scrollbars (**Show Scroll Bars**: Always /
  When Scrolling / Follow System); Control Bar fits 1280 px; independent **zoom per window**;
  Groove Pool toggle moved into the browser drop-down; Preferences renamed **Settings** (12.0.5).
- Zoom/scaling: Display & Input → **Zoom Display**; **12.1** Ctrl/Cmd +/− zooms the whole UI; Arrangement
  **vertical waveform zoom** toggle + slider (×/dB) right of the Time Ruler; Alt +/− zooms the MIDI editor
  (12.0.5); **12.2** resizing the browser/window zooms Arrangement content instead of pushing it off-screen;
  **12.2** optional GPU renderer on Windows.
- **Info View / hover**: Info View (bottom-left, `?`) shows the name/function of whatever is hovered; users can
  add **Edit Info Text** notes to tracks/clips/devices. 12.x additions: MPE lane names appear on hover; hover
  a grouped note to highlight its group; hover a tuning name for its details; hover piano-roll notes for
  tuned pitch/frequency and controller key in the Status Bar; more Info View text for context-menu items
  (12.0.5), Clip editor view modes (12.1.5), Device View area (12.4). Manual 2.2.2 *Info View*.

### 2.8 Keyboard navigation, shortcuts, accessibility **[12.0]**
- **Navigate menu**; **Use Tab to Move Focus**; Alt/Option-0…7 jump to Control Bar / Session / Arrangement /
  Clip View / Device View / Browser / Groove Pool / Help(Learn) View; Shift-Alt-M focuses the Arrangement mixer;
  Alt-arrows between controls; Esc to track header; PgUp/PgDn = 8 scenes.
- **Keyboard Workflow**: Shift+letter shortcuts work with Computer MIDI Keyboard on; Delete resets controls;
  **Freeze** Ctrl/Cmd-Alt-Shift-F; **Clip Markers** submenu (Ctrl-F9…F12 set start/loop/end from selection);
  **Move Insert Marker To Playhead** (Ctrl/Cmd-Shift-Space); **momentary latching** of A/B/S/Z/F1–F8/Tab;
  Fold/Unfold tracks U / Shift-U; metronome key = O; Session record Ctrl/Cmd-Shift-F9.
- **Screen Reader Support** (VoiceOver/NVDA) for transport, browser search, Session/Arrangement, clip/scene
  properties, MIDI editing, native devices, mapping, grooves, tunings; Options → **Accessibility** submenu
  (Speak Menu Commands, Speak Time in Seconds, etc.). Manual ch. 40; 41.
- 12.1: Filters/Tag Editor accessible; 12.2: **Automation and Modulation Keyboard Workflow** (Enter selects/
  creates breakpoints, arrows move, type values, Tab cycles, Alt-↑↓ cycles automated parameters).

### 2.9 Arrangement View changes across 12.x
- **12.0**: `R` reverses MIDI clips too; deactivated clips show full content; vertical waveform zoom;
  **Move Clips with Arrow Keys** setting; keyboard clip resize; Optimize Height/Width toggles moved under Main
  track; selecting a lane header selects its content; **Comping (Take Lanes) now in all editions incl. Lite**;
  **Freeze and Flatten Track** command; **Return tracks can be copied/pasted/duplicated/reordered**;
  **Playback menu**; Master → **Main track**; **Keep Latency** / Track Options; mouse-wheel-hold pans.
- **12.0.5**: **Crop** shortcut Ctrl/Cmd-Shift-J and in loop-brace menu; Ctrl-Alt-I / -R toggle In/Out and
  Returns in the Arrangement mixer; automation lanes only wheel-scroll when highlighted.
- **12.1**: **Split Clip from Clip View** (Ctrl/Cmd-Shift-E); Crop follows the actual time selection; time
  selection/split/crop work in **unwarped** audio clips; Overview inside the focus frame; faster close of
  clip-heavy Sets. 12.1.5: new locator gets focus; big scroll/zoom frame-rate improvement.
- **12.2**: **Show/Hide Take Lanes** button in track headers; **Delete All / Delete Unused Take Lanes**;
  **Group Tracks** show a zoomable overview and aggregate nested sub-groups into one lane; duplicate
  automation lanes suppressed, Show Automation focuses the lane; song-start-at-locator marker drawn green.
- **12.3**: **Insert Empty MIDI Clip** works without a selection (1 bar or grid, whichever longer);
  double-click creates a clip in a partially-filled grid cell; **Shift+double-click** creates a clip over a
  drawn range; notes whose starts fall outside the clip aren't drawn; take lanes insertable from automation
  mode.
- **12.4**: macOS Cmd-click toggles the grid for off-grid insert markers / selections; Esc from timeline to
  lane headers; **Copy Time** command (Ctrl/Cmd-Shift-C — which *removed the Capture MIDI shortcut*);
  clip **Fade** button visible for all Arrangement clips (fades loop jumps).
- **Locators**: unchanged in scope — manual 6.4 *Launching the Arrangement with Locators* (Set Locator
  button, launchable/quantised, Previous/Next). No "sections" feature exists; Performance Pack's
  **Arrangement Looper** (four loop lengths at the current position) is the closest thing.

### 2.10 Session View changes across 12.x
- Scene tempo / time signature (Live 11) now visible by default in the Main track with a View-menu toggle
  (12.0.5); **Scene View** panel (tempo/signature + follow actions). Clip→Arrangement drag now preserves
  scene ordering and extends looped clips to the longest; Ctrl/Cmd-Enter = Clip Stop for selected slots;
  **12.2 Scene Follow Actions: Unlinked / Longest** modes with loop-length or "Clip End" readout;
  **12.4** `S` solos a selected chain; deactivated-clip colours; slot borders take clip colours.
  Manual ch. 7; 16.7 Follow Actions.

### 2.11 New devices and device changes in 12.0
- **Meld** (Suite): bi-timbral **macro oscillator** synth, engines A/B, ~24 oscillator types (Basic Shapes, FM,
  Chip, Shepard's Pi, Noise Loop, Crackle, Rain…), per-engine filters incl. **scale-aware resonators**,
  two envelopes + two LFOs per engine with **LFO FX**, expandable **modulation matrix**, MPE. Manual 30.8.
- **Roar** (Suite): three-stage colour/saturation; routings **Single, Serial, Parallel, Multi Band, Mid Side,
  Feedback**; 12 shaper curves; pre/post filters; 2 LFOs + Envelope Follower + Noise + matrix; Feedback with
  time modes; **Compress**. Manual 28.33.
- **Granulator III** (Suite, Max for Live, Robert Henke): grain modes **Classic / Loop / Cloud**, real-time
  capture (**Ext-in**), MPE (Slide, poly Press), nine filters incl. combos, stereo-phase LFO.
- **Drift** is *not* new in 12 — it arrived in **Live 11.3 (May 2023)** as the first MPE synth in every
  edition; 12.2 adds a **Hi-Quality** mode (title-bar context menu). Manual 30.3.
- **CC Control** (new MIDI effect): send CC/mod wheel/pitch bend/pressure to hardware; automatable; 12.1
  adds **Learn**. Manual 29.2.
- **Arpeggiator** (new display, Style pattern browsing, Use Current Scale), **Chord** (Strum, Strum Tension,
  Strum Crescendo, Velocity/Chance per note, **Learn**, per-note MPE), **Pitch** (Step Up/Down + Step Width,
  Block/Fold/Limit modes), **Random** (Scale→Interval; Random/Alt toggles), **Scale** follows the clip scale,
  **Note Length** Latch mode, **Sampler Round Robin** (Forward/Backward/Other/Random + reset interval),
  **Operator** per-note pitch bend, **Multiband Dynamics** UI, **Shaper** play modes, **LFO** Steps/Shape/
  Stray/Glider/10× audio-rate, **Expression Control** overhaul (legacy kept), **Envelope MIDI** slopes.
- **New Modulation Behavior**: M4L modulators (LFO, Shaper, Envelope Follower, Expression Control, Envelope
  MIDI, Shaper MIDI) get a **Mod** toggle so modulation is relative and the underlying value stays editable
  (green dot indicator); Clip Modulation on all built-in M4L parameters.
- Device View: taller meters, chain input meters, rounded drop areas; all instruments now MPE (label dropped).

### 2.12 Packs at launch
- **Performance Pack** (Iftah; Live 12 Standard + M4L / included in Suite): **Performer** (floating widget window
  of faders/crossfaders/buttons/dials mapped to anything), **Variations** (snapshots of the whole Set with
  include/exclude), **Arrangement Looper** (four loop lengths at the playhead), **Prearranger** (pre-lay clips
  then fill them by performing).
- **Lost and Found** (foley/percussive trinkets), **Beats Tool Pack**, **Trap Drums** / **Golden Era Hip Hop
  Drums** (Sound Oracle, MPE kits), **MIDI Tools Pack**, **Sequencers Pack**, Live 12 Demo Set "Patience".

---

## 3. Live 12.1 (8 Oct 2024)

| Feature | What | UI / manual |
|---|---|---|
| **Auto Shift** (all editions) | Real-time monophonic pitch tracking + correction with formant shift; quantise to built-in or user scales (**Scale Aware** button); polyphonic harmonies via **MIDI sidechain**; vibrato LFO + multi-purpose LFO (Pitch/Formant/Volume/Pan, reset on onset); MPE modulation in MIDI mode; **Live Mode** for low latency. First scale-aware audio effect. | Audio effect; tabs **Quantizer / MIDI / LFO**, Pitch & Vibrato sections. Manual 28.4 |
| **Drum Sampler** (all editions) | Compact one-shot sampler for Drum Racks: start/length, AHD env, transpose/detune, 4-mode filter, nine **playback effects** (Stretch, Loop, Pitch Envelope, Punch, 8 Bit, FM, Ring Modulation, Sub-Oscillator, Noise) on an X/Y pad; Velocity/Slide modulation; **Save as Default Pad**; double-click a sample into the selected pad; replaces DS Sampler; context-menu swap Simpler↔Drum Sampler. | Instrument. Manual 30.4 |
| **Limiter** update | Smoother release, new metering, **Mid/Side** routing, continuous Gain Reduction Link, **Soft Clip**, **True Peak**, **Maximize** toggle. | 28.24 |
| **Saturator** update | Focused main view with real-time curve visualisation, **Bass Enhancer** curve with Threshold, Hard second-stage clip, expanded pre-shaper EQ view. | 28.34 |
| **Find and Select Notes** | See §2.3. | 10.5.3 |
| **Chop / Glissando / LFO** MIDI Tools; chains; mappable tools | See §2.1. | ch. 11 |
| **Scale Awareness for Audio Clips**; scale on Drum Rack tracks | See §2.4. | 8.2.4 |
| **Apply Grooves Instantly** | A groove is auto-loaded into every new Set and applied to new MIDI clips at **Global Groove Amount** 0 %; amount visible in the Groove Pool *and the Control Bar*; **Auto Load Groove** toggle + Hot-Swap. | ch. 14 |
| **Undo History** | List of undo/redo steps; jump multiple steps. View → Undo History (Ctrl/Cmd-Alt-Z). | 5.4.2 |
| **Full-Height Browser** | Browser stretches to the Status Bar; drop-down next to the Show/Hide Browser toggle / View menu. | ch. 4 |
| **Auto Tagging** (user content + VST3) | See §2.6. | 4.4.2 |
| Tag reordering / tag folders / subtags / Reset Tag Order | See §2.6. | 4.4.3 |
| **Envelope Follower** sidechain, **Echo** repitch smoothing, **Meld** Phase Reset/Spread, **Tuner** tunings, **CC Control** Learn | Device improvements. | ch. 28/32 |
| Release Velocity lane; foreground-clip LED in multi-clip editing; MPE pitch-bend lane for Drum Rack tracks | MIDI editor. | ch. 10/12 |
| Ctrl/Cmd +/− zooms the UI; Max for Live UI objects tab-navigable | Accessibility. | ch. 40 |
| **Move control surface** support; Push 2/3 get Macro Variations, Global Groove encoder, Set save on hardware | Hardware. | — |

---

## 4. Live 12.2 (11 Jun 2025)

| Feature | What | UI / manual |
|---|---|---|
| **Bounce to New Track** | Render clips or a time selection (may span clips/parts) from any MIDI/audio track **post-FX, pre-mixer** to a new audio track placed below the source; source clips muted; mixer settings copied; multi-track selection → one new track each. Files in `Samples/Processed/Bounce`; new track named "<src> (Bounce)". | Clip/selection context menu, Edit menu, **Ctrl/Cmd-B**. Manual ch. 20 *Bounce to Audio* (20.1) |
| **Bounce Track in Place** | Whole track rendered to audio, replacing it (renamed from *Freeze and Flatten Track* / *Flatten*). | Track title-bar / clip context menu. 20.1 |
| **Auto Filter** redesign | New UI + sound; per-channel L/R modulation display and output spectrum; filter types **DJ, Comb, Vowel, Morph, Resampling, Notch + LP** (plus LP/HP/BP/Notch); circuits **SVF, DFM, MS2, PRD**; LFO shapes **Wander, Ramp Up/Down** + Morph; S&H smoothing; LFO quantisation **Steps / S&H**; **Envelope Attack Hold**; mono sidechain + sidechain EQ; **Output**, **Clip**, **Dry/Wet**. Also on Note and Move. | 28.2 |
| **Automation and Modulation Keyboard Workflow** | Select/create/move/type breakpoints from the keyboard; cycle automated parameters. | 25.5.2; 40.5 |
| **Browser**: Filter View redesign, **Filter View Menu**, **Content Columns** (choose/reorder/sort; Show File Extensions), **Quick Tags** panel (above Preview; Ctrl/Cmd-E to Add field), **Custom Icons** for labels/user folders, results-bar filter count, **MIDI Tools filter group**, presets grouped by device folder in All | See §2.6. | 4.1, 4.4.4 |
| **Expressive Chords** (Max for Live; Intro/Standard/Suite via Packs page) | Play "interesting, nuanced, natural-sounding" harmonies from single notes using **52 curated chord sets**; MPE controls; keyboard/pad layouts; import own chord sets; **12.3 adds Chord Edit mode** (transpose / custom chords). | MIDI effect device |
| **Roar** update | **Delay** routing mode, **Dispersion** filter, external sidechain for the envelope follower, **MIDI sidechain** pitch control in Note mode (**MIDI > FB Note**), **Envelope Hold**, modulation LEDs. | 28.33 |
| **Meld** update | **Chord** oscillator (four saws, **Use Current Scale**), **Scrambler** LFO FX. | 30.8 |
| **Resonators / Spectral Resonator** | Scale awareness + tuning; Spectral Resonator **Quantize** harmonics. **Operator** 32 voices. | 28.31 / 28.36 |
| **Device header** redesign | Sidechain toggle moved left with its own header (Auto Filter, Compressor, Corpus, Gate, Glue Compressor, Multiband Dynamics, Shifter); triangle only for sidechain, new **arrow** for breakout views; **context-menu button** in every title bar; Compressor sidechain filter in own panel. M4L **Edit in Max**. | 23.2.1 |
| Drum Sampler: **Envelope Follows Pitch**, Hold to Inf, Simpler→Drum Sampler keeps markers; **Drift Hi-Quality** | Devices. | 30.4 / 30.3 |
| Session: **Scene Follow Actions Unlinked/Longest**; Arrangement: take-lane buttons, group overview, automation-lane dedupe | See §2.9/2.10. | 7 / 6 |
| Enum parameters get min/max when macro/MIDI-mapped; VST3 program changes; Shift-drag note multi-select; Windows GPU renderer; .ablbundle (Note/Move) opens faster | Misc. | — |
| Push 3: **16 Pitches** layout, Follow Actions, Groove Pool + Tuning Systems access, External Audio Effect. Move 1.5: slicing, 4-track MIDI I/O, MIDI clock, Auto Filter | Hardware. | — |

---

## 5. Live 12.3 (25 Nov 2025)

| Feature | What | UI / manual |
|---|---|---|
| **Stem Separation** (Suite; also Push 3 Standalone) | Local separation of any audio into **Vocals, Drums, Bass, Others**; modes **High Speed** (single pass) / **High Quality** (per-stem passes); stems land on colour-coded tracks inside a new **Group Track** with the source track's effects; source clip muted; files in `Samples/Processed/Stems` (44.1 kHz). | Right-click a sample in the browser or a clip in Session/Arrangement → **Separate Stems to New Audio Tracks**. Manual ch. 22 |
| **Splice Integration** | Splice library as a browser **label**: browse/preview in sync with the transport, drag or double-click to load, download to `User Library/Samples/Splice` (configurable in Library Settings). **Search with Sound**: select a clip/time and Splice returns complementary samples by style + rhythm. Key filter **Apply Key from DAW** (major/minor) and **Transpose** preview sync. Free account needed. | Browser → Splice label (Home tab). Manual 4.7.3 |
| **Bounce Group to New Track** / **Bounce Group in Place** | Group bounced with all processing incl. return tracks (pre-FX on Main). | Group slot / Group lane context menus, Ctrl/Cmd-B. 20.2 |
| **Paste Bounced Audio** | Copy clips or a time selection from one track, then paste as freshly bounced audio into an audio track, empty MIDI track, or **take lane**; re-paste after edits for variations. | Context/Edit menu, **Ctrl/Cmd-Alt-V**. 20.3 |
| **Device A/B Comparison** | Every built-in device holds two parameter states; **Compare: Switch to A/B** (key **P**) and **Compare: Copy A/B to B/A**; automation follows the state; M4L API access. | Device title-bar Options menu. 23.2.2 |
| **Auto Pan-Tremolo** | Auto Pan renamed; **Panning / Tremolo** modes with real-time position/level visualisation; LFO time modes 16th/Triplet/Dotted/**Time** (seconds); **Modulation Attack** (protect transients); **Frequency Modulation** by input level; Tremolo shape/invert, **Harmonic** and **Vintage** modes. Old device = **Auto Pan Legacy**. | 28.3 |
| Arrangement MIDI-clip creation improvements; multi-clip **Set 1.1.1 Here**; browser default sidebar icons, device/preset icons, **Content|Backup Set** filter, Filter View (Ctrl/Cmd-Alt-G) / Tag Editor (Ctrl/Cmd-Shift-E) shortcuts, Quick Tags double-click search, **Hide from Sidebar** for Splice/Cloud/Push | See §2.9 / §2.6. | — |
| **Reduced minimum mixer height** | Mixer can be shrunk far more; pan hides, activators compress. | ch. 18 |
| Packs: **Generators by Iftah** (Sting, Patterns); Sequencers Pack reproducible arrangements; Expressive Chords Chord Edit | — | — |
| Push 3: **XYZ Layout**, **Rhythm Generator**, standalone stem splitting, class-compliant audio interfaces. Move 1.8: Auto Pan-Tremolo. | Hardware. | — |
| M4L API: `Track.insert_device`, `Chain.insert_device`, `RackDevice.insert_chain`, `DrumChain.in_note`; faster track creation; new Windows installer | Dev/infra. | — |

---

## 6. Live 12.4 (5 May 2026) — current major

| Feature | What | UI / manual |
|---|---|---|
| **Link Audio** | Stream multichannel audio in real time between Link peers (Live, Note, Move, Push Standalone) over LAN/Wi-Fi; all tracks with audio output are receivable; automatic latency handling. Peers listed in a new **Link drop-down in the Control Bar**; pick a peer in an audio track's input chooser, then the source track; monitor In / arm to record. Settings → new **Link** page: **Audio**, **Name**, **Latency**, **Sync to Incoming Audio**, **Peers**. | 2.3.4; 36.1.1–36.1.3 |
| **Learn View** (replaces Help View) | Video + text modules, filter by topic, completion checkmarks, **Picture-in-Picture** player, content updated independently of Live; "Pack lessons" → **Pack Info pages** (Help → Pack Overview). | 2.2.1 |
| **Erosion** redesign | **Noise Blend** merges the old sine/noise modes, **Stereo Width**, real-time spectrum, latency 2 ms; old = **Erosion Legacy**. | 28.17 |
| **Chorus-Ensemble** | Classic → **Chorus** mode; new **Time** (fixed delay / Auto) and **Taps** (1 or 2). | 28.8 |
| **Delay** | LFO rate in Hz / ms / synced; seven waveforms + **Morph**. | 28.11 |
| **Separate Stems for Time Selection**; **Merge to Single Track**; only the audible clip portion is processed; total progress; bit depth kept; GPU on macOS 26.3+ | Stem separation. | ch. 22 |
| **Quick Tags** can create tags, parent tags, tag groups inline | Browser. | 4.4.4 |
| **Copy Time** (Ctrl/Cmd-Shift-C); Cmd-click off-grid selection; Esc to lane headers; Fade button for loop jumps | Arrangement. | ch. 6 |
| Wavetable 16 voices; rename folded devices; Drum Sampler 8-bit decay off; naming consistency; `S` solos chains; deactivated-clip colours; wider note-resize hit area; Link driver warning | Misc. | — |
| M4L: Max 9.1.4, **Visible / Visible (Not Stored)** parameter modes, `SimplerDevice.replace_sample`, **Max for Live Developer Mode** in the Options menu | Dev. | ch. 31 |
| Push: MIDI mappings created on Push Standalone, custom control scripts, Link Audio. **Move 2.0 / Note 2.0**: audio tracks/clips, mic/line/USB-C recording, pitch-preserving warp, MIDI→audio, Auto Shift + Erosion, one-way Link Audio sharing | Hardware. | — |

---

## 7. Cross-cutting topics the gap analysis asked about

### 7.1 Bounce family (summary)
- 12.0 *Freeze and Flatten Track* → 12.2 **Bounce Track in Place**, **Bounce to New Track** (Ctrl/Cmd-B) →
  12.3 **Bounce Group to New Track**, **Bounce Group in Place**, **Paste Bounced Audio** (Ctrl/Cmd-Alt-V) →
  12.3.5 bounced tracks numbered. Track bounces are post-FX/pre-mixer; group bounces are post-mixer of the
  group (pre-Main FX). Manual ch. 20; shortcuts 41.18.

### 7.2 Comping / Take Lanes (Live 11 → 12)
- Take lanes recorded per pass (loop recording); **Audition** (T); Enter promotes a selection to the main lane;
  **Source Highlights** resize the comp split points; drag samples from the browser into take lanes; Insert Take
  Lane (Shift-Alt-T); Ctrl-Alt-U shows/hides lanes. 12.0: all editions; 12.2: header Show/Hide button, delete
  all/unused; 12.3: Paste Bounced Audio into a take lane, insert from automation mode; 12.4: clearer
  inactive colours; M4L API for take lanes (12.2). Manual ch. 21.

### 7.3 Linked-Track Editing (Live 11)
- Link tracks so moving/resizing clips, fades, splits etc. apply across them (essential for multi-mic
  comping). Manual 6.14 (6.14.1 Linking and Unlinking, 6.14.2 Editing Linked Tracks). No 12.x changes.

### 7.4 MPE (Live 11.x → 12)
- **Expression** editor view mode with Pitch (on the note), Slide, Pressure, Velocity, Release Velocity lanes;
  draw mode; MPE presets; MPE/Multi-channel Settings for plug-ins; 11.3 gave MPE to Analog/Collision/Electric/
  Tension and added Drift; 12.0 all instruments MPE; 12.1 Glissando + LFO transformations, Drum Rack pitch-bend
  lane, Auto Shift MPE; 12.2 Expressive Chords MPE. Manual ch. 12.

### 7.5 Chance / Probability / Velocity Deviation (Live 11 → 12)
- Chance lane (0–100 %), **Velocity Deviation** (ex-Velocity Range), Randomize + Randomize Range in the editor
  footer, **Probability Groups Play All / Play One** [12.0], Find and Select by Chance/Velocity [12.1],
  Push edits group chance. Manual 10.5.12–10.5.13.

### 7.6 Follow Actions (Live 11 → 12)
- Per clip: Chance A/B, Linked (clip end × loops) / Unlinked (time), actions No Action / Stop / Play Again /
  Previous / Next / First / Last / Any / Other / Jump. Per scene (Scene View) with 12.2's **Unlinked / Longest**.
  Manual 16.7; 8.3.1; 7.2.2.

### 7.7 Macro Controls: Variations & Randomize (Live 11 → 12)
- Up to 16 macros; **Macro Variations** view (New / launch / overwrite / exclude a macro); **Rand** button with
  per-macro exclusion; 12.2 min/max for enum parameters. Manual 24.7 (24.7.2 Randomizing, 24.7.3 Variations).

### 7.8 Tempo Follower / sync
- Follow button in the Control Bar (Show Tempo Follower Toggle), input channel in Tempo & MIDI Settings;
  exclusive with external sync; 12.0 deleting a followed track deletes its tempo automation; 12.4.3 down to
  10 BPM. Link + **Link Audio** [12.4]; MIDI Clock / MTC; **Resync External Hardware** [12.0]. Manual ch. 36.

### 7.9 Capture MIDI
- **Capture** button in the Control Bar: Live always listens on armed/monitored tracks; stopped + empty Set →
  new clips, tempo detection (80–160 BPM) and loop; playing → phrase detection / overdub. 12.2.5 buffer no
  longer cleared when playing over a stopped clip; **12.4 removed the keyboard shortcut** (given to Copy
  Time). Manual 19.10.

### 7.10 Move / Note / Cloud integration
- Browser **Cloud** label syncs Sets from Note and Move (sign in on ableton.com); `.ablbundle` import (12.2
  faster, reuses downloaded audio); **Push** label transfers from Push 3 Standalone; Move as a **control
  surface** [12.1] with Note Mode, step sequencing, audio clips in Note Mode [12.4]; Move firmware 1.5/1.8/
  2.0 mirror Live devices (Auto Filter, Auto Pan-Tremolo, Auto Shift, Erosion, Drift, Drum Sampler);
  Link Audio between all of them [12.4]. Manual 4.7.4, 4.7.5.

### 7.11 Device visualisations added in 12.x
- 12.0 Arpeggiator pattern display, Device View meters; 12.1 Saturator live curve + spectra, Limiter metering,
  Drum Sampler X/Y; 12.2 Auto Filter L/R modulation + output spectrum, Roar modulation LEDs; 12.3
  Auto Pan-Tremolo position/level; 12.4 Erosion spectrum, Delay LFO shapes. Also Meld/Roar matrices.

### 7.12 Editions
- Comping in Lite since 12.0; Auto Shift, Drum Sampler, Limiter/Saturator in all editions; Expressive Chords
  Intro+; Meld/Roar/Granulator III/Stem Separation Suite; MIDI Tools + Max for Live tools Standard/Suite.

---

## 8. Full Live 12 device inventory (from manual ch. 28–30, 32)

- **Audio effects (28)**: Amp, Auto Filter, Auto Pan-Tremolo, Auto Shift, Beat Repeat, Cabinet, Channel EQ,
  Chorus-Ensemble, Compressor, Corpus, Delay, Drum Buss, Dynamic Tube, Echo, EQ Eight, EQ Three, Erosion,
  External Audio Effect, Filter Delay, Gate, Glue Compressor, Grain Delay, Hybrid Reverb, Limiter, Looper,
  Multiband Dynamics, Overdrive, Pedal, Phaser-Flanger, Redux, Resonators, Reverb, Roar, Saturator, Shifter,
  Spectral Resonator, Spectral Time, Spectrum, Tuner, Utility, Vinyl Distortion, Vocoder
  (+ Legacy: Auto Filter Legacy, Auto Pan Legacy, Erosion Legacy, Expression Control Legacy).
- **MIDI effects (29)**: Arpeggiator, CC Control, Chord, Note Length, Pitch, Random, Scale, Velocity.
- **Instruments (30)**: Analog, Collision, Drift, Drum Sampler, Electric, External Instrument, Impulse, Meld,
  Operator, Sampler, Simpler, Tension, Wavetable.
- **Max for Live devices (32)**: DS Clang/Clap/Cymbal/FM/HH/Kick/Snare/Tom; Align Delay, Envelope Follower,
  LFO, Shaper; Envelope MIDI, Expression Control, MIDI Monitor, MPE Control, Note Echo, Shaper MIDI.
  Suite Packs add Granulator III, Expressive Chords, Performance Pack, MIDI Tools/Sequencers/Generators packs.

---

## 9. Live 12 manual — chapter list (42 chapters)

1. Welcome to Live · 2. First Steps · 3. Live Concepts · 4. Working with the Browser · 5. Managing Files and
Sets · 6. Arrangement View · 7. Session View · 8. Clip View · 9. Audio Clips, Tempo, and Warping ·
10. Editing MIDI · 11. MIDI Tools · 12. Editing MPE · 13. Converting Audio to MIDI · 14. Using Grooves ·
15. Using Tuning Systems · 16. Launching Clips · 17. Routing and I/O · 18. Mixing · 19. Recording New Clips ·
20. Bounce to Audio · 21. Comping · 22. Stem Separation · 23. Working with Instruments and Effects ·
24. Instrument, Drum and Effect Racks · 25. Automation and Editing Envelopes · 26. Clip Envelopes ·
27. Working with Video · 28. Live Audio Effect Reference · 29. Live MIDI Effect Reference ·
30. Live Instrument Reference · 31. Max for Live · 32. Max for Live Devices · 33. MIDI and Key Remote Control ·
34. Using Push 1 · 35. Using Push 2 · 36. Synchronizing with Link, Tempo Follower, and MIDI ·
37. Computer Audio Resources and Strategies · 38. Audio Fact Sheet · 39. MIDI Fact Sheet ·
40. Accessibility and Keyboard Navigation · 41. Live Keyboard Shortcuts · 42. Credits

The complete section-level table of contents (871 entries, extracted from the manual index page) is in
Appendix A at the end of this file.

---

## 10. Sources

Ableton (official)
- https://www.ableton.com/en/release-notes/live-12/  (all 12.0 → 12.4.5 notes; downloaded in full)
- https://www.ableton.com/en/live-manual/12/  (manual index; chapter + section list extracted from it)
- https://www.ableton.com/en/live-manual/12/midi-tools/
- https://www.ableton.com/en/live-manual/12/using-tuning-systems/
- https://www.ableton.com/en/live-manual/12/working-with-the-browser/
- https://www.ableton.com/en/live-manual/12/arrangement-view/
- https://www.ableton.com/en/live-manual/12/session-view/
- https://www.ableton.com/en/live-manual/12/clip-view/
- https://www.ableton.com/en/live-manual/12/editing-midi/
- https://www.ableton.com/en/live-manual/12/editing-mpe/
- https://www.ableton.com/en/live-manual/12/launching-clips/
- https://www.ableton.com/en/live-manual/12/mixing/
- https://www.ableton.com/en/live-manual/12/recording-new-clips/
- https://www.ableton.com/en/live-manual/12/bounce-to-audio/
- https://www.ableton.com/en/live-manual/12/comping/
- https://www.ableton.com/en/live-manual/12/stem-separation/
- https://www.ableton.com/en/live-manual/12/working-with-instruments-and-effects/
- https://www.ableton.com/en/live-manual/12/instrument-drum-and-effect-racks/
- https://www.ableton.com/en/live-manual/12/automation-and-editing-envelopes/
- https://www.ableton.com/en/live-manual/12/live-audio-effect-reference/
- https://www.ableton.com/en/live-manual/12/live-midi-effect-reference/
- https://www.ableton.com/en/live-manual/12/live-instrument-reference/
- https://www.ableton.com/en/live-manual/12/max-for-live-devices/
- https://www.ableton.com/en/live-manual/12/synchronizing-with-link-tempo-follower-and-midi/
- https://www.ableton.com/en/live-manual/12/accessibility-and-keyboard-navigation/
- https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/
- https://www.ableton.com/en/live/all-new-features/  (marketing summary of everything 12.0–12.4)
- https://www.ableton.com/en/blog/live-121-adds-auto-shift-drum-sampler-and-more-now-in-public-beta/
- https://www.ableton.com/en/blog/live-121-is-out-now/
- https://www.ableton.com/en/blog/live-12-2/  (12.2 announcement)
- https://www.ableton.com/en/blog/live-12-2-is-out-now/
- https://www.ableton.com/en/blog/live-12-3-is-here/
- https://www.ableton.com/en/blog/live-12-4-is-out-now/
- https://www.ableton.com/en/packs/performance-pack/
- https://www.ableton.com/en/blog/live-113-is-out-now/  (Drift's origin in 11.3; via search snippet)
- Not reachable: https://www.ableton.com/en/live/whats-new/ (404); help.ableton.com "What's new in Live 12 / 12.4"
  and "Navigation and View Options in Live 12 FAQ" (403 to the fetcher; only search snippets used).

Press / community
- Sound on Sound — Live 12 review: https://www.soundonsound.com/reviews/ableton-live-12
- Sound on Sound — "Live 12: What's New In v12.1": https://www.soundonsound.com/techniques/live-12-whats-new-v121
- Sound on Sound — Granulator III: https://www.soundonsound.com/techniques/ableton-live-12-granulator-iii
- Sound on Sound news (12.2 beta / 12.3 beta / 12.4 beta) via search: https://www.soundonsound.com/news/ableton-live-124-enters-public-beta
- MusicRadar — Live 12 everything new: https://www.musicradar.com/news/ableton-live-12-whats-new-devices-midi-workflow
- MusicRadar — Live 12 Suite review: https://www.musicradar.com/reviews/ableton-live-12-suite-review
- MusicRadar — Live 12.1 five things: https://www.musicradar.com/news/ableton-live-12.1-5-things
- MusicRadar — Live 12.4 out now: https://www.musicradar.com/music-tech/ableton-live-12-4-is-out-now-with-link-audio-and-updated-erosion-delay-and-chorus-ensemble-devices
- CDM — Live 12 guide to everything new: https://cdm.link/2023/11/ableton-live-12-everything-new/
- CDM — Live 12.1 public beta: https://cdm.link/ableton-live-12-1/
- CDM — Live 12.2 hands-on guide: https://cdm.link/live-12-2-hands-on-guide/
- CDM — Live 12.3 final: https://cdm.link/live-12-3-arrives/
- Sonic Bloom — Live 12 announced in depth: https://sonicbloom.net/ableton-live-12-announced-new-devices-features-depth/
- Sonic Bloom — Live 12.2, 12 small improvements: https://sonicbloom.net/ableton-live-12-2-12-small-improvements/
- Synth Anatomy — Live 12.4 overview: https://synthanatomy.com/2026/04/ableton-live-12-stay-creative-and-in-focus-an-overview-of-the-new-features.html
- MusicTech — Live 12.3: https://musictech.com/news/music/ableton-live-12-3/  (search snippet)
- Boost.Audio — "Live 13 in 2026 – reality vs speculation" (confirms nothing announced): https://boost.audio/en/news/ableton-live-13-w-2026-roku-rzeczywistosc-vs-spekulacje

---

## Appendix A — Live 12 manual, full section-level table of contents

### 1. Welcome to Live  (/en/live-manual/12/welcome-to-live/)
- 1.1 The Ableton Team Says: Thank You

### 2. First Steps  (/en/live-manual/12/first-steps/)
- 2.1 Installation and Authorization
- 2.2 Learning About Live
- 2.2.1 Learn View
- 2.2.2 Info View
- 2.2.3 Other Learning Resources
- 2.3 Live’s Settings
- 2.3.1 Display & Input
- 2.3.2 Theme & Colors
- 2.3.3 Audio
- 2.3.4 Link
- 2.3.5 Tempo & MIDI
- 2.3.6 File & Folder
- 2.3.7 Library
- 2.3.8 Plug-Ins
- 2.3.9 Record, Warp & Launch
- 2.3.10 Licenses & Updates

### 3. Live Concepts  (/en/live-manual/12/live-concepts/)
- 3.1 The Control Bar
- 3.2 The Status Bar
- 3.3 The Browser
- 3.4 Sound Similarity
- 3.5 Live Sets
- 3.6 Arrangement and Session
- 3.7 Tracks
- 3.8 Audio and MIDI
- 3.9 Audio Clips and Samples
- 3.10 MIDI Clips and MIDI Files
- 3.11 Devices
- 3.12 Clip and Device View
- 3.13 Scale Awareness
- 3.14 The Mixer
- 3.15 Presets and Racks
- 3.16 Routing
- 3.17 Recording New Clips
- 3.18 Automation Envelopes
- 3.19 Clip Envelopes
- 3.20 MIDI and Key Remote
- 3.21 Saving and Exporting

### 4. Working with the Browser  (/en/live-manual/12/working-with-the-browser/)
- 4.1 Content Pane
- 4.2 Search Bar
- 4.2.1 Saving Search Results as Custom Labels
- 4.3 Browser History
- 4.4 Filters and Tags
- 4.4.1 Filter Groups
- 4.4.2 Tags
- 4.4.3 Tag Editor
- 4.4.4 Quick Tags
- 4.5 Collections
- 4.6 Library
- 4.7 Places
- 4.7.1 Downloading and Installing Packs in the Browser
- 4.7.2 Pack Info
- 4.7.3 Splice
- 4.7.4 Using Ableton Cloud
- 4.7.5 Transferring Files from Push 3 in Standalone Mode
- 4.7.6 User Library
- 4.7.7 Current Project
- 4.7.8 User Folders
- 4.8 Navigating in the Browser
- 4.9 Previewing Files
- 4.10 Adding Content from the Browser to a Live Set

### 5. Managing Files and Sets  (/en/live-manual/12/managing-files-and-sets/)
- 5.1 Sample Files
- 5.1.1 The Decoding Cache
- 5.1.2 Analysis Files (.asd)
- 5.1.3 Exporting Audio and Video
- 5.2 MIDI Files
- 5.2.1 Exporting MIDI Files
- 5.3 Live Clips
- 5.4 Live Sets
- 5.4.1 Creating, Opening and Saving Sets
- 5.4.2 Accessing a Set’s Undo History
- 5.4.3 Merging Sets
- 5.4.4 Exporting Session Clips as New Sets
- 5.4.5 Template Sets
- 5.4.6 Viewing and Changing a Live Set’s File References
- 5.5 Live Projects
- 5.5.1 Projects and Live Sets
- 5.5.2 Projects and Presets
- 5.5.3 Managing Files in a Project
- 5.6 Locating Missing Files
- 5.6.1 Manual Repair
- 5.6.2 Automatic Repair
- 5.7 Collecting External Files
- 5.7.1 Collect Files on Export
- 5.7.2 Aggregated Locating and Collecting
- 5.8 Finding Unused Files
- 5.9 Packing Projects into Packs
- 5.10 File Management FAQs
- 5.10.1 How Do I Create a Project?
- 5.10.2 How Can I Save Presets Into My Current Project?
- 5.10.3 Can I Work On Multiple Versions of a Set?
- 5.10.4 Where Should I Save My Live Sets?
- 5.10.5 Can I Use My Own Folder Structure Within a Project Folder?

### 6. Arrangement View  (/en/live-manual/12/arrangement-view/)
- 6.1 Layout
- 6.2 Navigation and Zooming
- 6.3 Transport and Playback
- 6.4 Launching the Arrangement with Locators
- 6.5 Time Signature Changes
- 6.6 The Arrangement Loop
- 6.7 Moving and Resizing Clips
- 6.8 Audio Clip Fades and Crossfades
- 6.9 Selecting Clips and Time
- 6.10 Using the Editing Grid
- 6.11 Using the …Time Commands
- 6.12 Splitting Clips
- 6.13 Consolidating Clips
- 6.14 Linked-Track Editing
- 6.14.1 Linking and Unlinking Tracks
- 6.14.2 Editing Linked Tracks
- 6.15 The Mixer in Arrangement View

### 7. Session View  (/en/live-manual/12/session-view/)
- 7.1 Session View Clips
- 7.2 Tracks and Scenes
- 7.2.1 Editing Scene Tempo and Time Signature Values
- 7.2.2 Scene View
- 7.3 The Track Status Fields
- 7.4 Setting Up the Session View Grid
- 7.4.1 Select on Launch
- 7.4.2 Removing Clip Stop Buttons
- 7.4.3 Editing Scenes
- 7.5 Recording Sessions into the Arrangement

### 8. Clip View  (/en/live-manual/12/clip-view/)
- 8.1 Clip View Layout
- 8.1.1 Clip Title Bar
- 8.1.2 Clip Panels
- 8.1.3 Editor View Modes
- 8.2 Main Clip Properties Panel
- 8.2.1 Clip and Loop Region Settings
- 8.2.2 Clip Time Signature
- 8.2.3 Clip Groove
- 8.2.4 Clip Scale
- 8.3 Extended Clip Properties
- 8.3.1 Follow Action and Launch Controls
- 8.3.2 MIDI Clip Bank and Program Change Controls
- 8.4 Audio Utilities Panel
- 8.4.1 Warp Controls
- 8.4.2 Reversing Samples
- 8.4.3 Destructive Sample Editing
- 8.4.4 Clip Start and End Fades
- 8.4.5 Clip RAM Mode
- 8.4.6 High Quality Interpolation
- 8.4.7 Clip Gain and Pitch
- 8.5 Pitch and Time Utilities Panel
- 8.5.1 Pitch Tools
- 8.5.2 Time Tools
- 8.6 Transform and Generate Panels
- 8.7 Zooming and Scrolling in the Clip View’s Editor
- 8.8 Playing and Scrubbing Clips
- 8.9 Looping Clips
- 8.10 Clip View Sample Details
- 8.11 Cropping Clips
- 8.12 Replacing and Editing the Sample
- 8.13 Editing Clip Properties for Multiple Clips
- 8.14 Clip Defaults and Update Rate

### 9. Audio Clips, Tempo, and Warping  (/en/live-manual/12/audio-clips-tempo-and-warping/)
- 9.1 Tempo
- 9.1.1 Setting the Tempo
- 9.1.2 Tapping the Tempo
- 9.1.3 Nudging the Tempo
- 9.1.4 Clip Tempo Followers and Leaders
- 9.2 Warping
- 9.2.1 Warping Options in Settings
- 9.2.2 Importing Samples
- 9.2.3 Warp Markers
- 9.2.4 Warping Short Samples
- 9.2.5 Auto-Warping Long Samples
- 9.2.6 Manipulating Grooves
- 9.2.7 Quantizing Audio
- 9.3 Warp Modes
- 9.3.1 Beats Mode
- 9.3.2 Tones Mode
- 9.3.3 Texture Mode
- 9.3.4 Re-Pitch Mode
- 9.3.5 Complex and Complex Pro Mode

### 10. Editing MIDI  (/en/live-manual/12/editing-midi/)
- 10.1 The MIDI Note Editor Layout
- 10.2 Zooming and Navigating in the MIDI Note Editor
- 10.2.1 Grid Snapping
- 10.2.2 Playback Options
- 10.3 Creating a MIDI Clip
- 10.4 Adding MIDI Notes
- 10.4.1 Draw Mode
- 10.4.2 Previewing Notes
- 10.5 Editing MIDI Notes
- 10.5.1 Non-Destructive Editing
- 10.5.2 Selecting Notes and Timespan
- 10.5.3 Find and Select Notes
- 10.5.4 Moving Notes
- 10.5.5 Changing Note Length
- 10.5.6 MIDI Note Stretch
- 10.5.7 Deactivating Notes
- 10.5.8 Note Operations
- 10.5.9 Pitch and Time Utilities
- 10.5.10 MIDI Tools
- 10.5.11 Quantizing Notes
- 10.5.12 Editing Velocities
- 10.5.13 Editing Probabilities
- 10.6 Folding and Scales
- 10.7 Editing MIDI Clips
- 10.7.1 Cropping MIDI Clips
- 10.7.2 The …Time Commands in the MIDI Note Editor
- 10.7.3 Looping
- 10.8 Multi-Clip Editing
- 10.8.1 Focus Mode
- 10.8.2 Multi-Clip Editing in the Session View
- 10.8.3 Multi-Clip Editing in the Arrangement View

### 11. MIDI Tools  (/en/live-manual/12/midi-tools/)
- 11.1 Using MIDI Tools
- 11.1.1 Using Max for Live MIDI Tools
- 11.2 Transformation Tools
- 11.2.1 Arpeggiate
- 11.2.2 Chop
- 11.2.3 Connect
- 11.2.4 Glissando
- 11.2.5 LFO
- 11.2.6 Ornament
- 11.2.7 Quantize
- 11.2.8 Recombine
- 11.2.9 Span
- 11.2.10 Strum
- 11.2.11 Time Warp
- 11.2.12 Velocity Shaper
- 11.3 Generative Tools
- 11.3.1 Rhythm
- 11.3.2 Seed
- 11.3.3 Shape
- 11.3.4 Stacks
- 11.3.5 Euclidean

### 12. Editing MPE  (/en/live-manual/12/editing-mpe/)
- 12.1 Viewing MPE Data
- 12.2 Editing MPE Data
- 12.3 Drawing Envelopes
- 12.4 MPE in Live’s Devices and on Push 2
- 12.5 MPE in External Plug-ins
- 12.6 MPE/Multi-channel Settings
- 12.6.1 Accessing the MPE/Multi-channel Settings Dialog
- 12.6.2 The MPE/Multi-Channel Settings Dialog

### 13. Converting Audio to MIDI  (/en/live-manual/12/converting-audio-to-midi/)
- 13.1 Slice to New MIDI Track
- 13.1.1 Resequencing Slices
- 13.1.2 Using Effects on Slices
- 13.2 Convert Harmony to New MIDI Track
- 13.3 Convert Melody to New MIDI Track
- 13.4 Convert Drums to New MIDI Track
- 13.5 Optimizing for Better Conversion Quality

### 14. Using Grooves  (/en/live-manual/12/using-grooves/)
- 14.1 Groove Pool
- 14.1.1 Adjusting Groove Parameters
- 14.1.2 Committing Grooves
- 14.2 Editing Grooves
- 14.2.1 Extracting Grooves
- 14.3 Groove Tips
- 14.3.1 Grooving a Single Voice
- 14.3.2 Non-Destructive Quantization
- 14.3.3 Creating Texture With Randomization

### 15. Using Tuning Systems  (/en/live-manual/12/using-tuning-systems/)
- 15.1 Loading a Tuning System
- 15.2 The Tuning Section
- 15.3 MIDI Track Options for Tuning Systems
- 15.3.1 Bypass Tuning
- 15.3.2 MIDI Controller Layouts
- 15.4 Learn More About Tuning Systems

### 16. Launching Clips  (/en/live-manual/12/launching-clips/)
- 16.1 The Launch Controls
- 16.2 Launch Modes
- 16.3 Legato Mode
- 16.4 Clip Launch Quantization
- 16.5 Velocity
- 16.6 Clip Offset and Nudging
- 16.7 Follow Actions
- 16.7.1 Looping Parts of a Clip
- 16.7.2 Creating Cycles
- 16.7.3 Temporarily Looping Clips
- 16.7.4 Adding Variations in Sync
- 16.7.5 Mixing up Melodies and Beats
- 16.7.6 Creating Nonrepetitive Structures

### 17. Routing and I/O  (/en/live-manual/12/routing-and-i-o/)
- 17.1 Monitoring
- 17.2 External Audio In/Out
- 17.2.1 Mono/Stereo Conversions
- 17.3 External MIDI In/Out
- 17.3.1 MIDI Port Inputs and Outputs
- 17.3.2 Playing MIDI With the Computer Keyboard
- 17.3.3 Connecting External Synthesizers
- 17.3.4 MIDI In/Out Indicators
- 17.4 Resampling
- 17.5 Internal Routings
- 17.5.1 Internal Routing Points
- 17.5.2 Making Use of Internal Routing

### 18. Mixing  (/en/live-manual/12/mixing/)
- 18.1 The Live Mixer
- 18.1.1 Additional Mixer Features
- 18.2 Audio and MIDI Tracks
- 18.3 Group Tracks
- 18.4 Return Tracks and the Main track
- 18.5 Using Live’s Crossfader
- 18.6 Soloing and Cueing
- 18.7 Track Delays
- 18.8 Keep Monitoring Latency in Recording Track Toggles
- 18.9 Performance Impact Track Indicators

### 19. Recording New Clips  (/en/live-manual/12/recording-new-clips/)
- 19.1 Choosing an Input
- 19.2 Arming (Record-Enabling) Tracks
- 19.3 Recording
- 19.3.1 Recording Into the Arrangement
- 19.3.2 Recording Into Session Slots
- 19.3.3 Overdub Recording MIDI Patterns
- 19.3.4 MIDI Step Recording
- 19.4 Recording in Sync
- 19.4.1 Metronome Settings
- 19.5 Recording Quantized MIDI Notes
- 19.6 Recording with Count-in
- 19.7 Setting up File Types
- 19.8 Where are the Recorded Samples?
- 19.9 Using Remote Control for Recording
- 19.10 Capturing MIDI
- 19.10.1 Starting a New Live Set
- 19.10.2 Adding Material to an Existing Live Set

### 20. Bounce to Audio  (/en/live-manual/12/bounce-to-audio/)
- 20.1 Bouncing Individual Tracks
- 20.2 Bouncing Group Tracks
- 20.3 Pasting Bounced Audio

### 21. Comping  (/en/live-manual/12/comping/)
- 21.1 Take Lanes
- 21.2 Inserting and Managing Take Lanes
- 21.3 Recording Takes
- 21.4 Inserting Samples
- 21.5 Auditioning Take Lanes
- 21.6 Creating a Comp
- 21.7 Source Highlights

### 22. Stem Separation  (/en/live-manual/12/stem-separation/)
- 22.1 How Stem Separation Works in Live
- 22.2 Separating Audio Files and Clips
- 22.2.1 Separation Speed vs. Quality

### 23. Working with Instruments and Effects  (/en/live-manual/12/working-with-instruments-and-effects/)
- 23.1 Device View
- 23.2 Using Devices
- 23.2.1 Device Title Bar
- 23.2.2 Device A/B Comparison
- 23.2.3 Live Device Presets
- 23.2.4 Hot-Swapping Presets
- 23.2.5 Saving Presets
- 23.2.6 Default Presets
- 23.3 Using Plug-Ins
- 23.3.1 Plug-Ins in the Device View
- 23.3.2 Sidechain Parameters
- 23.4 VST Plug-Ins
- 23.4.1 The VST Plug-In Folder
- 23.4.2 VST Presets and Banks
- 23.5 Audio Units Plug-Ins
- 23.6 Device Delay Compensation

### 24. Instrument, Drum and Effect Racks  (/en/live-manual/12/instrument-drum-and-effect-racks/)
- 24.1 An Overview of Racks
- 24.1.1 Signal Flow and Parallel Device Chains
- 24.1.2 Macro Controls
- 24.2 Creating Racks
- 24.3 Looking at Racks
- 24.4 Chain List
- 24.4.1 Auto Select
- 24.5 Zones
- 24.5.1 Signal Flow through Zones
- 24.5.2 Key Zones
- 24.5.3 Velocity Zones
- 24.5.4 Chain Select Zones
- 24.6 Drum Racks
- 24.6.1 Pad View
- 24.7 Using the Macro Controls
- 24.7.1 Map Mode
- 24.7.2 Randomizing Macro Controls
- 24.7.3 Macro Control Variations
- 24.8 Mixing With Racks
- 24.8.1 Extracting Chains

### 25. Automation and Editing Envelopes  (/en/live-manual/12/automation-and-editing-envelopes/)
- 25.1 Recording Automation in Arrangement View
- 25.2 Recording Automation in Session View
- 25.2.1 Session Automation Recording Modes
- 25.3 Deleting Automation
- 25.4 Overriding Automation
- 25.5 Drawing and Editing Automation
- 25.5.1 Drawing Envelopes
- 25.5.2 Editing Breakpoints
- 25.5.3 Stretching and Skewing Envelopes
- 25.5.4 Simplifying Envelopes
- 25.5.5 Inserting Automation Shapes
- 25.5.6 Locking Envelopes
- 25.5.7 Edit Menu Commands
- 25.5.8 Editing the Tempo Automation

### 26. Clip Envelopes  (/en/live-manual/12/clip-envelopes/)
- 26.1 The Clip Envelope Editor
- 26.2 Audio Clip Envelopes
- 26.2.1 Clip Envelopes are Non-Destructive
- 26.2.2 Changing Pitch and Tuning per Note
- 26.2.3 Muting or Attenuating Notes in a Sample
- 26.2.4 Scrambling Beats
- 26.2.5 Using Clips as Templates
- 26.3 Mixer and Device Clip Envelopes
- 26.3.1 Modulating Mixer Volumes and Sends
- 26.3.2 Modulating Pan
- 26.3.3 Modulating Device Controls
- 26.4 MIDI Controller Clip Envelopes
- 26.5 Unlinking Clip Envelopes From Clips
- 26.5.1 Programming a Fade-Out for a Live Set
- 26.5.2 Creating Long Loops from Short Loops
- 26.5.3 Imposing Rhythm Patterns onto Samples
- 26.5.4 Clip Envelopes as LFOs
- 26.5.5 Warping Linked Envelopes

### 27. Working with Video  (/en/live-manual/12/working-with-video/)
- 27.1 Importing Video
- 27.2 The Appearance of Video in Live
- 27.2.1 Video Clips in the Arrangement View
- 27.2.2 The Video Window
- 27.2.3 Clip View
- 27.3 Matching Sound to Video
- 27.4 Video Trimming Tricks

### 28. Live Audio Effect Reference  (/en/live-manual/12/live-audio-effect-reference/)
- 28.1 Amp
- 28.1.1 Amp Tips
- 28.2 Auto Filter
- 28.2.1 Filter Types
- 28.2.2 Filter Display
- 28.2.3 LFO Controls
- 28.2.4 Envelope Follower Controls
- 28.2.5 Filter Drive and Circuits
- 28.2.6 Global Controls
- 28.2.7 Sidechain Parameters
- 28.3 Auto Pan-Tremolo
- 28.4 Auto Shift
- 28.4.1 Input Section
- 28.4.2 Quantizer Tab
- 28.4.3 MIDI Tab
- 28.4.4 LFO Tab
- 28.4.5 Pitch Section
- 28.4.6 Vibrato Section
- 28.5 Beat Repeat
- 28.6 Cabinet
- 28.6.1 Cabinet Tips
- 28.7 Channel EQ
- 28.7.1 Channel EQ Tips
- 28.8 Chorus-Ensemble
- 28.8.1 Chorus-Ensemble Tips
- 28.9 Compressor
- 28.9.1 Sidechain Parameters
- 28.9.2 Compressor Tips
- 28.10 Corpus
- 28.10.1 Resonator Parameters
- 28.10.2 LFO Section
- 28.10.3 Filter Section
- 28.10.4 Global Parameters
- 28.10.5 Sidechain Parameters
- 28.11 Delay
- 28.11.1 Context Menu Options for Delay
- 28.11.2 Delay Tips
- 28.12 Drum Buss
- 28.13 Dynamic Tube
- 28.14 Echo
- 28.14.1 Echo Tab
- 28.14.2 Modulation Tab
- 28.14.3 Character Tab
- 28.14.4 Global Controls
- 28.15 EQ Eight
- 28.16 EQ Three
- 28.17 Erosion
- 28.18 External Audio Effect
- 28.19 Filter Delay
- 28.20 Gate
- 28.21 Glue Compressor
- 28.21.1 Sidechain Parameters
- 28.22 Grain Delay
- 28.23 Hybrid Reverb
- 28.23.1 Signal Flow
- 28.23.2 Input Section
- 28.23.3 Convolution Reverb Engine
- 28.23.4 Algorithmic Reverb Engine
- 28.23.5 EQ Section
- 28.23.6 Output Section
- 28.24 Limiter
- 28.25 Looper
- 28.25.1 Feedback Routing
- 28.26 Multiband Dynamics
- 28.26.1 Dynamics Processing Theory
- 28.26.2 Interface and Controls
- 28.26.3 Sidechain Parameters
- 28.26.4 Multiband Dynamics Tips
- 28.27 Overdrive
- 28.28 Pedal
- 28.28.1 Pedal Tips
- 28.29 Phaser-Flanger
- 28.30 Redux
- 28.30.1 Downsampling
- 28.30.2 Bit Reduction
- 28.31 Resonators
- 28.32 Reverb
- 28.32.1 Input Filter
- 28.32.2 Early Reflections
- 28.32.3 Diffusion Network
- 28.32.4 Chorus
- 28.32.5 Global Settings
- 28.32.6 Output
- 28.33 Roar
- 28.33.1 Input Section
- 28.33.2 Gain Stage Section
- 28.33.3 Modulation Section
- 28.33.4 Feedback Section
- 28.33.5 Global Section
- 28.33.6 Sidechain Parameters
- 28.34 Saturator
- 28.35 Shifter
- 28.35.1 Tuning and Delay Section
- 28.35.2 LFO Section
- 28.35.3 Envelope Follower Section
- 28.35.4 Shifter Mode Section
- 28.35.5 Sidechain Parameters
- 28.35.6 Shifter Tips
- 28.36 Spectral Resonator
- 28.36.1 Pitch Mode Section
- 28.36.2 Frequency Section
- 28.36.3 Modulation Section
- 28.36.4 Spectrogram
- 28.36.5 Global Parameters
- 28.36.6 Spectral Resonator Tips
- 28.37 Spectral Time
- 28.37.1 Freezer Section
- 28.37.2 Delay Section
- 28.37.3 Resolution Section
- 28.37.4 Global Controls
- 28.38 Spectrum
- 28.39 Tuner
- 28.39.1 View Switches
- 28.39.2 Classic View
- 28.39.3 Histogram View
- 28.39.4 Note Spellings
- 28.39.5 Reference Slider
- 28.40 Utility
- 28.41 Vinyl Distortion
- 28.42 Vocoder
- 28.42.1 Vocoder Tips

### 29. Live MIDI Effect Reference  (/en/live-manual/12/live-midi-effect-reference/)
- 29.1 Arpeggiator
- 29.2 CC Control
- 29.3 Chord
- 29.4 Note Length
- 29.5 Pitch
- 29.6 Random
- 29.7 Scale
- 29.8 Velocity

### 30. Live Instrument Reference  (/en/live-manual/12/live-instrument-reference/)
- 30.1 Analog
- 30.1.1 Architecture and Interface
- 30.1.2 Oscillators
- 30.1.3 Noise Generator
- 30.1.4 Filters
- 30.1.5 Amplifiers
- 30.1.6 Envelopes
- 30.1.7 LFOs
- 30.1.8 Global Parameters
- 30.1.9 MPE Sources
- 30.2 Collision
- 30.2.1 Architecture and Interface
- 30.2.2 Mallet Section
- 30.2.3 Noise Section
- 30.2.4 Resonator Tabs
- 30.2.5 LFO Tab
- 30.2.6 MIDI/MPE Tab
- 30.2.7 Sound Design Tips
- 30.3 Drift
- 30.3.1 Subtractive Synthesis
- 30.3.2 Oscillator Section
- 30.3.3 Filter Section
- 30.3.4 Envelopes Section
- 30.3.5 LFO Section
- 30.3.6 Mod Section
- 30.3.7 Global Section
- 30.4 Drum Sampler
- 30.4.1 Sample Controls Section
- 30.4.2 Playback Effects Section
- 30.4.3 Filter Section
- 30.4.4 Global Section
- 30.4.5 Context Menu Options for Drum Sampler
- 30.5 Electric
- 30.5.1 Architecture and Interface
- 30.5.2 Hammer Section
- 30.5.3 Fork Section
- 30.5.4 Damper/Pickup Section
- 30.5.5 Global Section
- 30.6 External Instrument
- 30.7 Impulse
- 30.7.1 Sample Slots
- 30.7.2 Start, Transpose and Stretch
- 30.7.3 Filter
- 30.7.4 Saturator and Envelope
- 30.7.5 Pan and Volume
- 30.7.6 Global Controls
- 30.7.7 Individual Outputs
- 30.8 Meld
- 30.8.1 General Overview
- 30.8.2 Oscillators
- 30.8.3 Oscillator Macros
- 30.8.4 Envelopes Tab
- 30.8.5 LFOs Tab
- 30.8.6 Matrix Tab
- 30.8.7 MIDI and MPE Tabs
- 30.8.8 Settings Tab
- 30.8.9 Filters
- 30.8.10 Mix Section
- 30.8.11 Global Controls
- 30.9 Operator
- 30.9.1 General Overview
- 30.9.2 Oscillator Section
- 30.9.3 LFO Section
- 30.9.4 Envelopes
- 30.9.5 Filter Section
- 30.9.6 Global Controls
- 30.9.7 Glide and Spread
- 30.9.8 Strategies for Saving CPU Power
- 30.9.9 Finally…
- 30.9.10 The Complete Parameter List
- 30.10 Sampler
- 30.10.1 Getting Started with Sampler
- 30.10.2 Multisampling
- 30.10.3 Title Bar Options
- 30.10.4 Sampler’s Tabs
- 30.10.5 The Zone Tab
- 30.10.6 The Sample Tab
- 30.10.7 The Pitch/Osc Tab
- 30.10.8 The Filter/Global Tab
- 30.10.9 The Modulation Tab
- 30.10.10 The MIDI Tab
- 30.10.11 Importing Third-Party Multisamples
- 30.11 Simpler
- 30.11.1 Playback Modes
- 30.11.2 Warp Controls
- 30.11.3 Filter
- 30.11.4 Envelopes
- 30.11.5 LFO
- 30.11.6 Global Parameters
- 30.11.7 Context Menu Options for Simpler
- 30.11.8 Strategies for Saving CPU Power
- 30.12 Tension
- 30.12.1 Architecture and Interface
- 30.12.2 String Tab
- 30.12.3 Filter/Global Tab
- 30.12.4 Sound Design Tips
- 30.13 Wavetable
- 30.13.1 Wavetable Synthesis
- 30.13.2 Oscillators
- 30.13.3 Sub Oscillator
- 30.13.4 Filters
- 30.13.5 Matrix Tab
- 30.13.6 Mod Sources Tab
- 30.13.7 MIDI Tab
- 30.13.8 Global and Unison Controls
- 30.13.9 Hi-Quality Mode

### 31. Max for Live  (/en/live-manual/12/max-for-live/)
- 31.1 Setting Up Max for Live
- 31.2 Using Max for Live Devices
- 31.3 Editing Max for Live Devices
- 31.4 Building Max for Live MIDI Tools
- 31.5 Max Dependencies
- 31.6 Learning Max Programming

### 32. Max for Live Devices  (/en/live-manual/12/max-for-live-devices/)
- 32.1 Max for Live Instruments
- 32.1.1 DS Clang
- 32.1.2 DS Clap
- 32.1.3 DS Cymbal
- 32.1.4 DS FM
- 32.1.5 DS HH
- 32.1.6 DS Kick
- 32.1.7 DS Snare
- 32.1.8 DS Tom
- 32.2 Max for Live Audio Effects
- 32.2.1 Align Delay
- 32.2.2 Envelope Follower
- 32.2.3 LFO
- 32.2.4 Shaper
- 32.3 Max for Live MIDI Effects
- 32.3.1 Envelope MIDI
- 32.3.2 Expression Control
- 32.3.3 MIDI Monitor
- 32.3.4 MPE Control
- 32.3.5 Note Echo
- 32.3.6 Shaper MIDI

### 33. MIDI and Key Remote Control  (/en/live-manual/12/midi-and-key-remote-control/)
- 33.1 MIDI Remote Control
- 33.1.1 Natively Supported Control Surfaces
- 33.1.2 Manual Control Surface Setup
- 33.1.3 Takeover Mode
- 33.2 The Mapping Browser
- 33.2.1 Assigning MIDI Remote Control
- 33.2.2 Mapping to MIDI Notes
- 33.2.3 Mapping to Absolute MIDI Controllers
- 33.2.4 Mapping to Relative MIDI Controllers
- 33.2.5 Computer Keyboard Remote Control

### 34. Using Push 1  (/en/live-manual/12/using-push-1/)
- 34.1 Setup
- 34.2 Browsing and Loading Sounds
- 34.3 Playing and Programming Beats
- 34.3.1 Loop Selector
- 34.3.2 16 Velocities Mode
- 34.3.3 64-Pad Mode
- 34.3.4 Loading Individual Drums
- 34.3.5 Step Sequencing Beats
- 34.3.6 Real-time Recording
- 34.3.7 Fixed Length Recording
- 34.4 Additional Recording Options
- 34.4.1 Recording with Repeat
- 34.4.2 Quantizing
- 34.5 Playing Melodies and Harmonies
- 34.5.1 Playing in Other Keys
- 34.6 Step Sequencing Melodies and Harmonies
- 34.6.1 Adjusting the Loop Length
- 34.7 Melodic Sequencer + 32 Notes
- 34.7.1 32 Notes
- 34.7.2 Sequencer
- 34.8 Navigating in Note Mode
- 34.9 Controlling Live’s Instruments and Effects
- 34.10 Mixing with Push 1
- 34.11 Recording Automation
- 34.12 Step Sequencing Automation
- 34.12.1 Note-Specific Parameters
- 34.12.2 Per-Step Automation
- 34.13 Controlling Live’s Session View
- 34.13.1 Session Overview
- 34.14 Setting User Preferences
- 34.15 Push 1 Control Reference

### 35. Using Push 2  (/en/live-manual/12/using-push-2/)
- 35.1 Setup
- 35.2 Browsing and Loading Sounds
- 35.3 Playing and Programming Beats
- 35.3.1 Loop Selector
- 35.3.2 16 Velocities Mode
- 35.3.3 64-Pad Mode
- 35.3.4 Loading Individual Drums
- 35.3.5 Step Sequencing Beats
- 35.3.6 Real-time Recording
- 35.3.7 Fixed Length Recording
- 35.4 Additional Recording Options
- 35.4.1 Recording with Repeat
- 35.4.2 Quantizing
- 35.4.3 Arrangement Recording
- 35.5 Playing Melodies and Harmonies
- 35.5.1 Playing in Other Keys
- 35.6 Step Sequencing Melodies and Harmonies
- 35.6.1 Adjusting the Loop Length
- 35.7 Melodic Sequencer + 32 Notes
- 35.7.1 32 Notes
- 35.7.2 Sequencer
- 35.8 Working with Samples
- 35.8.1 Classic Playback Mode
- 35.8.2 One-Shot Mode
- 35.8.3 Slicing Mode
- 35.9 Navigating in Note Mode
- 35.10 Working With Instruments and Effects
- 35.10.1 Adding, Deleting, and Reordering Devices
- 35.10.2 Working with Racks
- 35.11 Track Control And Mixing
- 35.11.1 Rack and Group Track Mixing
- 35.12 Recording Automation
- 35.13 Step Sequencing Automation
- 35.14 Clip Mode
- 35.14.1 Using MIDI Tracks in Clip Mode
- 35.14.2 Real-Time Playing Layouts
- 35.14.3 Sequencing Layouts
- 35.14.4 Note-Specific Parameters
- 35.15 Controlling Live’s Session View
- 35.15.1 Session Overview
- 35.16 Setup Menu
- 35.17 Push 2 Control Reference

### 36. Synchronizing with Link, Tempo Follower, and MIDI  (/en/live-manual/12/synchronizing-with-link-tempo-follower-and-midi/)
- 36.1 Synchronizing via Link
- 36.1.1 Setting up Link and Link Audio
- 36.1.2 Using Link
- 36.1.3 Using Link Audio
- 36.2 Synchronizing via Tempo Follower
- 36.2.1 Setting Up Tempo Follower
- 36.3 Synchronizing via MIDI
- 36.3.1 Synchronizing External MIDI Devices to Live
- 36.3.2 Synchronizing Live to External MIDI Devices
- 36.3.3 Sync Delay

### 37. Computer Audio Resources and Strategies  (/en/live-manual/12/computer-audio-resources-and-strategies/)
- 37.1 Managing the CPU Load
- 37.1.1 The CPU Load Meter
- 37.1.2 CPU Load from Multichannel Audio
- 37.1.3 CPU Load from Tracks and Devices
- 37.1.4 Track Freeze
- 37.2 Managing the Disk Load

### 38. Audio Fact Sheet  (/en/live-manual/12/audio-fact-sheet/)
- 38.1 Testing and Methodology
- 38.2 Neutral Operations
- 38.2.1 Undithered Rendering
- 38.2.2 Matching Sample Rate/No Transposition
- 38.2.3 Unstretched Beats/Tones/Texture/Re-Pitch Warping
- 38.2.4 Summing at Single Mix Points
- 38.2.5 Recording External Signals (Bit Depth >/= A/D Converter)
- 38.2.6 Recording Internal Sources at 32 Bit
- 38.2.7 Freezing Tracks
- 38.2.8 Bypassed Effects
- 38.2.9 Routing
- 38.2.10 Splitting Clips
- 38.3 Non-Neutral Operations
- 38.3.1 Playback in Complex and Complex Pro Mode
- 38.3.2 Sample Rate Conversion/Transposition
- 38.3.3 Volume Automation
- 38.3.4 Dithering
- 38.3.5 Recording External Signals (Bit Depth < A/D Converter)
- 38.3.6 Recording Internal Sources Below 32 Bit
- 38.3.7 Consolidate
- 38.3.8 Clip Fades
- 38.3.9 Panning
- 38.3.10 Grooves
- 38.4 Tips for Achieving Optimal Sound Quality in Live
- 38.5 Conclusion

### 39. MIDI Fact Sheet  (/en/live-manual/12/midi-fact-sheet/)
- 39.1 Ideal MIDI Behavior
- 39.2 MIDI Timing Problems
- 39.3 Live’s MIDI Solutions
- 39.4 Variables Outside of Live’s Control
- 39.5 Tips for Achieving Optimal MIDI Performance
- 39.6 Summary and Conclusions

### 40. Accessibility and Keyboard Navigation  (/en/live-manual/12/accessibility-and-keyboard-navigation/)
- 40.1 Menu and Keyboard Navigation Settings
- 40.1.1 Using Tab for Navigation
- 40.1.2 Settings Menu
- 40.1.3 Options Menu
- 40.1.4 Speak Help Text
- 40.2 Audio Setup
- 40.3 Connecting MIDI Devices
- 40.4 Navigating in Live
- 40.4.1 Navigate Menu
- 40.5 Editing Automation and Modulation Envelopes
- 40.5.1 Navigating Between Breakpoints
- 40.5.2 Selecting and Editing Breakpoints
- 40.5.3 Switching Between Automation Envelopes in Arrangement View

### 41. Live Keyboard Shortcuts  (/en/live-manual/12/live-keyboard-shortcuts/)
- 41.1 Showing and Hiding Views
- 41.2 Keyboard Focus and Navigation
- 41.3 Working with Sets and the Program
- 41.4 Working with Devices and Plug-Ins
- 41.5 Editing
- 41.6 Adjusting Values
- 41.7 Commands for Breakpoint Envelopes
- 41.8 Loop Brace and Start/End Markers
- 41.9 Zooming, Display and Selections
- 41.10 Clip View Editor View Modes
- 41.11 Clip View Sample Editor
- 41.12 Clip View MIDI Note Editor
- 41.13 Grid Snapping and Drawing
- 41.14 Global Quantization
- 41.15 Session View
- 41.16 Arrangement View
- 41.17 Comping
- 41.18 Bounce to Audio
- 41.19 Commands for Tracks
- 41.20 Transport
- 41.21 Audio Engine
- 41.22 Browser
- 41.23 Similar Sample Swapping
- 41.24 Key/MIDI Map Mode and the Computer MIDI Keyboard
- 41.25 Momentary Latching Shortcuts
- 41.26 General Keyboard Navigation and Workflow
- 41.26.1 Using Tab for Navigation
- 41.26.2 Navigating Between Controls in the Settings Menu
- 41.27 Editing Automation and Modulation Envelopes with the Keyboard
- 41.28 Accessing Menus
- 41.29 Using Live’s Context Menu

### 42. Credits  (/en/live-manual/12/credits/)