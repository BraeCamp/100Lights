# Ableton Live 12 — Interface & Workflow Surface

Research notes for a gap analysis against Beacon (100Lights browser DAW). Research only; no code touched.
Compiled 2026-09-04 from the Live 12 reference manual (12.4.x edition), Ableton help-center/blog pages,
Sonic Bloom, MusicRadar, Sound On Sound, LANDR, EDMProd, Black Ghost Audio and several tutorial write-ups.
Source numbers `[S#]` refer to the Sources section at the end.

Version context (matters for naming):
- Live 12.0 (Mar 2024) renamed **Preferences → Settings** and split Look/Feel into **Display & Input** and **Theme & Colors**; added the redesigned Browser (tags/filters/similarity), stacked Clip+Device views, Keys & Scale in the Control Bar, Tunings, the Navigate menu and keyboard focus navigation. `[S7][S28]`
- 12.1 (2024): MIDI note filters (Find & Select), MIDI Tools, Push macro variations, Auto Shift. `[S29][S65]`
- 12.2 (Jun 2025): Quick Tags panel, Filter View toggle/menu, sortable content columns, keyboard automation workflow, device-header context button, take-lane header button. `[S27][S48]`
- 12.3 (Nov 2025): **Help View replaced by Learn View**, Splice label in browser, smaller minimum mixer height, Bounce to New Track polish. `[S27][S64]`
- 12.4 (May 2026): Link Audio + dedicated **Link** settings page (Link, Tempo & MIDI split), Learn View filters/progress. `[S27][S74]`
- 12.4.5 (Aug 2026): Ctrl/Cmd+F selects existing search term; Status Bar remote notifications. `[S27]`

Blocked sources: reddit.com is not reachable from this environment (search API and fetch both refuse the domain), and forum.ableton.com / help.ableton.com return 403 on fetch (help-center content used here comes from search snippets only). Reddit tips are therefore represented through the secondary write-ups that aggregate them (LANDR, EDMProd, Sonic Bloom, MusicRadar).

---

## 0. Screen anatomy (what is on the main window)

| Region | What it is | Show/hide | Source |
|---|---|---|---|
| **Control Bar** (top strip) | Transport, tempo, metronome, scale, loop/punch, map modes, CPU, view selector. Nine sections in Live 12 (see §1). | Always visible | [S1] |
| **Browser** (left column) | Library of sounds/devices/samples/packs/places; also hosts the Groove Pool, Tuning section and Learn View column area. | Ctrl+Alt+B / Cmd+Opt+B (also Ctrl+Alt+5), toggle at far-left of Control Bar; Browser Config Menu offers Full-Height Browser, Tuning, Groove Pool | [S1][S5][S8] |
| **Main view** | Either **Session View** (clip-launch grid) or **Arrangement View** (timeline). Tab toggles; both share the same tracks. | Tab, or selector top-right | [S1][S53] |
| **Detail View** (bottom) | **Clip View** and/or **Device View**; in Live 12 both can be **stacked** (shown at once). | Selectors bottom-right; Shift+Tab or F12 toggles which one; Ctrl+Alt+3 / Ctrl+Alt+4 show/hide each | [S16][S19][S8] |
| **Info View** (bottom-left) | Hover help: name + function of whatever is under the mouse; also shows user "Info Text". | `?` key (Shift+/), bottom-left toggle | [S7][S26] |
| **Status Bar** (bottom) | Error messages/update notices; in MIDI editor shows selected-note position/pitch/velocity/probability; 12.2 shows applied MIDI Tools; 12.4.5 remote notifications. | Always | [S1][S27][S48] |
| **Overview strip** (Arrangement only) | Miniature whole-song map above the timeline; drag to scroll/zoom. | Ctrl+Alt+O / Cmd+Opt+O | [S2][S8] |
| **Mixer view control / config menu** (bottom-right) | Show/hide mixer sections: In/Out, Sends, Returns, Mixer, Track Options (Track Delay), Crossfader, Performance Impact. | Drop-down next to Mixer selector; also View › Mixer Controls | [S4][S34] |
| **Second Window** | A second top-level window (dual monitors) that can hold the other main view; Clip View and Device View cannot be on both windows at once. | View › Second Window, Ctrl+Shift+W / Cmd+Shift+W | [S8][S40][S60] |
| **Video Window** | Floating always-on-top video monitor. | View › Video Window, Ctrl+Alt+V / Cmd+Opt+V | [S22][S8] |
| **Learn View** (12.3+) / **Help View** (≤12.2) | Built-in lessons; Learn View = videos + text, filter by topic, mark complete, picture-in-picture. | Help menu, Ctrl+Alt+7 / Cmd+Opt+7 | [S7][S27][S26] |
| **Full Screen** | Hides OS chrome. | View › Full Screen; F11 (Win) / Ctrl+Cmd+F (Mac — the manual table prints it as Cmd+F; verify) | [S8][S39] |

---

## 1. Control Bar, left to right

The Live 12 manual groups it into nine sections: Browser options · Tempo settings & metronome · Scale settings · Follow & Arrangement position · Transport · Automation & Capture MIDI · Arrangement loop settings · MIDI & CPU settings · View selector. `[S1]`

### 1.1 Browser options
| Control | Does | Notes / shortcut | Src |
|---|---|---|---|
| Show/Hide Browser toggle | Opens/closes the browser column. | Ctrl+Alt+B / Cmd+Opt+B | [S1][S8] |
| Browser Config Menu (▾) | Options: expand browser to **full height** (keeps other views open), show **Tuning** section, show **Groove Pool**. | Groove Pool also Ctrl+Alt+6 | [S1][S5][S11] |

### 1.2 Tempo settings & metronome
| Control | Does | Notes / shortcut | Src |
|---|---|---|---|
| **Link** toggle | Enables Ableton Link; shows number of connected peers when on. | Only visible if *Show Link Toggle* is on in Link settings; count-in unavailable while Link is on | [S12] |
| **Follow** (Tempo Follower) | Live analyses an audio input and follows its tempo in real time. | Visible only when *Show Tempo Follower Toggle* is on and an Input Channel is set (Tempo & MIDI settings); greyed out if the input can't connect; mutually exclusive with External Sync | [S12][S42] |
| **EXT** | Enables external MIDI-clock/timecode sync; upper LED flashes on usable incoming sync, lower LED when Live sends sync. | Appears only when a MIDI port's Sync column is enabled; also Options › External Sync | [S12] |
| **Tap** (Tap Tempo) | Click on each beat to set tempo; can also start playback. | Key/MIDI-mappable | [S56] |
| **Tempo** field | Song tempo in BPM (20–999); drag or type. Two fields: integer and decimal portion. | Tempo automation lives on the Main track (Mixer › Song Tempo) | [S2][S9][S3] |
| **Nudge Down / Nudge Up** | Momentarily slows/speeds the tempo while held, for syncing by ear with DJs/live players. | Both mappable | [S56] |
| **Time Signature** numerator/denominator | Global meter; typed or dragged, works while playing; time-signature *changes* are markers in the Arrangement (Create › Insert Time Signature Change). | Ctrl+R renames/edits a selected marker | [S2] |
| **Metronome** toggle + ▾ menu | Click during play/record. Menu: **Count-In** (None/1/2/4 bars… shown in blue in the Arrangement Position fields), **Sound** (Classic/Click/Wood per tutorials), **Rhythm** (Auto follows the denominator, or a fixed division), **Enable Only While Recording** (respects Punch-In). Volume = Preview/Cue Volume knob on Main. | Toggle: `O` in the Live 12 shortcut list (verify in-app) | [S10][S8][S59] |
| **Groove Global Amount** | Appears here once any clip uses a groove; scales Timing/Random/Velocity for all grooves (0–130%). | | [S11] |

### 1.3 Scale settings (Live 12 "Keys & Scale")
| Control | Does | Notes | Src |
|---|---|---|---|
| **Scale Mode** toggle | Turns scale awareness on for the *selected* clip(s) and for clips created afterwards. It is **not** a global scale — it mirrors the currently/most-recently selected clip; select all clips (Ctrl+A) to change all. | Hidden while a Tuning system is loaded | [S1][S33][S20] |
| **Root Note** chooser | Key root. | | [S33][S16] |
| **Scale Name** chooser | Scale type. Scale is forwarded to "scale-aware" devices (Arpeggiator, Chord, Pitch, Random, Scale, Meld, Resonators…) via their *Use Current Scale* toggle, and to the MIDI editor (Highlight Scale `K`, Fold to Scale `G`). Splice key filter can "Apply Key from DAW". | | [S18][S27][S66] |

### 1.4 Follow & Arrangement position
| Control | Does | Notes | Src |
|---|---|---|---|
| **Follow** toggle | Display scrolls to keep the playhead visible (Arrangement and Clip View). *Follow Behavior* in Display & Input settings chooses **Page** (jump a page) vs **Scroll** (continuous). Follow pauses while you edit and resumes on stop/restart or scrub click. | Options › Follow; Ctrl+Shift+F (Win) / Cmd+Shift+F (Mac, Live 11) — the Live 12 table shows Ctrl+Shift+F / Option+Shift+F (verify) | [S2][S7][S16][S47] |
| **Arrangement Position** fields | Bars.Beats.Sixteenths of the playhead; drag, type, arrow keys. Keep counting even when only Session clips play (continuous musical time). Show count-in in blue. | | [S2][S3][S10] |

### 1.5 Transport
| Control | Does | Notes | Src |
|---|---|---|---|
| **Play** | Starts from the insert marker (Arrangement) / start marker. | Space; Shift+Space continues from last stop; Ctrl/Option+Space plays the selection | [S2][S8] |
| **Stop** | Stops; **double-click** (or press twice) returns to 1.1.1; Home / Fn+← also returns to start. | Stop All Clips is a separate Session control | [S2][S3] |
| **Arrangement Record** | Records into the Arrangement: audio/MIDI on armed tracks *and* "logs all of your actions" — clip launches, mixer/device moves (if Automation Arm), tempo/meter changes. *Start Playback with Record* pref decides whether it starts transport immediately; Shift-click inverts. | F9; Shift+F9 arms recording without starting | [S3][S10][S8] |

### 1.6 Automation & Capture MIDI
| Control | Does | Notes | Src |
|---|---|---|---|
| **MIDI Arrangement Overdub** | New MIDI recorded into the Arrangement is *mixed with* existing notes in the clip instead of replacing them. MIDI only. | | [S10] |
| **Automation Arm** | When on, manual control moves during Arrangement/Session recording are written as automation. | | [S9] |
| **Re-Enable Automation** | Lights up when you have manually overridden an automated parameter; click to restore all automation (or right-click a single control › Re-Enable Automation; relaunching the clip also restores). | | [S9] |
| **Capture MIDI** | Retrieves MIDI you played on monitored MIDI tracks before pressing record. In an empty Set it detects tempo (80–160 BPM), sets a loop and starts playback; in a running Set it overdubs onto the playing clip. | Push 3 has a dedicated button | [S10][S45] |
| **Session Record** | Records new clips into the selected scene on all armed tracks; press again to switch from recording to loop playback; pressing again toggles overdub on/off for MIDI. | Ctrl+Shift+F9 / Cmd+Shift+F9 | [S10][S8] |
| **New** button | Visible only in Key/MIDI Map mode: stops clips on armed tracks and selects/creates a scene to record into. | mappable | [S10] |
| **Global Quantization** chooser | Launch quantization for clips/scenes: None, 1/32 … 1 Bar, 2/4/8 Bars. | Ctrl+6/7/8/9 = 1/16, 1/8, 1/4, 1 Bar; Ctrl+0 = None | [S14][S8] |

### 1.7 Arrangement Loop settings
| Control | Does | Notes | Src |
|---|---|---|---|
| **Punch In** | Prevents recording before the loop-brace start (protects material / pre-roll). | | [S10] |
| **Loop Start** field | Numeric loop-brace start. | | [S2] |
| **Loop** toggle | Enables Arrangement loop (the brace in the scrub area). | Ctrl+L / Cmd+L = Loop Selection (turns loop on and sets it to the time selection) | [S2][S8] |
| **Loop Length** field | Numeric loop length. Arrow keys nudge/shift the brace; Ctrl+arrows resize/double/halve. | Ctrl+F10/F11 set brace start/end; Ctrl+F9/F12 set start/end markers | [S2][S8] |
| **Punch Out** | Prevents recording after the loop-brace end. | | [S10] |

### 1.8 MIDI & CPU settings
| Control | Does | Notes | Src |
|---|---|---|---|
| **Draw Mode** (pencil) | Toggles drawing of notes/envelopes/velocities instead of selecting. | `B`; hold B ≈500 ms for momentary; Options › Draw Mode; *Pitch Lock* option in Display & Input | [S9][S18][S8] |
| **Computer MIDI Keyboard** | QWERTY becomes a MIDI keyboard (A-row = white keys from C3, Z/X octave, C/V velocity). | `M`; Options › Computer MIDI Keyboard | [S15][S8] |
| **KEY** (Key Map Mode) | Assignable elements turn orange/red; click one then press a key. | Ctrl+K / Cmd+K; Options › Edit Key Map | [S13][S8][S56] |
| **MIDI** (MIDI Map Mode) | Assignable elements turn blue; click one then move a controller. Mapping Browser lists all mappings with Min/Max (invertable). | Ctrl+M / Cmd+M; Options › Edit MIDI Map | [S13][S8] |
| **MIDI In/Out indicators** | Small LEDs that flash on incoming/outgoing MIDI: one pair for track MIDI, one pair beside KEY/MIDI for remote-control MIDI (upper = in, lower = out). | Use to confirm a controller is recognised | [S13][S12] |
| **CPU Load Meter** | % of audio-buffer time used. Click for menu: **Average** (default) / **Current** / **Warn on Current CPU Overload** (off by default since Live 11). >100% = dropouts. | Audio engine on/off: Ctrl+Alt+Shift+E | [S17][S8] |
| **Disk Overload indicator (D)** | Flashes when disk can't stream fast enough (dropouts/gaps). Remedies: RAM mode, fewer channels, mono samples. | | [S17][S56] |

### 1.9 View selector
| Control | Does | Src |
|---|---|---|
| **Session / Arrangement** selector (top-right) | Switches the main view. Only the UI changes; playing clips are unaffected. Tab (hold ≈500 ms for momentary). | [S1][S8] |

---

## 2. Show/hide toggles and the view selectors (bottom-right cluster)

| Toggle | Where | Does | Shortcut | Src |
|---|---|---|---|---|
| Clip View selector | bottom-right | Shows the Clip View for the selected clip(s). Double-clicking a clip also opens it. | Ctrl+Alt+3 / Cmd+Opt+3 | [S16][S8] |
| Device View selector | bottom-right | Shows the selected track's device chain. Double-click a track title bar opens it. | Ctrl+Alt+4 / Cmd+Opt+4 | [S19][S8] |
| Stack toggles (next to the two selectors) | bottom-right | Live 12: expand both so Clip View stacks on top of Device View ("stacked detail view"). | — | [S19][S28][S34] |
| Toggle Clip/Device | keyboard | Switches which one is in front. | Shift+Tab or F12 (Shift+Tab is taken by focus navigation when *Use Tab Key to Navigate* is on) | [S8][S16] |
| Mixer selector + config ▾ | bottom-right | Show/hide the mixer; drop-down toggles In/Out, Sends, Returns, Mixer, Track Options (Track Delay), Crossfader, Performance Impact. Same list under View › Mixer Controls. | Ctrl+Alt+M mixer; Ctrl+Alt+I In/Out; Ctrl+Alt+S Sends; Ctrl+Alt+R Returns | [S4][S8][S34] |
| Info View toggle | bottom-left | | `?` | [S7] |
| Browser toggle | Control Bar far-left | | Ctrl+Alt+B | [S1] |
| Overview toggle | View menu | Arrangement overview strip. | Ctrl+Alt+O | [S8][S53] |
| Automation Mode toggle | above track headers (Arrangement) | Show/hide automation lanes. | `A` (hold for momentary) | [S9][S8] |
| Show/Hide Take Lanes | track header button (12.2+) / context menu | | Ctrl+Alt+U / Cmd+Opt+U | [S25][S48] |
| Full-Size Clip View | Clip View | Expands the Clip View to the whole window. | Ctrl+Alt+E / Cmd+Opt+E | [S8] |
| Detail-view resize | drag the top border of the Clip/Device view; drag to the bottom to close; drag the browser's bottom edge to auto-close Info View + detail view | | — | [S16][S5] |
| Plug-in windows | View menu | Show/hide all floating plug-in windows. | Ctrl+Alt+P / Cmd+Opt+P | [S19][S8] |
| Filter View / Tag Editor (browser) | right of search field | 12.2: toggle Filter View; Filter View menu shows/hides filter groups. | Ctrl+Alt+G / Cmd+Opt+G; Tag Editor Ctrl+Shift+E (when browser focused, 12.4.3) | [S27] |

---

## 3. Arrangement View

### 3.1 Layout
| Element | Does | Notes | Src |
|---|---|---|---|
| **Overview strip** | Whole-song thumbnail; drag horizontally to scroll, vertically to zoom; double-click = zoom to full arrangement; click to jump the view. | Ctrl+Alt+O | [S2][S52] |
| **Beat-Time Ruler** | Bars.beats.16ths; drag to scroll (horizontal) or zoom (vertical); double-click zooms to selection / whole song. | | [S2] |
| **Scrub area** | Row under the ruler: click to launch playback there (quantised); hold to loop that grid chunk; holds loop brace, locators, time-signature markers. Clicking needs *Permanent Scrub Areas* on, otherwise Shift-click. | | [S2][S16][S37] |
| **Time Ruler** (lower) | Minutes:seconds:ms by default, or SMPTE frames via **Options › Time Ruler Format** (Seconds / 24 / 25 / 29.97 / 30 / 30-drop fps). Also right-click the ruler. | | [S36][S22] |
| **Track header** | Unfold button, name, Track Activator, Solo/Cue, Arm; Live 12 shows an Automation Mode toggle + Lock Envelopes toggle in the header row; take-lane button; linked-track indicator; auto-number with `#` prefix. | `U` unfold; Alt+U unfold all; 0 deactivate; S solo; C arm | [S2][S4][S8] |
| **Arrangement Track Controls** (right side of headers) | Compact volume, pan, I/O, sends etc.; customised via **View › Arrangement Track Controls** submenu. Separate from the full mixer. | | [S2][S34] |
| **Mixer in Arrangement** (Live 12) | The Session-style mixer can be opened in the Arrangement too. | Ctrl+Alt+M | [S2][S28] |
| **Main lane / take lanes** | Clips live in the main lane; take lanes (comping) sit beneath. | | [S2][S25] |
| **Automation lanes** | Per-track: Device chooser (Mixer / device / None; LEDs mark automated devices), Control chooser, **+ Add Lane for Each Automated Envelope** (Alt/Cmd adds all), **− Remove Lane**, show/hide additional lanes toggle, "Show Automated Parameters Only". Main track: Mixer › Song Tempo with min/max display boxes. | `A` | [S9] |
| **Mixer Drop Area** | Under the tracks: drop instruments/effects to create tracks. | | [S2] |
| **Grid density readout** | Bottom-right above the ruler. | | [S2] |
| **Back to Arrangement** | Lights when Session clips have taken over tracks; click to resume Arrangement playback. | F10 | [S3][S8] |
| **Enable Follow Actions Globally** | Beside Back to Arrangement: disables all follow actions while you edit. | | [S14] |
| **H / W** | Optimize Arrangement Height / Width. | H, W | [S2][S53] |
| **Waveform vertical zoom slider** | Enlarges waveforms on all audio tracks. | | [S2] |

### 3.2 Navigation, zoom, follow
- Zoom: `+`/`−`; Ctrl/Cmd+scroll; drag in ruler; **Z** zoom to time selection, **X** step back; Alt/Option+scroll = vertical zoom of one track; Alt/Option+`+`/`−` track height; hold Alt while resizing a track resizes all; Alt+pinch on trackpads. `[S2][S8]`
- Pan: Ctrl+Alt+drag / Cmd+Option+drag; Shift+scroll horizontal. `[S2][S8]`
- Follow: Control Bar toggle / Options › Follow; **Page vs Scroll** behaviour in Display & Input. `[S2][S7]`
- Window zoom (whole UI): Ctrl/Cmd+`+`/`−`; **Zoom Display** slider in Display & Input, 50–200%, separate value for the second window. `[S8][S7][S67]`
- Keyboard focus: Alt/Option+0…8 jump to Control Bar / Session / Arrangement / Clip / Device / Browser / Groove Pool / Learn View / Selected Clip Panel; Tab / Shift+Tab walk controls when *Use Tab Key to Navigate* is on; Ctrl+Tab / Option+Tab next neighbour; Esc to track title bar; Alt+Shift+M focus mixer. `[S8][S24]`

### 3.3 Loop brace, locators, time-signature markers
| Item | Does | Shortcut | Src |
|---|---|---|---|
| Loop brace | Drag edges = start/end; drag bar = move; click brace = Select Loop; context menu **Set Song Start Time Here**; **Loop to Next Locator**. | Ctrl+L loop selection; ←/→ nudge; ↑/↓ shift by length; Ctrl+←/→ resize; Ctrl+↑/↓ halve/double; Ctrl+Shift+L select loop contents | [S2][S8] |
| Locators | **Set** button adds at play position (becomes **Del** when a locator is selected); **◀ ▶** previous/next (quantised); double-click = play from locator; rename Ctrl+R; Edit Info Text; **Set Song Start Time Here**. | Create › Add Locator | [S2][S53] |
| Time-signature markers | Create › Insert Time Signature Change; edit Ctrl+R; move with ←/→; **Delete Fragmentary Bar Time / Complete Fragmentary Bar** commands. | | [S2] |
| Start / End markers | Song start/end. | Ctrl+F9 / Ctrl+F12; Ctrl+click / Ctrl+Shift+click | [S8] |

### 3.4 Selection and editing
| Action | Shortcut / gesture | Src |
|---|---|---|
| Click background = insert marker; drag = time selection; Shift+click extends; Shift+arrows extend | | [S2] |
| Move insert marker across tracks/time | arrows; Ctrl/Option+←/→ snap to clip edges & locators | [S2] |
| **Split** at insert marker/selection | Ctrl+E / Cmd+E | [S2][S8] |
| **Consolidate** selection into one clip | Ctrl+J / Cmd+J | [S2][S8] |
| **Crop** clip(s) | Ctrl+Shift+J | [S8][S16] |
| **Duplicate** | Ctrl+D | [S8] |
| **Deactivate** selection / track / clip | `0` | [S2][S8] |
| **Reverse** audio selection | `R` | [S2] |
| **Insert Silence** | Ctrl+I / Cmd+I | [S2][S8] |
| **Cut / Copy / Paste / Duplicate / Delete Time** | Ctrl+Shift+X / +C (12.4.3) / +V / +D / +Delete | [S2][S8][S27] |
| Nudge selection | ←/→ | [S2] |
| Slide clip contents inside boundaries | Ctrl+Shift+drag (Win) / Shift+Option+drag (Mac) | [S2] |
| Bypass snapping | Alt (Win) / Cmd (Mac) while dragging; Ctrl+Alt+Shift bypasses object snapping | [S2][S8] |
| Stretch warped clip | Shift+drag clip title bar | [S8] |
| Fades / crossfades | Hover for fade handles; Ctrl+Alt+F create from selection; `F` momentary handles in automation mode; Delete removes (or resets to 4 ms if *Create Fades on Clip Edges*) | [S2][S8] |
| Resize clip from keyboard | Enter + ←/→ when insert marker at edge | [S8] |
| Insert empty MIDI clip | Ctrl+Shift+M (12.3+: works at insert marker; Shift+double-click for a defined range) | [S8][S27] |
| **Bounce to New Track** | Ctrl+B / Cmd+B; Paste Bounced Audio Ctrl+Alt+V | [S8][S27] |
| Play from insert marker in clip / move marker to playhead | Ctrl+Space (Win) / Option+Space; Ctrl+Shift+Space | [S8] |
| Chase MIDI Notes | Options menu; on by default so notes sound when starting mid-note | [S2][S16] |

### 3.5 Grid
Ctrl/Cmd+1 narrow · +2 widen · +3 triplets · +4 snap on/off · +5 fixed vs adaptive; Alt (Win)/Cmd (Mac) held = temporarily bypass (or enable) snapping. `[S2][S8]`

### 3.6 Linked-track editing and comping
- **Link Tracks** (track/group header context menu): edits (move/resize/split/consolidate/fades/arm/take lanes) apply across linked tracks; indicator button in headers; Ctrl+Link Tracks adds to a link; Unlink Track(s). `[S2]`
- **Take lanes**: created automatically per record pass; Show/Hide Take Lanes (Ctrl+Alt+U); Insert Take Lane Shift+Alt+T; audition `T`; select region + Enter copies to main lane; Ctrl+↑/↓ swaps in adjacent takes; draw-mode comping; Delete All / Delete All Unused Take Lanes (12.2). `[S25][S48][S60]`

---

## 4. Session View

| Element | Does | Notes / shortcut | Src |
|---|---|---|---|
| **Clip slots / grid** | Tracks are columns, **scenes** are rows; each slot has a ▶ launch button, ■ stop button, or is empty. Rubber-band, Shift/Ctrl multi-select; drag to reorder. | Enter launches selected; arrows navigate; 0 deactivates; Ctrl+E adds/removes a stop button; Ctrl+Shift+M inserts MIDI clip | [S3][S8] |
| **Scene launch column** (Main track) | Launches every clip in the row; scene number auto-updates; striped button = follow actions. | Insert Scene Ctrl+I; Capture and Insert Scene Ctrl+Shift+I; Page Up/Down moves 8 scenes | [S3][S8][S14] |
| **Scene Tempo / Time Signature fields** | Drag the Main track header edge to reveal; per-scene tempo (20–999) and meter; coloured launch button when set; Return to Default. (Older trick: name the scene "120 bpm 3/4".) | Tab/Shift+Tab move between fields | [S3][S52] |
| **Scene View** | Panel for selected scene(s): tempo/meter + **scene Follow Actions** (12.2: Unlinked/Longest). | | [S3][S48] |
| **Track Status field** | Above the mixer: pie = looping clip (loop length in beats, play count), progress bar = one-shot remaining time, mic/keyboard icon = monitoring input, mini arrangement = Arrangement clips playing. | | [S3] |
| **Track title bar** | Click select; Ctrl+R rename (Tab moves to next); `#` auto-number; drag to reorder; drag edges to resize (Alt = all); drag into browser Places = save as Set. | | [S4] |
| **Stop All Clips** | Bottom of Main track column; also disables all Arrangement clips. | | [S3][S53] |
| **Back to Arrangement** | Orange when Session owns tracks. | F10 | [S3][S53] |
| **Session mixer strip** (bottom, top→down) | In/Out (Audio From type/channel, Monitor In/Auto/Off, Audio To type/channel) · Sends knobs · Track Activator, Solo/Cue, Arm · Pan · Volume fader + peak/RMS meter (drag the mixer top edge taller for tick marks, numeric field, resettable peak) · Track Delay (Track Options) · Crossfade A/B · Performance Impact meter. 12.3 lowered the minimum height (pan hides first). | Sections toggled bottom-right | [S4][S15][S27] |
| **Main track** | Cue Out chooser, Cue Volume, **Solo/Cue** mode switch (headphone icons replace S), Preview volume (browser/metronome), crossfader, Main output chooser. | | [S4][S5] |
| **Return tracks** | Hidden/shown with Ctrl+Alt+R; Pre/Post send toggle; sends to returns disabled by default (right-click › Enable Send). | | [S4] |
| **Group tracks** | Ctrl+G groups selection; nested groups allowed; group slots show launch/stop buttons when any child has a clip; selecting a group slot selects all child clips; `+`/`−`/`U` show/hide children. | | [S3][S4][S8] |
| **Select on Launch** | Record/Warp/Launch setting: launching also selects the clip (so Clip View follows). | | [S3][S14] |
| **Follow Actions** | Per clip: A/B actions × chance, Linked/Unlinked, time; actions: No Action, Stop, Play Again, Previous, Next, First, Last, Any, Other, Jump. Shift+Enter toggles; Ctrl+Shift+Enter creates a chain. | | [S14][S8] |
| **Launch modes** | Trigger / Gate / Toggle / Repeat; Legato; per-clip Launch Quantization (None/Global/…); Velocity amount. | Clip View Launch panel | [S14] |
| **Relative Session Navigation strip** | Only in Key/MIDI Map mode: scene up/down, scene number, launch/cancel scene, per-track launch. | | [S13] |

---

## 5. Mixer (applies to both views)

| Control | Does | Notes | Src |
|---|---|---|---|
| Volume | Track level; multi-selected tracks move together preserving offsets; Shift = fine. | | [S4] |
| Pan | Stereo Pan or **Split Stereo Pan** (per-channel); double-click resets. | | [S4] |
| Meter | Peak + RMS; input meters while recording; peak indicators for >0 dB. | | [S4] |
| Track Activator | Mute; muting also mutes tracks fed from it; blue when Monitor = In. | `0`; F1–F8 toggle first eight tracks | [S4][S15][S8] |
| Solo / Cue | Exclusive by default (Ctrl-click for multiple, or *Exclusive Solo* off in Record/Warp/Launch). **Solo in Place** (Options) keeps return-track effects audible. Groups show half-coloured solo. | `S` | [S4] |
| Arm | Exclusive by default (Ctrl-click / *Exclusive Arm* setting); arming selects the track. | `C` | [S10][S4] |
| Monitor In/Auto/Off | In = always monitor input; Auto = when armed and no clip playing; Off = never. Right-click In/Auto: *Keep Monitoring Latency in Recorded Audio*. | Needs In/Out section shown | [S15][S70] |
| Sends A/B… | Level to return tracks; S buttons enable sends on returns; Pre/Post on returns. | | [S4] |
| Cue system | Needs ≥4 outputs; Cue Out ≠ Main Out; Cue switch replaces Solo; browser preview goes to Cue Out. | | [S4][S5] |
| Crossfader + A/B assign | DJ-style fader across any number of tracks; per-track A/B buttons; 7 curves via context menu; mappable to keys/controllers; automatable (Mixer › X-Fade Assign; Main › Crossfade). | Show via Mixer Controls › Crossfader | [S4] |
| Track Delay | ± ms per track to compensate real-world latency; needs Delay Compensation on; in Mixer Controls › Track Options. | | [S4] |
| Performance Impact | Six-rectangle per-track CPU meter. | | [S4][S17] |
| Group tracks | Summing bus + folder; Assign Track Color to Grouped Tracks and Clips; Ungroup Ctrl+Shift+G; cannot hold clips; deleting group deletes contents. | | [S4] |
| Freeze / Flatten | Edit menu; renders devices to freeze files while keeping mixer/clip editing; no group freeze; Flatten commits. | Ctrl+Alt+Shift+F | [S17][S8] |
| Insert tracks | Ctrl+T audio · Ctrl+Shift+T MIDI · Ctrl+Alt+T return | | [S8] |

---

## 6. Detail View — Clip View and Device View

### 6.1 Clip View
- **Open/resize**: double-click a clip, selector, Ctrl+Alt+3; drag top border; horizontal (panels left, editor right) or vertical layout by dragging the panel edge; *Arrange Clip View Panels Automatically*. `[S16]`
- **Title bar**: Clip Activator, name, colour (multi-clip shows stripes), Save Default Clip (audio). `[S16]`
- **Panels** (foldable): Main Clip Properties (Start/End + Set buttons, Loop toggle/Position/Length, clip time signature, Groove chooser + Hot-Swap + Commit, **Scale Mode / Root / Scale**), Extended Properties (Launch controls in Session; Bank/Program for MIDI), Audio Utilities (Warp on/off, Warp mode, Seg. BPM ×2 ÷2, Reverse, Edit, Hi-Q, Fade, RAM, Gain, Pitch st/ct, Lead/Follow tempo), Pitch & Time utilities for MIDI (Transpose, Fit to Scale, Invert, Add Interval, Stretch, ×2 /2, Set Length, Humanize, Reverse, Legato), **Transform / Generate** MIDI Tools panels. `[S16][S18][S23]`
- **Editor header buttons** (MIDI): **Fold** (`F`, hide empty key tracks), **Focus** (`N`, edit one clip while viewing up to 8 — multi-clip editing), **Highlight Scale** (`K`), **Fold to Scale** (`G`), **Find & Select notes** filters (12.1: pitch/time/chance/duration/velocity…), Preview (headphone) for note audition + step recording, Grid chooser, lane selector for Velocity / Chance / Release velocity lanes. `[S18][S27]`
- **Editor tabs**: Sample|Envelopes (audio), Notes|Envelopes|MPE (MIDI); Ctrl+Tab / Option+Tab cycles; Alt+Shift+1/2/3. Envelopes tab = Device/Control choosers, Automation vs Modulation toggles, Linked/Unlinked loop for envelopes. `[S16][S21][S8]`
- **Navigation**: Z/X zoom; Clip View selector box (drag to scroll/zoom); Follow toggle; loop brace shortcuts same as Arrangement; Ctrl+D duplicates the loop; scrub areas. `[S16]`
- **Full-Size Clip View**: Ctrl+Alt+E. `[S8]`

### 6.2 Device View
- Device chain left→right; drag to reorder; double-click device title or browser item to add; Enter loads from browser. `[S19]`
- Device title bar: Activator, Hot-Swap presets (`Q`), Save Preset, fold (double-click), expanded/breakout-view arrow (12.2), sidechain section moved left with its own header (12.2), **context-menu button** in the title bar (12.2 — the closest thing to a "hover info" affordance on devices), Lock to control surface (hand icon), rename even when folded (12.4). `[S19][S27][S48]`
- A/B Compare states (P toggles; Edit › Compare: Copy A to B). `[S19]`
- Plug-in windows: Show/Hide button per device; Auto-Open, Auto-Hide, Multiple Plug-In Windows settings; Ctrl+Alt+P all windows; Configure mode picks parameters for Live's panel. `[S19]`
- Delay Compensation (Options) on by default; Reduced Latency When Monitoring bypasses it for monitored tracks (saved with Set). `[S19][S35]`

---

## 7. Browser (Live 12)

| Element | Does | Notes / shortcut | Src |
|---|---|---|---|
| Sidebar › **Collections** | Seven colour labels; assign with keys 1–7 (0 clears); items can carry several colours (3 shown); rename Ctrl+R; Edit button shows/hides labels. | | [S5][S8] |
| Sidebar › **Library** labels | All, Sounds, Drums, Instruments, Audio Effects, MIDI Effects, Modulators, Max for Live, Plug-Ins, Clips, Samples, Grooves, Templates, Tunings; Edit to show/hide; 12.2 lets you assign custom icons; saved searches appear here as custom labels. | | [S5][S27] |
| Sidebar › **Places** | Packs (Core Library, updates, Available Packs with download/pause/install), Splice (12.3), Cloud (Note/Move sets), Push (Push 3 standalone), User Library (Clips/Defaults/Grooves/Presets/Samples/Templates/Chord Banks/ABL Assets), Current Project, user folders, **Add Folder…**; right-click › Hide from Sidebar / Remove from Sidebar / Locate Folder. | Add discrete folders, not whole drives | [S5][S27][S51] |
| **Search field** | AND of all terms; `#tag` searches; Ctrl/Cmd+F jumps to All + search (12.4.5 selects existing term); ↓ jumps to results; Esc clears; **Add Label** saves the search as a label. | | [S5][S27][S31] |
| **Filter View** | Filter groups (Content, Sounds, Drums, Instrument, Character, Creator, Format, MIDI Tools…) with tags; Ctrl/Cmd-click multi-select within a group; state remembered per label; Filter View menu shows/hides groups, *Reset Filter Groups to Default*, *Enable Auto Tags* (analysis-based tags for user samples ≤60 s); results bar shows active-filter count (12.2). | Ctrl+Alt+G toggle (12.4.3) | [S5][S27][S32] |
| **Tag Editor / Quick Tags** | Tag Editor: check/uncheck tags, Add Tag…, Add Group…, subtags, multi-item tagging. Quick Tags panel (12.2, above Preview): view/add/remove tags for the selection, asterisk for partially shared tags, double-click a tag to search it (12.4.3). | Ctrl+E jumps to Quick Tags "Add…"; Ctrl+Shift+E Tag Editor | [S5][S27][S48] |
| **Similar sound search** | *Show Similar Files* (context menu / Sample Editor) uses tags + neural-net analysis to list similar samples/presets; **Similar Sample Swapping**: Ctrl+←/→ swap to previous/next similar sample, Ctrl+↑ save reference, Ctrl+↓ return; Alt shows swap controls on Drum Rack pads. | Ctrl+Shift+F "Show similar files" in the browser | [S8][S16][S54] |
| **Content pane** | Columns customisable/reorderable/sortable (12.2); Show File Extensions; Pack size; unfold Sets to drag tracks/clips out. | | [S5][S6][S27] |
| **Preview tab** | Preview toggle (bottom); waveform with scrub; **Raw** = original tempo, unlooped; default previews in time with the Set at the next bar; Shift+Enter / → previews without the toggle; volume = Main Preview/Cue knob; routes to Cue Out when cueing. | | [S5] |
| **Hot-Swap** | `Q` (or the device's hot-swap button) links the browser to a device/sample slot so arrow keys + Enter audition presets in place; Esc/Q/X exits. | | [S8][S19][S11] |
| **History** | Back/forward arrows left of the search field; Ctrl+[ / Ctrl+]; Windows mouse back/forward buttons (12.4). | | [S5][S27] |
| Loading | Drag to a track/empty area (new track), double-click or Enter into selected track; Ctrl-drag drops clips as a scene. | | [S5][S8] |
| Splice label (12.3) | Search (instrument/genre/key/tempo/type), *Search with Sound* from a clip/time selection, *Apply Key from DAW*, Timestretch/1 BAR preview toggles, download location setting. | | [S5][S27] |
| File menu ops | Save Live Set / Save As / Save a Copy / Save as Template / Save as Default Set, Collect All and Save, Manage Files (File Manager), Export Audio/Video Ctrl+Shift+R, Export MIDI Ctrl+Shift+E. | | [S6][S8][S45] |

---

## 8. Draw Mode / pencil behaviour
- Toggle `B` or Control Bar pencil or Options › Draw Mode; hold `B` for a momentary switch. `[S9][S8]`
- MIDI notes: click-drag adds notes at the grid length; clicking existing notes erases; **Pitch Lock** (Display & Input) confines a drag to one pitch (drum-lane style); Alt/Option flips between pitch-locked and freehand melodic drawing; drawing back over notes erases. `[S18][S62]`
- Velocities/chance lanes: draw with B; Alt/Cmd for freehand or straight lines. `[S18]`
- Envelopes: draws grid-width steps; Shift = finer vertical; turn grid off (Ctrl+4) or hold Alt/Cmd for freehand curves. `[S9][S52]`
- Comping: draw-mode drag on a take lane copies straight to the main lane. `[S25]`

---

## 9. Groove Pool
Opened from the Browser Config Menu or Ctrl+Alt+6; grooves (.agr) arrive by double-click or drag from the browser's Grooves label. Per-groove columns: **Base** (1/4, 1/8, 1/16 …), **Quantize** %, **Timing** %, **Random** %, **Velocity** (−100…+100); **Global Amount** (0–130%) also shown in the Control Bar. Clip View Groove chooser + Hot-Swap + **Commit** (writes notes / warp markers, chooser returns to None). **Extract Groove(s)** from any clip via context menu or drag to the pool. Unused grooves grey out. Tutorial trick: zero everything, raise Random for humanising, or use Quantize % as a soft quantiser. `[S11][S51][S60]`

---

## 10. Sync: Link, Tempo Follower, MIDI clock
- **Link**: Control Bar toggle shows peers; Link settings: Show Link Toggle, **Start Stop Sync**; 12.4 **Link Audio** (Audio toggle, Name, Latency slider, *Sync to Incoming Audio*, Peers list) — Link peers appear as Input Type on audio tracks; count-in unavailable while Link is on. `[S12][S27]`
- **Tempo Follower**: Tempo & MIDI settings › Input Channel + Show Tempo Follower Toggle; Follow button beside Tempo; mutually exclusive with EXT sync. `[S12][S42]`
- **MIDI sync**: MIDI Ports list Sync column (in/out), Sync Type (MIDI Clock / MIDI Timecode), MIDI Clock Sync Delay, MTC frame rate + offset; EXT button LEDs; loop mode wraps song-position pointers. `[S12]`

---

## 11. Keys & Scale, and Set-level Tuning
- **Scale**: per-clip property mirrored in the Control Bar; applies to selected + new clips; devices opt in with *Use Current Scale*; editor Highlight/Fold to Scale; Transpose by scale degrees; Fit to Scale. `[S33][S16][S18]`
- **Tuning (Set-level)**: Tuning section (Browser Config Menu › Tuning, or double-click a tuning in the Tunings label); shows tuning name, reference note/octave + Ref. frequency, lowest/highest note, save (.ascl) button, info link; drag .scl/.ascl files in; Delete returns to 12-TET; **Bypass Tuning** per MIDI track (I/O section; Drum Racks bypass automatically); *Retune Set on Loading* moves existing notes to nearest pitches; all Live instruments + MPE plug-ins with 48-semitone bend range follow; **Scale controls disappear while a tuning is loaded**. `[S20][S55][S41]`
- Other Set-level state worth listing for parity: tempo + tempo automation, time signature + change markers, global launch quantization, groove Global Amount, loop brace/punch, start/end markers, locators, Delay Compensation and Reduced Latency (saved with the Set), Default Set / templates. `[S2][S12][S35][S45]`

---

## 12. Info View, Status Bar, Help View → Learn View, "hover info"
- **Info View**: bottom-left; `?` toggles; shows name + function of the hovered element; **Edit Info Text** (Edit menu / context menu) attaches user notes to tracks, clips, devices, locators, scenes — the tutorials' favourite "notes" feature. `[S7][S45][S60]`
- **Status Bar**: messages/updates; MIDI editor note readout; 12.2 shows which MIDI Tools were applied; 12.4.5 remote notifications. `[S1][S27]`
- **Help View** (Live 11–12.2): lessons panel with table of contents (Help menu). **Learn View** (12.3+): Ctrl+Alt+7, video + text lessons, topic filters, Complete Lesson checkmarks, PiP window, needs internet. Pack lesson content is now "Pack Info pages" (Help › Pack Overview). `[S26][S7][S27][S30]`
- **"Hover Info"**: no feature by that name exists in Live 12.x release notes. The hover-driven surfaces are: Info View text, value read-outs while dragging/hovering breakpoints, linked-track highlight on hover, take-lane/loop-bar colour preview in multi-clip editing, and (12.2) the device title-bar **context-menu button** that replaced right-click-only access. `[S9][S18][S48][S27]`

---

## 13. Menus (compiled from manual references — verify ordering in-app)

**File**: New Live Set · Open Live Set · Open Recent Set ▸ · Save Live Set (Ctrl+S) · Save Live Set As… (Ctrl+Shift+S) · Save a Copy… · Save Live Set as Template… · Save Live Set as Default Set · Collect All and Save · Manage Files · Install Pack… · Export Audio/Video… (Ctrl+Shift+R) · Export MIDI Clip… (Ctrl+Shift+E) · Quit (Win). `[S6][S8][S45]`

**Edit**: Undo/Redo · Cut/Copy/Paste · Duplicate (Ctrl+D) · Delete · Select All · Select Loop · Loop Selection (Ctrl+L) · Rename (Ctrl+R) · Edit Info Text · Deactivate/Activate · Group Tracks (Ctrl+G) · Ungroup Tracks · Link/Unlink Tracks · Freeze/Unfreeze Track · Flatten · Bounce to New Track (Ctrl+B) · Quantize (Ctrl+U) · Quantize Settings… · Record Quantization ▸ · Split (Ctrl+E) · Consolidate (Ctrl+J) · Crop Clip(s) · Reverse Clip(s) · Cut/Copy/Paste/Duplicate/Delete Time · Add/Remove Stop Button · Compare: Copy A to B / Switch to B · Assign Track Color to Clips · Extract Groove(s). `[S2][S3][S4][S8][S10][S19]`

**Create**: Insert Audio Track (Ctrl+T) · Insert MIDI Track (Ctrl+Shift+T) · Insert Return Track (Ctrl+Alt+T) · Insert Scene (Ctrl+I in Session) · Capture and Insert Scene · Insert Empty MIDI Clip(s) (Ctrl+Shift+M) · Insert Silence (Ctrl+I in Arrangement) · Insert Time Signature Change · Add Locator · Create Fade In/Out · Create Crossfade · Insert Take Lane (Shift+Alt+T). `[S2][S3][S8][S25]`

**View**: Full Screen · Second Window · Session/Arrangement · Browser · Info View · Learn View · Overview · Automation (A) · Take Lanes · **Mixer Controls ▸** (In/Out, Sends, Returns, Mixer, Track Options, Crossfader, Performance Impact) · **Arrangement Track Controls ▸** · Clip View · Device View · Clip View editor tabs (Sample/Notes, Envelopes, MPE) · Clip View panel layout (horizontal/vertical/automatic) · Groove Pool · Zoom In / Zoom Out (window) · Zoom to Arrangement Time Selection / Zoom Back · Optimize Arrangement Height / Width · Video Window · Plug-In Windows. `[S2][S4][S8][S16][S34][S39][S40]`

**Navigate** (new in 12): Control Bar / Session / Arrangement / Clip View / Device View / Browser / Groove Pool / Learn View / Selected Clip Panel / Clip Panels (Alt/Option+0…8) · Use Tab Key to Move Focus · Wrap Tab Navigation · Next/Previous control · Move Focus to Mixer. `[S24][S8][S54]`

**Options**: Edit MIDI Map (Ctrl+M) · Edit Key Map (Ctrl+K) · Computer MIDI Keyboard (M) · External Sync · Delay Compensation · Reduced Latency When Monitoring · Time Ruler Format ▸ (Seconds / 24 / 25 / 29.97 / 30 / 30 drop fps) · Chase MIDI Notes · MIDI Envelope Auto-Reset · Draw Mode (B) · Follow · Solo in Place · Lock Envelopes · Accessibility ▸ (Speak Menu Commands, Speak Minimum and Maximum Slider Values, Speak Time in Seconds) · Settings/Preferences (Windows; under the Live menu on macOS). `[S2][S4][S9][S12][S13][S15][S19][S21][S24][S35][S36]`

**Help**: Learn View (12.3+; Help View earlier) · Pack Overview (12.3+) · Read the Live Manual · Keyboard shortcuts · Check for Updates · Get Support · About Live. `[S7][S27][S26]`

---

## 14. Settings / Preferences (Ctrl+, / Cmd+,)

Tab naming: **Live 11 / 12.0-era**: Look Feel · Audio · Link Tempo MIDI · File Folder · Library · Plug-Ins · Record Warp Launch · Licenses Maintenance. **Live 12.x**: Display & Input · Theme & Colors · Audio · Link (12.4) · Tempo & MIDI · File & Folder · Library · Plug-Ins · Record, Warp & Launch · Licenses & Updates. `[S26][S7][S27]`

| Tab | Options (name — effect) | Src |
|---|---|---|
| **Display & Input** (was Look Feel) | Language · **Zoom Display** % for main window and second window (50–200%) · Outline View in Focus · Show scroll bars · **Follow Behavior** Page/Scroll (Arrangement and clips) · Show UI labels · Use Tab Key to Navigate · Wrap Tab Navigation · Use arrow keys to move clips · **Pen Tablet Mode** · **Permanent Scrub Areas** · **Draw MIDI notes with Pitch Lock** · Restore "Don't Show Again" dialogs · (Windows) HiDPI mode, prevent system sleep, allow multiple instances | [S7][S26][S18][S37][S62][S67] |
| **Theme & Colors** | **Theme** drop-down (Default + installed .ask themes) · Appearance Light/Dark + follow OS light/dark · Tone Neutral/Cool/Warm · **High Contrast** · **Grid Line Intensity** · Brightness · Color Intensity · Color Hue · Auto-Assign Track Colors · Default track color · Clip color = random or track color · reduced palette for colour-vision deficiency (Live 11 wording) | [S7][S26][S28][S63][S69] |
| **Audio** | Driver Type · Audio Input/Output Device (macOS *Use System Device*) · Input Config / Output Config (mono/stereo pairs, renaming) · In/Out Sample Rate · Default SR & Pitch Conversion (High Quality) · **Buffer Size** · Input/Output Latency · **Driver Error Compensation** · Overall Latency · **Test Tone** (volume, frequency) · **CPU Usage Simulator** | [S7][S15][S17][S38][S68] |
| **Link / Tempo & MIDI** | Show Link Toggle · Start Stop Sync · Link Audio (12.4: Audio, Name, Latency, Sync to Incoming Audio, Peers) · Tempo Follower Input Channel + Show Tempo Follower Toggle · six Control Surface / Input / Output rows (+ Dump) · **Takeover Mode** None / Pick-Up / Value Scaling · MIDI Ports list with **Track / Sync / Remote / MPE** switches, Sync Type, Sync Delay, MTC rate/offset | [S12][S13][S27] |
| **File & Folder** | Save Current Set as Default · Create Analysis Files (.asd) · Sample Editor app · Temporary Folder · Max Application / Max for Live paths · Decoding Cache (cache folder, maximum size, minimum free space) | [S6][S7][S10][S62] |
| **Library** | Location of User Library · **Collect Files on Export** (Always/Ask/Never) · Installation folder for Packs · Show Downloadable Packs · Show Cloud / Push / Splice labels · Splice download location | [S5][S7] |
| **Plug-Ins** | Rescan · Use VST2 System / Custom folder · Use VST3 System / Custom folder · Use Audio Units (macOS) · **Auto-Open Plug-In Windows** · **Auto-Hide Plug-In Windows** · **Multiple Plug-In Windows** | [S19][S7][S62] |
| **Record, Warp & Launch** | File Type (WAV/AIFF/FLAC) · Bit Depth · Count-In · **Exclusive Arm / Exclusive Solo** · Clip Update Rate · Record Session automation in Armed / All tracks · **Start Playback with Record** · **Loop/Warp Short Samples** (Unwarped One Shot / Warped One Shot / Warped Loop / Auto) · **Auto-Warp Long Samples** · Default Warp Mode (Beats default; tutorials suggest Complex) · **Create Fades on Clip Edges** (4 ms) · Default Launch Mode · Default Launch Quantization · **Select on Launch** | [S23][S10][S4][S14][S16][S43][S62] |
| **Licenses & Updates** | Authorization, automatic updates, usage data; rent-to-own re-auth progress dialog (12.3) | [S7][S27] |

---

## 15. Keyboard shortcuts everyone uses (Win / Mac)

Corrections to the brief's list: **Ctrl+Shift+M** inserts an empty *MIDI clip* (new MIDI *track* is Ctrl+Shift+T); **Freeze** is Ctrl+Alt+Shift+F (Ctrl+Shift+F is Follow in Live 11 and "show similar files"/MIDI note filters in Live 12); **deactivate** is `0` (Ctrl+Shift+D is *Duplicate Time*). `[S8]`

| Action | Win | Mac | Src |
|---|---|---|---|
| Session ⇄ Arrangement | Tab | Tab | [S8] |
| Clip ⇄ Device view | Shift+Tab / F12 | Shift+Tab / F12 | [S8] |
| Browser | Ctrl+Alt+B | Cmd+Opt+B | [S8] |
| Info View | ? | ? | [S8] |
| Overview | Ctrl+Alt+O | Cmd+Opt+O | [S8] |
| In/Out · Sends · Returns · Mixer | Ctrl+Alt+I · S · R · M | Cmd+Opt+I · S · R · M | [S8] |
| Clip View · Device View · Groove Pool · Learn View | Ctrl+Alt+3 · 4 · 6 · 7 | Cmd+Opt+3 · 4 · 6 · 7 | [S8] |
| Draw Mode | B | B | [S8] |
| Automation mode | A | A | [S8] |
| Split / Consolidate / Crop | Ctrl+E / Ctrl+J / Ctrl+Shift+J | Cmd+E / Cmd+J / Cmd+Shift+J | [S8] |
| Duplicate | Ctrl+D | Cmd+D | [S8] |
| Loop selection | Ctrl+L | Cmd+L | [S8] |
| Quantize / settings | Ctrl+U / Ctrl+Shift+U | Cmd+U / Cmd+Shift+U | [S8] |
| Insert Silence (Arr) / Insert Scene (Session) | Ctrl+I | Cmd+I | [S8] |
| Time commands | Ctrl+Shift+X / C / V / D / Delete | Cmd+Shift+… | [S8] |
| Deactivate | 0 | 0 | [S8] |
| New audio / MIDI / return track | Ctrl+T / Ctrl+Shift+T / Ctrl+Alt+T | Cmd+T / Cmd+Shift+T / Cmd+Opt+T | [S8] |
| Insert MIDI clip | Ctrl+Shift+M | Cmd+Shift+M | [S8] |
| Group / Ungroup | Ctrl+G / Ctrl+Shift+G | Cmd+G / Cmd+Shift+G | [S8] |
| Freeze | Ctrl+Alt+Shift+F | Cmd+Opt+Shift+F | [S8] |
| Key map / MIDI map / computer keyboard | Ctrl+K / Ctrl+M / M | Cmd+K / Cmd+M / M | [S8] |
| Settings | Ctrl+, | Cmd+, | [S8] |
| Play / continue / play selection | Space / Shift+Space / Ctrl+Space | Space / Shift+Space / Opt+Space | [S8] |
| Record / Session record / Back to Arrangement | F9 / Ctrl+Shift+F9 / F10 | F9 / Cmd+Shift+F9 / F10 | [S8] |
| Zoom to selection / back / fit H / fit W | Z / X / H / W | Z / X / H / W | [S8] |
| Fold / unfold all tracks | U / Alt+U | U / Opt+U | [S8] |
| Grid narrow/widen/triplet/snap/fixed | Ctrl+1…5 | Cmd+1…5 | [S8] |
| Global quantization | Ctrl+6…9, Ctrl+0 | Cmd+6…9, Cmd+0 | [S8] |
| Rename / Edit Info Text | Ctrl+R | Cmd+R | [S8] |
| Solo / Arm / Track activators 1–8 | S / C / F1–F8 | S / C / F1–F8 | [S8] |
| Hot-swap | Q | Q | [S8] |
| Search browser | Ctrl+F | Cmd+F | [S8] |
| Take lanes / audition / add | Ctrl+Alt+U / T / Shift+Alt+T | Cmd+Opt+U / T / Shift+Opt+T | [S8] |
| Bounce to New Track | Ctrl+B | Cmd+B | [S8] |
| Full-size Clip View | Ctrl+Alt+E | Cmd+Opt+E | [S8] |
| Second window / full screen | Ctrl+Shift+W / F11 | Cmd+Shift+W / Ctrl+Cmd+F | [S8][S39] |
| Momentary latching (hold ≈500 ms) | A, B, S, Z, F1–F8, Tab | same | [S8] |
| Live 12.2 automation keyboard workflow | Enter select/create breakpoint, arrows move, Alt+←/→ prev/next breakpoint, Alt+↑/↓ cycle automated params, type value, Delete | Option variants | [S27][S48] |

---

## 16. Tips the tutorials repeat

1. **Learn a handful of shortcuts and stop mousing**: Tab, Ctrl+D, Ctrl+E, Ctrl+J, Ctrl+L, 0, Ctrl+F, B, Z/X, H/W, Alt+U — every list (LANDR 38, EDMProd 100, Sonic Bloom 10/5, Medium 10) leads with these. `[S61][S59][S46][S47][S45]`
2. **Build a Default Set + templates + track/device defaults** (right-click › Save as Default; File › Save as Default Set/Template). `[S45][S51][S59]`
3. **Make the browser yours**: Collections (1–7), Add Folder (even Dropbox), custom tags/saved searches, hide unused labels, Ctrl+F then Enter to load anything. `[S45][S49][S51][S59]`
4. **Time commands** (Insert Silence, Cut/Paste/Duplicate/Delete Time) instead of dragging clips around. `[S45][S60][S59]`
5. **Deactivate (0), don't delete** — clips, notes, tracks. `[S45][S46][S59]`
6. **Groove Pool**: extract grooves from loops, humanise with Random, soft-quantise with Quantize %. `[S51][S60]`
7. **Edit Info Text + locators as project notes**; rename with Ctrl+R and Tab; `#` for auto-numbering. `[S45][S52][S60][S59]`
8. **Colour-code and group tracks before mixing**; Assign Track Color to Clips. `[S45][S59]`
9. **Second Window on two monitors; Full Screen on laptops.** `[S60][S30]`
10. **Take lanes for comping loop-recorded takes.** `[S60][S25]`
11. **Capture MIDI and Resampling** (Audio From › Resampling) to catch ideas. `[S45][S51][S59]`
12. **Settings to change on day one**: Auto-Warp Long Samples off, decide Create Fades on Clip Edges, Count-In 2 bars, Multiple Plug-In Windows on / Auto-Hide off, Zoom Display to taste, dark theme + warm/cool tone, Pitch Lock for drums, Record Session automation. `[S62][S59]`
13. **Modifier tricks**: Shift+Space continues; Shift = fine drag; Alt/Cmd bypasses grid; Ctrl-click multi-arm/solo; Shift-select tracks and move faders together; Alt while resizing = all tracks; Alt+drag envelope = curve. `[S52][S8][S9]`
14. **Scenes as song sections** (and scene tempo/time-signature fields, formerly the "120 bpm 3/4" naming trick). `[S52][S3][S59]`
15. **Key-map an A/B switch; MIDI-map the crossfader/anything** (Ctrl+K / Ctrl+M). `[S51][S47]`
16. **Freeze/Flatten** for CPU; read the Performance Impact meters; keep Info View on while learning. `[S59][S17][S7]`
17. **Options.txt** for hidden switches (e.g. EnableMapToSiblings). `[S51][S59]`

---

## 17. Gap-analysis checklist (surfaces to compare against Beacon)

Control Bar: tap · tempo · nudge · time-sig · metronome+count-in+sound+rhythm+only-while-recording · Link · tempo follower · EXT sync · scale mode/root/scale · follow (page/scroll) · position fields · play/stop(double=home)/record · overdub · automation arm · re-enable automation · capture MIDI · session record · global quantization · punch in/out · loop start/length/toggle · draw mode · computer keyboard · key/MIDI map + mapping browser · MIDI LEDs · CPU average/current/warn · disk overload · view selector.
Views: session grid + scenes(tempo/meter/follow) + status fields + stop-all + back-to-arrangement + global follow-actions toggle · arrangement overview strip · rulers/scrub · locators · time-sig markers · loop brace · take lanes · linked tracks · automation lanes (+/−, choosers, lock) · fades/crossfades · time commands · grid modes · H/W fit · Z/X · follow.
Mixer: volume/pan(split)/meters(peak+RMS, resizable)/activator/solo(in place, exclusive)/cue/arm(exclusive)/monitor In-Auto-Off(keep latency)/sends+returns(pre/post, S)/main(cue out, cue vol, preview)/crossfader A/B + curves/track delay/performance impact/groups+nested/freeze-flatten/section show-hide per view.
Detail: stacked clip+device · clip panels · fold/focus/highlight/fold-to-scale · find & select · velocity/chance lanes · MIDI tools · envelopes tab (automation vs modulation, unlinked loop) · full-size clip view · device title bar (activator, hot-swap, save, fold, A/B, context button, plug-in window) · configure.
Browser: collections · library labels · places · search (#tags, AND, saved) · filter groups/tags/auto-tags · tag editor/quick tags · similarity search + swap · preview (raw/tempo-sync, scrub, cue out) · hot-swap · history · columns · packs/splice/cloud.
Global: Info View + Edit Info Text · Status Bar · Learn View · Navigate/keyboard focus · zoom display · themes (light/dark/tone/contrast/grid intensity) · second window/full screen/video window · settings tabs (above) · groove pool · tuning section · options menu switches.

---

## Sources

- [S1] Live 12 manual — Live Concepts: https://www.ableton.com/en/live-manual/12/live-concepts/
- [S2] Live 12 manual — Arrangement View: https://www.ableton.com/en/live-manual/12/arrangement-view/
- [S3] Live 12 manual — Session View: https://www.ableton.com/en/live-manual/12/session-view/
- [S4] Live 12 manual — Mixing: https://www.ableton.com/en/live-manual/12/mixing/
- [S5] Live 12 manual — Working with the Browser: https://www.ableton.com/en/live-manual/12/working-with-the-browser/
- [S6] Live 12 manual — Managing Files and Sets: https://www.ableton.com/en/live-manual/12/managing-files-and-sets/
- [S7] Live 12 manual — First Steps (Settings, Info View, Learn View): https://www.ableton.com/en/live-manual/12/first-steps/
- [S8] Live 12 manual — Live Keyboard Shortcuts: https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/
- [S9] Live 12 manual — Automation and Editing Envelopes: https://www.ableton.com/en/live-manual/12/automation-and-editing-envelopes/
- [S10] Live 12 manual — Recording New Clips: https://www.ableton.com/en/live-manual/12/recording-new-clips/
- [S11] Live 12 manual — Using Grooves: https://www.ableton.com/en/live-manual/12/using-grooves/
- [S12] Live 12 manual — Synchronizing with Link, Tempo Follower, and MIDI: https://www.ableton.com/en/live-manual/12/synchronizing-with-link-tempo-follower-and-midi/
- [S13] Live 12 manual — MIDI and Key Remote Control: https://www.ableton.com/en/live-manual/12/midi-and-key-remote-control/
- [S14] Live 12 manual — Launching Clips: https://www.ableton.com/en/live-manual/12/launching-clips/
- [S15] Live 12 manual — Routing and I/O: https://www.ableton.com/en/live-manual/12/routing-and-i-o/
- [S16] Live 12 manual — Clip View: https://www.ableton.com/en/live-manual/12/clip-view/
- [S17] Live 12 manual — Computer Audio Resources and Strategies: https://www.ableton.com/en/live-manual/12/computer-audio-resources-and-strategies/
- [S18] Live 12 manual — Editing MIDI: https://www.ableton.com/en/live-manual/12/editing-midi/
- [S19] Live 12 manual — Working with Instruments and Effects: https://www.ableton.com/en/live-manual/12/working-with-instruments-and-effects/
- [S20] Live 12 manual — Using Tuning Systems: https://www.ableton.com/en/live-manual/12/using-tuning-systems/
- [S21] Live 12 manual — Clip Envelopes: https://www.ableton.com/en/live-manual/12/clip-envelopes/
- [S22] Live 12 manual — Working with Video: https://www.ableton.com/en/live-manual/12/working-with-video/
- [S23] Live 12 manual — Audio Clips, Tempo, and Warping: https://www.ableton.com/en/live-manual/12/audio-clips-tempo-and-warping/
- [S24] Live 12 manual — Accessibility and Keyboard Navigation: https://www.ableton.com/en/live-manual/12/accessibility-and-keyboard-navigation/
- [S25] Live 12 manual — Comping: https://www.ableton.com/en/live-manual/12/comping/
- [S26] Live 11 manual — First Steps (Look/Feel naming, Help View): https://www.ableton.com/en/live-manual/11/first-steps/
- [S27] Ableton — Live 12 Release Notes (12.2 → 12.4.5): https://www.ableton.com/en/release-notes/live-12/
- [S28] Ableton — All new features in Live 12: https://www.ableton.com/en/live/all-new-features/
- [S29] Ableton blog — Live 12.1 walkthrough: https://www.ableton.com/en/blog/live-121-walkthrough-video/
- [S30] Ableton — Learn Live: Interface (video lesson index): https://www.ableton.com/en/live/learn-live/interface/
- [S31] Ableton Help — The Live 12 Browser (search snippet; fetch 403): https://help.ableton.com/hc/en-us/articles/12927340213660-The-Live-12-Browser
- [S32] Ableton Help — Browser and Tags in Live 12 FAQ (snippet): https://help.ableton.com/hc/en-us/articles/11425042663708-Browser-and-Tags-in-Live-12-FAQ
- [S33] Ableton Help — Keys and Scales in Live 12 FAQ (snippet): https://help.ableton.com/hc/en-us/articles/11425083250972-Keys-and-Scales-in-Live-12-FAQ
- [S34] Ableton Help — Navigation and View Options in Live 12 FAQ (snippet): https://help.ableton.com/hc/en-us/articles/12243771208092-Navigation-and-View-Options-in-Live-12-FAQ
- [S35] Ableton Help — Reduced Latency When Monitoring FAQ (snippet): https://help.ableton.com/hc/en-us/articles/209072249-Reduced-Latency-When-Monitoring-FAQ
- [S36] Ableton Help — SMPTE Timecode FAQ (snippet): https://help.ableton.com/hc/en-us/articles/360010120320-SMPTE-Timecode-FAQ
- [S37] Ableton Help — Pen Tablet Mode (snippet): https://help.ableton.com/hc/en-us/articles/209769585-Pen-Tablet-Mode
- [S38] Ableton Help — Driver Error Compensation FAQ (snippet): https://help.ableton.com/hc/en-us/articles/115000234830-Driver-Error-Compensation-FAQ
- [S39] Ableton Help — Full screen in Ableton Live (snippet): https://help.ableton.com/hc/en-us/articles/20210918971036-Full-screen-in-Ableton-Live
- [S40] Ableton Help — Dual Monitor Support (snippet): https://help.ableton.com/hc/en-us/articles/209071749-Dual-Monitor-Support
- [S41] Ableton Help — Tuning Systems FAQ (snippet): https://help.ableton.com/hc/en-us/articles/11535414344476-Tuning-Systems-FAQ
- [S42] Ableton Help — Tempo Following FAQ (snippet): https://help.ableton.com/hc/en-us/articles/360019100900-Tempo-Following-FAQ
- [S43] Ableton Help — Auto-Warp in Live 11.3 or later (snippet): https://help.ableton.com/hc/en-us/articles/9230108251164-Auto-Warp-in-Live-11-3-or-later
- [S44] Ableton Help — Comping in Live FAQ (snippet): https://help.ableton.com/hc/en-us/articles/360019092580-Comping-in-Live-FAQ
- [S45] Sonic Bloom — 25 Essential Workflow Tips: https://sonicbloom.net/25-essential-workflow-tips/
- [S46] Sonic Bloom — 10 Essential Shortcuts (headings only retrievable): https://sonicbloom.net/10-essential-shortcuts-to-speed-up-your-workflow-in-ableton-live/
- [S47] Sonic Bloom — 5 Essential Shortcuts: https://sonicbloom.net/5-essential-shortcuts-for-your-ableton-live-workflow/
- [S48] Sonic Bloom — Live 12.2: 12 Small Improvements: https://sonicbloom.net/ableton-live-12-2-12-small-improvements/
- [S49] Sonic Bloom — How I Optimised Live 12's Browser: https://sonicbloom.net/optimise-ableton-live-12-browser/
- [S50] Sonic Bloom — All New Shortcuts in Live 12 (Part 1; details are in its PDF): https://sonicbloom.net/all-new-shortcuts-ableton-live-12-1/
- [S51] MusicRadar — 20 Ableton Live power tips: https://www.musicradar.com/how-to/20-must-try-ableton-live-power-tips
- [S52] MusicRadar — 14 Ableton Live secret tips and tricks: https://www.musicradar.com/tuition/tech/14-ableton-live-secret-tips-and-tricks-589572
- [S53] Sound On Sound — Ableton Quick Start: https://www.soundonsound.com/techniques/ableton-quick-start
- [S54] Sound On Sound — Ableton Live 12 review: https://www.soundonsound.com/reviews/ableton-live-12
- [S55] Sound On Sound — Ableton Live 12: Tuning Systems: https://www.soundonsound.com/techniques/ableton-live-12-tuning-systems
- [S56] Beat Production — Breaking Down Ableton Live's Control Bar: https://beatproduction.net/breaking-down-ableton-lives-control-bar/
- [S57] Live Aspects — Ableton Live 101 complete beginner's guide: https://liveaspects.com/ableton-live-complete-guide/
- [S58] BassGorilla — Ableton Tutorial: complete guide: https://bassgorilla.com/ableton-tutorial/
- [S59] EDMProd — 100 Ableton Tips: https://www.edmprod.com/ableton-live-tips/
- [S60] Black Ghost Audio — 6 Ableton Live tricks: https://www.blackghostaudio.com/blog/do-you-know-these-6-ableton-live-tricks
- [S61] LANDR — 38 Ableton shortcuts: https://blog.landr.com/ableton-shortcuts/
- [S62] Push Patterns — "Ableton Live Settings To Turn OFF Now" (write-up of the YouTube video https://www.youtube.com/watch?v=luZWMJyKrD8): https://www.pushpatterns.com/blog/Ableton-Live-Settings-To-Turn-OFF-Now
- [S63] Sound Algorithm — How to enable dark mode in Live: https://www.soundalgorithm.io/ableton-guides/how-to-enable-dark-mode/
- [S64] RouteNote — Live 12.2 what's new: https://routenote.com/blog/ableton-live-12-2-is-coming-heres-whats-new/
- [S65] RouteNote — Live 12.1 what's new (snippet): https://routenote.com/blog/ableton-live-12-1-is-out-now-whats-new/
- [S66] Isotonik Studios — Scale Awareness in Live 12 (snippet): https://isotonikstudios.com/scale-awareness-in-ableton-live-12-ned-rushs-playful-deep-dive-via-midi-devices-and-clip-modes/
- [S67] Blogs That Knock — How to zoom the display in Ableton (snippet): https://blogsthatknock.com/how-to-zoom-the-display-in-ableton/
- [S68] Audeobox — Ableton audio setup guide (snippet): https://www.audeobox.com/learn/ableton/ableton-audio-setup-guide/
- [S69] CDM — Live 12 themes (snippet): https://cdm.link/live-12-themes-free/
- [S70] Ableton Drummer — How to use Keep Latency in Live 12 (snippet): https://blog.abletondrummer.com/how-to-use-keep-latency-in-ableton-live-12/
- [S71] YouTube — "Ableton Live 12 Beginner Tutorial - Interface and Navigation" (page text not retrievable; pointer only): https://www.youtube.com/watch?v=8M-3uUYJ1Ok
- [S72] Ableton Forum — Handy list of keyboard shortcuts for Live 12 (and 11) (fetch 403; pointer only): https://forum.ableton.com/viewtopic.php?t=249692
- [S73] Medium — These 10 Ableton keyboard shortcuts changed how I make music (fetch 403; pointer only): https://medium.com/@OSCILLATR/these-10-ableton-keyboard-shortcuts-changed-the-way-i-make-music-51b12cb629b5
- [S74] Music City SF — Live 12.4 new features (snippet): https://musiccitysf.com/accelerator-blog/ableton-live-12-4-new-features/
- [S75] Ableton Help — How to reduce latency while monitoring (snippet): https://help.ableton.com/hc/en-us/articles/360011924559-How-to-reduce-latency-while-monitoring
- Not reachable: reddit.com (r/ableton) — search API refuses the domain and fetch is blocked; forum.ableton.com and help.ableton.com return 403 on fetch (snippets via search only).
