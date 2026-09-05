'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle, Search, X, Lock } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import { useUITierOptional } from '../UITierProvider'
import { type UITier, ELEMENT_MIN_TIER, TIER_RANK, TIER_INFO, tierAtLeast } from '@/lib/ui-tiers'
import { shortcutGroups, resolveKey } from '@/lib/keymap'

// ── Feature highlight ──────────────────────────────────────────────────────────
// Buttons across the editor carry data-help-id attributes. Clicking a feature in
// the help panel finds those elements and runs a 7s fading glow on them.

const GLOW_MS = 7000

export function highlightHelpTargets(ids: string[]): boolean {
  if (typeof document === 'undefined') return false
  const els = ids.flatMap(id =>
    Array.from(document.querySelectorAll<HTMLElement>(`[data-help-id="${id}"]`))
  )
  if (els.length === 0) return false
  for (const el of els) {
    // Restart the animation if this target is already glowing
    el.classList.remove('daw-help-glow')
    void el.offsetWidth
    el.classList.add('daw-help-glow')
    window.setTimeout(() => el.classList.remove('daw-help-glow'), GLOW_MS + 100)
  }
  els[0].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  return true
}

// ── Data ───────────────────────────────────────────────────────────────────────

type Mode = 'music' | 'podcast'

interface Shortcut { keys: string; action: string }
interface ShortcutGroup { label: string; modes?: Mode[]; items: Shortcut[] }

// ⌘ is swapped for Ctrl at render time on non-Mac platforms.
//
// The KEY rows come from lib/keymap.ts — the table the handlers themselves
// resolve against — so this panel cannot advertise a key nothing listens to
// (it did: `B` for the library, for a long time). The mouse rows have no
// table to come from and are written here.
const GESTURES: Record<string, Shortcut[]> = {
  'Transport & Global': [
    { keys: 'Hold E / L', action: 'While dragging a clip edge — force Expand or Loop for that drag' },
  ],
  'Arrangement — selection & editing': [
    { keys: 'Drag empty space', action: 'Box-select clips (replaces the current selection)' },
    { keys: '⌘ click', action: 'Add / remove a single clip from the selection' },
    { keys: '⇧ click', action: 'Select the range of clips up to here (across tracks)' },
    { keys: '⌘ drag', action: 'Add the box to the current selection' },
    { keys: '⌥ drag clip', action: 'Copy the clip as you drag' },
  ],
  'Arrangement — view & playback': [
    { keys: '⌥ drag', action: 'Bypass snap while dragging' },
  ],
  'Knobs': [
    { keys: 'Right-click', action: 'MIDI-learn a device knob — turn a hardware control to bind it' },
  ],
}
const SHORTCUT_GROUPS: ShortcutGroup[] = shortcutGroups().map(g => ({
  label: g.label,
  modes: g.modes,
  items: [...g.items.map(({ keys, action }) => ({ keys, action })), ...(GESTURES[g.label] ?? [])],
}))

interface Feature {
  name: string
  description: string
  helpIds: string[]        // empty = no persistent button; clicking always shows the hint
  modes?: Mode[]           // undefined = both
  hint?: string            // shown when the target isn't currently on screen
  group: string
}

const ARR_HINT = 'Switch to the Arrangement view to see this control.'
const SESSION_HINT = 'Switch to the Session view to see this control.'
const TRACK_HINT = 'Add a track first — this control sits on each track header in the Arrangement view.'
const CLIP_HINT = 'Right-click a clip in the Arrangement view — this lives in the clip context menu.'
const DEVICE_HINT = 'Select a track with its ⚙ button first — this opens in the bottom panel.'

const FEATURES: Feature[] = [
  // ── Transport ──
  { group: 'Transport', name: 'Play / Stop', helpIds: ['play'],
    description: 'Start and stop playback from the current playhead position. The transport keeps time in beats and bars, and Space toggles it from anywhere in the editor.' },
  { group: 'Transport', name: 'Record', helpIds: ['record'],
    description: 'Opens the record setup box: toggle the monitor to hear yourself, add effects to the take, then start recording into new clips on every armed track. Takes are lossless — 32-bit float WAV at the studio’s sample rate, sample-exact from the first frame — so they punch, quantize and bounce cleanly. Effects land as FX bars under the recording.' },
  { group: 'Transport', name: 'Rewind', helpIds: ['rewind'],
    description: 'Jump the playhead straight back to the start of the project — the quickest way to audition your arrangement from the top right after an edit.' },
  { group: 'Transport', name: 'Loop', helpIds: ['loop'],
    description: 'Repeat the loop region continuously during playback so you can tweak sounds, levels, and effects while the same section plays underneath your changes.' },
  { group: 'Transport', name: 'Jam Capture', helpIds: ['jam'], modes: ['music'],
    description: 'Grab the last 30 seconds of everything you just played from the rolling jam buffer and drop it into the arrangement as a clip — a great take is never lost.' },
  { group: 'Transport', name: 'Tempo & Tap', helpIds: ['bpm'], modes: ['music'],
    description: 'Click the BPM readout to type an exact tempo, or hit TAP along with any song and the project tempo is measured from the timing of your taps.' },
  { group: 'Transport', name: 'Time Signature', helpIds: ['time-sig'], modes: ['music'],
    description: 'Click to edit the project’s time signature — the ruler, snap grid, metronome, and bar numbering all follow the meter you set here.' },
  { group: 'Transport', name: 'Metronome', helpIds: ['metronome'], modes: ['music'],
    description: 'Toggle the click that sounds on every beat while recording or playing, keeping performances locked to the project tempo. Press M to flip it from anywhere.' },
  { group: 'Transport', name: 'Swing', helpIds: ['swing'], modes: ['music'],
    description: 'Push every off-beat note slightly later to give rigid, quantized patterns a looser, more human groove. Drag right for more shuffle, left for straight timing.' },
  { group: 'Transport', name: 'Varispeed', helpIds: ['varispeed'], modes: ['music'],
    description: 'Tape-style speed control from 25% to 200% — pitch rises and falls with playback speed, exactly like slowing down or speeding up a reel-to-reel machine.' },
  { group: 'Transport', name: 'Key & Scale', helpIds: ['key-scale'], modes: ['music'],
    description: 'Set the project’s root note and scale. Instruments, pads, and pitch tools all reference it, so everything you play and program stays in key together.' },
  { group: 'Transport', name: 'Master Volume', helpIds: ['master-volume'],
    description: 'The overall output level for the whole project — everything you hear passes through this final fader before it reaches your speakers or headphones.' },
  { group: 'Transport', name: 'Tuner', helpIds: ['tuner'], modes: ['music'],
    description: 'Open a floating tuner panel to check and adjust the pitch of pads and instruments, so all of your sounds agree on the same reference pitch.' },
  { group: 'Transport', name: 'Record Session', helpIds: ['screen-recorder'], modes: ['music'],
    description: 'Records your screen together with the studio’s own audio, taken straight from the mixer rather than from system sound — so notifications and other tabs never end up in the take. Optionally records your microphone too, for talking over what you’re doing. Preview it and save the video when you stop.' },
  { group: 'Transport', name: 'Masking Detector', helpIds: ['masking'], modes: ['music'],
    description: 'Analyzes your mix and shows which tracks are competing for the same frequency bands, so you can EQ or pan them apart for a cleaner, clearer result.' },

  // ── Views & Layout ──
  { group: 'Views & Layout', name: 'Session View', helpIds: ['view-session'], modes: ['music'],
    description: 'A grid of clips you launch scene by scene — ideal for sketching ideas and live jamming before you commit anything to the arrangement timeline.' },
  { group: 'Views & Layout', name: 'Arrangement View', helpIds: ['view-arrangement'],
    description: 'The timeline where clips are laid out on tracks against beats and bars. This is where you build the full structure of your song or episode.' },
  { group: 'Views & Layout', name: 'Mixer', helpIds: ['view-mixer'],
    description: 'Channel strips for every track with volume faders, pan, mute/solo, and live spectrum meters — the place to balance your entire mix in one view.' },
  { group: 'Views & Layout', name: 'Mixer under the Arrangement', helpIds: ['arrangement-mixer'], modes: ['music'], hint: 'Press ⌘⌥M in the Arrangement, or ⌘K → "Show the mixer under the arrangement".',
    description: 'One row of channel strips beneath the arrangement, so you balance the mix without leaving the clips. The drop-down swaps what the row shows: Mixer, Sends, Returns, In / Out, Track Options, Crossfader (assign tracks to A or B and fade between them), Performance Impact.' },
  { group: 'Views & Layout', name: 'Sound Library', helpIds: ['sound-library'], modes: ['music'],
    description: 'Browse thousands of built-in and imported sounds organized into folders. Drag any sound straight onto a track, and save your own captures back into it.' },
  { group: 'Views & Layout', name: 'Code', helpIds: ['sound-code'], modes: ['music'],
    description: 'Generate a synth (poly) track from a few lines of math — scales, chords, euclidean rhythms, seeded randomness. Or select a clip to load its patch, notes, and clip-only effects (rollFx) as editable code. It runs in a sandbox; the track’s shared effects show read-only underneath with a Mute FX toggle to audition just the code.' },
  { group: 'Views & Layout', name: 'Practice Room', helpIds: ['practice'], modes: ['music'],
    description: 'Guided skill paths completed by doing, not reading — pick a path and the editor checks steps off as your project takes shape, glowing the next control when you ask.' },

  // ── Arrangement Tools ──
  { group: 'Arrangement Tools', name: 'Zoom', helpIds: ['zoom-in', 'zoom-out'], hint: ARR_HINT,
    description: 'Zoom the timeline in for fine, detailed edits or out for a bird’s-eye view of the whole arrangement — your position stays anchored while you zoom.' },
  { group: 'Arrangement Tools', name: 'Overview', helpIds: ['overview'], hint: ARR_HINT,
    description: 'The strip above the ruler is the whole song in miniature — every clip a sliver in its track’s colour, with a box over what is on screen. Drag the box to scroll, drag an edge to zoom, click anywhere to jump there, double-click to fit the song to the window.' },
  { group: 'Arrangement Tools', name: 'Follow', helpIds: ['follow'], hint: ARR_HINT,
    description: 'Keeps the playhead on screen while the song plays — by the page (the view jumps when the playhead runs off the edge) or by scrolling (it glides along). Pauses the moment you scroll or drag so an edit is never pulled out from under you, and resumes when you play again.' },
  { group: 'Arrangement Tools', name: 'Fit Heights', helpIds: ['fit-height'], hint: ARR_HINT,
    description: 'Sizes every track so all of them fit the window at once (⌥H) — the partner to Fit to Window, which does the same for time (F or W).' },
  { group: 'Arrangement Tools', name: 'Waveform Scale', helpIds: ['wf-scale'], hint: ARR_HINT,
    description: 'Waveforms drawn linear (loud is tall) or on a 60 dB scale, where the quiet tail of a note is still visible. Sits beside the waveform zoom.' },
  { group: 'Arrangement Tools', name: 'Fit to Window', helpIds: ['fit-window'], hint: ARR_HINT,
    description: 'Instantly scale the timeline so your entire arrangement fits the visible area — the fastest way to reorient after zooming deep. Also on the F key.' },
  { group: 'Arrangement Tools', name: 'Snap', helpIds: ['snap'], hint: ARR_HINT,
    description: 'Choose the grid clips snap to while dragging: off, 1/16, 1/8, beat, or bar (keys 1–5). Hold ⌥ Option mid-drag to bypass the grid entirely.' },
  { group: 'Arrangement Tools', name: 'Waveform Zoom', helpIds: ['wf-zoom'], hint: ARR_HINT,
    description: 'Vertically magnify the waveforms drawn inside audio clips, making quiet material easier to see and edit — without changing any actual playback levels.' },
  { group: 'Arrangement Tools', name: 'Ripple Edit', helpIds: ['ripple'], hint: ARR_HINT,
    description: 'When enabled, moving or trimming a clip shifts every clip to its right by the same amount, keeping downstream material glued together. Toggle with G.' },
  { group: 'Arrangement Tools', name: 'Split at Transients', helpIds: ['split-transients'], hint: ARR_HINT,
    description: 'Automatically slice the selected audio clip at every detected hit or transient — perfect for chopping a drum break into individually editable pieces.' },
  { group: 'Arrangement Tools', name: 'Spectral Morph', helpIds: ['morph'], hint: 'Select exactly two audio clips in the Arrangement view first.',
    description: 'Blend two selected audio clips into one brand-new sound by interpolating their spectra over time — an experimental sound-design tool for unique textures.' },
  { group: 'Arrangement Tools', name: 'Piano Roll', helpIds: ['piano-roll'], modes: ['music'], hint: 'Select a MIDI clip — its notes open in the clip pane at the bottom (or double-click the clip). Appearance → Display & Input chooses bottom pane or inline.',
    description: 'The MIDI editor: draw, move, and resize notes on a grid, with velocity editing and key/scale highlighting built in. It lives in the clip pane at the bottom of the studio and follows the selected clip — Notes and Envelopes tabs top-right — or, by the Display setting, unfolds inline under the track.' },
  { group: 'Arrangement Tools', name: 'Export', helpIds: ['export'], hint: ARR_HINT,
    description: 'Render your finished project to an audio file — lossless WAV for mastering and distribution, or compact WebM/Opus for quick sharing on the web.' },
  { group: 'Arrangement Tools', name: 'Save Project', helpIds: ['save'], hint: ARR_HINT,
    description: 'Save your work to the cloud so it’s available on any device — also on ⌘S. The button shows progress while saving and confirms once it lands.' },

  // ── Tracks & Mixing ──
  { group: 'Tracks & Mixing', name: 'Add Track', helpIds: ['add-track'], hint: ARR_HINT,
    description: 'Create a new track at the bottom of the arrangement. Tracks hold audio clips, MIDI instruments, or drums, and each gets its own color and controls.' },
  { group: 'Tracks & Mixing', name: 'Create on a Track', helpIds: ['track-lane'], hint: ARR_HINT,
    description: 'Double-click an empty track lane to open a create menu — Upload an audio file, Record from the mic, Browse the library, or Synthesize a sound with code — the quickest way to fill a fresh track at the point you clicked.' },
  { group: 'Tracks & Mixing', name: 'Return Tracks', helpIds: ['add-return'], hint: ARR_HINT,
    description: 'Add a return track to host shared effects like reverb or delay — any track can send signal to it instead of duplicating the same effect everywhere.' },
  { group: 'Tracks & Mixing', name: 'Arm for Recording', helpIds: ['arm'], hint: TRACK_HINT,
    description: 'The ● button on each track header. Armed tracks capture audio from their input when you hit record, and several tracks can record at the same time.' },
  { group: 'Tracks & Mixing', name: 'Track Input', helpIds: ['track-input'], hint: TRACK_HINT,
    description: 'Choose what each track records: your default microphone, a specific input device, or system audio. The label reads ·IN, MIC, or SYS to show the source.' },
  { group: 'Tracks & Mixing', name: 'Mute & Solo', helpIds: ['mute', 'solo'], hint: TRACK_HINT,
    description: 'M silences a track; S isolates it by silencing everything else. Solo several tracks together to audition just one part of the mix in context.' },
  { group: 'Tracks & Mixing', name: 'Track Settings', helpIds: ['track-settings'], hint: TRACK_HINT,
    description: 'The ⚙ button opens the track’s device chain and instrument panel below — right-click the track header for more options like rename, color, and freeze.' },
  { group: 'Tracks & Mixing', name: 'Automation Lanes', helpIds: ['automation'], hint: TRACK_HINT,
    description: 'Add lanes that change parameters over time — volume rides, pan sweeps, filter moves — drawn as editable curves directly beneath the track’s clips.' },
  // The Effects Lane entry is gone with the button that opened it: nothing sets
  // showFx any more, so a help topic pointing at `fx-lane` would highlight an
  // element that never renders — a tour step leading somewhere that does not
  // exist is worse than no step. Track effects are covered by "Device Chain"
  // under Instruments & Effects, and by "Track Settings" above it; if the bar
  // lane comes back, so does this.

  // ── Session View ──
  { group: 'Session View', name: 'Scenes', helpIds: ['add-scene'], modes: ['music'], hint: SESSION_HINT,
    description: 'Rows of clips that launch together as one unit. Trigger a scene to switch your whole jam at once, then add more scenes as the idea grows into a song.' },
  { group: 'Session View', name: 'Capture to Arrangement', helpIds: ['capture-arrangement'], modes: ['music'], hint: SESSION_HINT,
    description: 'Stamps the session clips you launch into the arrangement timeline as you perform, turning a live jam directly into a structured, editable song.' },
  { group: 'Session View', name: 'MIDI Overdub', helpIds: ['midi-overdub'], modes: ['music'], hint: SESSION_HINT,
    description: 'Layer new MIDI notes onto clips while they loop, building up patterns pass by pass without ever stopping playback or losing the groove.' },
  { group: 'Session View', name: 'Stop All Clips', helpIds: ['stop-all'], modes: ['music'], hint: SESSION_HINT,
    description: 'Halt every playing session clip at once and hand playback back to the arrangement timeline — the clean way out of a live jam.' },

  // ── Clips ──
  { group: 'Clips', name: 'Deactivate / Activate', helpIds: [], hint: CLIP_HINT,
    description: 'Park a clip without deleting it: press 0 (or right-click → Deactivate) and it stays in place, dimmed and dashed, skipped by playback and every render until you activate it again. The way to try the arrangement without an idea and still keep the idea.' },
  { group: 'Clips', name: 'Clip Settings', helpIds: [], hint: CLIP_HINT,
    description: 'Gain, pitch, warp mode, fades, boomerang, and more for the selected clip. Warp keeps a clip locked to the project tempo; pitch stays independent of speed.' },
  { group: 'Clips', name: 'Crop', helpIds: [], hint: CLIP_HINT,
    description: 'Trim a clip visually by dragging crop handles over its waveform, keeping only the region you want — non-destructive, so you can always pull it back out.' },
  { group: 'Clips', name: 'Isolate on Playhead', helpIds: [], hint: CLIP_HINT,
    description: 'Audition one slice of a clip in a focused loop to fine-tune exactly what it contains — great for checking a single hit inside a busy phrase.' },
  { group: 'Clips', name: 'Replace Sample', helpIds: [], hint: CLIP_HINT,
    description: 'Swap the audio inside a clip for a different sound while keeping its position, length, warp, and effects — perfect for auditioning drum sounds in context.' },
  { group: 'Clips', name: 'Spectral Editor', helpIds: ['spectral'], hint: 'Select an audio clip first — the ▦ button appears in its quick-actions strip (also in the right-click menu).',
    description: 'View a clip as a time × frequency image and edit the sound itself — select a region and attenuate, boost, or erase just that energy, like removing a cough or hum.' },
  { group: 'Clips', name: 'Boomerang', helpIds: [], hint: 'Right-click a clip → Clip Settings, then toggle Boomerang.',
    description: 'Make a clip play forward then backward in a continuous ping-pong loop — a one-click way to turn any sample into a hypnotic, evolving texture.' },

  // ── Instruments & Effects ──
  { group: 'Instruments & Effects', name: 'Device Chain', helpIds: ['add-device'], hint: DEVICE_HINT,
    description: 'Stack effects and processors on a track in series — EQ, compression, delay, and more — then reorder, bypass, or remove devices as the sound develops.' },
  { group: 'Instruments & Effects', name: 'Instrument Picker', helpIds: ['bottom-instrument'], modes: ['music'], hint: DEVICE_HINT,
    description: 'Choose the synth, drum kit, or sampler a MIDI track plays, and browse through presets with instant middle-C preview before you commit to one.' },
  { group: 'Instruments & Effects', name: 'Pads & Keyboard', helpIds: ['pads'], modes: ['music'], hint: 'Pick an instrument for the selected track first — the ⌨ Pads button appears in the bottom panel’s tab bar.',
    description: 'Play instruments live from clickable pads, your computer keyboard, or a plugged-in MIDI keyboard. Instrument notes record as editable MIDI; sample pads bounce audio.' },
  { group: 'Instruments & Effects', name: 'Capture MIDI', helpIds: [], modes: ['music'], hint: 'Open the Pad Input window — CAPTURE sits next to the REC button.',
    description: 'Everything you play while the transport runs is remembered for 30 seconds, even when not recording. One click on CAPTURE turns that great unrecorded take into a MIDI clip.' },
  { group: 'Tracks & Mixing', name: 'Delay Compensation', helpIds: ['delay-compensation'], modes: ['music'], hint: 'Open More in the transport bar — PDC is the toggle there. A track with latency shows a Δ chip in its device chain.',
    description: 'Some devices hold the signal — a plug-in hosted out of process, a lookahead. Delay compensation finds the slowest track and delays every other one by the difference, so they all arrive together. Turn it off while recording live through a slow device.' },
  { group: 'Views & Layout', name: 'Info View & Status Bar', helpIds: ['status-bar'], hint: 'The bar along the very bottom of the studio. ⌘⌥I shows and hides it.',
    description: 'Point at anything and the Info View, bottom left, says what it does — the same words as this help. A clip or track can carry your own note (right-click → Edit Info Text…), shown there whenever the pointer is over it. Bottom right, the status readout: the selection’s start, end and length in bars.beats and in clock time, or the playhead when nothing is selected.' },
  { group: 'Views & Layout', name: 'Detail Area', helpIds: ['detail-toggles'], hint: 'Select a clip or a track — the detail area opens along the bottom of the studio.',
    description: 'The bottom of the screen, two panes tall: the clip pane (what the selected clip is — its name, where it sits, its length, loop and on/off) above the device pane (the selected track’s effects and instrument). Show or hide each with the toggles at the bottom right, ⌘⌥3 and ⌘⌥4; ⇧Tab flips keyboard focus between them; ⌘⌥E stretches the area to full size.' },
  { group: 'Instruments & Effects', name: 'LFO Modulation', helpIds: [], modes: ['music'], hint: 'Select a track, then ⌘K → "Add an LFO" — or say "put an LFO on the pad filter", "tremolo the keys at 4 Hz", "take the LFO off".',
    description: 'An LFO on a track keeps a parameter moving — a wobble on the filter cutoff, a tremolo on the volume, an auto-pan, reverb that breathes — in time with the song (every eighth, once a bar) or at a rate in hertz. Automation is a shape drawn once; modulation repeats. It rides on top of automation and steps aside when removed.' },
  { group: 'Instruments & Effects', name: 'Knobs by Keyboard', helpIds: [], hint: 'Click or Tab to any knob — mixer pan, EQ, sends, device parameters — then use the arrow keys, or press Enter and type the number.',
    description: 'Every knob is a slider to the keyboard and to a screen reader: arrows nudge it (Shift for fine, Page keys for coarse), Delete resets it, Enter opens a typed entry that understands units — "800", "1.2k", "-6dB", "50%", "L30".' },

  // ── Collaboration ──
  { group: 'Collaboration', name: 'Invite Collaborators', helpIds: ['invite'], hint: 'Open a saved project — the invite button lives in the collaboration bar at the top.',
    description: 'Share a link that lets others join your project and edit with you in real time, with live presence showing what everyone is currently working on.' },

  // ── Podcast ──
  { group: 'Podcast', name: 'Rec All Voice', helpIds: ['rec-all-voice'], modes: ['podcast'],
    description: 'Arm or disarm every voice track in a single click so the host and all guests are ready to capture the moment you hit record.' },
  { group: 'Podcast', name: 'Add Guest', helpIds: ['add-guest'], modes: ['podcast'], hint: 'Open the left sidebar — the + Guest button sits at the top of the panel.',
    description: 'Create a new guest track with the voice processing chain already applied, so each additional speaker sounds polished from their very first take.' },
  { group: 'Podcast', name: 'Setup Panel', helpIds: ['rail-setup'], modes: ['podcast'],
    description: 'Pick a microphone for each voice track, watch live input meters as people speak, and check your mic permissions before the show starts.' },
  { group: 'Podcast', name: 'Episode Info', helpIds: ['rail-episode'], modes: ['podcast'],
    description: 'Fill in the show name, episode title, number, season, description, and guest list — the metadata that travels with your published episode.' },
  { group: 'Podcast', name: 'Remote Guests', helpIds: ['rail-guests'], modes: ['podcast'],
    description: 'Invite remote guests to record in their own browser, then pull their high-quality local recordings straight into your timeline, perfectly aligned.' },
  { group: 'Podcast', name: 'Chapter Marker', helpIds: ['chapter'], modes: ['podcast'], hint: ARR_HINT,
    description: 'Drop a named chapter marker at the playhead — or double-click the ruler — so listeners can skip straight to segments in podcast apps that support chapters.' },
  { group: 'Podcast', name: 'Publish', helpIds: ['publish'], modes: ['podcast'], hint: ARR_HINT,
    description: 'Publish the finished episode to your podcast RSS feed so subscribers get it automatically in whichever podcast app they use.' },
]

// ── Component ──────────────────────────────────────────────────────────────────

/** Name + description for a data-help-id — powers Inspect mode's hover cards. */
export function helpInfoFor(helpId: string): { name: string; description: string } | null {
  for (const f of FEATURES) {
    if (f.helpIds.includes(helpId)) return { name: f.name, description: f.description }
  }
  return null
}

/** Lowest UI tier that shows this feature — the highest requirement of its
 *  help ids (a feature is only available once every control it points at is). */
function featureMinTier(f: Feature): UITier {
  let min: UITier = 'beginner'
  for (const id of f.helpIds) {
    const req = ELEMENT_MIN_TIER[id]
    if (req && TIER_RANK[req] > TIER_RANK[min]) min = req
  }
  return min
}

export default function HelpButton() {
  const { audioMode } = useDaw()
  const uiTier = useUITierOptional()
  const currentTier: UITier = uiTier?.tier ?? 'full'
  const mode: Mode = audioMode === 'podcast' ? 'podcast' : 'music'
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'shortcuts' | 'features'>('shortcuts')
  const [hintFor, setHintFor] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Only rendered inside the modal, which opens post-hydration — no SSR mismatch
  const [isMac] = useState(() => typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac'))

  // Inject glow keyframes once per page: two attention blinks, then a slow fade
  useEffect(() => {
    const id = 'daw-help-styles'
    if (typeof document === 'undefined' || document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
@keyframes dawHelpGlow {
  0%   { box-shadow: 0 0 0 3px rgba(250,204,21,0.95), 0 0 18px 5px rgba(250,204,21,0.55); }
  5%   { box-shadow: 0 0 0 1px rgba(250,204,21,0.45), 0 0 6px 2px rgba(250,204,21,0.25); }
  10%  { box-shadow: 0 0 0 3px rgba(250,204,21,0.95), 0 0 18px 5px rgba(250,204,21,0.55); }
  15%  { box-shadow: 0 0 0 1px rgba(250,204,21,0.45), 0 0 6px 2px rgba(250,204,21,0.25); }
  20%  { box-shadow: 0 0 0 3px rgba(250,204,21,0.9), 0 0 16px 5px rgba(250,204,21,0.5); }
  100% { box-shadow: 0 0 0 3px rgba(250,204,21,0), 0 0 4px 1px rgba(250,204,21,0); }
}
.daw-help-glow { animation: dawHelpGlow ${GLOW_MS}ms ease-out both; border-radius: 4px; }
`
    document.head.appendChild(style)
  }, [])

  // Glow the help button itself when the editor opens so users learn where it is
  useEffect(() => {
    const t = window.setTimeout(() => highlightHelpTargets(['help']), 600)
    return () => window.clearTimeout(t)
  }, [])

  // H or ? opens the help menu from anywhere (outside text fields)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      // Something else already consumed this key (e.g. the pad window playing notes)
      if (e.defaultPrevented) return
      // Pad window active → every key is potential performance input
      if (document.body.dataset.padInputActive === '1') return
      if (resolveKey(e, ['global'])?.id === 'help.open') {
        e.preventDefault()
        setQuery('')
        setOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        // First Esc clears an active search; second closes the modal
        if (query) setQuery('')
        else setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, query])

  function renderKeys(keys: string) {
    return isMac ? keys : keys.replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt ').replace(/⇧/g, 'Shift ')
  }

  function handleFeatureClick(f: Feature) {
    // A tier-hidden control is still in the DOM (display:none), so highlighting
    // would "succeed" on an invisible element. Show the tier hint instead.
    if (!tierAtLeast(currentTier, featureMinTier(f))) {
      setHintFor(f.name)
      return
    }
    const found = highlightHelpTargets(f.helpIds)
    if (found) {
      setHintFor(null)
      setOpen(false)  // close so the glowing button is visible
    } else {
      setHintFor(f.name)
    }
  }

  const q = query.trim().toLowerCase()
  const matches = (...texts: string[]) => !q || texts.some(t => t.toLowerCase().includes(q))

  const visibleGroups = SHORTCUT_GROUPS
    .filter(g => !g.modes || g.modes.includes(mode))
    .map(g => ({ ...g, items: g.items.filter(sc => matches(sc.keys, renderKeys(sc.keys), sc.action)) }))
    .filter(g => g.items.length > 0)
  const visibleFeatures = FEATURES
    .filter(f => !f.modes || f.modes.includes(mode))
    .filter(f => matches(f.name, f.description, f.group))
  // Preserve registry order while bucketing by group
  const featureGroups: [string, Feature[]][] = []
  for (const f of visibleFeatures) {
    const bucket = featureGroups.find(([g]) => g === f.group)
    if (bucket) bucket[1].push(f)
    else featureGroups.push([f.group, [f]])
  }

  const tabBtn = (t: 'shortcuts' | 'features', label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        background: tab === t ? 'var(--bg-card)' : 'transparent',
        border: tab === t ? '1px solid var(--border)' : '1px solid transparent',
        borderRadius: 4,
        color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
        cursor: 'pointer', fontSize: 12, padding: '3px 12px', fontWeight: 600,
      }}
    >{label}</button>
  )

  return (
    <>
      <button
        onClick={() => { setQuery(''); setOpen(v => !v) }}
        title="Help — shortcuts & features"
        data-help-id="help"
        style={{
          width: 24, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer',
          background: open ? 'rgb(var(--accent-rgb) / 0.12)' : 'transparent',
          color: open ? 'var(--accent)' : 'var(--text-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <HelpCircle size={14} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          onClick={() => setOpen(false)}
          className="electron-nodrag"  // punch out the title-bar drag region while the modal is open
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 520, maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 80px)',
              display: 'flex', flexDirection: 'column',
              background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10,
              boxShadow: '0 16px 50px rgba(0,0,0,0.7)', overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginRight: 8 }}>Help</span>
              {tabBtn('shortcuts', 'Shortcuts')}
              {tabBtn('features', 'Features')}
              <button
                onClick={() => setOpen(false)}
                title="Close"
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 2 }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Search */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
              flexShrink: 0,
            }}>
              <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search ${tab === 'shortcuts' ? 'shortcuts' : 'features'}…`}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  color: 'var(--text-primary)', fontSize: 12,
                }}
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  title="Clear search"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 2 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Body */}
            <div style={{ overflowY: 'auto', padding: '12px 14px' }}>
              {tab === 'shortcuts' && visibleGroups.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
                  No shortcuts match “{query.trim()}”.
                  {visibleFeatures.length > 0 && (
                    <button
                      onClick={() => setTab('features')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, padding: 0, marginLeft: 5, textDecoration: 'underline' }}
                    >{visibleFeatures.length} match{visibleFeatures.length === 1 ? '' : 'es'} in Features</button>
                  )}
                </div>
              )}
              {tab === 'features' && visibleFeatures.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
                  No features match “{query.trim()}”.
                  {visibleGroups.length > 0 && (
                    <button
                      onClick={() => setTab('shortcuts')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, padding: 0, marginLeft: 5, textDecoration: 'underline' }}
                    >{visibleGroups.reduce((n, g) => n + g.items.length, 0)} match{visibleGroups.reduce((n, g) => n + g.items.length, 0) === 1 ? '' : 'es'} in Shortcuts</button>
                  )}
                </div>
              )}
              {tab === 'shortcuts' ? (
                visibleGroups.map(group => (
                  <div key={group.label} style={{ marginBottom: 16 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                      letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6,
                    }}>{group.label}</div>
                    {group.items.map(sc => (
                      <div key={group.label + sc.keys + sc.action} style={{
                        display: 'flex', alignItems: 'baseline', gap: 10, padding: '3px 0',
                      }}>
                        <kbd style={{
                          fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
                          color: 'var(--text-primary)', background: 'var(--bg-card)',
                          border: '1px solid var(--border)', borderRadius: 4,
                          padding: '1px 7px', minWidth: 64, textAlign: 'center', flexShrink: 0,
                          whiteSpace: 'nowrap',
                        }}>{renderKeys(sc.keys)}</kbd>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sc.action}</span>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                <>
                  {visibleFeatures.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                      Click a feature to light up its button in the editor.
                    </div>
                  )}
                  {featureGroups.map(([group, feats]) => (
                    <div key={group} style={{ marginBottom: 14 }}>
                      <div style={{
                        fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                        letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4,
                      }}>{group}</div>
                      {feats.map(f => {
                        const minTier = featureMinTier(f)
                        const locked = !tierAtLeast(currentTier, minTier)
                        return (
                        <div key={f.name}>
                          <button
                            onClick={() => handleFeatureClick(f)}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left',
                              background: 'transparent', border: '1px solid transparent',
                              borderRadius: 6, padding: '6px 8px', cursor: 'pointer',
                              opacity: locked ? 0.55 : 1,
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{f.name}</span>
                              {locked && (
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
                                  fontSize: 9, fontWeight: 700, letterSpacing: '0.03em',
                                  color: 'var(--accent-light)', background: 'var(--accent-subtle)',
                                  border: '1px solid rgba(139,92,246,0.35)', borderRadius: 4, padding: '1px 5px',
                                }}>
                                  <Lock size={9} /> {TIER_INFO[minTier].name}
                                </span>
                              )}
                            </span>
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 1, lineHeight: 1.45 }}>{f.description}</span>
                          </button>
                          {hintFor === f.name && locked && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '2px 8px 6px', lineHeight: 1.45 }}>
                              Not in <b style={{ color: 'var(--text-secondary)' }}>{TIER_INFO[currentTier].name}</b> mode.
                              {uiTier && (
                                <button
                                  onClick={() => { uiTier.setTier(minTier); setHintFor(null) }}
                                  style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: 'var(--accent-light)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
                                >Switch to {TIER_INFO[minTier].name}</button>
                              )}
                            </div>
                          )}
                          {hintFor === f.name && !locked && (
                            <div style={{
                              fontSize: 11, color: '#facc15', padding: '2px 8px 6px',
                            }}>{f.hint ?? 'This control isn’t visible right now.'}</div>
                          )}
                        </div>
                        )
                      })}
                    </div>
                  ))}
                </>
              )}
            </div>
            <div style={{ borderTop: '1px solid var(--border)', padding: '8px 14px', flexShrink: 0 }}>
              <a href="/community" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--text-muted)', textDecoration: 'none' }}>
                Community — browse shared songs, samples, presets &amp; recipes ↗
              </a>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
