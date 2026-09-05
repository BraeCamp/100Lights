# Ableton Live 12 — MIDI Note Editor & Clip View (research for Beacon gap analysis)

Researched 2026-09-04 against Live 12.0 → 12.4.5 (latest release note dated 2026-08-26).
Scope: everything a user can do in the **Detail View at the bottom of the screen** — the Clip View for
MIDI clips (Notes / Envelopes / Expression tabs, lanes, Pitch & Time utilities, Transform/Generate MIDI
Tools) and for audio clips (Sample Editor: warping, transients, warp modes, gain/pitch, fades, reverse,
crop, slice/convert to MIDI) — plus the Live 12 stacked Clip+Device View.

Conventions: shortcuts are given **Win / Mac**. "Manual" = Ableton Reference Manual v12. Where a
behaviour was only found in a forum/tutorial (not the manual) it is marked *(community)*.
Reddit r/ableton could not be crawled (site blocks the fetcher); community material comes from the
Ableton Forum, Sonic Bloom, MusicRadar, Sound On Sound, Attack Magazine, CDM, EDMProd, Unison,
LiveAspects, Icon Collective, Patches.zone, Synthtopia, HomeMusicMaker and Synth Anatomy.

---

## 0. Version timeline (what arrived when)

| Version | Date | Relevant additions | Source |
|---|---|---|---|
| 12.0 | Mar 2024 | MIDI Tools (Transform + Generate panels: Arpeggiate, Connect, Ornament, Quantize, Recombine, Span, Strum, Time Warp, Velocity Shaper; Rhythm, Seed, Shape, Stacks, Euclidean); Notes box renamed **Pitch & Time** utilities (Fit to Scale, Invert, Add Interval, Stretch, Set Length, Humanize, Reverse, Legato); **Stacked Detail Views** (Clip View above Device View); Keys & Scales in Control Bar + clip; Fold to Scale / scale highlighting; probability **groups** (Play All / Play One); new note shortcuts (Split/Chop/Join/Fit); keyboard-only note navigation; tuning systems; Mixer in Arrangement; Arrangement editing overhaul | [All new features](https://www.ableton.com/en/live/all-new-features/), [CDM guide](https://cdm.link/2023/11/ableton-live-12-everything-new/), [MusicRadar what's new](https://www.musicradar.com/news/ableton-live-12-whats-new-devices-midi-workflow), [Sonic Bloom 12 in depth](https://sonicbloom.net/ableton-live-12-announced-new-devices-features-depth/) |
| 12.1 | Oct 2024 | **Chop** transformation; **Glissando** + **LFO** MPE transformations; **Find and Select Notes** toolbar (magnifying-glass in Clip Content Editor settings; Pitch/Time/Velocity/Chance/Condition/Count/Duration/Scale filters — Standard+); Auto Shift, Drum Sampler; MIDI Tools Pack + Sequencers Pack (Max for Live) | [Ableton 12.1 is out](https://www.ableton.com/en/blog/live-121-is-out-now/), [Sonic Bloom 12.1 tools](https://sonicbloom.net/new-midi-tools-in-ableton-live-12-1/), [CDM 12.1](https://cdm.link/live-12-1-midi-tools/), [MusicRadar 12.1](https://www.musicradar.com/news/ableton-live-12.1-5-things), [SOS 12.1](https://www.soundonsound.com/techniques/live-12-whats-new-v121) |
| 12.2 | Jun 2025 | Shift+click-hold-drag to add notes to a selection anywhere in the clip; **keyboard automation/modulation breakpoint workflow** (Enter creates/selects breakpoint, arrows, typed values); MIDI Tools status indicator; Bounce to New Track / Bounce in Place / Paste Bounced Audio; Take-lane show/hide; Auto Filter, Roar, Meld updates; Resonators/Spectral Resonator scale-aware | [Release notes](https://www.ableton.com/en/release-notes/live-12/), [Sonic Bloom 12.2](https://sonicbloom.net/ableton-live-12-2-12-small-improvements/), [Ableton 12.2 blog](https://www.ableton.com/en/blog/live-12-2/) |
| 12.3 | Nov 2025 | **Stem Separation** from any audio clip (Suite); Shift+double-click creates an Arrangement MIDI clip over a definable range; Bounce Groups; Device A/B; Splice in browser; Generators by Iftah pack (Sting, Patterns); Expressive Chords "Chord Edit" mode | [Release notes](https://www.ableton.com/en/release-notes/live-12/), [Ableton 12.3 blog](https://www.ableton.com/en/blog/live-12-3-is-here/) |
| 12.4 | May 2026 | Wider note-edge resize hit-area in the MIDI Note Editor; stem-separate a *selected portion* of a clip in Arrangement and merge stems back; Link Audio; Learn View replaces Help View; 12-tone tuning systems in MIDI Tools (12.4.3) | [Release notes](https://www.ableton.com/en/release-notes/live-12/), [Synth Anatomy 12.4](https://synthanatomy.com/2026/04/ableton-live-12-stay-creative-and-in-focus-an-overview-of-the-new-features.html) |

Note on the prompt's "Live 12.1 stacked detail views": stacking shipped in **12.0**; 12.1 added the note toolbar and tools listed above.

---

## 1. The Detail View: Clip View, Device View, stacking, sizing

| Item | What it does | Where / shortcut | Source |
|---|---|---|---|
| Detail View (bottom area) | Bottom strip of the window that shows either the **Clip View** (selected clip) or the **Device View** (selected track's device chain). | Bottom of window; selectors bottom-right | [Live Concepts](https://www.ableton.com/en/live-manual/12/live-concepts/) |
| Stacked Detail Views | "The Clip View and Device View can be stacked, which lets you view them at the same time." Clip editor/automation on top, devices below. | Triangle toggles next to the Clip View and Device View Selectors, "to the left of the Mixer View toggle" (bottom-right). Show/hide Clip View **Ctrl+Alt+3 / Cmd+Option+3**; Device View **Ctrl+Alt+4 / Cmd+Option+4** | [Live Concepts](https://www.ableton.com/en/live-manual/12/live-concepts/), [Working with Instruments and Effects §23.1](https://www.ableton.com/en/live-manual/12/working-with-instruments-and-effects/) |
| Resize the detail area | Drag the split between Session/Arrangement and the Clip View to enlarge it. | Drag split line | [Clip View §8.7 / Editing MIDI §10.2](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Full-size Clip View | Maximise Clip View over the whole window. | **Ctrl+Alt+E / Cmd+Option+E** | [Keyboard shortcuts](https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/) |
| Fold a device | Collapse a device to save vertical room when stacked. | Double-click device title bar, or Fold in context menu | [Working with Instruments and Effects](https://www.ableton.com/en/live-manual/12/working-with-instruments-and-effects/) |
| Move focus between views | Navigate menu: Control Bar Alt+0, Session Alt+1, Arrangement Alt+2, **Clip View Alt+3 / Option+3**, Device View Alt+4, Browser Alt+5, Groove Pool Alt+6, Learn View Alt+7. Focus the clip panels **Alt+Shift+P / Option+Shift+P**. | Navigate menu | [Accessibility & keyboard navigation](https://www.ableton.com/en/live-manual/12/accessibility-and-keyboard-navigation/) |
| Clip View panels vertical/horizontal | Left-hand panels can be arranged vertically or horizontally; View menu "Arrange Clip View Panels Vertically/Horizontally/Automatically"; double-click a panel title bar (or Fold) to minimise it. | View menu; drag right edge of panels | [Clip View §8.1.2](https://www.ableton.com/en/live-manual/12/clip-view/) |
| Editor view modes (tabs) | Audio clip: **Sample Editor \| Envelope Editor**. MIDI clip: **MIDI Note Editor (Notes) \| Envelope Editor \| MPE (Expression) Editor**. | Tabs; **Ctrl+Tab (Win) / Option+Tab (Mac)** cycles; **Alt+Shift+1/2/3 / Option+Shift+1/2/3** jump to Sample-or-Notes / Envelopes / MPE tab | [Clip View §8.1.3](https://www.ableton.com/en/live-manual/12/clip-view/), [Keyboard shortcuts](https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/) |
| Clip View title bar | Clip name, colour, **Clip Activator** (0 key deactivates; multi-select toggles all), Rename (context/Edit menu), colour palette in context menu, "Assign Track Color to Clips", **Save Default Clip** (audio only: stores clip settings incl. warp markers with the sample; own samples only). | Title bar | [Clip View §8.1.1](https://www.ableton.com/en/live-manual/12/clip-view/), [Warping](https://www.ableton.com/en/live-manual/12/audio-clips-tempo-and-warping/) |
| Community note | Users complained the old single "Device View toggle" changed; the forum thread documents the new triangle toggles + Ctrl+Alt+3/4 as the workaround. *(community)* | — | [Forum: Bring back Device view toggle](https://forum.ableton.com/viewtopic.php?t=249571) |

### Clip View panels (MIDI clip)
Main Clip Properties (name/colour/signature/groove/scale, clip & loop region), Extended Clip Properties (Session only: Launch box, Follow Actions, MIDI Bank/Program), **Pitch and Time Utilities**, **Transform**, **Generate**. Audio clips replace Pitch & Time with **Audio Utilities** (warp/gain/pitch etc.) and Transform holds only Quantize. ([Clip View §8.2–8.6](https://www.ableton.com/en/live-manual/12/clip-view/))

### Clip View header (right of the editor)
Fold to Notes button · Fold to Scale button · Highlight Scales button · **Find and Select Notes** toggle (magnifier, 12.1) · Preview (headphone) switch above the piano ruler · **Grid chooser** (right side of header) · Focus button (multi-clip) · Clip Content Toolbar with Play All / Play One / Ungroup. Lanes below: Velocity, Chance, Release Velocity, expression lanes, selected via the **Lane Selector** (triangle drop-down) and **Show/Hide All Expression Editors** toggle. ([Editing MIDI §10.1](https://www.ableton.com/en/live-manual/12/editing-midi/))

---

## 2. Draw Mode ("pencil", B)

| Item | What it does | Where / shortcut | Source |
|---|---|---|---|
| Toggle Draw Mode | Enables the pencil for notes, velocities, chance, expression and envelopes. | Control Bar Draw Mode switch; Options menu; **B**. **Hold B** while mouse-editing = momentary toggle. | [Editing MIDI §10.4.1](https://www.ableton.com/en/live-manual/12/editing-midi/), [Editing MPE](https://www.ableton.com/en/live-manual/12/editing-mpe/), [Automation](https://www.ableton.com/en/live-manual/12/automation-and-editing-envelopes/) |
| Draw a note | Click inserts a note whose **length equals the current grid division**; drag horizontally to lay down consecutive grid-length notes (steps by grid). Click an existing note to delete it. | Pencil in MIDI Note Editor | [Editing MIDI §10.4.1](https://www.ableton.com/en/live-manual/12/editing-midi/); grid-length behaviour also [Forum t=153448](https://forum.ableton.com/viewtopic.php?t=153448) *(community)* |
| Velocity while drawing | "Drag up to increase it toward 127, drag down to decrease toward 0" while drawing; the **next drawn note inherits the velocity of the previous note**. *(community — forum, matches manual's "last used" behaviour)* | Vertical drag during draw | [Forum t=153448](https://forum.ableton.com/viewtopic.php?t=153448), [Forum t=177186](https://forum.ableton.com/viewtopic.php?t=177186) |
| Draw Mode with Pitch Lock | Preference (Display & Input Settings in 12; Record/Warp/Launch in 11). ON: drawing is constrained to one key track (pitch-locked); **Alt / Option** temporarily allows freehand melodic drawing. OFF: freehand is default and Alt/Option pitch-locks. | Settings → Display & Input | [Editing MIDI §10.4.1](https://www.ableton.com/en/live-manual/12/editing-midi/), [Live 11 manual](https://www.ableton.com/en/live-manual/11/editing-midi-notes-and-velocities/) |
| Erase while drawing | Melodic mode: starting a drag on an existing note erases it. Pitch-locked mode: dragging back toward the first added note erases drawn notes. | Pencil | [Editing MIDI §10.4.1](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Grid off / freehand | Grid off = **Ctrl+4 / Cmd+4** (Snap to Grid, Options menu); hold **Alt (Win) / Cmd (Mac)** to bypass snapping temporarily. | Options menu | [Editing MIDI §10.2.1](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Resize a drawn note | Cursor becomes a bracket at note start/end → click-drag. 12.4 widened this hit-area. | Note edges | [Release notes 12.4](https://www.ableton.com/en/release-notes/live-12/), [Forum t=226464](https://forum.ableton.com/viewtopic.php?t=226464) *(community)* |
| Draw velocities | In Draw Mode, dragging in the Velocity Editor sets the velocity of notes in each grid division; **if notes are selected only those are affected**; hovered notes highlight blue. **Alt/Option-drag** = straight line; **+Shift** = horizontal line. Grid off (Ctrl+4) or hold Alt/Cmd to hit individual markers (crescendos). Ramp across one key track: click the piano-ruler key to select that track's notes, then draw the ramp. | Velocity lane | [Editing MIDI §10.5.12.1](https://www.ableton.com/en/live-manual/12/editing-midi/), [Forum t=232123](https://forum.ableton.com/viewtopic.php?t=232123) |
| Draw chance | The Chance Editor lane uses the same marker/drag mechanics as velocity (per-grid-division in Draw Mode, selected notes only when a selection exists). | Chance lane | [Editing MIDI §10.5.13](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Draw expression (MPE) | Free-hand draw in **Pitch, Slide, Pressure** lanes; with grid on, drawing creates steps "as wide as the visible grid"; **Shift** vertical for fine value; grid is OFF by default in the Expression tab — hold **Alt / Cmd** to temporarily draw on-grid. | Expression tab | [Editing MPE](https://www.ableton.com/en/live-manual/12/editing-mpe/) |
| Draw envelopes / automation | Draw creates grid-width steps; Shift for finer values; Alt/Cmd for freehand while grid shown; Draw Mode off = breakpoint editing. | Envelopes tab / Arrangement | [Automation & envelopes](https://www.ableton.com/en/live-manual/12/automation-and-editing-envelopes/), [Clip Envelopes](https://www.ableton.com/en/live-manual/12/clip-envelopes/) |

---

## 3. MIDI Note Editor — navigation, zoom, grid, playback

| Item | What it does | Where / shortcut | Source |
|---|---|---|---|
| Time ruler zoom/scroll | Drag vertically in the time ruler to zoom, horizontally to scroll; Ctrl/Cmd+scroll zooms time; Alt/Option+scroll zooms key tracks; double-click ruler auto-zooms to selection. | Time ruler / note ruler | [Editing MIDI §10.2](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Clip View Selector (overview) | Black outline over a whole-clip thumbnail (bottom-right of editor); drag inside to scroll, drag edges to zoom. | Bottom-right of editor | [Clip View §8.7](https://www.ableton.com/en/live-manual/12/clip-view/) |
| Zoom keys | **+ / −** zoom around selection; **Z** zoom to selection; **X** zoom back; **Alt/Option + / −** zoom the note editor; **Ctrl/Cmd + / −** zoom window; Page Up/Down one octave, Shift+PgUp/PgDn one key track. (W / H fit content to view width/height are Arrangement shortcuts.) | Keyboard | [Editing MIDI §10.2](https://www.ableton.com/en/live-manual/12/editing-midi/), [Keyboard shortcuts](https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/) |
| Grid chooser | Fixed vs Adaptive grid, triplets, narrower/wider; Snap to Grid **Ctrl+4 / Cmd+4**. Snapping: a note "moves freely up to the first grid line you encounter" then snaps; off-grid notes keep their offset (preserves groove). | Right of Clip View header; context menu | [Editing MIDI §10.2.1](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Follow | Editor scrolls with playhead; pauses while editing; **Alt+Shift+F / Option+Shift+F**. | Control Bar | [Editing MIDI §10.2.2](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Scrub area | Click below the beat ruler to jump playback (quantised to global quantisation); Shift-click if "Permanent Scrub Areas" is off; holding the mouse repeats a quantisation-sized chunk. | Below ruler | [Clip View §8.8](https://www.ableton.com/en/live-manual/12/clip-view/) |
| Chase MIDI Notes | Notes already sounding when playback starts mid-note still play. | Options menu | [Editing MIDI §10.2.2](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Note preview (headphone) | "Preview switch" above the piano ruler auditions notes on add/select/move; with an armed track it enables **step recording**; global across MIDI tracks. | Above piano ruler | [Editing MIDI §10.4.2](https://www.ableton.com/en/live-manual/12/editing-midi/), [EDMProd](https://www.edmprod.com/ableton-live-piano-roll/) |
| Note ruler modes | Vertical ruler shows octaves C-2–C8, tuning-system note names, or **drum pad names** (Drum Rack); note spelling Flats/Sharps/Both/Auto or MIDI numbers via piano-ruler context menu. | Piano ruler context menu | [Editing MIDI §10.1, §10.6](https://www.ableton.com/en/live-manual/12/editing-midi/) |

---

## 4. Selecting notes

| Item | What it does | Where / shortcut | Source |
|---|---|---|---|
| Insert marker | Click sets a flashing time marker; **←/→** move by grid; **Ctrl/Option ←/→** to previous/next note boundary; **Home/End** clip start/end. | Editor | [Editing MIDI §10.5.2](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Time selection | Click-drag selects a timespan (notes inside auto-select); **Enter** toggles between time selection and note selection; **Shift+arrows** extend from insert marker; **Alt/Cmd+Shift+arrows** grid-independent; **Alt/Option+Shift+arrows** to note boundary; Esc collapses. | Editor | same |
| Note selection | Click; Shift+click add/remove; Shift+click piano-ruler key = all notes in that key track; click-drag lasso; **Ctrl+A / Cmd+A** all; **Ctrl/Option ↑/↓** nearest/next note in time; **Ctrl/Option ←/→** next note in same key track; Esc deselect. 12.2: **Shift + click-and-hold a selected note, then drag** across other notes to add them anywhere in the clip. | Editor | [Editing MIDI §10.5.2](https://www.ableton.com/en/live-manual/12/editing-midi/), [Sonic Bloom 12.2](https://sonicbloom.net/ableton-live-12-2-12-small-improvements/) |
| Invert Selection | Swaps selected/unselected notes. | Edit menu / context; **Ctrl+Shift+A / Cmd+Shift+A** | [Editing MIDI §10.5.2](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| **Find and Select Notes** (12.1) | Toggle reveals a filter toolbar above the time ruler. Filters: **Pitch** (all octaves), **Time** (start/length + Repeat interval), **Chance** (min/max), **Condition** (Active / Chance<100% / has Velocity Deviation), **Count** (every nth, Offset, Quantized-per-grid-step), **Duration** (min/max), **Scale** (Use Clip Scale or explicit root+scale), **Velocity** (min/max). **Invert** toggle; **Select** button re-applies; yellow dot = active; filters combine; clicking in the editor clears them. With it active, Shift+click a ruler key adds that key track; Shift+drag makes evenly spaced repeated time selections. Standard edition and up. | Magnifier in Clip Content Editor header | [Editing MIDI §10.5.3](https://www.ableton.com/en/live-manual/12/editing-midi/), [Sonic Bloom 12.1](https://sonicbloom.net/new-midi-tools-in-ableton-live-12-1/), [CDM 12.1](https://cdm.link/live-12-1-midi-tools/) |
| Select Material in Loop | Selects everything inside the loop brace. | **Ctrl+Shift+L / Cmd+Shift+L** | [Keyboard shortcuts](https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/) |

---

## 5. Moving, copying, resizing, stretching, muting notes

| Item | What it does | Where / shortcut | Source |
|---|---|---|---|
| Move | Drag horizontally (time) / vertically (pitch). **←/→** move by grid; **↑/↓** transpose semitone; **Shift+↑/↓** octave; **Alt/Cmd+←/→** nudge grid-free. | Editor | [Editing MIDI §10.5.4, §10.5.9.1](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Copy/duplicate | **Ctrl/Option-drag** copies (modifier can be added mid-drag); Copy/Cut/Paste at insert marker; **Ctrl+D / Cmd+D** duplicates selection in time. | Edit menu | [Editing MIDI §10.5.4](https://www.ableton.com/en/live-manual/12/editing-midi/), [EDMProd](https://www.edmprod.com/ableton-live-piano-roll/) |
| Overlap rule | New note overlapping the *start* of an existing note overwrites it; overlapping the *end* shortens the existing note. | — | [Editing MIDI §10.5.4](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Change length | Drag note edge (free to first grid line then snaps; Alt/Cmd bypass); **Shift+←/→** lengthen/shorten by grid; **Shift+Alt/Cmd+←/→** grid-free. | Note edges | [Editing MIDI §10.5.5](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Fit to Time Range | Stretch selected notes to fill the current time selection. | Edit menu / context; **Ctrl+Alt+J / Cmd+Option+J**; Duration dropdown → Set Length | same |
| MIDI Note Stretch markers | With ≥2 notes or a time range selected, a pair of downward markers appears below the scrub area; drag a fixed marker to scale notes proportionally (snaps; Alt/Cmd bypass); a **pseudo stretch marker** between them stretches only the inside; drag one marker past the other to **mirror** note order; linked clip envelopes stretch too. | Below scrub area | [Editing MIDI §10.5.6](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Velocity by drag | **Alt-drag (Win) / Cmd-drag (Mac)** a note vertically to change velocity without the lane. | Editor | [Keyboard shortcuts](https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/) |
| Deactivate note(s) | Mute notes in place (greyed). | **0**; Edit menu "Deactivate Note(s)"; piano-ruler/editor context menu | [Editing MIDI §10.5.7](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Split | Hold **E** and draw a line across notes (E + click-drag horizontally splits and positions; Ctrl/Cmd snaps); **Ctrl+E / Cmd+E** with no note selection splits at the insert marker / time-selection edges; Edit → Split Note(s). | Editor | [Editing MIDI §10.5.8.1](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Chop | **Ctrl+E / Cmd+E** on selected notes chops them on the grid ("Chop Note(s) on Grid"); while held, **Ctrl/Cmd+↑/↓** changes part count (Shift = powers of two); mouse: hold **E+Ctrl (Win) / E+Option (Mac)** and drag up/down over a note. | Editor | same; [Synthtopia / DeSantis](https://www.synthtopia.com/content/2023/11/26/ableton-live-12-tools-for-chopping-joining-midi/) |
| Join | Merge selected notes in the same key track into one (keeps MPE). | **Ctrl+J / Cmd+J**; Edit → Join Notes | [Editing MIDI §10.5.8.3](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| …Time commands | **Duplicate Time**, **Delete Time**, **Insert Time** act on the whole clip by inserting/removing time (loop brace unchanged). | Edit / context menu | [Editing MIDI §10.7.2](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Crop Clip / Crop to Time Selection | Remove MIDI outside the loop brace or the time selection. | Clip context menu; **Ctrl+Shift+J / Cmd+Shift+J** | [Editing MIDI §10.7.1](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Undo scope | Note edits undo; MIDI-Tool *parameter* changes do not. | Edit menu | [MIDI Tools](https://www.ableton.com/en/live-manual/12/midi-tools/) |

---

## 6. Velocity, velocity deviation, release velocity, chance, probability groups

| Item | What it does | Where / shortcut | Source |
|---|---|---|---|
| Velocity shown on notes | Saturation of the note colour = velocity. | Editor | [Editing MIDI §10.5.12](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Velocity Editor lane | Hidden by default; open via Lane Selector. Drag markers (value in lane header); stacked notes highlight on hover; Shift+click multi-select; type a value + Enter; **Ctrl/Cmd+↑/↓ ±10** (Shift = fine). Resize lanes via split lines (drag the split above the lanes to resize all). | Lane Selector (triangle) | same |
| Velocity controls (below lane) | **Randomize** button + **Randomization Amount** slider (selected or all notes); **Ramp Start / Ramp End** sliders distribute velocities evenly across the selection; **Velocity Deviation** slider (+/−) sets a per-note random range ("+20 on velocity 60 → random 60–80 each play"); shaded area + dot on marker show deviation; **Ctrl/Cmd-drag from a marker** sets the range; double-click a deviated marker resets to 0. **Ctrl+Shift+↑/↓ / Cmd+Shift+↑/↓** adjusts deviation. | Below Velocity lane | same; [Keyboard shortcuts](https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/) |
| Release Velocity Editor | Lane showing Note-Off velocity (device-dependent, e.g. Sampler). | Lane Selector → Release Velocity | [Editing MIDI §10.5.12.2](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Chance Editor lane | Per-note probability 0–100%; drag marker, type value, **↑/↓ ±10%** (Shift fine); **Ctrl+Alt+↑/↓ / Cmd+Option+↑/↓**; small triangle in the note's upper-left when <100%. **Randomization Amount** + **Randomize** (e.g. 50% ± 25% → 25–75%). | Lane Selector → Chance | [Editing MIDI §10.5.13](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Probability Groups (12.0) | One probability for a group: **Play All** (all fire together) or **Play One** (one random note). Diamond handle = Play All, triangle = Play One; right-click marker to switch type; hover shows group members. | Clip Content Toolbar Play All / Play One / Ungroup; Edit menu; **Ctrl+G / Cmd+G** (last type), **Ctrl+Shift+G / Cmd+Shift+G** ungroup | [Editing MIDI §10.5.13.1](https://www.ableton.com/en/live-manual/12/editing-midi/), [All new features](https://www.ableton.com/en/live/all-new-features/) |

---

## 7. Fold, scale highlighting, Key & Scale, tuning

| Item | What it does | Where / shortcut | Source |
|---|---|---|---|
| Fold to Notes | Hide key tracks with no notes (Drum Rack: only pads with notes/devices). | Header button; **F**; View menu | [Editing MIDI §10.6](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Fold to Scale | Hide key tracks outside the active scale (out-of-scale notes still show their track). | Header Scale-fold button; **G**; View menu | same |
| Highlight Scale | Highlights scale keys on the piano ruler and key tracks; root more prominent; global toggle. | Header button; **K**; Options menu | same; [Keyboard shortcuts](https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/) |
| Scale Mode / Root / Scale Name | Per-clip scale; Scale button in Main Clip Properties **or the Control Bar**; new clips inherit the foreground clip's scale; scale-aware devices and MIDI Tools use scale degrees. Audio clips forward scale to scale-aware devices. | Clip panel / Control Bar | [Clip View §8.2.4](https://www.ableton.com/en/live-manual/12/clip-view/), [Editing MIDI §10.6](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Note spelling | Flats / Sharps / Both / Auto (circle of fifths) or MIDI note numbers. | Piano-ruler context menu | [Editing MIDI §10.6](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Tuning systems | Note ruler can display tuning-system note names; 12.4.3 makes 12-tone tuning systems work in MIDI Tools. | Control Bar tuning chooser | [Editing MIDI §10.1](https://www.ableton.com/en/live-manual/12/editing-midi/), [Release notes](https://www.ableton.com/en/release-notes/live-12/) |

---

## 8. Pitch and Time Utilities panel (was the "Notes" box in Live 11)

Applies to selected notes / time range; buttons apply to the whole clip when nothing is selected.

| Tool | What it does | Where | Source |
|---|---|---|---|
| Transpose slider | Semitones (or scale degrees when a scale is active); shows the pitch range. | Pitch group | [Editing MIDI §10.5.9.1](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Fit to Scale | Snap pitches to the nearest degree of the clip scale (lower on ties); greyed without a scale. | Pitch group | §10.5.9.2 |
| Invert | Flip selection upside-down (highest↔lowest); scale-relative when a scale is active. | Pitch group | §10.5.9.3 |
| Interval Size + Add Interval | Adds a copy of each selected note at N semitones/degrees (chords); new notes are selected. | Pitch group | §10.5.9.4 |
| Stretch factor, ×2, /2 | Multiply note durations/positions; loop length unaffected. | Time group | §10.5.9.5 |
| Duration chooser + Set Length | Set all selected notes to a length (or Fit to Time Range). | Time group | §10.5.9.6 |
| Humanize Amount + Humanize | Random timing shift up to ¼ grid before/after (Clip View chapter says up to ½). | Time group | §10.5.9.7, [Clip View §8.5.2](https://www.ableton.com/en/live-manual/12/clip-view/) |
| Reverse | Retrograde the pattern (whole clip if no selection). | Time group | §10.5.9.8 |
| Legato | Extend/shorten each note to the next note's start; last note to loop end (see Span tool). | Time group | §10.5.9.9 |
| Mirror | Not a button — achieved by dragging one stretch marker past the other (§10.5.6) or the Recombine tool's Mirror mode. | — | §10.5.6, [MIDI Tools](https://www.ableton.com/en/live-manual/12/midi-tools/) |

---

## 9. Quantize

| Item | What it does | Where / shortcut | Source |
|---|---|---|---|
| Four ways to quantise | Record quantisation; grid snapping; the **Quantize MIDI Tool** (Transform panel); Edit → Quantize using the tool's settings. | — | [Editing MIDI §10.5.11](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Quantize MIDI Tool | Grid size or explicit meter incl. triplets; quantise note **start, end, or both**; **Amount %** for partial (non-destructive feel). | Transform panel | [MIDI Tools](https://www.ableton.com/en/live-manual/12/midi-tools/) |
| Quantize / Quantize Settings | Apply **Ctrl+U / Cmd+U**; open settings **Ctrl+Shift+U / Cmd+Shift+U**. | Edit menu | [Keyboard shortcuts](https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/) |
| Audio quantize | Same shortcut in the Sample Editor moves the nearest transient's warp marker to the grid; Amount shifts by a percentage. | Sample Editor Transform panel | [Warping](https://www.ableton.com/en/live-manual/12/audio-clips-tempo-and-warping/) |

---

## 10. Loop brace, Start/End markers, region controls

| Item | What it does | Where / shortcut | Source |
|---|---|---|---|
| Clip Start/End + Set buttons | Value fields with **Set Start / Set End** (quantised to global setting). **Ctrl+F9 / Cmd+F9** set start marker, **Ctrl+F12** set end marker. | Main Clip Properties | [Clip View §8.2.1](https://www.ableton.com/en/live-manual/12/clip-view/), [Keyboard shortcuts](https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/) |
| Loop toggle, Position, Length + Set buttons | Loop on/off (audio needs Warp on); Set Loop Position / Set Loop Length; clicking Set Loop Length during playback captures a loop on the fly; all MIDI-mappable. **Ctrl+F10 / Ctrl+F11** set loop brace start/end. | Main Clip Properties | same |
| Loop brace (in editor) | Drag its ends; **←/→** nudge by grid; **↑/↓** shift by one loop length; **Ctrl/Cmd+←/→** shorten/lengthen by grid; **Ctrl/Cmd+↑/↓** halve/double. **Alt/Option+arrows** move the whole clip region (start+end markers). | Editor ruler | [Clip View §8.9](https://www.ableton.com/en/live-manual/12/clip-view/) |
| Duplicate Loop | Doubles the loop and copies its contents (notes right of the loop keep their end-relative position); auto-zooms. | Select loop brace → **Ctrl+D / Cmd+D**; Edit menu "Duplicate Loop"; (Live 11 "Dupl. Loop" button) | [Editing MIDI §10.7.3](https://www.ableton.com/en/live-manual/12/editing-midi/) |
| Run Into Loop | Start marker before the loop: clip plays from start then enters the loop. | Drag start marker | [Clip View §8.9](https://www.ableton.com/en/live-manual/12/clip-view/) |
| Clip time signature / Groove / Commit | Per-clip signature (display only); Groove chooser + Hot-Swap + **Commit** writes the groove into notes (or a volume envelope for audio). | Main Clip Properties | [Clip View §8.2.2–8.2.3](https://www.ableton.com/en/live-manual/12/clip-view/) |
| Clip Update Rate | How fast Clip View changes hit a running clip. | Settings → Record, Warp & Launch | [Clip View §8.14](https://www.ableton.com/en/live-manual/12/clip-view/) |

---

## 11. Multi-clip editing & Focus Mode

| Item | What it does | Where / shortcut | Source |
|---|---|---|---|
| Multi-clip editing | Up to **eight** MIDI clips shown together (Session: looped clips, ordered by track then scene; Arrangement: clips across a time selection on up to eight tracks). One colour-matched **loop bar** per clip above the editor; drag above the scrub area to resize loop-bar height. Loop, signature, groove and scale controls edit all selected clips. | Select clips → Clip View | [Editing MIDI §10.8](https://www.ableton.com/en/live-manual/12/editing-midi/), [Clip View §8.13](https://www.ableton.com/en/live-manual/12/clip-view/) |
| Focus Mode | ON: only the active clip is editable (others grey); hover an inactive loop bar to reveal; click a note or loop bar to switch clip; hold N = momentary. OFF: all notes active, editing/copy-paste/time selection work across clip boundaries; notes can be drawn continuously across Arrangement clip boundaries. | Focus button; **N** | [Editing MIDI §10.8.1](https://www.ableton.com/en/live-manual/12/editing-midi/), [Icon Collective](https://www.iconcollective.edu/ableton-live-multi-clip-editing), [MusicRadar multi-clip](https://www.musicradar.com/how-to/how-to-edit-multiple-midi-clips-in-one-view-in-ableton-live-10) |
| Multi-clip property editing | Sliders show a value range with split triangle handles; drag to extremes to unify. | Clip View | [Clip View §8.13](https://www.ableton.com/en/live-manual/12/clip-view/) |
| Multi-clip warping | Same-length audio clips selected together share warp-marker edits. | Sample Editor | [Warping](https://www.ableton.com/en/live-manual/12/audio-clips-tempo-and-warping/), [Patches.zone](https://www.patches.zone/ableton-tutorials/warping-ableton-live) |

---

## 12. Keyboard-only editing (Accessibility chapter)

"Use Tab Key to Move Focus" (Navigate menu / Display & Input) turns Tab into focus navigation (Tab / Shift+Tab; Ctrl+Tab row-wise; optional Wrap). Then: insert marker + **Shift+←/→** selects time; **↑/↓** transpose, **Shift+↑/↓** octaves; **←/→** move by grid; **Ctrl/Option+←/→** note boundaries; **Ctrl/Cmd+↑/↓** velocity; **Ctrl+Alt/Cmd+Option+↑/↓** chance; **Shift+←/→** note length. Audio: Ctrl/Option+←/→ move insert marker, **Ctrl+I / Cmd+I** insert+select warp marker, **Ctrl+Shift+I** insert transient. Envelopes (12.2): **Enter** creates/selects breakpoint, **Alt/Option+←/→** jump breakpoints, Tab/Shift+Tab next/previous, ↑/↓ value, Delete; **Alt/Option+↑/↓** cycles envelopes, **Shift+Alt+↑/↓** device parameters. Not screen-reader-supported: MPE editing. ([Accessibility & keyboard navigation](https://www.ableton.com/en/live-manual/12/accessibility-and-keyboard-navigation/), [Release notes 12.2](https://www.ableton.com/en/release-notes/live-12/))

---

## 13. Envelopes tab (clip envelopes)

| Item | What it does | Where / shortcut | Source |
|---|---|---|---|
| Device chooser / Control chooser | Left: **Clip** (audio: sample controls) or **MIDI Ctrl** (MIDI clips), every device in the chain, Mixer. Right: the parameter; LEDs mark adjusted envelopes; "Only show adjusted envelopes". Clicking a device parameter selects it in the chooser *(community)*. | Envelopes tab | [Clip Envelopes](https://www.ableton.com/en/live-manual/12/clip-envelopes/), [Sonic Bloom clip automation](https://sonicbloom.net/clip-automation-ableton-live/) |
| Automation vs Modulation toggles | Session clips: red **Automation** (absolute) or blue **Modulation** (relative) envelopes; Arrangement clips only modulate in Clip View (automation lives on track lanes). | Below choosers | [Clip Envelopes](https://www.ableton.com/en/live-manual/12/clip-envelopes/) |
| Linked / Unlinked + envelope loop/region | Right-click → unlink gives the envelope its own loop brace, Loop switch, start marker and length (e.g. 3.2.1) → "clip envelope as tempo-synced LFO". Linked envelopes follow warp-marker moves. | Envelopes tab loop controls ("Linked" button) | same; [Sonic Bloom](https://sonicbloom.net/clip-automation-ableton-live/) |
| Draw / breakpoint editing | Draw Mode steps on grid; breakpoints: click segment to add, click breakpoint to delete, right-click **Edit Value**, Shift fine, **Alt/Option-drag curves a segment** (Alt+double-click straightens), stretch/skew handles on a time selection (Alt mirrors), **Insert Shape** (sine/tri/saw/ramps/ADSR) from the context menu, **Simplify Envelope**, copy/paste between parameters. **Ctrl+Alt / Cmd+Option-drag** scrolls. | Envelope Editor | [Automation & envelopes](https://www.ableton.com/en/live-manual/12/automation-and-editing-envelopes/), [Clip Envelopes](https://www.ableton.com/en/live-manual/12/clip-envelopes/) |
| Clear Envelope | Reset to default. | Context menu; **Ctrl+Backspace / Cmd+Delete** opens context | [Clip Envelopes](https://www.ableton.com/en/live-manual/12/clip-envelopes/) |
| Audio clip envelopes | **Transposition** (additive, −48..+48 st), **Gain** (% of Clip Gain), **Sample Offset** (Beats mode only, ±8 sixteenths, "escalator" repeats), pan (intensity set by pan knob), sends (can only reduce). | Clip → control | same |
| MIDI Ctrl envelopes | CC 0–119 (scrollable), pitch bend etc.; **MIDI Envelope Auto-Reset** (Options / editor context). | MIDI Ctrl → control | same |
| Clip as template | Drop a new sample onto Clip View: envelopes and settings stay, only the sample changes. | Drag-drop | same |

---

## 14. Expression tab (MPE / per-note expression)

| Item | What it does | Where / shortcut | Source |
|---|---|---|---|
| Lanes | **Pitch** (drawn as envelopes on the notes themselves), **Slide**, **Pressure**, **Velocity**, **Release Velocity**; Slide+Pressure shown by default; lane selector toggles at left; triangle toggle shows/hides all (Alt/Option-click shows all); lanes resizable individually or together. | Expression tab (**Alt+Shift+3 / Option+Shift+3**) | [Editing MPE](https://www.ableton.com/en/live-manual/12/editing-mpe/), [Keyboard shortcuts](https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/) |
| Breakpoints | Selected notes show envelopes (others dimmed); click segment = new breakpoint, click breakpoint = delete; drag (selection follows); right-click **Edit Value**; Shift constrains to one axis; drag over neighbours removes them; **Alt/Option-drag** curves; Alt+double-click straightens. | Lanes | same |
| Grid | Off by default in this tab; **Ctrl+4 / Cmd+4** enables (snaps to neighbouring breakpoint times). Pitch breakpoints snap to semitones with Alt/Cmd. | Options | same |
| Scale a whole envelope | Hover above the envelope until it turns blue, drag up/down (not for Pitch); **Ctrl+A / Cmd+A** selects all breakpoints of a note. | Lanes | same |
| Notes carry expression | Moving/stretching a note (stretch markers, ×2, /2) moves/stretches its expression. Join keeps MPE. | — | same |
| Zoom / Fold / Clear | **Z** zooms to the pitch-bend range in the selection; Fold hides pitch envelopes; context **Clear All Envelopes**. | — | same |
| MPE tools | **Glissando** and **LFO** transformations (12.1) write these envelopes; only visible in the MPE editor. | Transform panel | [MIDI Tools](https://www.ableton.com/en/live-manual/12/midi-tools/) |

---

## 15. MIDI Tools — Transform and Generate panels

### 15.1 Common interface
| Item | What it does | Where / shortcut | Source |
|---|---|---|---|
| Panels | **Transform** (tool chooser + parameters) and **Generate** (tool chooser + parameters) in Clip View; MIDI clips only (audio Transform = Quantize only). | Clip View left panels | [Clip View §8.6](https://www.ableton.com/en/live-manual/12/clip-view/) |
| Auto Apply / Apply | Auto Apply on by default (notes change as you tweak); off → press **Apply** (**Ctrl+Enter / Cmd+Enter**). Apply/Generate button turns yellow when there are un-applied changes. | Panel header | [MIDI Tools](https://www.ableton.com/en/live-manual/12/midi-tools/), [MusicRadar tools](https://www.musicradar.com/how-to/live-12-midi-tools) |
| Reset | Restores defaults (greyed when at defaults). | Panel header | [MIDI Tools](https://www.ableton.com/en/live-manual/12/midi-tools/) |
| Scope | Transformations act on the note selection / time selection / whole loop; generators fill the time selection or the loop and **replace existing notes they overlap**; generated notes stay selected (coloured) while un-generated ones are grey. | — | same; [Attack Magazine](https://www.attackmagazine.com/technique/tutorials/getting-started-with-ableton-lives-generative-midi-tools/) |
| Scale-aware | With a clip scale active, pitch parameters are in scale degrees. | — | [MIDI Tools](https://www.ableton.com/en/live-manual/12/midi-tools/) |
| Status indicator | 12.2 added a visual status indicator for MIDI Tools. | Panel | [Sonic Bloom 12.2](https://sonicbloom.net/ableton-live-12-2-12-small-improvements/) |
| Max for Live tools | Drop .amxd files into `User Library/MIDI Tools/Max Transformations` or `/Max Generators` (or any Places folder); browser "MIDI Tool" / "Stacks" tags. Velocity Shaper + Euclidean ship with Standard/Suite. | Browser | [MIDI Tools](https://www.ableton.com/en/live-manual/12/midi-tools/), [Ableton FAQ](https://help.ableton.com/hc/en-us/articles/11535349458588-MIDI-Tools-and-Device-Updates-in-Live-12-FAQ) |

### 15.2 Generators
| Tool | Parameters / behaviour | Source |
|---|---|---|
| **Rhythm** | Pitch (or drum pad; **Alt/Option-click the piano ruler** to pick), **Steps** (≤16), **Pattern** knob, **Density**, **Step Duration**, **Split** (probability of halving a step), **Shift** (±step offset), **Velocity**, **Accent** velocity, **Accent Frequency**, Accent Offset arrows. Works one voice at a time. | [MIDI Tools](https://www.ableton.com/en/live-manual/12/midi-tools/), [SOS generators](https://www.soundonsound.com/techniques/ableton-live-12-midi-generators), [MusicRadar generative](https://www.musicradar.com/how-to/live-12-midi-tools-1) |
| **Seed** | Min/Max **Pitch** (or Key Track sliders / Alt-drag on ruler), **Duration** range (1/128–1 note), **Velocity** range, **Voices**, **Density**. | same; [MusicRadar basslines](https://www.musicradar.com/tutorials/music-production-tutorials/stuck-for-ideas-heres-how-to-create-fresh-basslines-and-melodies-with-ableton-live-12s-midi-tools) |
| **Shape** | Shape preset dropdown (9 shapes: up, down, arc, bounce…) or draw a custom shape in the display (purple dots), Min/Max Pitch, **Rate**, **Tie**, **Density**, **Jitter**. | same |
| **Stacks** | Chord Selector pad (click/drag or Ctrl/Cmd+arrows), 15 chord types, chord banks as **.stacks** JSON files (loadable from browser Places), **Add/Delete Chord** (up to 4 slots → progression), **Root** (Alt-click ruler; snaps to scale), **Inversion** (±), **Duration** & **Offset** in eighths. Parameters apply to the selected chord only. | [MIDI Tools](https://www.ableton.com/en/live-manual/12/midi-tools/), [SOS](https://www.soundonsound.com/techniques/ableton-live-12-midi-generators) |
| **Euclidean** (M4L) | Up to 4 voices; Pattern tab (per-voice rotation, randomize dice), Voices tab (pitch/pad, velocity), **Steps**, **Density**, **Division**. | [MIDI Tools](https://www.ableton.com/en/live-manual/12/midi-tools/), [Attack](https://www.attackmagazine.com/technique/tutorials/getting-started-with-ableton-lives-generative-midi-tools/) |
| Packs | 12.1 **MIDI Tools Pack** (Retrigger, Slice Shuffler, Polyrhythm Generator, Stages, Phase Pattern); 12.3 **Generators by Iftah** (Sting acid lines, Patterns percussion); Sequencers Pack (SQ etc.). Suite / M4L. | [Ableton blog Meyer](https://www.ableton.com/en/blog/philip-meyer-midi-tools/), [12.3 blog](https://www.ableton.com/en/blog/live-12-3-is-here/) |

### 15.3 Transformations
| Tool | Parameters / behaviour | Source |
|---|---|---|
| **Arpeggiate** | Style (18 patterns), Distance (st/degrees), Steps, Rate, Gate — splits chords into arpeggios like the Arpeggiator device. | [MIDI Tools](https://www.ableton.com/en/live-manual/12/midi-tools/) |
| **Chop** (12.1) | **Parts** 2–64, **Gaps** (± behave differently), pattern toggles for chunks/gaps, emphasis toggles + **Stretch Chunk(s)**, **Variation** (random start/end). | same; [Sonic Bloom 12.1](https://sonicbloom.net/new-midi-tools-in-ableton-live-12-1/) |
| **Connect** | Fills gaps with interpolated notes: **Spread**, **Density**, **Rate**, **Tie**. | [MIDI Tools](https://www.ableton.com/en/live-manual/12/midi-tools/) |
| **Glissando** (12.1, MPE) | Pitch-bend curve from note to next note: **Start** (% of note), **Curve** (breakpoint). Needs ≥2 notes. | same |
| **LFO** (12.1, MPE) | Target Pitch Bend/Slide/Pressure; Attack/Decay envelope; Shape + Sine/Square/Triangle/Random; Reseed; **Rate** 1–1/128; Time Shift; Amount (±120 st for pitch, ±127 others); Amplitude Base. | same |
| **Ornament** | Flam mode (Position ±, Velocity) or Grace Notes mode (Pitch High/Low/Same, Position, Velocity, Chance, Amount); reapply adds more. | same |
| **Quantize** | see §9. | same |
| **Recombine** | Dimension Position/Pitch/Duration/Velocity; **Shuffle**, **Mirror**, **Rotate** (steps; Rotate on Grid). Shuffle re-rolls each Apply. | same |
| **Span** | Legato / Tenuto / Staccato articulation; Offset; Variation. | same |
| **Strum** | Strum Low / Strum High offsets (±), **Tension**, breakpoint display. | same |
| **Time Warp** | Up to 3 breakpoints (Time/Speed), Quantize toggle, Preserve Time Range, Include Note End — accelerando/ritardando. | same |
| **Velocity Shaper** (M4L) | Envelope display with breakpoints, Min/Max velocity, Loop, Rotate, Division. | same |
| Pre-release name "Articulate" | CDM's beta list shows "Articulate"; shipped as **Span**. | [CDM](https://cdm.link/2023/11/ableton-live-12-everything-new/) |

---

## 16. Audio clips: the Sample Editor (waveform detail at the bottom)

### 16.1 Sample box / Audio Utilities
| Item | What it does | Where | Source |
|---|---|---|---|
| Sample details header | Sample name, sample rate, bit depth, channels (asterisk = mixed values across multi-selection); **Show in Browser**. | Sample Editor header / context | [Clip View §8.10](https://www.ableton.com/en/live-manual/12/clip-view/) |
| **Warp** switch | Off = original tempo; On = follows Set tempo; loop needs Warp on. | Audio Utilities | [Clip View §8.4.1](https://www.ableton.com/en/live-manual/12/clip-view/) |
| Seg. BPM, **×2 / ÷2** | Original tempo estimate (type exact BPM; Shift-drag fine); halve/double when auto-detection is off by an octave. | Audio Utilities | [Warping](https://www.ableton.com/en/live-manual/12/audio-clips-tempo-and-warping/) |
| Warp Mode chooser | Beats / Tones / Texture / Re-Pitch / Complex / Complex Pro (§16.3). Default set in Record, Warp & Launch. | Audio Utilities | same |
| **Gain** | dB slider (range handles when multi-selected). | Audio Utilities | [Clip View §8.4.7](https://www.ableton.com/en/live-manual/12/clip-view/) |
| **Pitch** (Transpose + Detune) | Semitones field + cents field; disabled in Re-Pitch mode. | Audio Utilities | same |
| **RAM** | Load clip into RAM instead of streaming (fixes disk dropouts / Legato mode). | Audio Utilities | §8.4.5 |
| **Hi-Q** | High-quality interpolation, ~19 st of transposition before aliasing; more CPU. | Audio Utilities | §8.4.6 |
| **Rev** (Reverse) | Renders a reversed sample file (warp markers/loop flip; envelopes stay); remembers both versions until Live closes. Arrangement: **R** on a selection. | Audio Utilities; context "Reverse Clip(s)" | §8.4.2, [Arrangement](https://www.ableton.com/en/live-manual/12/arrangement-view/) |
| **Edit** | Open in external sample editor (File & Folder settings). | Audio Utilities | §8.4.3 |
| Clip **Fade** toggle | 0–4 ms signal-dependent fades at clip edges (Session clips); default on when "Create Fades on Clip Edges" is set. | Audio Utilities | §8.4.4 |
| Tempo **Lead/Follow** | Arrangement clips can lead the Set tempo from their warp markers (bottom-most leading clip wins; creates tempo automation; "Unfollow Tempo Automation"). | Audio Utilities (Arrangement) | [Warping](https://www.ableton.com/en/live-manual/12/audio-clips-tempo-and-warping/) |
| Save (Save Default Clip) | Stores warp markers + settings with your own sample. | Title bar | same |
| Replace sample | Drag a sample onto Clip View (or double-click/Enter in browser); markers kept only if same length; **Show Similar Files**; **Manage Sample File**. | Drag / context | [Clip View §8.12](https://www.ableton.com/en/live-manual/12/clip-view/) |
| Crop | **Crop Clip Sample** (start/loop region) or **Crop Clip Sample to Time Selection**; writes a new file to `Samples/Processed/Crop`. | Context; **Ctrl+Shift+J / Cmd+Shift+J** | [Clip View §8.11](https://www.ableton.com/en/live-manual/12/clip-view/) |
| Arrangement-only audio editing | Fade handles at clip corners + Fade Curve handle; **F** while hovering an automation lane shows fades; "Create Fades on Clip Edges" gives 4 ms defaults + auto crossfades; drag a fade over the neighbour or Create → Create Crossfade; **Split Ctrl+E**, **Consolidate Ctrl+J**, Cut/Paste/Delete Time, Insert Silence; Bounce to New Track / in place / Paste Bounced Audio (12.2); **Separate Stems** (12.3; portion of a clip + merge back in 12.4). | Arrangement | [Arrangement View](https://www.ableton.com/en/live-manual/12/arrangement-view/), [12.2 blog](https://www.ableton.com/en/blog/live-12-2/), [12.3 blog](https://www.ableton.com/en/blog/live-12-3-is-here/), [Synth Anatomy 12.4](https://synthanatomy.com/2026/04/ableton-live-12-stay-creative-and-in-focus-an-overview-of-the-new-features.html) |

### 16.2 Warp markers & transients
| Item | What it does | Where / shortcut | Source |
|---|---|---|---|
| Transient markers | Auto-detected "small gray markers at the top of the Sample Editor"; insert **Ctrl+Shift+I / Cmd+Shift+I**, delete **Ctrl+Shift+Backspace / Cmd+Shift+Delete**, context **Reset Transients**; Shift-drag repositions. They drive Beats mode, audio Quantize, Slice and Convert-to-MIDI. | Top of waveform | [Warping](https://www.ableton.com/en/live-manual/12/audio-clips-tempo-and-warping/), [SOS warping](https://www.soundonsound.com/techniques/ableton-live-warping-revisited) |
| Pseudo warp markers | Grey markers that appear when hovering a transient; double-click/drag turns them yellow (real). **Ctrl/Cmd while creating one also creates markers at the adjacent transients** ("lock the neighbours"). | Hover transient | same; [Patches.zone](https://www.patches.zone/ableton-tutorials/warping-ableton-live), [Sonic Bloom warp tip](https://sonicbloom.net/ableton-live-quick-tips-automatically-create-warp-markers-left-right-of-a-transient/) |
| Create / move / delete warp markers | Double-click upper half of the waveform or **Ctrl+I / Cmd+I** at the insert marker; drag or arrow keys move; **Ctrl/Cmd+←/→** selects markers; **Shift-drag moves the waveform under the marker**; double-click or Delete removes. The waveform moves, the grid stays. | Waveform | [Warping](https://www.ableton.com/en/live-manual/12/audio-clips-tempo-and-warping/), [Keyboard shortcuts](https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/) |
| Set 1.1.1 Here | Declare the first downbeat at the insert marker. | Context menu | [Warping](https://www.ableton.com/en/live-manual/12/audio-clips-tempo-and-warping/), [Icon Collective warp](https://www.iconcollective.edu/warp-tracks-in-ableton-live) |
| Warp From Here / (Start At…) / (Straight) / Warp … BPM From Here | Re-run auto-warp to the right of a marker; "Start At" uses the Set tempo as baseline; "Straight" places a single marker for steady-tempo material; "… BPM From Here" assumes the clip already matches the Set tempo. | Context menu | same |
| Warp Sample As… / Warp Selection as … loop | Force a seamless loop of N bars; select a range and warp it to fill a suggested loop length. | Context menu | same |
| Auto-warp preferences | Loop/Warp Short Samples: Unwarped One Shot / Warped One Shot / Warped Loop / Auto; **Auto-Warp Long Samples** (adds a marker per bar); Default Warp Mode (Beats). | Settings → Record, Warp & Launch | same |
| Even/odd/uneven loops | 1/2/4/8/16-bar loops get start+end markers automatically; odd loops need the end marker on an even bar; uneven material: Set 1.1.1 Here then Warp From Here. | — | same |
| Groove by warping | Deliberately drag a marker off a transient (pin neighbours first) for feel changes. | — | same |

### 16.3 Warp modes
| Mode | Parameters | Use | Source |
|---|---|---|---|
| **Beats** | **Preserve** (Transients or grid divisions 1 bar…1/32), **Transient Loop Mode** Off / Forward / Back-and-Forth, **Transient Envelope** 0–100 (fade after each segment; 100 = none). | Drums, EDM; Loop Off + low envelope = gating/tightening; Back-and-Forth best at slow tempos. | [Warping](https://www.ableton.com/en/live-manual/12/audio-clips-tempo-and-warping/), [Patches.zone](https://www.patches.zone/ableton-tutorials/warping-ableton-live), [HomeMusicMaker](https://www.homemusicmaker.com/ableton-warp-modes) |
| **Tones** | **Grain Size** (actual size follows pitch clarity). | Vocals, mono instruments, bass. | same |
| **Texture** | **Grain Size** (applied as set), **Flux** (Fluctuation randomness). | Pads, noise, polyphonic textures; larger grains = glitch. | same |
| **Re-Pitch** | none (Transpose/Detune disabled) — turntable-style speed=pitch. | DJ/lo-fi. | same |
| **Complex** | none. | Full mixes; CPU heavier — freeze/flatten. | same |
| **Complex Pro** | **Formants** 0–100 (preserve formants when transposing), **Envelope** (default 128; lower for high-pitched, higher for low). | Best quality for full songs / vocal transposition. | same; [Icon Collective warp](https://www.iconcollective.edu/warp-tracks-in-ableton-live) |

### 16.4 Slice / Convert to MIDI
| Command | What it does | Where | Source |
|---|---|---|---|
| **Slice to New MIDI Track** | Dialog: slice by beat division / Transients / Warp Markers / Region; max 128 slices; **Slicing Preset** chooser (Ableton + user presets); **Preserve Warped Timing** toggle. Creates MIDI track + Drum Rack (one Simpler per slice) + macros; MIDI notes ascend chromatically. | Create menu / clip context menu | [Converting Audio to MIDI](https://www.ableton.com/en/live-manual/12/converting-audio-to-midi/) |
| **Convert Harmony to New MIDI Track** | Polyphonic pitch detection → Instrument Rack (piano). | Create / context | same |
| **Convert Melody to New MIDI Track** | Monophonic pitch → Instrument Rack (synth with "Synth to Piano" macro). | Create / context | same |
| **Convert Drums to New MIDI Track** | Kick/snare/hat detection → Drum Rack; tune by editing transient markers first. | Create / context | same |
| Quality tips | Clear attacks; isolated instrument; WAV/AIFF not MP3; "wrong" command for creative results. | — | same |
| **Separate Stems** (12.3/12.4) | Split vocals/drums/bass/other from an audio clip (Suite); 12.4: on a selected clip portion in Arrangement; merge stems. | Clip context | [12.3 blog](https://www.ableton.com/en/blog/live-12-3-is-here/), [Synth Anatomy](https://synthanatomy.com/2026/04/ableton-live-12-stay-creative-and-in-focus-an-overview-of-the-new-features.html) |

---

## 17. Tips tutorials repeat

Workflow advice that recurs across the Ableton manual, Sonic Bloom, MusicRadar, SOS, Attack, EDMProd, Unison, LiveAspects, Icon Collective, Patches.zone and CDM:

1. **Learn the handful of note shortcuts** — B draw, Ctrl/Cmd+D duplicate, Shift+↑/↓ octave, Ctrl/Cmd+U quantize (Ctrl/Cmd+Shift+U settings), F fold, 0 deactivate, Ctrl/Cmd+E chop/split, Ctrl/Cmd+J join, Ctrl/Cmd+Alt+J fit, Z/X zoom, Ctrl/Cmd+4 grid off. (EDMProd, Unison, LiveAspects, Sonic Bloom, Future Music quote "learn one a day".)
2. **Turn the headphone preview on** so every add/move is audible; with an armed track it becomes step entry. (EDMProd, Unison, LiveAspects, manual.)
3. **Duplicate Loop, then vary the second half** — the standard way to build 2-/4-bar variations. (EDMProd, Unison.)
4. **Legato / Span to close gaps**; **Deactivate (0) instead of delete** while auditioning ideas. (EDMProd, Unison.)
5. **Fold** the piano roll for Drum Racks; **Fold to Scale / Highlight Scale (K)** for melodies; set the scale in the Control Bar once so new clips and scale-aware tools follow it. (EDMProd, Ableton, MusicRadar.)
6. **Humanise by layering**: Velocity Randomize/Deviation + Chance + Humanize + a Groove from the Groove Pool; quantize at ~50% Amount to keep feel. (Unison, EDMProd, manual.)
7. **Hold Alt/Cmd to bypass the grid** for a single edit rather than toggling it. (manual, LiveAspects.)
8. **Generators**: work at a slow tempo; **deselect the generated notes before generating the next voice** or they are replaced (SOS, Attack, MusicRadar); Alt-click the piano ruler to pick the pitch/pad; **generate inside the loop brace** to touch only part of the clip; **turn Auto off** until settings are right; use Rhythm's **Split %** for variety; keep Seed's range narrow (a 4th/5th, Voices = 1) for bass; **re-select the notes before changing Shape settings** or you get overlays; move the clip start marker to find a better downbeat.
9. **Transform after generating**: Recombine (Shuffle) for instant variations that keep the shape; Strum on chords; Ornament flams on drums; Connect to fill gaps; Chop + Join to build tuplets and complex rhythms (DeSantis).
10. **Find & Select + a Transformation** (12.1) is the intended pairing: filter by velocity/chance/count/scale, combine filters, then apply a tool only to those notes. (Sonic Bloom, CDM.)
11. **Multi-clip editing** (up to 8 clips) to see drums vs bass relationships; hover a loop bar to identify a clip; Focus (N) when you only want one clip touched. (Icon Collective, MusicRadar, manual.)
12. **Stack Clip View above Device View** so notes/automation and the instrument are visible together; Ctrl/Cmd+Alt+3 / +4 toggle each. (Ableton, CDM, forum.)
13. **Warping recipe**: know the BPM → find the first downbeat → **Set 1.1.1 Here** → **Warp From Here (Straight)** for steady material → metronome check → add markers where it drifts → Save Default Clip. Disable Auto-Warp Long Samples if it fights you. (Icon Collective, manual.)
14. **Pin the neighbours**: Ctrl/Cmd-drag a warp marker (or create markers either side) so only the region you touch moves. (Patches.zone, SOS, Sonic Bloom.)
15. **Pick the warp mode by material**: Beats for drums, Tones for vocals/bass, Texture for pads/noise, Re-Pitch for DJ/lo-fi, Complex/Complex Pro for full songs; Complex Pro Formants for transposed vocals; freeze/flatten Complex to save CPU; Beats + Loop Off + Transient Envelope as a gate. (Every warp tutorial.)
16. **Consolidate first (Ctrl/Cmd+J)** so multi-mic clips are the same length, then warp/quantize them together. (Patches.zone, manual.)
17. **Envelopes**: draw steps on-grid then switch Draw Mode off to smooth breakpoints; Alt-drag for curves; **unlink** an envelope with an odd loop length to get a tempo-synced LFO; Insert Shape / Simplify Envelope. (manual, Sonic Bloom.)
18. **Resample MIDI effects** into clips to see what Arpeggiator/Chord actually produced. (Ableton blog, EDMProd.)

---

## 18. Quick checklist for the Beacon gap analysis (surface areas to compare)

- Detail area: stackable clip + device panes, resizable split, full-size toggle, per-view show/hide shortcuts.
- Draw Mode: grid-length notes, step-by-grid painting, velocity-by-drag while drawing, last-velocity inheritance, pitch-lock preference + Alt flip, erase-by-draw, hold-B momentary.
- Lanes: Velocity, Velocity Deviation, Release Velocity, Chance, Probability Groups, MPE Pitch/Slide/Pressure, lane selector, resizable lanes.
- Selection: insert marker + keyboard time/note selection, Enter toggle, Invert Selection, Find & Select filters (8), key-track click.
- Editing: overlap rules, edge resize, stretch markers (proportional + pseudo + mirror), split/chop/join/fit, deactivate, …Time commands, crop.
- Pitch & Time utilities: Transpose, Fit to Scale, Invert, Add Interval, Stretch ×2 /2, Set Length, Humanize, Reverse, Legato.
- Quantize: start/end/both, meter incl. triplets, Amount %.
- Loop: brace keyboard ops, Set buttons, Duplicate Loop, Run Into Loop, on-the-fly capture.
- Scale: clip scale + Control Bar scale, highlight, fold to scale, spelling, tuning systems.
- Multi-clip (8) + Focus mode; keyboard-only editing; accessibility.
- Envelopes tab: automation vs modulation, unlinked loops, shapes, curves, MIDI CC.
- MIDI Tools: Auto-apply/Apply/Reset, 5 generators, 12 transformations, M4L extensibility, scale-degree awareness.
- Audio: warp switch, Seg BPM ×2 ÷2, six warp modes with parameters, gain/pitch/detune/RAM/Hi-Q/reverse/fade/edit/save, warp+transient markers with all context commands, audio quantize, crop, slice/convert/stems, tempo lead.

---

## Sources

Ableton manual (v12)
- https://www.ableton.com/en/live-manual/12/editing-midi/
- https://www.ableton.com/en/live-manual/12/clip-view/
- https://www.ableton.com/en/live-manual/12/audio-clips-tempo-and-warping/
- https://www.ableton.com/en/live-manual/12/midi-tools/
- https://www.ableton.com/en/live-manual/12/converting-audio-to-midi/
- https://www.ableton.com/en/live-manual/12/clip-envelopes/
- https://www.ableton.com/en/live-manual/12/editing-mpe/
- https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/
- https://www.ableton.com/en/live-manual/12/working-with-instruments-and-effects/
- https://www.ableton.com/en/live-manual/12/live-concepts/
- https://www.ableton.com/en/live-manual/12/accessibility-and-keyboard-navigation/
- https://www.ableton.com/en/live-manual/12/automation-and-editing-envelopes/
- https://www.ableton.com/en/live-manual/12/arrangement-view/
- https://www.ableton.com/en/live-manual/11/editing-midi-notes-and-velocities/ (Live 11 wording for Draw Mode / Notes box)

Ableton release notes, blog, help
- https://www.ableton.com/en/release-notes/live-12/
- https://www.ableton.com/en/live/all-new-features/
- https://www.ableton.com/en/blog/live-121-is-out-now/
- https://www.ableton.com/en/blog/live-12-2/
- https://www.ableton.com/en/blog/live-12-3-is-here/
- https://www.ableton.com/en/blog/philip-meyer-midi-tools/
- https://www.ableton.com/en/blog/midi-master-tutorials/
- https://www.ableton.com/en/live/learn-live/
- https://help.ableton.com/hc/en-us/articles/11535349458588-MIDI-Tools-and-Device-Updates-in-Live-12-FAQ

Sonic Bloom
- https://sonicbloom.net/new-midi-tools-in-ableton-live-12-1/
- https://sonicbloom.net/ableton-live-12-2-12-small-improvements/
- https://sonicbloom.net/ableton-live-12-announced-new-devices-features-depth/
- https://sonicbloom.net/clip-automation-ableton-live/
- https://sonicbloom.net/ableton-live-quick-tips-automatically-create-warp-markers-left-right-of-a-transient/
- https://sonicbloom.net/new-shortcuts-ableton-live-12-2-clips/ (video + PDF index)
- https://sonicbloom.net/all-new-shortcuts-ableton-live-12-1/ (video + PDF index)
- https://sonicbloom.net/ableton-live-insider-tips-create-adjust-midi-notes-faster/ (video)

MusicRadar
- https://www.musicradar.com/how-to/live-12-midi-tools
- https://www.musicradar.com/how-to/live-12-midi-tools-1
- https://www.musicradar.com/tutorials/music-production-tutorials/stuck-for-ideas-heres-how-to-create-fresh-basslines-and-melodies-with-ableton-live-12s-midi-tools
- https://www.musicradar.com/news/ableton-live-12-whats-new-devices-midi-workflow
- https://www.musicradar.com/news/ableton-live-12.1-5-things
- https://www.musicradar.com/how-to/how-to-edit-multiple-midi-clips-in-one-view-in-ableton-live-10

Other tutorials / press / community
- https://www.soundonsound.com/techniques/ableton-live-12-midi-generators
- https://www.soundonsound.com/techniques/ableton-live-warping-revisited
- https://www.soundonsound.com/techniques/live-12-whats-new-v121
- https://www.attackmagazine.com/technique/tutorials/getting-started-with-ableton-lives-generative-midi-tools/
- https://cdm.link/live-12-1-midi-tools/
- https://cdm.link/2023/11/ableton-live-12-everything-new/
- https://www.edmprod.com/ableton-live-piano-roll/
- https://unison.audio/ableton-piano-roll/
- https://liveaspects.com/how-to-use-the-piano-roll-in-ableton/
- https://www.iconcollective.edu/ableton-live-multi-clip-editing
- https://www.iconcollective.edu/warp-tracks-in-ableton-live
- https://www.patches.zone/ableton-tutorials/warping-ableton-live
- https://www.homemusicmaker.com/ableton-warp-modes
- https://www.synthtopia.com/content/2023/11/26/ableton-live-12-tools-for-chopping-joining-midi/ (Dennis DeSantis YouTube tutorial write-up)
- https://synthanatomy.com/2026/04/ableton-live-12-stay-creative-and-in-focus-an-overview-of-the-new-features.html
- https://forum.ableton.com/viewtopic.php?t=249571 (Detail View toggle thread)
- https://forum.ableton.com/viewtopic.php?t=153448 (drawn-note velocity/length)
- https://forum.ableton.com/viewtopic.php?t=177186 (default velocity of drawn notes)
- https://forum.ableton.com/viewtopic.php?t=226464 (lengthen a drawn note)
- https://forum.ableton.com/viewtopic.php?t=232123 (Draw Mode for velocity)

Not reachable from this environment: reddit.com (crawler blocked), audeobox.com, pcaudiolabs.com, gearspace.com, YouTube page text.
