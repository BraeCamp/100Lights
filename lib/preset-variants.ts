// 100 additional built-in preset variants. Each REUSES an existing sample folder
// (samples resolve by folder) but gives it a distinct name + `sound.fx` shaping,
// so the library gains a wide tonal palette without any new audio. This is the
// same mechanism as "Sub Drone" (a second preset over the Synth Bass samples).
//
// Spread into BUILT_IN at the END of lib/midi-presets.ts (APPEND ONLY — built-in
// ids are index-based; never reorder these once shipped). Every fx key below is a
// real RollFx field from lib/roll-fx.ts; values are offsets from each field's
// neutral (gain 1, filterHz 18000 = open, highpassHz 20 = off, EQ in dB, 0–1 fx).
import type { MidiPreset } from './midi-presets'
import type { RollFx } from './daw-types'

type Variant = Omit<MidiPreset, 'id' | 'builtIn' | 'createdAt'>
const P = (name: string, folder: string, loNote: number, hiNote: number, category: string, group: string, fx: RollFx): Variant =>
  ({ name, folder, loNote, hiNote, category, group, sound: { fx } })

export const PRESET_VARIANTS: Variant[] = [
  // ── Piano ──────────────────────────────────────────────────────────────────
  P('Felt Piano',        'Piano – All Notes',        36, 84,  'piano-grand', 'Piano', { attack: 0.006, filterHz: 4500, treble: -3, gain: 0.9, reverbWet: 0.2 }),
  P('Dark Upright',      'Piano – All Notes',        36, 84,  'piano-grand', 'Piano', { filterHz: 2600, treble: -5, bass: 2 }),
  P('Honky-Tonk',        'Piano – All Notes',        36, 84,  'piano-grand', 'Piano', { detune: 14, filterHz: 6000, treble: 1 }),
  P('Lofi Tack Piano',   'Piano – All Notes',        36, 84,  'piano-grand', 'Piano', { bitcrush: 0.2, detune: 7, filterHz: 3200, treble: -3, gain: 0.95 }),
  P('Cathedral Grand',   'Grand Piano – All Notes',  21, 108, 'piano-grand', 'Piano', { reverbWet: 0.65, reverbSize: 0.9, reverbPredelay: 0.03 }),
  P('Cinematic Grand',   'Grand Piano – All Notes',  21, 108, 'piano-grand', 'Piano', { reverbWet: 0.5, reverbSize: 0.85, width: 1.3, bass: 1 }),
  P('Bright Concert',    'Grand Piano – All Notes',  21, 108, 'piano-grand', 'Piano', { highpassHz: 200, treble: 4, reverbWet: 0.2 }),
  // ── Electric piano / Rhodes / clav ─────────────────────────────────────────
  P('Dreamy Rhodes',     'Rhodes – All Notes',       36, 84,  'piano-rhodes', 'Piano', { chorusDepth: 0.45, reverbWet: 0.4, delayWet: 0.2, delayFeedback: 0.3 }),
  P('Tremolo Rhodes',    'Rhodes – All Notes',       36, 84,  'piano-rhodes', 'Piano', { tremoloDepth: 0.5, tremoloRate: 4.5, reverbWet: 0.2 }),
  P('Bright Rhodes',     'Rhodes – All Notes',       36, 84,  'piano-rhodes', 'Piano', { treble: 3, highpassHz: 150, reverbWet: 0.15 }),
  P('Suitcase EP',       'Warm Electric Piano – All Notes', 28, 103, 'piano-electric', 'Piano', { chorusDepth: 0.35, bass: 3, reverbWet: 0.25 }),
  P('Vintage Tape EP',   'Warm Electric Piano – All Notes', 28, 103, 'piano-electric', 'Piano', { bitcrush: 0.1, detune: 6, filterHz: 6000, treble: -2, gain: 1.05 }),
  P('Phaser EP',         'Elec. Piano – All Notes',  36, 84,  'piano-electric', 'Piano', { phaser: 0.5, reverbWet: 0.2 }),
  P('Wurli Grit',        'Elec. Piano – All Notes',  36, 84,  'piano-electric', 'Piano', { drive: 0.3, bass: 2, mid: 2 }),
  P('Wah Clav',          'Elec. Piano – All Notes',  36, 84,  'piano-electric', 'Piano', { filterLfoDepth: 0.5, filterLfoRate: 4, filterQ: 5, drive: 0.2 }),
  // ── Harpsichord ────────────────────────────────────────────────────────────
  P('Baroque Harpsichord', 'Harpsichord – All Notes', 41, 89, 'other', 'Piano', { treble: 3, highpassHz: 120, reverbWet: 0.2 }),
  P('Wide Harpsichord',    'Harpsichord – All Notes', 41, 89, 'other', 'Piano', { width: 1.4, reverbWet: 0.25, treble: 2 }),
  // ── Organ ──────────────────────────────────────────────────────────────────
  P('Rock Organ',       'Organ – All Notes',        36, 84,  'synth-organ', 'Organ', { drive: 0.4, distortion: 0.2, mid: 2 }),
  P('Jazz Organ',       'Organ – All Notes',        36, 84,  'synth-organ', 'Organ', { chorusDepth: 0.4, reverbWet: 0.15, treble: 1 }),
  P('Vibrato Organ',    'Organ – All Notes',        36, 84,  'synth-organ', 'Organ', { vibratoDepth: 0.25, vibratoRate: 6, reverbWet: 0.2 }),
  P('Cathedral Pipe',   'Church Organ – All Notes', 36, 96,  'synth-organ', 'Organ', { reverbWet: 0.7, reverbSize: 0.95, reverbPredelay: 0.05 }),
  P('Full Pipe Organ',  'Church Organ – All Notes', 36, 96,  'synth-organ', 'Organ', { bass: 3, sub: 2, reverbWet: 0.5, reverbSize: 0.8 }),
  // ── Synth lead ─────────────────────────────────────────────────────────────
  P('Bright Saw Lead',    'Synth Lead – All Notes', 36, 96, 'synth-lead', 'Synth', { highpassHz: 250, treble: 3, reverbWet: 0.15 }),
  P('Detuned Trance Lead','Synth Lead – All Notes', 36, 96, 'synth-lead', 'Synth', { detune: 12, chorusDepth: 0.3, reverbWet: 0.3, delayWet: 0.2 }),
  P('Delay Lead',         'Synth Lead – All Notes', 36, 96, 'synth-lead', 'Synth', { delayWet: 0.35, delayFeedback: 0.4, delayPingpong: 0.4, reverbWet: 0.2 }),
  P('Acid Lead',          'Synth Lead – All Notes', 36, 96, 'synth-lead', 'Synth', { filterLfoDepth: 0.5, filterLfoRate: 4, filterQ: 6, drive: 0.3, filterHz: 4000 }),
  P('Soft Sine Lead',     'Synth Lead – All Notes', 36, 96, 'synth-lead', 'Synth', { filterHz: 3000, treble: -2, reverbWet: 0.25, gain: 0.95 }),
  P('Hard Distortion Lead','Synth Lead – All Notes',36, 96, 'synth-lead', 'Synth', { distortion: 0.4, drive: 0.4, mid: 2 }),
  // ── Synth pad ──────────────────────────────────────────────────────────────
  P('Cinematic Pad',     'Warm Pad – All Notes',   36, 96, 'synth-pad', 'Synth', { reverbWet: 0.6, reverbSize: 0.9, width: 1.5, attack: 0.4 }),
  P('Dark Ambient Pad',  'Warm Pad – All Notes',   36, 96, 'synth-pad', 'Synth', { filterHz: 1800, treble: -4, reverbWet: 0.5, attack: 0.5 }),
  P('Shimmer Pad',       'Warm Pad – All Notes',   36, 96, 'synth-pad', 'Synth', { delayWet: 0.4, delayFeedback: 0.5, reverbWet: 0.5, treble: 2 }),
  P('Dreamy Wash Pad',   'Synth Pad – All Notes',  36, 84, 'synth-pad', 'Synth', { chorusDepth: 0.5, reverbWet: 0.55, delayWet: 0.3, attack: 0.3 }),
  P('Underwater Pad',    'Synth Pad – All Notes',  36, 84, 'synth-pad', 'Synth', { filterHz: 1000, filterLfoDepth: 0.4, filterLfoRate: 0.6, chorusDepth: 0.5 }),
  P('Wide Analog Pad',   'Synth Pad – All Notes',  36, 84, 'synth-pad', 'Synth', { width: 1.7, detune: 8, filterHz: 5000, reverbWet: 0.3 }),
  P('Phaser Pad',        'Synth Pad – All Notes',  36, 84, 'synth-pad', 'Synth', { phaser: 0.5, reverbWet: 0.4, attack: 0.3 }),
  // ── Dark synth ─────────────────────────────────────────────────────────────
  P('Sub Growl',        'Dark Synth – All Notes', 24, 96, 'synth-dark', 'Synth', { sub: 5, bass: 4, filterHz: 1500, drive: 0.2 }),
  P('Horror Drone',     'Dark Synth – All Notes', 24, 96, 'synth-dark', 'Synth', { filterHz: 900, filterLfoDepth: 0.3, filterLfoRate: 0.4, reverbWet: 0.6 }),
  P('Reese Bass Synth', 'Dark Synth – All Notes', 24, 96, 'synth-dark', 'Synth', { detune: 15, drive: 0.3, filterHz: 2200, sub: 3 }),
  // ── Metallic pluck ─────────────────────────────────────────────────────────
  P('Bright Bell Pluck','Metallic Pluck – All Notes', 36, 96, 'synth-pluck', 'Synth', { treble: 3, reverbWet: 0.3, delayWet: 0.25 }),
  P('Dark Mallet Pluck','Metallic Pluck – All Notes', 36, 96, 'synth-pluck', 'Synth', { filterHz: 2400, treble: -3, reverbWet: 0.2 }),
  P('Echo Pluck',       'Metallic Pluck – All Notes', 36, 96, 'synth-pluck', 'Synth', { delayWet: 0.4, delayFeedback: 0.45, delayPingpong: 0.5, reverbWet: 0.25 }),
  // ── Choir ──────────────────────────────────────────────────────────────────
  P('Cathedral Choir',  'Choir Aahs – All Notes', 43, 84, 'synth-choir', 'Synth', { reverbWet: 0.7, reverbSize: 0.95, attack: 0.2 }),
  P('Wide Choir Pad',   'Choir Aahs – All Notes', 43, 84, 'synth-choir', 'Synth', { width: 1.6, reverbWet: 0.5, attack: 0.3 }),
  P('Airy Choir',       'Choir – All Notes',      36, 84, 'synth-choir', 'Synth', { highpassHz: 300, treble: 3, reverbWet: 0.4 }),
  P('Dark Choir',       'Choir – All Notes',      36, 84, 'synth-choir', 'Synth', { filterHz: 2200, treble: -4, reverbWet: 0.5 }),
  // ── Ensemble / synth strings ───────────────────────────────────────────────
  P('Cinematic Strings','String Ensemble – All Notes', 28, 96, 'synth-strings', 'Strings', { reverbWet: 0.6, reverbSize: 0.85, width: 1.4, attack: 0.15 }),
  P('Warm Strings',     'String Ensemble – All Notes', 28, 96, 'synth-strings', 'Strings', { filterHz: 5000, bass: 2, treble: -1, reverbWet: 0.3 }),
  P('Bright Section',   'String Ensemble – All Notes', 28, 96, 'synth-strings', 'Strings', { highpassHz: 200, treble: 3, reverbWet: 0.25 }),
  P('Tremolo Strings',  'String Ensemble – All Notes', 28, 96, 'synth-strings', 'Strings', { tremoloDepth: 0.4, tremoloRate: 6, reverbWet: 0.3 }),
  P('Wide Synth Strings','Synth Strings – All Notes',  36, 84, 'synth-strings', 'Strings', { width: 1.6, chorusDepth: 0.3, reverbWet: 0.35 }),
  P('Dark Synth Strings','Synth Strings – All Notes',  36, 84, 'synth-strings', 'Strings', { filterHz: 2000, treble: -4, reverbWet: 0.3 }),
  // ── Solo strings ───────────────────────────────────────────────────────────
  P('Vibrato Violin',   'Solo Violin – All Notes', 55, 100, 'violin', 'Strings', { vibratoDepth: 0.3, vibratoRate: 5.5, reverbWet: 0.3 }),
  P('Concert Violin',   'Violin – All Notes',      55, 88,  'violin', 'Strings', { reverbWet: 0.5, reverbSize: 0.85, treble: 1 }),
  P('Dark Viola',       'Viola – All Notes',       48, 77,  'viola', 'Strings', { filterHz: 2600, treble: -3, bass: 2 }),
  P('Warm Cello',       'Cello – All Notes',       36, 81,  'viola', 'Strings', { filterHz: 4000, bass: 3, reverbWet: 0.3 }),
  P('Cinematic Cello',  'Cello – All Notes',       36, 81,  'viola', 'Strings', { reverbWet: 0.55, reverbSize: 0.9, sub: 2 }),
  P('Pizzicato Hall',   'Pizzicato Strings – All Notes', 36, 96, 'other', 'Strings', { reverbWet: 0.4, treble: 2, delayWet: 0.15 }),
  // ── Harp ───────────────────────────────────────────────────────────────────
  P('Ethereal Harp',    'Orchestral Harp – All Notes', 24, 103, 'other', 'Strings', { reverbWet: 0.55, delayWet: 0.25, treble: 2 }),
  P('Dark Harp',        'Orchestral Harp – All Notes', 24, 103, 'other', 'Strings', { filterHz: 3000, treble: -2, reverbWet: 0.3 }),
  // ── Guitar ─────────────────────────────────────────────────────────────────
  P('Clean Reverb Guitar','Clean Electric Guitar – All Notes', 40, 86, 'other', 'Guitar', { reverbWet: 0.4, treble: 2 }),
  P('Chorus Guitar',    'Clean Electric Guitar – All Notes', 40, 86, 'other', 'Guitar', { chorusDepth: 0.4, reverbWet: 0.25 }),
  P('Delay Guitar',     'Clean Electric Guitar – All Notes', 40, 86, 'other', 'Guitar', { delayWet: 0.35, delayFeedback: 0.4, delayPingpong: 0.4, reverbWet: 0.2 }),
  P('Ambient Guitar Wash','Clean Electric Guitar – All Notes', 40, 86, 'other', 'Guitar', { reverbWet: 0.6, reverbSize: 0.9, delayWet: 0.3, attack: 0.05 }),
  P('Overdrive Guitar', 'Electric Guitar – All Notes', 40, 76, 'other', 'Guitar', { drive: 0.45, distortion: 0.25, mid: 2 }),
  P('Crunch Guitar',    'Electric Guitar – All Notes', 40, 76, 'other', 'Guitar', { distortion: 0.4, drive: 0.3, treble: 2 }),
  P('Tremolo Surf',     'Electric Guitar – All Notes', 40, 76, 'other', 'Guitar', { tremoloDepth: 0.5, tremoloRate: 5, reverbWet: 0.3 }),
  P('Warm Nylon',       'Nylon Acoustic Guitar – All Notes', 40, 84, 'other', 'Guitar', { filterHz: 5000, bass: 2, reverbWet: 0.25 }),
  P('Bright Steel',     'Steel Acoustic Guitar – All Notes', 40, 84, 'other', 'Guitar', { highpassHz: 150, treble: 3, reverbWet: 0.2 }),
  P('Lofi Acoustic',    'Acoustic Guitar – All Notes', 40, 76, 'other', 'Guitar', { bitcrush: 0.12, filterHz: 3500, treble: -2, gain: 0.95 }),
  // ── Bass ───────────────────────────────────────────────────────────────────
  P('Deep Sub Bass',    'Synth Bass – All Notes', 24, 60, 'synth-bass', 'Bass', { sub: 6, bass: 4, filterHz: 1800 }),
  P('Driven Synth Bass','Synth Bass – All Notes', 24, 60, 'synth-bass', 'Bass', { drive: 0.35, filterHz: 2200, bass: 2 }),
  P('Acid Bass',        'Synth Bass – All Notes', 24, 60, 'synth-bass', 'Bass', { filterLfoDepth: 0.5, filterLfoRate: 3, filterQ: 7, drive: 0.3, filterHz: 2500 }),
  P('Reese Sub',        'Synth Bass – All Notes', 24, 60, 'synth-bass', 'Bass', { detune: 14, drive: 0.3, sub: 4, filterHz: 2000 }),
  P('Warm Electric Bass','Electric Bass – All Notes', 24, 67, 'synth-bass', 'Bass', { filterHz: 3500, bass: 3, treble: -2 }),
  P('Bright Finger Bass','Electric Bass – All Notes', 24, 67, 'synth-bass', 'Bass', { highpassHz: 80, treble: 2, mid: 1 }),
  P('Fretless Warmth',  'Fretless Bass – All Notes', 24, 67, 'synth-bass', 'Bass', { filterHz: 3000, bass: 3, chorusDepth: 0.2 }),
  P('Upright Jazz Bass','Acoustic Bass – All Notes', 24, 55, 'synth-bass', 'Bass', { filterHz: 2800, bass: 2, treble: -3 }),
  // ── Brass ──────────────────────────────────────────────────────────────────
  P('Bright Trumpet',   'Trumpet – All Notes',    52, 84, 'other', 'Brass', { highpassHz: 200, treble: 3, reverbWet: 0.2 }),
  P('Muted Trumpet',    'Trumpet – All Notes',    52, 84, 'other', 'Brass', { highpassHz: 400, filterHz: 2500, bass: -3 }),
  P('Warm Trombone',    'Trombone – All Notes',   40, 77, 'other', 'Brass', { filterHz: 3500, bass: 3, reverbWet: 0.25 }),
  P('Cinematic Horn',   'French Horn – All Notes',35, 77, 'other', 'Brass', { reverbWet: 0.55, reverbSize: 0.85, bass: 2 }),
  P('Fanfare Horn',     'French Horn – All Notes',35, 77, 'other', 'Brass', { highpassHz: 150, treble: 2, reverbWet: 0.3 }),
  // ── Woodwinds ──────────────────────────────────────────────────────────────
  P('Airy Flute',       'Flute – All Notes',      60, 96, 'other', 'Woodwinds', { highpassHz: 300, treble: 3, reverbWet: 0.3 }),
  P('Dark Flute',       'Flute – All Notes',      60, 96, 'other', 'Woodwinds', { filterHz: 3000, treble: -3, reverbWet: 0.25 }),
  P('Breathy Pan Flute','Pan Flute – All Notes',  60, 96, 'other', 'Woodwinds', { reverbWet: 0.4, delayWet: 0.2, treble: 2 }),
  P('Warm Clarinet',    'Clarinet – All Notes',   50, 93, 'other', 'Woodwinds', { filterHz: 4000, bass: 2, reverbWet: 0.2 }),
  P('Bright Oboe',      'Oboe – All Notes',       58, 91, 'other', 'Woodwinds', { treble: 2, highpassHz: 150, reverbWet: 0.25 }),
  // ── Mallets ────────────────────────────────────────────────────────────────
  P('Concert Vibraphone','Vibraphone – All Notes',53, 89, 'other', 'Mallets', { tremoloDepth: 0.35, tremoloRate: 4, reverbWet: 0.35 }),
  P('Dark Vibraphone',  'Vibraphone – All Notes', 53, 89, 'other', 'Mallets', { filterHz: 3000, treble: -3, reverbWet: 0.3 }),
  P('Shimmer Marimba',  'Marimba – All Notes',    45, 96, 'other', 'Mallets', { reverbWet: 0.35, delayWet: 0.25, treble: 2 }),
  P('Echo Marimba',     'Marimba – All Notes',    45, 96, 'other', 'Mallets', { delayWet: 0.4, delayFeedback: 0.45, delayPingpong: 0.5, reverbWet: 0.2 }),
  P('Music Box Dream',  'Music Box – All Notes',  60, 96, 'other', 'Mallets', { reverbWet: 0.5, delayWet: 0.3, treble: 2 }),
  P('Bright Glockenspiel','Glockenspiel – All Notes', 72, 108, 'other', 'Mallets', { treble: 3, reverbWet: 0.4 }),
  P('Warm Kalimba',     'Kalimba – All Notes',    48, 84, 'other', 'Mallets', { filterHz: 5000, bass: 2, reverbWet: 0.3 }),
  // ── Drone / atmos ──────────────────────────────────────────────────────────
  P('Meditation Drone', 'Drone – All Notes',      36, 60, 'synth-drone', 'Synth', { reverbWet: 0.6, filterHz: 1500, sub: 3, attack: 0.6 }),
  P('Bright Drone',     'Drone – All Notes',      36, 60, 'synth-drone', 'Synth', { highpassHz: 200, treble: 2, reverbWet: 0.5, attack: 0.5 }),
  // ── Final batch ────────────────────────────────────────────────────────────
  P('Sad Piano',        'Grand Piano – All Notes', 21, 108, 'piano-grand', 'Piano', { filterHz: 5000, treble: -2, reverbWet: 0.35, gain: 0.9 }),
  P('Glass Pad',        'Warm Pad – All Notes',    36, 96,  'synth-pad', 'Synth', { highpassHz: 400, treble: 3, reverbWet: 0.5, chorusDepth: 0.3 }),
  P('Telephone Lead',   'Synth Lead – All Notes',  36, 96,  'synth-lead', 'Synth', { highpassHz: 600, filterHz: 3000, bass: -6, mid: 2 }),
  P('Warm Trumpet',     'Trumpet – All Notes',     52, 84,  'other', 'Brass', { filterHz: 4500, bass: 2, reverbWet: 0.3 }),
  P('Dreamy Glock',     'Glockenspiel – All Notes',72, 108, 'other', 'Mallets', { reverbWet: 0.5, delayWet: 0.3, treble: 1 }),
  P('Cello Sub Swell',  'Cello – All Notes',       36, 81,  'viola', 'Strings', { sub: 3, filterHz: 2000, reverbWet: 0.4, attack: 0.3 }),
  P('Gospel Organ',     'Organ – All Notes',       36, 84,  'synth-organ', 'Organ', { drive: 0.2, chorusDepth: 0.3, bass: 2, reverbWet: 0.2 }),
]
