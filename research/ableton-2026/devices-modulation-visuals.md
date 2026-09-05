# Ableton Live 12 (12.0 → 12.4.5) — Devices, Modulation, Visualisations, Knobs

Research notes for a gap analysis of Beacon (100Lights browser DAW) + Apollo (Helios hybrid synth) against Live 12 Suite.
Compiled 2026-09-04 from the Live 12 reference manual (fetched as full HTML and stripped, so no chapter was truncated),
the Live 12 release notes through 12.4.5 (Aug 26 2026), Ableton blog posts, Sound On Sound, MusicRadar, Sonic Bloom,
CDM, EDMProd, ModeAudio, Push Patterns, Synth Anatomy, and a decompressed copy of the factory `OTT.adv` preset.
Every claim carries a source tag `[Sn]`; the numbered list is in the Sources section at the end.

Conventions: "manual" = Live 12 reference manual. "M4L" = Max for Live. Version tags like **(12.2)** mean "introduced in that release".

---

## 0. Live 12.x timeline (what changed where)

| Version | Date | Device / modulation / UI items relevant to this analysis |
|---|---|---|
| 12.0 | Mar 2024 | Meld, Roar, Granulator III; MIDI Tools (Generators + Transformations); tuning systems + scale awareness; stacked Clip/Device views; mixer in Arrangement; Note Expression (MPE) editing tab; modulator devices (LFO/Shaper/Envelope Follower/Envelope MIDI/Shaper MIDI/Expression Control) gain **Mod vs Remote** modes so a modulated parameter stays hand-adjustable; Expression Control UI rebuilt with per-source tabs + curve display; 10x audio-rate toggle on LFO; `live.modulate~`; Clip Modulation enabled on all built-in M4L parameters; modulated mixer sliders draw their dot in the modulation colour. [S1][S9][S10][S24] |
| 12.1 | Oct 2024 | Auto Shift (pitch correction, MIDI sidechain, LFO, MPE); Drum Sampler (X/Y FX pad); Limiter rebuilt (new metering, M/S, True Peak, Soft Clip, Maximize); Saturator rebuilt (real-time level drawn on the curve; expanded view shows pre-shaper EQ curve + input/output spectra; Bass Shaper curve); Find & Select notes; MPE transformations Glissando + LFO; Envelope Follower gets sidechain routing; modulator presets default to Mod instead of Remote. [S1][S25][S26][S27] |
| 12.2 | Apr–Jun 2025 | Auto Filter rebuilt (live filter curve, per-channel modulated curves, output spectrum, DJ/Comb/Vowel/Resampling/Notch+LP, DFM/MS2/PRD circuits, LFO Wander/Ramp/Morph, Steps/S&H quantise, Envelope Hold, sidechain EQ, Output/Clip/Dry-Wet); Bounce to New Track / Track in Place; Expressive Chords (M4L, MPE); Roar Delay routing, Dispersion filter, external + MIDI sidechain, Envelope Hold, per-source modulation LEDs; Meld Chord oscillator + Scrambler LFO FX; Resonators/Spectral Resonator scale-aware; keyboard breakpoint workflow; sidechain toggle moved to its own header at the left of Compressor/Glue/Gate/Multiband/Auto Filter/Corpus/Shifter; device context menu gets a dedicated **Show Options** button in the title bar; enum parameters get Min/Max when macro- or MIDI-mapped; Operator 32 voices. [S1][S11][S12] |
| 12.3 | Nov 2025 | Stem Separation (Suite), Splice in browser, **Device A/B** compare (P key, "(B)" in title bar), Auto Pan → **Auto Pan-Tremolo** (Panning/Tremolo modes, live pan-position/tremolo-level visual, Harmonic + Vintage tremolo, Modulation Attack, Frequency Modulation, Time/16th/Triplet/Dotted LFO modes), Bounce Groups, Paste Bounced Audio, Push XYZ layout + Rhythm Generator. [S1][S13][S14] |
| 12.4 | Apr 2026 | Link Audio; Erosion rebuilt (spectrum + modulation viz, X-Y, Noise Blend, Stereo Width, 2 ms latency, "Erosion Legacy" kept); Chorus-Ensemble Chorus mode gets Time + Taps; Delay LFO gets Hz/ms/sync modes, 7 waveforms, Morph; Learn View replaces Help View; Push can create MIDI mappings and map native modulators directly; M4L "Visible"/"Visible (Not Stored)" parameter modes; devices renamable while folded (12.4.x); parameter names harmonised across delay/filter sections. [S1][S15][S16] |

---

## 1. MODULATION in Live 12

### 1.1 The four places modulation lives (there is no single "Modulation tab")

1. **Clip envelopes → Envelopes tab → Automation / Modulation toggle** (Session clips). [S2]
2. **Modulator devices** (LFO, Shaper, Envelope Follower, Envelope MIDI, Shaper MIDI, Expression Control, MPE Control) with Map buttons. [S4]
3. **Instrument/effect-internal modulation** (Wavetable/Meld/Roar Matrix tabs, Drift Mod section, Sampler Modulation tab, Operator/Analog/Collision LFO+env routing, the built-in envelope followers in Auto Filter/Dynamic Tube/Phaser-Flanger/Shifter). [S3][S5][S20]
4. **Macro Controls + Mapping Browser** in Racks, and **MIDI/Key Map mode** for hardware. [S6][S7]

### 1.2 Clip envelopes: automation vs modulation

- Envelopes tab has a **Device chooser** (Clip / MIDI Ctrl / mixer / each device) and a **Control chooser**; parameters with edited envelopes show an **LED** next to their name; "Only show adjusted envelopes" filters the lists. [S2]
- Session clips show **Automation** and **Modulation** toggles under the choosers. Arrangement clips only carry modulation envelopes in Clip View; their automation lives in the track's automation lanes. [S2]
- **Automation = absolute value, drawn red. Modulation = relative, drawn blue.** "Whereas automation envelopes define the absolute value of a control at any given point in time, modulation envelopes can only influence this defined value." Red LED / blue LED in the Control chooser; a parameter can carry both. [S2][S31]
- What modulation can touch: audio-clip **Transposition, Gain, Sample Offset**; **Track Volume** (post-FX, a small dot under the fader thumb shows the actual modulated value), **Sends** (a blue segment on the knob's position ring shows the modulated value; can only reduce, never exceed the knob), **Pan** (relative: full-width at centre, amount shrinks as the knob is turned), **any device parameter** (relative), **MIDI CC 0–119**. [S2]
- Modulation is a percentage of the automation/knob value and cannot push past it (but can reduce to −inf dB). [S2]
- **Unlinked envelopes**: an envelope can get its own loop/region (coloured loop brace) independent of the clip, e.g. a 3.2.1-bar LFO-style cycle or a fade across many clip repeats. [S2]
- Drawing: Draw Mode = grid steps; breakpoint mode = click segment to add, click point to delete, Alt/Option-drag to curve, Shift for fine value, stretch/skew handles on a time selection, **automation shapes** (sine/triangle/saw/square scale to selection; ramps + ADSR link to neighbouring values), Simplify Envelope. [S8]
- Warp markers move linked envelopes proportionally; warp markers are editable from the envelope editor. [S2]

### 1.3 Arrangement automation (for completeness)

- Automation Arm records control moves; Touch (mouse) vs Latch (controller) behaviour; Session Automation Recording overdubs into playing clips. [S8]
- Automation Mode (A key) overlays lanes; lanes can be split below the clip; the Add Automation Lane button hides once a lane exists (12.2.x). Re-Enable Automation button lights when a control has been overridden; Lock Envelopes keeps envelopes at absolute song position. [S8][S1]
- **(12.2) keyboard breakpoint workflow**: Enter selects/creates a breakpoint at the insert marker, arrows move it in time/value, Delete removes, typing edits the value, Tab/Shift-Tab step through breakpoints, Alt/Option+arrows jump between breakpoints, Alt/Option+up/down cycles automated parameters of all devices on the track (add Shift for all parameters). [S1]
- Tempo is an automated parameter on the Main track (Mixer → Song Tempo) with min/max display range. [S8]

### 1.4 Modulator devices (LFO, Shaper, Envelope Follower, Envelope MIDI, Shaper MIDI, Expression Control, MPE Control)

Status: they are **Max for Live devices under the hood** but ship in every Live edition (Intro gets Expression Control + LFO; Standard/Suite add Envelope Follower, Envelope MIDI, Shaper, Shaper MIDI). [S17][S18]

Shared mapping architecture (all six): [S4]
- **Map** button → click any automatable parameter (device or mixer) to assign; **Unmap** clears; **Show/Hide Multimap** reveals slots for **up to 8 targets**; only one Map button can be active across all devices at a time (12.0.x). [S4][S1]
- **Mod (Modulation) mode — default since 12.1**: the target's base value "can be freely adjusted even after they are mapped"; **Polarity toggle** Bipolar (centred on base value) / Unipolar (one direction from base); **Modulation Amount** slider sets depth relative to base. [S4][S1]
- **Remote Control mode**: the modulator owns the value outright; **Min/Max** sliders scale the output range. [S4]
- The mapped parameter keeps its normal appearance in Mod mode (you can still drag it) — this is the Live 12 headline change over Live 11 where the mapped knob was locked. [S9][S24]

| Device | Type | Parameters | Display |
|---|---|---|---|
| **LFO** | audio effect | 9 waves (Sine, Up, Down, Triangle, Square, Random, Bin, Stray, Glider); Shape (bend/skew), Steps (≤24), Jitter, Smooth, Rate (Hz or sync, ×10 audio-rate toggle), Depth, Offset, Phase, Hold, Retrigger (R) | scrolling LFO output with a horizontal centre line that moves with Offset [S4] |
| **Shaper** | audio effect | breakpoint envelope (click add, Alt-drag curve, Shift-click delete), Clear, 6 presets, Grid + Snap, Jitter, Smooth, Phase, Offset, Depth, Rate (Hz/sync), trigger modes **Loop / 1-Shot (mappable T button) / Manual (scrub)** | main breakpoint editor + small oscilloscope of output [S4] |
| **Envelope Follower** | audio effect | Gain, Rise, Fall, Delay (ms or sync), **Sidechain** (Audio From, Pre/Post FX/Post Mixer, Rack channel), Sidechain Mix 0–100 % | envelope curve; **Direct** and **S.C.** input meters [S4][S1] |
| **Envelope MIDI** | MIDI effect | ADSR with slope controls, global time scale, trigger modes Free / Sync / Loop / Echo (feedback + time), Velocity scaling, Sustain vs one-shot | draggable ADSR handles + trigger LED [S4] |
| **Shaper MIDI** | MIDI effect | note-triggered breakpoint envelope, sustain breakpoint (Cmd-click), velocity scaling, loop, rate, echo | editor + oscilloscope + trigger LED [S4] |
| **Expression Control** | MIDI effect | **5 Mod Source tabs**, each choosing one of 10 sources: Velocity, Modwheel, Pitchbend, Pressure, Keytrack, Expression, Random, Increment (1–32 steps), Slide, Sustain; Linear (2-point) or S-curve (3-point) with Curve A/B + Link; Min/Max; Smoothing Lin/Log with Rise/Fall 0–1000 ms | curve display with draggable breakpoints [S4] |
| **MPE Control** | MIDI effect | shapes Press / Slide / NotePB via linear or S curves, independent rise/fall smoothing, converts MPE to global MIDI | per-dimension curve [S4] |

Third-party context: Sound On Sound's "Pushing the Envelope" describes the same Envelope Follower (Gain/Rise/Fall/Delay/Min-Max) and the four **built-in** envelope followers (Auto Filter → cutoff, Dynamic Tube → Bias, Flanger → delay time, Phaser → frequency) each with Envelope amount + Attack/Release. [S20] Push Patterns confirms that in 12.4 the "native modulators" (LFO, Envelope Follower, Shaper) can be mapped from Push 3 Standalone and that they drive "up to 8 separate parameters at once". [S18]

### 1.5 Modulation built into effects (no extra device needed)

- **Auto Filter (12.2)**: two-channel LFO (Phase or Spin stereo modes, Phase Offset, Steps / S&H quantise, Amt, Rate in Hz/s/sync/16ths, waves Sine/Triangle/Saw/Square/Ramp Up/Ramp Down/Wander/S&H, Morph or Smooth), Envelope follower (Attack, **Envelope Hold**, Release, Env S&H quantise, bipolar Envelope amount), external sidechain with EQ + Mono Sidechain option. [S3][S1]
- **Delay (12.4)**: LFO on delay time and filter freq; Rate/Time/Synced/Triplet/Dotted/Sixteenth modes; Sine/Triangle/Ramp Up/Ramp Down/Square/S&H/Wander + Morph; LED flashes at LFO rate; LFO section collapsible. [S3][S1]
- **Auto Pan-Tremolo (12.3)**: single morphable LFO (Shape, Invert), Modulation Attack (ramps modulation after onsets), Frequency Modulation (input level scales rate), Harmonic + Vintage tremolo modes. [S3][S1]
- **Roar**: Mod Sources tab = LFO 1, LFO 2 (Sine/Triangle/Square/Up/Down, Free/Synced/Triplet/Dotted/Sixteenth, Morph, Smooth), Env (envelope follower: Attack, Release, Envelope Hold, Threshold, Gain, Frequency, Width, Input Listen), Noise (Simplex/Wander/S&H/Brown); **Matrix** tab: sources across, targets down, click a parameter to add it as a target, drag cells, Global Modulation Amount, X clears; sources can modulate each other; expanded view shows all stages + full matrix; **(12.2) colour-coded LEDs** in the Modulation column show which source is active. [S3][S1][S21][S22]
- **Echo**: Modulation tab with 6 waveforms (drag the wave to set rate), Phase, filter + delay-time modulation. [S3]
- **Corpus**: 2 LFOs (7 shapes incl. two noise types, Phase/Spin, Offset when synced) + MIDI sidechain for frequency and Off Decay. [S3]
- **Phaser-Flanger / Shifter / Dynamic Tube**: LFO(s) + envelope follower; Phaser-Flanger's LFO and Envelope sections expand inside the device (triangle icon). [S3][S5][S20]
- **Spectral Resonator**: modulation modes section; **Auto Shift**: vibrato LFO + multi-purpose LFO, MPE in MIDI mode. [S3][S1]

### 1.6 Modulation inside instruments

- **Wavetable**: Matrix tab (sources horizontal — Env 1/2/3, LFO 1/2 — targets vertical; click a parameter to add it; additive vs multiplicative targets; Time and Amount master sliders), MIDI tab shares rows (velocity, key, modwheel, pitch bend, MPE). Two LFOs (5 shapes + Shape morph, Sync, Rate draggable on the waveform, Amount, Offset, Attack, Retrigger). Expanded view moves parameters up into the main window. [S5]
- **Meld**: per-engine Modulation Matrix (sources across, targets down, drag cells; click a parameter to add it; some additive, some multiplicative), MIDI tab (Velocity, Pitch, Random-per-note, Pitch Bend, Press, Modwheel) and MPE tab (Note Pitch Bend, Slide, Press); two envelopes (Amp + Mod, with Initial/Peak/Final, slope controls in red, loop modes, Link A/B) and two LFOs per engine (LFO 1 types Basic Shapes/Ramp/Wander/Alternate/Euclid/Pulsate feeding an **LFO FX** slot — incl. **Scrambler** (12.2)); expanded view shows all sources/targets with A/B toggles, Copy to A/B, X clear. [S5][S1][S23][S28]
- **Drift**: Mod section with 3 source→target slots (sources Env 1, Env 2/Cyc, LFO, Key, Velocity, Modwheel, Pressure, Slide; targets Osc gains/shape/detune, noise, LP freq/res, HP freq, LFO rate, Cyc env rate, Main volume, ±100 %) plus dedicated Shape-mod and filter-mod slots; Env 2 can be a **Cycling** envelope (Rate/Ratio/Time/Sync, Tilt/Hold). [S5][S29]
- **Sampler**: Modulation tab = loopable Aux envelope (Initial/Peak/Sustain/End, ADSR, slopes, 29 destinations ×2) + 3 LFOs (6 shapes, 0.01–30 Hz or sync, LFO 2/3 stereo). [S5]
- **Operator**: per-oscillator envelopes, filter/pitch/LFO envelopes, algorithm selector (11) is itself mappable/modulatable; Time<Key, Pan<Key/Random. [S5]
- **Analog / Collision**: 2 LFOs, envelopes with Lin/Exp slopes, MPE Pressure/Slide/NotePB sources with activity LEDs (Analog). [S5]
- **Granulator III**: per-knob modulation row under the display (LFO, Env 2, velocity, MPE Slide/Press), tempo-sync LFO. [S30][S33]
- **Drum Sampler**: Velocity or Slide → volume + one extra target; FX1/FX2 modulate the selected playback effect's two parameters. [S5][S1]

### 1.7 Macro Controls, Variations, Randomize (Racks)

- Up to **16 Macro Controls**, 8 visible by default; +/- view buttons change the visible count (saved with the Set). [S6]
- **Macro Map Mode**: mappable parameters get a coloured overlay, Map buttons appear under each macro, the **Mapping Browser** opens; click parameter → click a macro's Map button. Macro inherits the parameter's name and units. **Min/Max** sliders set the range; **Min > Max inverts**; right-click → Invert Range. Once mapped, the device parameter is drawn **disabled** (macro owns it) though clip envelopes can still modulate it; the Status Bar names the macro. Multiple targets on one macro → generic name "Macro n" and a 0–127 scale unless all targets share units and range. **(12.2)** enum parameters also get Min/Max when mapped. [S6][S1]
- **Rand (dice) button** in the Rack title bar randomises all mapped macros; per-macro **Exclude Macro from Randomization**; Volume macros in Instrument Rack presets are excluded by default. [S6]
- **Macro Variations**: Show/Hide Macro Variations view; **New** stores a snapshot ("Variation 1…"); rename/duplicate/delete; **Launch** and **Overwrite** buttons per variation; **Exclude Macro from Variations**. Variations fold/unfold with the device (12.4.x fix). [S6][S1]
- Macros can be given custom names, colours and info text. [S6]

### 1.8 MIDI / Key mapping

- **MIDI Map Mode** (mappable elements blue) and **Key Map Mode** (red); Mapping Browser lists control, path, name, Min/Max; ranges editable/invertible; Delete removes. Instant (control-surface) mappings are not listed. [S7]
- Absolute vs relative controllers (Signed Bit, Signed Bit 2, Bin Offset, Twos Complement); **Takeover** modes None / Pick-Up / Value Scaling; up to six native control surfaces; surfaces can be **locked** to a device (hand icon in the title bar). [S7][S1]
- **(12.4)** MIDI mappings can be created from Push. [S15]

### 1.9 MPE / Note Expression editing (12.0+)

- MIDI clip **Note Expression tab** (Option+3): lanes for **Pitch** (per-note pitch bend drawn on top of notes in the editor), **Slide**, **Pressure**, **Velocity**, **Release Velocity**; Slide + Pressure shown by default; lanes toggle/resize individually. [S19]
- Editing = same breakpoint grammar as automation: click to add/delete, Shift for axis lock / fine, Alt/Option-drag to curve, right-click Edit/Add Value, Draw Mode (B), grid off by default (Cmd+4 to snap), pitch snaps to semitones with the modifier, proportional scaling by dragging above the envelope (not for Pitch), envelopes stretch with notes (÷2/×2, stretch markers), Clear All Envelopes. [S19]
- **(12.1)** MPE transformations **Glissando** and **LFO** draw curves onto selected notes' expression lanes. [S25][S27]
- MIDI track meters show per-note controller changes: "the lowest dot in a meter lights up in a blue color". [S19]
- Devices responding: Wavetable, Drift, Meld, Sampler/Simpler, Granulator III, Analog/Collision/Tension/Electric (Pressure/Slide/NotePB with activity LEDs), Arpeggiator, Chord (can send MPE to generated notes), Auto Shift, Expressive Chords, MPE-enabled plug-ins (MPE Mode saved with the device default). [S5][S19][S12]

### 1.10 Sidechain inputs on devices

Compressor, Glue Compressor, Gate, Multiband Dynamics, Auto Filter (+ sidechain EQ, Mono Sidechain), Corpus (MIDI: Frequency / Off Decay), Shifter (audio + MIDI), Roar (external audio into the envelope follower + **MIDI > FB Note** for feedback pitch, Sidechain Listen), Auto Shift (MIDI notes for correction/harmony), Spectral Resonator (MIDI sidechain, 16 voices), Vocoder (carrier/modulator routing), Envelope Follower (external source with Direct/S.C. meters and Mix), and plug-ins that declare a sidechain (Gain + Mix knobs on the left). Each sidechain section has **Gain**, **Dry/Wet** (blend internal/external trigger), a **headphones "listen"** button, and an EQ block on the dynamics devices; auto-Makeup is unavailable with external sidechain on Compressor. **(12.2)** the sidechain toggle moved to the left edge "with its own header", separate from the breakout-view arrow. [S3][S4][S1]

---

## 2. OTT (Multiband Dynamics preset)

### 2.1 What it is
- "OTT" is a factory preset of **Multiband Dynamics** (Standard/Suite), created by former Ableton employee Claes Johansson in the Live 8 era; Steve Duda's free **Xfer OTT** (2012) clones it for other DAWs and exposes Depth/Time/In/Out + per-band Upwd/Dnwd/gain. Common expansion: "Over The Top". [S34][S35][S36]
- Mechanism: **simultaneous upward and downward compression on three bands** — quiet material is raised, loud material is squashed, so the output is dense with very small dynamic range; the aggressive ratios and low thresholds are why it sounds like heavy saturation/"shimmer". [S34][S35][S37]

### 2.2 Multiband Dynamics — the UI the preset lives in [S3][S38]
- **High / Low** band-enable buttons with crossover frequency sliders (both off = single band using the Mid controls). Each band: **activator**, **solo**, **Input** gain (pre) and **Output** gain (post).
- **Display**: per band, a **large bar = output level**, a **small bar = input level** (aligned when no processing), dB scale along the bottom. Left block = signal **below** the Below threshold; right block = signal **above** the Above threshold.
  - Hover a block **edge** → bracket cursor: drag left/right = **threshold**. Cmd-drag = same threshold on all bands; Alt-drag = Above + Below together on one band; Shift = fine.
  - Hover block **middle** → up/down cursor: drag = make that range louder/quieter, i.e. the **ratio**. Cmd = all bands; Alt = both blocks of one band; Shift = fine; **double-click resets**.
  - Semantics: Above block down = downward compression, up = upward expansion; Below block down = downward expansion, up = upward compression. SOS notes the zones colour green (Above compression) / orange (Below upward compression) when active. [S38]
- Right-hand column with **T / B / A** buttons switching the numeric fields between Time (attack/release), Below (threshold + ratio) and Above (threshold + ratio) per band. Quirk: type ".5" to get 1:2.00 and "2" to get 1:0.50. [S38]
- Global: **Soft Knee**, **RMS/Peak**, **Output**, **Time** (scales every attack/release together), **Amount** (scales every ratio; 0 % = ratio 1 = bypass — this is the "Depth" that tutorials talk about). Sidechain section behind the title-bar toggle. [S3]

### 2.3 The preset's actual numbers (decompressed `OTT.adv`) [S39]
Read from a user's backed-up copy of the preset (file name `OTT-1.adv`, so Amount may have been touched; everything else matches published descriptions [S34]).

| Parameter | Low | Mid | High |
|---|---|---|---|
| Crossovers | 88.28 Hz (Low/Mid) | | 2500 Hz (Mid/High) |
| Above threshold | −33.75 dB | −30.25 dB | −35.5 dB |
| Below threshold | −40.75 dB | −41.75 dB | −40.75 dB |
| Above ratio (stored, normalised) | −0.985 | −0.985 | −1.0 (≈ max downward compression / near-limiting) |
| Below ratio (stored, normalised) | +0.76 | +0.76 | +0.76 (strong upward compression) |
| Attack | 47.8 ms | 22.4 ms | 13.5 ms |
| Release | 282 ms | 282 ms | 132 ms |
| Band input gain | +5.2 dB | +5.2 dB | +5.2 dB |
| Band output gain | +10.3 dB | +5.7 dB | +10.3 dB |
| Global | Output **+19.1 dB**, Time 100 %, Soft Knee **on**, **RMS** detection, Amount 21 % in this copy (factory copy is widely described as 100 %; Xfer's Depth defaults to 100 %) | | |

Cross-check: the untouched "windows" between thresholds are 7 dB (low), 11.5 dB (mid), 5.25 dB (high) — exactly the 7 / 11.6 / 5.3 dB MusicRadar quotes, and the 88.3 Hz / 2.5 kHz splits match Xfer's fixed crossovers. MusicRadar also describes the low band's above-threshold slope as ~1/6 dB out per dB in, "almost like a limiter". [S34][S35]

### 2.4 What tutorials tell people to do with it
- Depth/Amount: 15–20 % for subtle, 20–50 % for aggressive, "rarely above 50 %" (SampleFocus); leads/bass 20–39 %, drums ~30 %, master 10–16 %, FX/foley 100 % (EDMProd); vocals and full mixes "start at 50 %" (MusicRadar); "the key… is only using a tiny bit" (Production Music Live). [S35][S36][S37][S34]
- Time knob = global attack/release scale: faster = tighter, slower = more transient. Output/band gains act "like an EQ" — the preset's +10 dB low/high band gains are why OTT brightens and thickens. [S35][S36]
- Xfer trick: Ctrl-click a band to disable it so you get upward-only or downward-only. [S35]
- Forum wisdom: it is easy to fool yourself because it gets louder; many drop it as their mixing improves. [S40]

---

## 3. DEVICE VISUALISATIONS — what draws live graphics

### 3.1 Cross-device conventions
- Any device with a **breakout/expanded view** gets an **arrow toggle** right of the Activator (EQ Eight, Spectrum, Saturator, Roar, Wavetable, Meld, Simpler, Sampler; Compressor/Glue/Gate/Multiband sidechain panels shared the same triangle until 12.2 split them). Expanded views float above the Device View and "parameters move between the main Device View and the expanded view depending on the dimensions of your screen layout". [S9][S5][S1]
- **Level meters between every device** in a chain (input/output), no inter-device clipping (32-bit float). [S9]
- Modulation feedback on controls: blue ring segment (send knob), dot under fader thumb (volume), disabled/greyed look for macro-mapped parameters, coloured overlay in Map modes, LED per modulation source in Roar's Modulation column. [S2][S6][S3]
- Most X-Y controllers accept Alt/Option-drag for a third parameter (Q/width). [S3]

### 3.2 Audio effects [S3 unless noted]

| Device | Live graphics | Notes |
|---|---|---|
| **EQ Eight** (Std+) | Filter curve + **output spectrum** (Analyze on/off); numbered filter dots; drag = freq/gain, Alt-drag = Q (vertical = Q on cut/notch bands); rubber-band multi-select; L/R and M/S draw both curves, **Edit** picks the active one | **Adaptive Q** (Q rises with boost/cut), **Audition** (headphone icon: hold a dot to solo that band), Scale (all gains), global Gain, **Oversampling** in the context menu; expanded view lets all 8 bands be edited at once; 8 filter types, 12/48 dB cuts. [S3][S41][S42] |
| **Spectrum** (Std+) | dB × frequency graph; **Block** size, **Channel** L/R/both, **Refresh**, **Avg**, **Graph** line vs bins, **Max** hold (click to reset), **Scale X** linear/log/semitone (note names), **Range / Auto** (drag legend to scroll/zoom), hover readout of amplitude + Hz + note; expand via title-bar button or double-click | measurement only |
| **Tuner** | **Classic** view (Target mode = ball on a curve with arrows; **Strobe** mode = rotating band, speed = detune) or **Histogram** view (pitch over time, grey centre bars, Auto-follow); green in tune / red out; Hz or cents; sharps/flats spelling; reference 410–480 Hz | measurement only |
| **Compressor** | **Collapsed** / **Transfer Curve** (in vs out, knee as dotted lines) / **Activity** (input light grey; GR orange or output dark grey over time); orange **Gain Reduction** meter; Output meter | Peak/RMS/Expand modes, Lin/Log envelope, Lookahead 0/1/10 ms, Auto Release, Makeup, Dry/Wet |
| **Glue Compressor** (Std+) | **needle** VU-style gain-reduction display; **Clip LED** red at >0 dB, yellow when Soft Clip is clipping | Range, Soft clip, Oversampling |
| **Multiband Dynamics** (Std+) | three-band block display (see §2.2): output bars (large), input bars (small), draggable Above/Below blocks | |
| **Limiter** (12.1) | Ceiling control inside the display, **Gain Reduction meter**, level metering; Soft Clip LED flashes when clipping | L/R or M/S, Link %, True Peak, Maximize, Lookahead 1.5/3/6 ms, Auto release |
| **Gate** | input (light grey) vs output (dark grey, white outline) level history; **threshold = draggable blue line** | Return/hysteresis, Hold, sidechain + EQ |
| **Saturator** (12.1) | **Shaper Curve** with the **real-time input signal drawn against the curve**; expanded view adds **Color Curve** (pre-shaper EQ) **with input and output spectra**, draggable handles (Amt Lo, Amt Hi/Freq) | 8 curves incl. Bass Shaper (Threshold 0…−50 dB) and Waveshaper (6 extra params), Soft/Hard post-clip, Hi-Quality, Pre-DC filter [S3][S1] |
| **Auto Filter** (12.2) | filter curve + **modulated L and R curves** + **real-time output spectrum**; drag handle for Freq/Res (Pitch/Formant for Vowel); LFO/Env parameter rows under the display | 10 filter types, 4 circuits, Drive, Clip, Output, Dry/Wet |
| **Auto Pan-Tremolo** (12.3) | LFO waveform + **live pan position / tremolo level** readout | |
| **Delay** | band-pass filter display (X = freq, Y = width); LFO LED at rate | Repitch/Fade/Jump, Freeze, Ping Pong |
| **Echo** (Suite) | **Tunnel** visualisation (circles = repeats, spacing = time, white dots = feedback), Filter display with draggable dots, modulation waveform (drag = rate) | Stereo/Ping Pong/Mid-Side |
| **Reverb** | input filter X-Y (low/high cut) | Early reflections/diffusion/chorus/freeze |
| **Hybrid Reverb** (Suite) | **convolution IR waveform display** (drop any audio file to add a User IR); convolution controls yellow, algorithmic blue; Reverb + EQ tabs; unused engine greys out | Serial/Parallel/Algorithm/Convolution routing, 5 algorithms |
| **Spectral Time / Spectral Resonator** (Suite) | **spectrogram** of dry (yellow) vs wet (blue) over time, hide toggle; Spectral Resonator embeds **Harmonics** and **Quantize** in the display | scale-aware since 12.2 |
| **Roar** (Suite) | **Shaper Visualization** per stage (drag the curve = Amount); per-source displays for LFO 1/2, Env, Noise; Matrix grid; **(12.2) colour LEDs per active modulation source**; yellow Drive LED; **expanded view** shows all stages + full matrix | 7 routings, 12 shapers, 9 filters, feedback + compressor |
| **Erosion** (12.4) | **input spectrum + modulation overlay** (solid vertical line = sine, dotted horizontal = noise); X-Y (Freq × Amount, Alt = width); icon brightness follows Noise Blend | |
| **Chorus-Ensemble** | active delay lines drawn as waveforms per mode | Chorus/Ensemble/Vibrato |
| **Channel EQ** | curve + spectrum (adaptive curve) | 3 bands + HP 80 Hz [S3][S12] |
| **EQ Three** | 3 signal-present LEDs | |
| **Corpus** (Std+) | X-Y (Decay × Material/Radius), limiter LED, MIDI note + cents readout under Tune | |
| **Filter Delay / Overdrive / Grain Delay / Vinyl Distortion** | X-Y controllers (Grain Delay's axes are assignable; Vinyl has two) | |
| **Phaser-Flanger** | mode display; LFO and Envelope sections expand inside the device (triangle) | Phaser/Flanger/Doubler |
| **Looper** | big performance display, red while recording, position + loop length | |
| **External Audio Effect** | peak indicators in/out | |
| **Drum Buss** | boom/bass level meter (per summary) | [S3] |
| **Auto Shift** (12.1) | input pitch display, correction meter, piano/scale view, LFO wave (per summary) | [S3][S26] |
| **Utility, Beat Repeat, Cabinet, Dynamic Tube, Pedal, Redux, Resonators, Shifter, Vocoder (band levels), Amp** | little or no live graphics beyond meters/LEDs | |

### 3.3 MIDI effects
Arpeggiator: **pattern visualisation** for the chosen Style + retrigger LED. Scale: **13×13 Note Matrix** grid (black squares = black keys, click to remap). Velocity: **Velocity Curve** grid (Drive/Compand reshape it; grey band shows Random range; gate LED). Random: +/0/− LEDs. Pitch: range LED. Chord: Shift 1–6 with velocity/chance, strum. MIDI Monitor: note list / flow diagram / MPE stream. [S43][S4]

### 3.4 Instruments [S5 unless noted]
- **Operator**: "shell + display" — the central display switches to whichever section you touch; per-oscillator **envelope display** or **harmonics/partial editor** (16/32/64 partials, Repeat); algorithm icons in the global display; foldable with its own triangle.
- **Analog**: shell + display per section (osc, filters, amps, LFOs, global); envelope viz reflects Lin/Exp slopes; MPE Pressure/Slide activity LEDs.
- **Wavetable** (Suite): wavetable **visualisation in linear (stacked waveforms) or polar (loops) view**, drag = wave position, drop a WAV to import; LFO waveform draggable for rate; Matrix grid; expanded view.
- **Meld** (Suite): oscillator displays, envelope editors with slope controls, LFO displays, Matrix grid; engine A blue / B orange; expanded view with A/B toggles. [S5][S23]
- **Drift**: **waveform display of Osc1+Osc2+noise**; filter section click reveals an X-Y envelope/filter editor with draggable dots; Env 1/2 and LFO displays; waveform display updates even when the device is inactive (12.1.x fix). [S5][S29][S1]
- **Simpler**: sample waveform with flags/loop, zoom (Cmd+wheel), expanded view moves the waveform up; Classic/One-Shot/Slice modes (slice markers). **Sampler** (Suite): waveform, zone editor, Modulation tab. **Drum Sampler** (12.1): waveform with playhead, **X/Y pad** for the selected playback effect, similar-sample swap buttons on hover.
- **Collision / Corpus**: resonator object drawn inside the X-Y controller. **Electric**: Hammer/Fork/Damper-Pickup section icons.
- **Impulse**: 8 slot waveforms. **Drum Rack**: **Pad View** of 128 pads (drop anything, "Multi" pads, mute/solo per pad).
- **Granulator III** (Suite, M4L): Main Display (waveform with **cyan moving grain lines** showing grain envelope/position), Modulator Display, Parameter Display; Classic/Looping/Cloud modes; Capture 1–8 s with level meter. [S30][S33]

### 3.5 Meters (mixer, track headers, main)
- Track **Meter shows peak and RMS** output (input while monitoring). "Peak meters show sudden changes in level, while RMS meters give a better impression of perceived loudness." [S44]
- Drag the mixer taller → **tick marks, a numeric volume field, resettable peak-hold indicators**; widen the track → **dB scale** beside the meter. [S44]
- 32-bit float: tracks can go "into the red" without clipping; only physical outputs, the Main track and file export clip; Live still shows >0 dB warnings. [S44]
- Mixer available in Arrangement View since 12.0; Session mixer components are toggleable from the mixer-view menu. [S44][S24]
- MIDI track meters show MPE per-note data (blue lowest dot). [S19]
- Modulated fader dot drawn in the modulation colour (12.0). [S1]

### 3.6 Device View scrolling and folding
- Device View at the bottom; Cmd+Option+4 show/hide, **Option+4 focus**, Shift+Tab / F12 toggles Device/Clip view, Cmd+Alt+L toggles both; **stacked Clip + Device views** (12.0). [S9][S45][S1]
- **Fold** a device by double-clicking its title bar or context menu → Fold; a Rack whose views are all hidden folds into its view column; Operator has its own fold triangle; **(12.4.x) devices can be renamed while folded** (unfolds automatically). [S9][S6][S1]
- Right-click the Device View selector → **hierarchical list of every device on the track** to jump to one. Racks: view column (Macros / Chain List / Devices / Pad View / Variations), round-corner brackets that detach when the Devices view is shown, up/down arrows step through the Chain List. [S6]
- Expanded/breakout views stay open across device switches (12.0.x fixes), work on disabled devices, and are wrapped for keyboard focus. [S1]

---

## 4. KNOBS & CONTROLS

### 4.1 Value editing (manual §41.6 "Adjusting Values" + §41.4) [S45]
| Action | Key/mouse |
|---|---|
| Change value | click-drag (knobs vertical, sliders along their axis) |
| **Finer resolution while dragging** | **Shift** |
| Decrement / increment | up / down arrow |
| Fine step or octave step | Shift + up/down |
| **Reset parameter** | **Delete** or **double-click** ("Return to Default") |
| Type a value | 0–9 then Enter (Esc cancels; "." / "," moves to next bar/beat/16th field) |
| Ignore grid while dragging | Alt (Win) / Cmd (Mac) |
| Hot-swap selected device | Q |
| A/B compare (12.3) | P |
| Group / ungroup devices | Cmd+G / Cmd+Shift+G |
| Toggle all devices in a group | Option-click an activator |
| Add device to selection | Shift-click |

- Sonic Bloom: Delete resets to the factory "unity" value, but for macro-mapped parameters inside a saved Rack it resets to the values saved with the Rack. [S46]
- Multi-selected tracks move mixer controls together, preserving offsets; double-click or the triangle above Pan resets it. [S44]
- Context-specific modifiers: Alt-drag EQ dots for Q, Cmd-drag Multiband thresholds for all bands, Alt-drag for both thresholds of a band, Shift+drag Drum Sampler start for zoomed fine edit, Alt on X-Y pads for width/Q. [S3][S5]
- Control surfaces: encoders fine-tune with Shift on the newer Komplete Kontrol/Push scripts. [S1]

### 4.2 Device title bar (manual §23.2.1) [S9][S1]
Left to right: **Activator** (on/off; off = no CPU), optional **expanded-view arrow** (breakout) and/or **sidechain triangle** (since 12.2 these are distinct), device name (rename via Cmd+R; "(B)" suffix when state B is active), optional **scale-awareness toggle** (Pitch/Scale/Chord/Meld/Resonators/Spectral Resonator/Arpeggiator…), **Learn** (Chord), **hand icon** when locked to a control surface, **Hot-Swap** (links browser to this device; Q), **Save Preset** (to User Library), **Show Options** (12.2 — opens the context menu: Fold, Rename, Edit Info Text, Compare A/B, Oversampling, Hi-Quality, Mono Sidechain, Edit in Max, …). M4L devices show a Max icon instead of the old Edit button.
- **Device A/B (12.3)**: every built-in device holds two parameter sets; Copy A→B / Switch (P); automation is per-state and gets disabled when switching (Re-Enable Automation in the parameter context menu). Not for Racks, M4L or plug-ins. [S9]
- Devices process left → right; drag title bars to reorder; Delete removes; paste inserts before the selection; plug-ins with >64 parameters use Configure mode; plug-in sidechain shows Gain + Mix at the left. [S9]

### 4.3 Racks & chains [S6]
- **Chain List** = parallel branches; each chain has activator, solo, hot-swap, volume, pan (Drum Rack chains add sends + note/choke); multi-select; **Auto Select** highlights chains currently passing signal; chains save as presets and take colours/names.
- **Zones**: Key, Velocity, **Chain Select** (a single 0–127 selector with fade ranges — preset banks / crossfades); Chain Selector is automatable/modulatable.
- **Drum Rack Pad View**: 128 note pads; drop samples/presets/effects; multi-sample drop → chromatic Simpler; Alt-drag layers; "Multi" pads.
- Macro Controls/Variations/Randomize: see §1.7.

---

## 5. STANDARD DEVICE LIST (Live 12 Suite) with one-liners

Edition counts from Ableton's comparison page: Instruments 8/12/21, Audio effects 27/36/59, MIDI effects 12/13/14, MIDI Tools 1/17/17, Modulators 2/6/6 (Intro/Standard/Suite). [S17] Descriptions from the manual reference chapters. [S3][S4][S5][S43]

### 5.1 Audio effects (built-in, non-M4L)
| Device | Ed. | One line |
|---|---|---|
| Amp | Suite | 7 physically modelled guitar amps (Gain/Bass/Mid/Treble/Presence, Dual mono) |
| Auto Filter | all | Multimode filter (LP/HP/BP/Notch/Morph/Vowel/Comb/DJ/Resampling/Notch+LP; SVF/DFM/MS2/PRD circuits) with stereo LFO + envelope follower + sidechain |
| Auto Pan-Tremolo | all | LFO-driven panning or tremolo/gating (Harmonic, Vintage modes) |
| Auto Shift | all | Real-time pitch correction, formant/pitch shift, vibrato, MIDI sidechain harmonies |
| Beat Repeat | all | Grid-quantised stutter/repeat with pitch decay, Chance, Gate/Insert/Mix |
| Cabinet | Suite | 5 speaker cabinets × mic type/position |
| Channel EQ | all | Desk-style 3-band EQ + HP 80 Hz, adaptive curves |
| Chorus-Ensemble | all | 2/3-line chorus, ensemble and vibrato modes |
| Compressor | all | Downward compressor/expander with knee, lookahead, Peak/RMS, sidechain + EQ, 3 display modes |
| Corpus | Std+ | Physically modelled resonators (beam, marimba, string, membrane, plate, pipe, tube) with LFOs + MIDI sidechain |
| Delay | all | Independent L/R delay, sync/time, band-pass, LFO, Repitch/Fade/Jump, Freeze, Ping Pong |
| Drum Buss | Std+ | Drum bus processor: comp, drive types, crunch/damp, transients, boom |
| Dynamic Tube | Std+ | Tube saturation with envelope-driven bias |
| Echo | Suite | Dual-line modulation delay with tunnel display, gate/duck/noise/wobble |
| EQ Eight | Std+ | 8-band parametric with spectrum, Adaptive Q, Audition, L/R & M/S |
| EQ Three | all | DJ-style 3-band kill EQ |
| Erosion | all | Sine/noise-modulated short delay degradation (spectrum display) |
| External Audio Effect | Std+ | Insert hardware with latency compensation |
| Filter Delay | Std+ | Three delay lines each with LP/HP X-Y filters |
| Gate | all | Threshold gate with return/hold/release, flip, sidechain |
| Glue Compressor | Std+ | Cytomic-modelled SSL-style bus compressor, needle GR, soft clip |
| Grain Delay | all | Granular pitch/spray/feedback delay on an X-Y |
| Hybrid Reverb | Suite | Convolution (user IRs) + 5 algorithmic engines, serial/parallel |
| Limiter | all | Mastering limiter, L/R or M/S, True Peak, Soft Clip, Maximize |
| Looper | all | Performance looper with overdub, tempo detect, drag-out clips |
| Multiband Dynamics | Std+ | 3-band upward/downward compression + expansion (OTT lives here) |
| Overdrive | Std+ | Pedal-style overdrive with pre band-pass X-Y |
| Pedal | Suite | Guitar distortion pedal (overdrive/distortion/fuzz) + sub |
| Phaser-Flanger | all | Phaser, flanger and doubler with 2 LFOs + envelope |
| Redux | all | Downsampling + bit reduction with shape/jitter/DC/filter |
| Resonators | Std+ | Five tuned resonators, scale-aware |
| Reverb | all | Algorithmic reverb: early reflections, diffusion, chorus, freeze |
| Roar | Suite | 3-stage saturation/colour with 7 routings, 12 shapers, feedback, compressor, mod matrix |
| Saturator | all | Waveshaper with 8 curves incl. Bass Shaper and Waveshaper, colour filters |
| Shifter | Std+ | Pitch/frequency shifter, ring mod, LFO + envelope, MIDI sidechain |
| Spectral Resonator | Suite | Spectral tuned resonances, MIDI polyphonic, spectrogram |
| Spectral Time | Suite | Spectral freezer + spectral delay, spectrogram |
| Spectrum | Std+ | Real-time analyser (measurement only) |
| Tuner | all | Chromatic tuner, classic/strobe/histogram views |
| Utility | all | Gain (−inf…+35 dB), width/M-S, phase, mono, bass mono, balance, mute, DC |
| Vinyl Distortion | Std+ | Tracing/pinch harmonic distortion + crackle |
| Vocoder | Std+ | Filter-bank vocoder with carrier options (not in Intro/Lite) |
| Audio Effect Rack | all | Parallel chains + macros |
| CV Clock In/Out, CV Envelope Follower, CV In, CV LFO, CV Shaper, CV Utility | all | CV Tools (M4L) for DC-coupled interfaces |

### 5.2 Max for Live audio effects in Suite [S4][S17]
Align Delay (sample/ms/distance alignment), **Envelope Follower**, **LFO**, **Shaper** (modulators), Color Limiter, Convolution Reverb, Gated Delay, Pitch Hack, PitchLoop89, Re-Enveloper, Spectral Blur, Surround Panner, plus the Inspired by Nature / Vector devices via packs.

### 5.3 MIDI effects [S43][S17]
| Device | One line |
|---|---|
| Arpeggiator | Styles (Up/Down/Converge/Diverge/Play Order/Chord Trigger/random…), rate, gate, hold, offset, groove, retrigger, pattern viz, MPE-aware |
| CC Control | Send Mod/PB/Pressure + custom CCs to hardware, Learn |
| Chord | Up to 6 shifts ±36 st with velocity/chance, strum tension/crescendo, MPE out, Learn |
| Note Length | Gate/length, trigger from note-off, release velocity, decay, key scale |
| Pitch | ±128 st or ±30 scale degrees, range/lowest, Block/Fold/Limit |
| Random | Chance/Choices/Interval, Random or Alt, Add/Sub/Bi, scale-aware |
| Scale | 13×13 remap matrix, user scales, fold, range |
| Velocity | Velocity curve grid, Clip/Gate/Fixed, Random, Drive, Compand, note-off velocity |
| MIDI Effect Rack | parallel MIDI chains + macros |
| M4L MIDI (all editions): MIDI Monitor, MPE Control, Expression Control, Rotating Rhythm Generator; Std+: Note Echo, Envelope MIDI, Shaper MIDI; Suite: Melodic Steps (+ Expressive Chords pack, Bouncy Notes etc. via packs) | |

**MIDI Tools** (clip-editor generators/transformations, Std/Suite): Quantize (all), Arpeggiate, Span, Connect, Ornament, Recombine, Strum, Stacks, Rhythm, Seed, Shape, Time Warp, Euclidean Generator, Velocity Shaper, + Chop, Glissando (MPE), LFO (MPE) from 12.1. [S17][S25]

### 5.4 Instruments [S5][S17]
| Device | Ed. | One line |
|---|---|---|
| Drift | all | 2-osc analogue-style subtractive synth with cycling envelope, MPE, waveform display |
| Simpler | all | Sampler with warping; Classic/One-Shot/Slice; expanded waveform |
| Drum Sampler | all | One-shot sampler for Drum Racks with AHD, filter, X/Y playback FX |
| Impulse | all | 8-slot drum sampler with per-slot filter/pitch/stretch |
| Drum Rack / Instrument Rack | all | Pad-mapped chains / parallel instrument chains with macros |
| CV Instrument / CV Triggers | all | Drive CV hardware |
| Analog | Std+ | Virtual analogue (AAS), 2 osc, 2 filters, 2 amps, 2 LFOs, MPE |
| Collision | Std+ | Mallet/noise → dual physical resonators |
| Electric | Std+ | Physically modelled electric piano |
| Tension | Std+ | Physically modelled strings (bow/pick/hammer, damper, body) |
| Drum Synths (DS Kick/Snare/HH/Clap/Tom/Cymbal/Clang/FM) | Std+ | M4L drum voices |
| Operator | Suite | 4-op FM/additive with partial editor, 11 algorithms, filter |
| Wavetable | Suite | 2 wavetable oscs + sub, 2 filters, 3 envs, 2 LFOs, matrix, MPE |
| Meld | Suite | Bi-timbral macro-oscillator synth (24 osc types incl. 6 scale-aware, Chord), 17 filter types, matrix, MPE |
| Sampler | Suite | Multisampler with zones, 3 LFOs, aux env, morphing filter |
| Granulator III | Suite | Robert Henke granular synth, Classic/Looping/Cloud, MPE, capture |
| Bass, Poli | Suite | M4L analogue-style bass/poly synths |

---

## 6. Hooks for the Beacon / Apollo gap analysis (what to diff)

1. **Modulation model**: Live's split of *absolute* automation (red) vs *relative* modulation (blue) drawn on the same knob (ring segment / fader dot), plus Mod-vs-Remote on modulators so the user keeps the knob. Apollo's mod matrix maps to Wavetable/Meld's "click a knob → it appears as a matrix row" pattern.
2. **Macro layer**: 16 macros, Map mode overlay, Mapping Browser Min/Max + invert, mapped knob greys out, Rand + Variations snapshots — a compact spec for a Beacon rack/macro system.
3. **OTT**: a 3-band up/down compressor with the block-drag UI (edges = threshold, middle = ratio, Cmd = all bands) and the numbers in §2.3 give an exact preset to reproduce.
4. **Visual grammar**: spectrum-behind-curve (EQ Eight/Auto Filter/Saturator/Erosion), transfer-curve + activity history (Compressor/Gate), needle + LED (Glue), dry-yellow/wet-blue spectrograms (Spectral devices), drag-the-curve = change Amount (Roar), linear/polar wavetable, scope of summed oscillators (Drift) — the Apollo oscilloscope/spectrum already covers the last two.
5. **Knob grammar**: Shift = fine, Delete/double-click = reset, type-in with Enter/Esc, arrow nudge, Q hot-swap, P A/B.
6. **Title bar**: on/off, breakout arrow, sidechain header, scale-aware toggle, hot-swap, save, options button, A/B state, lock icon.

---

## Sources

- [S1] Ableton — Live 12 Release Notes (12.0 → 12.4.5): https://www.ableton.com/en/release-notes/live-12/
- [S2] Ableton manual 12 — Clip Envelopes: https://www.ableton.com/en/live-manual/12/clip-envelopes/
- [S3] Ableton manual 12 — Live Audio Effect Reference: https://www.ableton.com/en/live-manual/12/live-audio-effect-reference/
- [S4] Ableton manual 12 — Max for Live Devices (LFO, Shaper, Envelope Follower, Envelope MIDI, Shaper MIDI, Expression Control, MPE Control, Note Echo, MIDI Monitor, Align Delay, Drum Synths): https://www.ableton.com/en/live-manual/12/max-for-live-devices/
- [S5] Ableton manual 12 — Live Instrument Reference: https://www.ableton.com/en/live-manual/12/live-instrument-reference/
- [S6] Ableton manual 12 — Instrument, Drum and Effect Racks: https://www.ableton.com/en/live-manual/12/instrument-drum-and-effect-racks/
- [S7] Ableton manual 12 — MIDI and Key Remote Control: https://www.ableton.com/en/live-manual/12/midi-and-key-remote-control/
- [S8] Ableton manual 12 — Automation and Editing Envelopes: https://www.ableton.com/en/live-manual/12/automation-and-editing-envelopes/
- [S9] Ableton manual 12 — Working with Instruments and Effects (Device View, title bar, A/B, presets, plug-ins): https://www.ableton.com/en/live-manual/12/working-with-instruments-and-effects/
- [S10] Ableton — What's new in Live 12 / All new features: https://www.ableton.com/en/live/all-new-features/
- [S11] Ableton blog — Live 12.2 is Out Now: https://www.ableton.com/en/blog/live-12-2-is-out-now/
- [S12] CDM — Live 12.2 hands-on guide: https://cdm.link/live-12-2-hands-on-guide/
- [S13] Ableton blog — Live 12.3 is here: https://www.ableton.com/en/blog/live-12-3-is-here/
- [S14] RouteNote — Ableton Live 12.3 update: https://routenote.com/blog/ableton-live-12-3-update/
- [S15] Synth Anatomy — Ableton Live 12.4 overview (Link Audio, Erosion, Chorus-Ensemble, Delay, Learn View): https://synthanatomy.com/2026/04/ableton-live-12-stay-creative-and-in-focus-an-overview-of-the-new-features.html
- [S16] Ableton blog — Live 12.1 is Out Now: https://www.ableton.com/en/blog/live-121-is-out-now/
- [S17] Ableton — Compare Live editions (device counts and per-edition lists): https://www.ableton.com/en/live/compare-editions/
- [S18] Push Patterns — Map modulation devices directly on Push 3 (Live 12.4): https://www.pushpatterns.com/blog/how-to-map-modulation-devices-directly-on-the-ableton-push-3
- [S19] Ableton manual 12 — Editing MPE (Note Expression tab): https://www.ableton.com/en/live-manual/12/editing-mpe/
- [S20] Sound On Sound — Pushing The Envelope (envelope followers in Live): https://www.soundonsound.com/techniques/pushing-envelope
- [S21] Sound On Sound — Ableton Live 12: Roar: https://www.soundonsound.com/techniques/ableton-live-12-roar
- [S22] MusicRadar — The ultimate guide to Roar: https://www.musicradar.com/news/ultimate-guide-to-ableton-live-12-roar
- [S23] MusicRadar — The ultimate guide to Meld: https://www.musicradar.com/news/ableton-live-12-ultimate-guide-to-meld
- [S24] Sonic Bloom — Ableton Live 12 Announced: New Devices & Features in Depth: https://sonicbloom.net/ableton-live-12-announced-new-devices-features-depth/
- [S25] MusicRadar — Ableton Live 12.1: 5 things you should know: https://www.musicradar.com/news/ableton-live-12.1-5-things
- [S26] Sound On Sound — Live 12: What's New in v12.1: https://www.soundonsound.com/techniques/live-12-whats-new-v121
- [S27] Synthtopia — Ableton Live 12.1 now available: https://www.synthtopia.com/content/2024/10/08/ableton-live-12-1-now-available-heres-whats-new/
- [S28] Ableton blog — Meld: A Look at Live 12's New Bi-Timbral Synth: https://www.ableton.com/en/blog/meld-a-look-at-live-12s-new-bi-timbral-synth/
- [S29] Sound On Sound — Ableton Live Drift Synthesizer: https://www.soundonsound.com/techniques/ableton-live-drift-synthesizer
- [S30] Sound On Sound — Ableton Live 12: Granulator III: https://www.soundonsound.com/techniques/ableton-live-12-granulator-iii
- [S31] Ableton Help — Working with Automation and Modulation (blocked by Cloudflare on fetch; snippet via search): https://help.ableton.com/hc/en-us/articles/209070629-Working-with-Automation-and-Modulation
- [S32] Ableton blog — Roar: Meet Live 12's New Processing Powerhouse: https://www.ableton.com/en/blog/roar-meet-live-12s-new-processing-powerhouse/
- [S33] MusicRadar — How to use Granulator III: https://www.musicradar.com/how-to/granulator-iii-ableton-live-12
- [S34] MusicRadar — What is OTT compression and how do you use it: https://www.musicradar.com/music-tech/plugins/its-loud-in-your-face-and-got-more-punch-than-a-kangaroo-at-boxing-practice-what-is-ott-compression-and-how-do-you-use-it
- [S35] EDMProd — OTT Plugin: Why Does It Sound SO Good?: https://www.edmprod.com/ott-plugin/
- [S36] SampleFocus — OTT Compression Guide: https://samplefocus.com/blog/ott-compression-guide-what-it-is-and-how-to-use-multiband-compression/
- [S37] Production Music Live — Explained: OTT Compressor: https://www.productionmusiclive.com/blogs/news/explained-ott-compressor
- [S38] Sound On Sound — Multiband Dynamics Plug-in (Ableton): https://www.soundonsound.com/techniques/multiband-dynamics-plug
- [S39] Factory OTT preset (gzipped XML, decompressed and parsed): https://github.com/Miserlou/ableton-backup/blob/master/Presets/Audio%20Effects/Multiband%20Dynamics/OTT-1.adv
- [S40] Ableton Forum — Help a newbie: OTT Multiband compression secrets (via search snippets): https://forum.ableton.com/viewtopic.php?t=222202
- [S41] ModeAudio — 5 Neat Tricks for Ableton Live's EQ Eight: https://modeaudio.com/magazine/5-neat-tricks-for-ableton-lives-eq-eight
- [S42] Production Music Live — EQ Eight: What It Is & How To Use It (via search): https://www.productionmusiclive.com/blogs/news/eq-eight-what-it-is-how-to-use-it
- [S43] Ableton manual 12 — Live MIDI Effect Reference: https://www.ableton.com/en/live-manual/12/live-midi-effect-reference/
- [S44] Ableton manual 12 — Mixing (meters, mixer features): https://www.ableton.com/en/live-manual/12/mixing/
- [S45] Ableton manual 12 — Live Keyboard Shortcuts (§41.4 Devices, §41.6 Adjusting Values): https://www.ableton.com/en/live-manual/12/live-keyboard-shortcuts/
- [S46] Sonic Bloom — Quick Tips: Reset Parameters: https://sonicbloom.net/ableton-live-9-quick-tips-reset-parameters/
- [S47] Product London — OTT in Ableton: https://www.productlondon.com/ott-ableton/
- [S48] Ableton blog — Live 12.3 is coming (stem separation): https://www.ableton.com/en/blog/live-12-3-is-coming/
- [S49] Sonic Bloom — All New Shortcuts in Ableton Live 12 (Part 1): https://sonicbloom.net/all-new-shortcuts-ableton-live-12-1/
- [S50] Subaqueous Music — Exploring Live 12's Roar: https://www.subaqueousmusic.com/unleashing-the-beast-exploring-ableton-live-12s-roar-audio-effect/

Fetch notes: reddit.com and help.ableton.com refuse automated fetches (Cloudflare); r/ableton content is represented only through search snippets (the automation/modulation colour explanation) and the Ableton forum thread. YouTube pages return no description text to the fetcher, so "OTT explained"-style videos are represented by their written companions above (Ableton's Side Brain Meld tutorial page, EDMProd, Production Music Live, MusicRadar).
