# Ableton Live 12.x — first-hand video observations (watched 2026-09-04)

Watched with `scripts/watch-video.mjs` (scene frames + captions) into
`~/video-watch/<id>/`. Every claim below was read off a frame or a caption
line; timestamps are the video's. These are the UI details Brae named —
pencil mode, the wave visual along the bottom, UI size, OTT, knobs, the
"condensed" screen — as they actually appear.

## Corpus

| id | title | channel | length |
|---|---|---|---|
| mML8ln4mRcc | What's new in Ableton Live 12.3? Feature Overview | Ableton | 7:07 |
| xBk_GVgfm1Y | What's new in Ableton Live 12.4? Feature Overview | Ableton | 6:27 |
| K2LdpamvXJ0 | Live Tips: Stacked Detail View, Mixer in Arrangement, Freeze and Flatten | Ableton | 0:47 |
| eFZJ3_EF8Q8 | Explore Ableton Live 12 — NEW LOOK & Interface | Kermode | 3:51 |
| 7aCvabHaCUU | Creating with Ableton Live 12.2's New Features | Seed To Stage | 17:10 |
| 8M-3uUYJ1Ok | Ableton Live 12 Beginner Tutorial — Interface and Navigation | Ableton Tips by PML | 19:54 |
| lbSg0RHvLx8 | How To Use OTT Multiband Compressor In Ableton Live | ArrangeWAV | 1:19 |

Earlier corpora (already distilled in research/beacon-*.md): Bound to
Divide's 8h38m Live 12 course (dt9SFEFe8ho), Felix Raphael's session-view
performance (EidG8BobNS4).

## 1. The screen: what is on it and how it is condensed

**Control bar, left → right** (K2 f00002, PML 4:09–4:58, 12.4 f00015):
Link · Tap · BPM (drag or type) · metronome (two dots) with a dropdown for
count-in and sound · time signature · launch quantization ("1 Bar") ·
**Key & Scale chooser sits in the bar** ("C Major", greyed when off) ·
arrangement position (bars.beats.16ths) · play / stop / record ·
MIDI arrangement overdub · automation arm · re-enable automation ·
Capture MIDI · session record · loop brace start/length + punch in/out ·
then on the right: **Draw mode pencil** (B) · Key map · MIDI map ·
sample-rate readout you can click to change ("48.0 kHz") · **CPU load %**
· MIDI in/out dots · a hamburger for the right sidebar (Learn/Help).
The bar is one row, ~24 px tall, almost all icons — that is the
"condensed" feeling. Values are text fields you drag vertically or type into.

**Three-stack layout** (K2 f00002 — the whole point of Live 12's
"stacked detail view"): Arrangement on top (with the track headers
column on the right), the **Clip View in the middle**, the **Device View
along the bottom**, all visible at once. The clip view's left column is
the clip's own panel (Start/End/Loop/Position/Length/Signature/Groove/
Scale + the Pitch & Time utilities); its right part is the note editor;
tabs "Notes | Envelopes | MPE" sit top-right of the clip view. The device
view is a horizontal chain of device panels — Analog (with two envelope
displays and tiny knobs), Delay (with a filter-curve display), a Max
device, Echo — each ~250 px wide, ~150 px tall. Brae's "more buttons,
more condensed" is literally this: three editors of ~150–250 px height
stacked, each dense.

**Track headers on the right of the arrangement** (K2 f00005): colour
block with name, input chooser ("All Ins", "All Channels"), monitor
(In/Auto/Off), track activator number, S, record arm, a numeric volume
field, pan "C", and a **vertical level meter** per track with a coloured
segment. The mixer's "Volume/Pan/In-Out/Sends" sections are what show
here, toggled from the bottom-right selectors.

**Mixer in Arrangement** (K2 f00005, Kermode 0:20): a horizontal mixer
strip under the arrangement — every track gets a Session-style strip:
name header, Audio/MIDI From + input, Monitor In/Auto/Off, Audio To/Main,
numbered activator, S, pan dial, fader with meter, arm; Main strip with
Cue Out / Main Out choosers. Kermode: "you can see the colours of the
individual tracks at the bottoms… more clarity in the meters with both the
colour and the new arrow to more easily see where things are volume-wise."

**Bottom-right show/hide selectors for the mixer** (Kermode f00004): a
menu with In/Out (⌥⌘I), Sends (⌥⌘S), Volume, Track Options, Crossfader,
Performance Impact, Return Tracks (⌥⌘R). Each is a toggle; the mixer
strip grows or shrinks accordingly.

**Bottom strip** (K2 f00002 bottom line): the **status/info line** shows
the current selection — "Time Selection Start 1.1.1 End 8.4.3 Length
7.3.2" — and the Info View (bottom-left) describes whatever is under the
mouse (Kermode f00019: "Waveform Vertical Zoom Level — Sets the vertical
zoom level for all audio waveforms. Use the Ctrl-click option…").

## 2. The wave visual along the bottom

What Brae sees as "wave visuals on the bottom of the screen" is the
**Clip View for an audio clip** (Kermode f00004/f00019): a full-width
waveform of the selected clip with the sample's name/rate/bit depth in
its title, a Sample tab and an Envelopes tab, warp controls on the left
(Warp on/off, Follow, warp mode "Beats", Preserve "Transients", BPM with
÷2 ×2, Loop, Start/End, Position/Length, Signature, Groove), then Gain
(dB fader), Pitch (semitone dial + cents), Reverse, Edit, RAM, HiQ. The
waveform shows warp markers and transient markers along its top ruler,
and the loop brace above it.

Second element: the **arrangement overview strip** at the very top of the
arrangement (a miniature of the whole song, with a zoom box you drag).

Third element: the **waveform vertical zoom** control at the bottom-right
of the arrangement (Kermode 2:10 — "shrink and expand the waveform… this
isn't changing the volume… you can toggle that on and off"), next to
**H** and **W** buttons: "optimise the height of all the tracks and
optimise the width… H and W are hotkeys". And a per-track fold arrow.

## 3. Pencil / Draw mode, as tutorials teach it

PML 10:25–11:13: "if you don't like double clicking every time… enter the
draw mode… pressing this button or the B key… your mouse turns into a
pencil… whenever you click it adds a note instantly, click again removes
it." Grid size is chosen by right-click → grid (16ths, quarters, 1 bar):
"whatever length you choose is the note you get". Then "the scale
button… you are only getting the notes from that scale… a really nice
safe mode for experimentation" — drawing in scale mode cannot go out of
key. Live 12 manual (fetched): Draw Mode has Pitch Lock (Display & Input
setting, or hold Alt) so a drag stays on one key track; dragging in the
velocity/chance lanes draws values; Alt-drag draws straight lines.

## 4. Browser (Kermode f00008, PML 0:54)

Left rail: Collections (Favorites + colour labels Orange/Yellow/Green/
Blue/UAD/Gray), Library (All, Sounds, Drums, Instruments, Audio Effects,
MIDI Effects, **Modulators**, Max for Live, Plug-Ins, Clips, Samples,
Grooves, **Tunings**, Templates), Places (Packs, Cloud, Push, user
folders). A **Filters** panel at the top of the results: Content (Clip,
Device, Groove, Image, MIDI, Preset, Sample, Set, Tuning, Video), Type,
Sounds, Drums, **Character** chips (Acoustic, Analog, Arpeggiated, Basic,
Bright, Chopped, Chord, Cinematic, Clean, Dark, Digital, Distorted,
Evolving, Inharmonic, Lofi & Vinyl, Modulated, Percussive, Punchy,
Rhythmic). Results rows show a **key label** ("4A", "12A" — Camelot) and
a preview waveform strip at the bottom with a headphones preview toggle
and a Raw switch. "Show similar files" (neural similarity) and search
history back/forward. Kermode 1:45: an arrow next to the browser toggle
shows/hides **Tuning** and **Groove Pool** panels (Groove Pool columns:
Groove Name, Base, Quantize, Timing, Random, Velocity; Global Amount).

## 5. Devices: knobs, displays, OTT (12.4 f00021, 12.2 video, OTT video)

- Device panels have a title bar (on/off toggle, name, hot-swap, save,
  fold), then a display region, then a row of **small round knobs with
  the value printed under each** (Drive 5.0 dB, Output -2.0 dB, Dry/Wet
  100%). Knobs are ~28 px. Every value is also a text field.
- **Displays**: Saturator shows the waveshaper curve with a shaded
  drive region and a Soft Clip toggle; **Erosion (12.4) got a real-time
  spectrum with a draggable node** for frequency/width; Limiter shows
  Ceiling/GR bar meters; Compressor/Glue show gain reduction; EQ Eight
  shows the spectrum behind the curve; Auto Filter (12.2) shows the
  response and got Comb, Notch+LP, Resampling, Dispersion modes, a
  two-page LFO/Envelope with **envelope sidechain from another track**.
- **A/B compare (12.3)**: every device has a Compare switch (Shift+P)
  that toggles between two saved states.
- **Modulation matrix & sidechain tab (12.2)**: Roar and Meld gained a
  sidechain/"matrix" tab: an incoming envelope (from a chosen track, with
  gain and mix) can be mapped to any parameter; Roar's feedback can be
  driven by MIDI notes from another track.
- **OTT** (ArrangeWAV): "audio effects → dynamics → multiband dynamics →
  OTT preset"; the whole tutorial is *pull the Amount/mix to ~30%*. Xfer
  OTT's controls are Depth, Time, In gain, Out gain and three band
  faders; Live's version is the Multiband Dynamics device with the OTT
  preset — three bands, each with above/below thresholds and ratios, a
  Time scaler and the global Amount. The teaching is: OTT = upward +
  downward compression per band, default is far too much, 20–40% is the
  musical range, use it on vocal/string/guitar groups.
- **Expressive Chords (12.2)**: a device that holds a chord bank and
  plays chords from single notes with Tilt (velocity weighting low↔high),
  Invert, Strum with an editable articulation order, and per-parameter
  randomisation ("almost as if a human is playing this").
- **Bounce to New Track / Bounce in place (12.2), Bounce Group (12.3),
  Paste Bounced Audio (12.3)**: right-click a selection → printed audio
  on a new track, original disabled; tutorials use it to "fire off a
  bunch of edits" of one feedback patch and blend them.
- **Auto Pan → Auto Pan-Tremolo (12.3)** with sync modes 16th/triplet/
  dotted and an attack shape. **Delay (12.4)** got LFO beat-sync, a
  waveform selector and a morph control. **Chorus-Ensemble (12.4)** got
  Time and Taps.
- **Stem separation (12.3, local)** into vocals/drums/bass/other, placed
  in a new group with the original muted; 12.4 added merge.
- **Splice in the browser (12.3)** with "search with sound" matching the
  harmony and rhythm of a selected clip.
- **Learn View (12.4)** replaces Help View: a right sidebar with lessons,
  an embedded video (pop-out picture-in-picture), text and a "Complete
  Lesson" button — the first lesson is literally "Display & Audio
  Interface: adjust the Zoom Level until the interface is comfortable…
  select different Themes and Color Settings."

## 6. Piano roll, as beginners are taught it (PML 8:20–14:40, sheet003)

Insert empty MIDI clip on a selection; the clip view opens at the bottom
and "you can make this bigger or smaller". Zoom by dragging in the ruler
(magnifier), scroll the piano ruler, stretch key height by dragging the
ruler sideways; C3 is the middle. Double-click adds a grid-length note;
grid from the right-click menu; B for draw. **Scale mode** confines
drawing to the key. **Add Interval** with the scale on builds triads
from bass notes ("drag this up and add two scale degrees"). Shift+↓
drops a note an octave (inversions). Velocity lane opened by dragging up
from the bottom; click notes to set velocity; **Randomize velocity with
an amount slider** for humanising; the headphone **preview** toggle
plays notes as you place them. Red in the meter = clipping → lower the
track fader. Devices at the bottom show macros (Upright Piano: Reverb
level/time) — "customise built-in instruments with such macros".
Dropping a sample on a MIDI track makes a **Simpler**; Z/X shift the
computer-keyboard octave; release length vs note length.

## 7. Recurring UI grammar worth copying

- Values are draggable text: drag vertically to change, click to type.
- Every panel is collapsible and remembers its height; the detail area
  is resizable by dragging its top edge; Shift+Tab flips Clip↔Device.
- Colour is the navigation system: track colour on headers, clips, the
  mixer strip footers and the arrangement overview.
- One-key toggles for editing modes (B draw, F fold, K scale highlight,
  G fold-to-scale, N focus, Z/X zoom, H/W optimise, Tab views).
- Hover = Info View text at bottom-left for every control.
- Track activators are numbered buttons; mute is the absence of the
  number's light, so a muted track is obvious at a glance.
