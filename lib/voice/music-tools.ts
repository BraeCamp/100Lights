// The command vocabulary — the official name for each thing you can say.
//
// Brae: "Let's start with the official terms for each command, and keep in mind
// time signatures, bpm, locations (which bar, what time)."
//
// Two decisions run through the whole list.
//
// THE NAMES ARE THE DAW'S, NOT THE SENTENCE'S. People say "loop the bass three
// more times", but in every DAW ever made that operation is DUPLICATE — "loop"
// means a loop brace or a clip's loop flag, which are different things you can
// also ask for. Naming the tool `duplicate_clip` and letting the model map
// "loop it again" onto it keeps one honest name per operation; naming it
// `loop_clip` would leave nothing to call the real loop with.
//
// EVERY PLACE AND LENGTH IS MUSICAL. A position is `{ bar, beat }` or
// `{ seconds }`, a length is `{ bars }` or `{ beats }` or `{ seconds }`, and
// both are resolved through the song's tempo and meter maps (lib/voice/position)
// rather than multiplied by one BPM. Bars and beats are counted from 1, the way
// they are spoken and the way the ruler prints them.
//
// The glossary below is the contract. Adding a command means adding an entry
// here and a case in lib/voice/execute-music, and both are tested.

/** Shared JSON-schema fragments, so every command speaks the same dialect. */
// ⚠️ THESE THREE ARE REPEATED INTO EVERY TOOL THAT USES THEM, and the whole
// tool list is re-sent on every single utterance. TARGET appeared 38 times at
// 130 characters, POSITION 7 times at 412 — nine thousand characters of
// identical text, 16% of a 15,400-token prefix, paid for on every command.
//
// So the explanation moves to the system prompt, where it is said ONCE, and
// what stays here is only what the model cannot infer from the name. Nothing is
// lost: the model reads the same words, in one place instead of forty. See
// SHARED_ARGS in MUSIC_SYSTEM_HINT below.
const POSITION = {
  type: 'object',
  description: 'A place in the song — bar (+ optional beat), or seconds.',
  properties: {
    bar: { type: 'number' },
    beat: { type: 'number' },
    seconds: { type: 'number' },
  },
} as const

const LENGTH = {
  type: 'object',
  description: 'A length — bars, beats, or seconds.',
  properties: {
    bars: { type: 'number' },
    beats: { type: 'number' },
    seconds: { type: 'number' },
  },
} as const

const TARGET = {
  type: 'string',
  description: 'A track or clip name, as spoken.',
} as const

import { ADD_OPTIONS, APOLLO_ADD_OPTIONS } from '../daw-effect-catalog'

/**
 * Every effect the assistant may name, taken from the catalogue the Add Device
 * menu uses.
 *
 * ⚠️ This was eight names typed by hand, and the model said so out loud when
 * asked for a phaser: "There's no phaser effect available — the options I have
 * are reverb, delay, filter, compressor, saturator, chorus, eq3, or limiter."
 * Every device shipped since that list was written — the whole Apollo set, plus
 * redux, gate, de-esser, transient shaper, multiband, dyn EQ, unmask, utility —
 * was unreachable by voice, and nothing could notice because the list looked
 * deliberate.
 *
 * Generated from ADD_OPTIONS + APOLLO_ADD_OPTIONS so a device added to the menu
 * is speakable the same day.
 */
export const SPEAKABLE_EFFECTS: string[] = [
  ...ADD_OPTIONS.map(o => o.type),
  ...APOLLO_ADD_OPTIONS.map(o => o.fx),
]

/**
 * Every device the studio can actually add, named the way it is labelled.
 *
 * ⚠️ Brae: "make sure that the AI has control over the device chain effect
 * graphs that show up when I click FX on a trackhead."
 *
 * It mostly did — the graph in the chain is a RENDER of an effect's parameters
 * (ResponseCurve draws the filter/EQ response from them), so controlling the
 * dials controls the curve, and set_device_param already does that. What it
 * could not do was NAME some of the devices: this list was hand-written and had
 * drifted from the catalogue, missing `filter` — the very device that draws the
 * curve — along with utility, unmask and the Apollo devices.
 *
 * A model that is not told a device exists does not ask for it; it reaches for
 * the nearest one it was told about, which is the failure this codebase keeps
 * finding. So the list is GENERATED from the same catalogue the Add menu uses
 * and buildSpokenEffect resolves against. It cannot advertise something the
 * executor cannot build, and it cannot omit something it can.
 */
function deviceList(): string {
  const names = [
    ...ADD_OPTIONS.map(o => o.label),
    ...APOLLO_ADD_OPTIONS.map(o => `${o.label} (Apollo)`),
  ]
  return `The device, as they said it. Available: ${names.join(', ')}.`
}

export const MUSIC_TOOLS = [
  {
    name: 'duplicate_clip',
    description:
      'DUPLICATE — repeat a clip N more times, back to back after itself. This is what "loop it 3 more times", "repeat that twice", "double it" mean. For an actual loop brace use set_loop_region; for a clip\'s own loop flag use set_clip_loop.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        count: { type: 'number', description: 'How many EXTRA copies. "3 more times" is 3.' },
      },
      required: ['target', 'count'],
    },
  },
  {
    name: 'automate_parameter',
    description:
      'AUTOMATION — write a ramp on a parameter over a span of the song. This is what "an ascending low pass filter from 80% to 0% over the first 8 seconds", "fade the volume out over the last 2 bars", "open the filter across the intro" mean. A SPAN IS OFTEN GIVEN AS AN ENDPOINT RATHER THAN A LENGTH, and those are the same request: "until the 6th bar", "up to the chorus", "through bar 12", "stays at 100% until bar 6", "keep it open till the drop". The giveaway is a value that has to HOLD and then change — that is a shape over time, which is this tool, not a single setting. Note what it is doing NOW before writing one: "stays at 100% until bar 6" when it is already 100% is a request to EXTEND the existing ramp to bar 6, and setting the value to 100% again changes nothing and is not what was asked.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        parameter: {
          type: 'string',
          enum: ['lowpass', 'highpass', 'volume', 'pan'],
          description: 'lowpass/highpass add a filter and automate its cutoff; volume and pan automate the track itself.',
        },
        from: { type: 'number', description: 'Starting value as a percentage, 0-100.' },
        to: { type: 'number', description: 'Ending value as a percentage, 0-100.' },
        start: { ...POSITION, description: 'Where the ramp begins. Omit for the start of the target clip.' },
        length: LENGTH,
      },
      required: ['target', 'parameter', 'from', 'to'],
    },
  },
  {
    name: 'move_clips',
    description:
      'MOVE — shift clips later or earlier by a length. "move everything over by one bar", "push the drums back 2 bars". Negative moves earlier. Omit target to move the whole arrangement.',
    input_schema: {
      type: 'object',
      properties: {
        target: { ...TARGET, description: 'A track or clip name; omit to move EVERYTHING.' },
        by: LENGTH,
      },
      required: ['by'],
    },
  },
  {
    name: 'insert_clip',
    description:
      'INSERT — put a new clip in the arrangement at a position. Use for "have a 1 bar long crash at the beginning", "put a kick on bar 9". Reuses a track whose name matches the sound.',
    input_schema: {
      type: 'object',
      properties: {
        sound: { type: 'string', description: 'crash, kick, snare, hat, or an instrument name.' },
        at: POSITION,
        length: LENGTH,
      },
      required: ['sound', 'at'],
    },
  },
  {
    name: 'set_tempo',
    description: 'TEMPO — change the song tempo in BPM. "take it to 128", "slow down to 90". ⚠️ The SONG\'s speed, and nothing else. If the sentence names a TRACK it is not this tool — "the pad should be lower" is that track\'s volume (set_track), not the tempo, and "lower" never means slower when something is named.',
    input_schema: {
      type: 'object',
      properties: {
        bpm: { type: 'number' },
        at: { ...POSITION, description: 'Omit to change the song tempo; give a position to add a tempo change there.' },
      },
      required: ['bpm'],
    },
  },
  {
    name: 'set_time_signature',
    description:
      'TIME SIGNATURE — change the meter. "put it in 3/4", "switch to 6/8 at bar 17". A change mid-song starts a new bar there.',
    input_schema: {
      type: 'object',
      properties: {
        numerator: { type: 'number', description: 'Beats per bar — the 3 in 3/4.' },
        denominator: { type: 'number', description: 'Which note gets the beat — the 4 in 3/4.' },
        at: { ...POSITION, description: 'Omit for the whole song.' },
      },
      required: ['numerator', 'denominator'],
    },
  },
  {
    name: 'set_loop_region',
    description:
      'LOOP BRACE — set the loop start and end, the region the transport repeats. "loop bars 9 to 17", "loop the chorus". This is NOT duplicating a clip.',
    input_schema: {
      type: 'object',
      properties: {
        start: POSITION,
        end: { ...POSITION, description: 'Where the loop ends. Give this or length.' },
        length: LENGTH,
        enabled: { type: 'boolean', description: 'Turn looping on or off without changing the region.' },
      },
    },
  },
  {
    name: 'set_track',
    description:
      'MIXER — mute, solo, set volume or pan on one track. "mute the hats", "bring the bass up", "pan the guitar left".',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        muted: { type: 'boolean' },
        solo: { type: 'boolean' },
        volume: { type: 'number', description: 'Percentage, 0-100.' },
        pan: { type: 'number', description: '-100 (hard left) to 100 (hard right).' },
      },
      required: ['target'],
    },
  },
  {
    name: 'transpose',
    description:
      'TRANSPOSE — move the notes of a clip up or down in semitones. "take the bass up an octave" is 12, "down a fifth" is -7.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        semitones: { type: 'number', description: 'Positive is up. An octave is 12.' },
      },
      required: ['target', 'semitones'],
    },
  },
  {
    name: 'transport',
    description:
      'TRANSPORT — play, stop, or return to the start. ALWAYS call this when the sentence ends with "then restart", "then play it", "and play it back", or similar: "restart" means go back to the beginning and play, and it is a real request like any other, not a closing remark. "go to bar 9" moves the playhead — but ONLY when going there is the request itself. A bar mentioned inside a larger sentence is describing WHERE something should happen, not asking to move: "until the 6th bar", "add a crash at bar 5", "make it louder from bar 3" are not transport calls, and moving the playhead during one of them is an edit nobody asked for.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['play', 'stop', 'pause', 'restart', 'toggle', 'locate'] },
        at: { ...POSITION, description: 'For "locate" — where to put the playhead.' },
      },
      required: ['action'],
    },
  },
  // ── The studio around the song ───────────────────────────────────────────
  //
  // Everything above changes the music. These change the workspace, and people
  // ask for them just as often — a voice system that can transpose a bassline
  // but cannot add a track is not a voice system, it is a demo.
  {
    name: 'set_master_volume',
    description:
      'MASTER — the level of the whole mix. "turn everything down", "master to 80 percent". For one track use set_track.',
    input_schema: {
      type: 'object',
      properties: { volume: { type: 'number', description: 'Percentage, 0-100.' } },
      required: ['volume'],
    },
  },
  {
    name: 'show_view',
    description:
      'THE WORKSPACE — open or close a panel around the song: "bring up the devices for the pad", "show the effects rack on the bass", "show automation on the drums", "open the pads", "close the devices". Changes what is ON SCREEN and never changes the song, so it is safe whenever somebody asks to SEE something. ⚠️ For the piano roll, the step sequencer, or moving to another part of the app, use open_editor instead — this tool does not do those.',
    input_schema: {
      type: 'object',
      properties: {
        view: {
          type: 'string',
          enum: ['devices', 'automation', 'pads'],
          description: 'devices = the effect rack for a track. automation = a drawable lane under a track. pads = the playable pad card.',
        },
        target: { type: 'string', description: 'The track to open it on, by name. Devices and automation both need one.' },
        open: { type: 'boolean', description: 'false to close it. Defaults to true.' },
      },
      required: ['view'],
    },
  },
  {
    name: 'make_beat',
    description:
      'BEAT FROM VOICE — the person said a rhythm out loud using drum syllables: "boom ka boom boom ka", "make me a beat like doom ts doom ts", "boom boom ka". Call this whenever the message contains percussion syllables, even buried in a sentence — the syllables at the END are the beat and the words in front are just the request. Put the syllables you heard in `pattern`, in order, separated by spaces. Do NOT tidy them into real words: "ka" is not "car", and the exact syllables are what decide which drum each one is. The actual RHYTHM comes from when they were said, not from you.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'The drum syllables, in order, space separated. "boom ka boom boom ka".' },
        track: { type: 'string', description: 'Which drum track to put it on. Omit to use the drums, or make one.' },
        at: { ...POSITION, description: 'Where to put it. Omit for the start.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'set_apollo_layer',
    description:
      'APOLLO\'S OWN LAYERS — the sub, the noise, and the three oscillators inside an Apollo instrument. "add sub to the pad", "more sub on the bass", "turn the noise up", "take the sub off", "bring in oscillator two", "drop the sub an octave". ⚠️ This is INSIDE the instrument, not an effect after it and not a separate track: adding sub here thickens the sound the pad already makes. Only Apollo instruments have these layers; the studio will say so for anything else rather than pretend.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        layer: {
          type: 'string',
          description: 'sub, noise, or "osc 1" / "osc 2" / "osc 3". "Sub" is the commonest by far.',
        },
        on: { type: 'boolean', description: 'True to bring it in, false to take it out. Adding implies true.' },
        level: { type: 'number', description: '0-100. Omit for a sensible default when switching it on.' },
        octave: { type: 'number', description: 'For the sub: -2 or -1. Omit to leave it.' },
      },
      required: ['layer'],
    },
  },

  // ── The rest of the audit's open list ────────────────────────────────────
  //
  // Brae: "Let's build the 'still open' ones for AI"
  //
  // Written as FEW tools with a parameter, rather than one tool per term. A
  // model chooses better from a short list of well-described tools than from
  // forty near-identical ones — "set a device parameter" with the parameter
  // named is one decision; twenty tools called set_reverb_decay, set_delay_time
  // and so on is twenty chances to pick the neighbour.
  {
    name: 'project_action',
    description:
      'THE PROJECT AS A DOCUMENT — open another one, start one, name a version, go back to one, or rename this one. "open Winter Drift", "make me a new project called Sketch", "save a version called before the drop", "put it back to before the drop", "what versions are there", "rename this project to Late Checkout". ⚠️ Opening or restoring REPLACES what is on screen; the studio saves as you work, so nothing is lost, but say what you are doing. For the SONG\'s contents use the ordinary commands — this is about the file, not the music.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'new', 'save_version', 'restore_version', 'list_versions', 'rename'],
        },
        name: { type: 'string', description: 'The project to open, the version to name or go back to, or the new name.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'write_part',
    description:
      'MAKE A NEW PART — a track, a sound chosen by CHARACTER, and notes to play, all in one. "put in a bassline using one of the darker sad piano presets", "add a warm bass part", "give me 8 bars of low notes on a mellow piano". ⚠️ Use this when the sentence asks for something that does not exist yet AND says what it should sound like. It is one command on purpose: a track with no clips cannot be given a sampled preset, so these steps fail if they are sent separately. For changing a sound that is already there use set_instrument; for notes on an existing track use insert_clip.',
    input_schema: {
      type: 'object',
      properties: {
        character: { type: 'string', description: 'The mood, as they said it: dark, darker, sad, melancholic, moody, mellow, soft, warm, bright, spacious, cinematic, lofi, gritty. Pass the words themselves — the library is searched by what each preset MEASURABLY sounds like, not by tags.' },
        instrument: { type: 'string', description: 'piano, bass, strings, synth, guitar, organ, mallets, brass, woodwinds — or a preset name.' },
        part: { type: 'string', enum: ['bass'], description: 'What to write. Bass is a low root movement; lead lines are written by hand, not generated.' },
        bars: { type: 'number', description: 'How long. Default 8.' },
        at: POSITION,
        name: { type: 'string', description: 'What to call the track. Default "Bass".' },
      },
      required: [],
    },
  },
  {
    name: 'set_apollo_param',
    description:
      'ANY DIAL INSIDE APOLLO, BY NAME — the synth\'s own 166 parameters, not an effect after it. "open the filter on the pad", "cutoff to 800 hertz", "more resonance on filter 2", "wavetable position halfway on oscillator 2", "grain density up on the texture", "osc A detune to 20 percent", "LFO 3 rate to 5 hertz", "macro 2 to 70", "longer glide". ⚠️ Only works on a track whose instrument is Apollo. Names the module it moved, so a wrong guess is visible at once. If the dial exists in several places (level, pan, rate) SAY WHICH — "the sub level", "LFO 2 rate" — or it will ask.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        parameter: { type: 'string', description: 'The dial as they said it, INCLUDING the module when they named one: "filter 2 cutoff", "sub level", "oscillator 2 wavetable position", "envelope 3 attack", "LFO 1 rate", "grain size", "spray", "formant", "glide", "master".' },
        value: { type: 'number', description: 'In the dial\'s own unit — Hertz for a cutoff or an LFO rate, seconds for an envelope stage, cents for fine tune, semitones for coarse. On a 0-1 dial a number above 1 is read as a percentage.' },
        percent: { type: 'number', description: '0-100 across the dial\'s own range, for "halfway" or "all the way up". Follows the dial\'s curve, so halfway sounds halfway.' },
        direction: { type: 'string', enum: ['more', 'less'], description: 'A step up or down, for "a bit more resonance" with no number.' },
      },
      required: ['parameter'],
    },
  },
  {
    name: 'set_apollo_switch',
    description:
      'A CHOICE INSIDE APOLLO, rather than a number — the things that are a setting, not a dial. "make oscillator two granular", "put osc 1 on the sample engine", "set the warp to sync", "unison of 4 on oscillator 1", "drop the sub an octave". ⚠️ Switching an ENGINE changes what an oscillator IS (wavetable, sample, granular, spectral) and the granular/sample/spectral dials only work once it has — but it needs a sample loaded to make a sound, so it says so rather than leaving silence.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        setting: { type: 'string', enum: ['engine', 'warp', 'unison', 'octave'], description: 'Which switch.' },
        value: { type: 'string', description: 'engine: wavetable, sample, granular, spectral. warp: off, sync, bend, pwm, fm, am, rm, saturate, mirror, flip, quantize. unison: a number 1-16. octave: -2 to 2.' },
        module: { type: 'string', description: 'Which one — "oscillator 2", "sub". Defaults to oscillator 1.' },
      },
      required: ['setting', 'value'],
    },
  },
  {
    name: 'set_apollo_filter',
    description:
      'WHICH FILTER MODEL APOLLO IS USING — the single biggest change to a patch\'s character. "give the pad a ladder filter", "make it an acid filter", "24 dB low pass on the bass", "put a comb filter on it", "vowel filter", "phaser filter". ⚠️ This CHANGES THE FILTER TYPE. For moving the cutoff or resonance use set_apollo_param; for a separate filter device after the synth use add_effect.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        type: { type: 'string', description: 'As they said it: ladder, moog, acid, EMS, german, french, formant, vowel, comb, flange, phaser, ring mod, sample and hold, downsample, DJ, diffuser, notch, peak, band pass, high pass, low pass. A slope in the sentence ("24 dB") is honoured.' },
        filter: { type: 'number', description: '1 or 2. Defaults to 1, the one people mean.' },
      },
      required: ['type'],
    },
  },
  {
    name: 'set_device_param',
    description:
      'A DEVICE PARAMETER BY NAME — the dials inside an effect, rather than one overall amount. "set the compressor ratio to 4 on the drums", "make the reverb decay longer on the vocals", "delay feedback to 40 percent", "limiter ceiling at minus one", "gate threshold minus 30". ⚠️ Use set_effect when they mean HOW MUCH of the effect ("more reverb"); use this when they name a specific dial. If the device is not on the track yet it is added first.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        device: { type: 'string', description: deviceList() },
        parameter: { type: 'string', description: 'The dial, as they said it: decay, size, time, feedback, threshold, ratio, attack, release, ceiling, frequency, rate, depth, mix.' },
        value: { type: 'number', description: 'In the parameter\'s own unit — dB, Hz, seconds, or a ratio. Use this OR percent.' },
        percent: { type: 'number', description: '0-100 across the parameter\'s range, when they said "halfway" or "all the way up".' },
      },
      required: ['parameter'],
    },
  },
  {
    name: 'set_sound',
    description:
      'THE INSTRUMENT ITSELF — envelope and filter, not an effect after it. "give the pad a slower attack", "shorten the release on the bass", "open the filter on the keys", "more resonance", "longer decay". ⚠️ This is the synth\'s own shape. A filter here is the instrument\'s filter; add_effect puts a separate filter device after it, which is a different sound and a different thing to undo.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        parameter: {
          type: 'string',
          enum: ['attack', 'decay', 'sustain', 'release', 'cutoff', 'resonance', 'detune', 'lfo rate', 'lfo depth'],
        },
        value: { type: 'number', description: 'Seconds for envelope stages, Hz for cutoff. Use this OR direction.' },
        direction: { type: 'string', enum: ['more', 'less'], description: 'A step up or down, for "a slower attack" with no number.' },
      },
      required: ['parameter'],
    },
  },
  {
    name: 'eq_band',
    description:
      'CUT OR BOOST AT A FREQUENCY — the commonest sentence in any mixing session. "cut 300 hertz on the guitar", "boost 5k on the vocals", "take out some 200 on the bass", "add a bit of top at 10k". Says which of the three bands it lands in and moves that one. ⚠️ For a general tone move with no frequency named, shape_tone is the better tool.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        frequency: { type: 'number', description: 'In Hertz. "5k" is 5000.' },
        gain: { type: 'number', description: 'dB. Negative cuts, positive boosts. Omit with `action` for a default 3 dB move.' },
        action: { type: 'string', enum: ['cut', 'boost'] },
      },
      required: ['frequency'],
    },
  },
  {
    name: 'send_to',
    description:
      'SEND TO A RETURN — feed some of a track into a shared effect bus instead of putting the effect on the track. "send the vocals to the reverb", "put a bit of the snare into the delay return", "take the bass out of the reverb bus". This is how several tracks share one reverb, which is both cheaper and how a mix hangs together.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        to: { type: 'string', description: 'The return track: "reverb", "delay", or whatever it is called.' },
        amount: { type: 'number', description: '0-100. 0 takes it out of the send.' },
      },
      required: ['to'],
    },
  },
  {
    name: 'nudge',
    description:
      'NUDGE — move something by a small amount, the way you do when it is nearly right. "nudge the snare a bit later", "pull the vocal forward slightly", "move it back 20 milliseconds". ⚠️ move_clips is the tool for musical distances (bars and beats); this is for the sub-beat amounts that have no musical name.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        direction: { type: 'string', enum: ['later', 'earlier'] },
        milliseconds: { type: 'number', description: 'How far. Omit for a small default nudge.' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'tempo_ramp',
    description:
      'SPEED UP OR SLOW DOWN OVER TIME — a ritardando or accelerando, rather than a jump. "slow down into the last chorus", "gradually speed up from bar 9 to bar 17", "ritardando at the end". Writes tempo changes across the stretch. ⚠️ set_tempo is a single change at one point; this is a gradual one between two.',
    input_schema: {
      type: 'object',
      properties: {
        from: POSITION,
        to: POSITION,
        bpm: { type: 'number', description: 'The tempo to arrive at.' },
        direction: { type: 'string', enum: ['slower', 'faster'], description: 'Instead of a bpm, for "slow down a bit".' },
      },
    },
  },
  {
    name: 'select',
    description:
      'SELECT — choose what "this" refers to, without touching the mouse. "select everything on the bass", "select the loop", "select all the clips", "select nothing". Useful before a command that acts on the selection, and the answer to "how do I tell it which one I mean".',
    input_schema: {
      type: 'object',
      properties: {
        what: { type: 'string', enum: ['all', 'none', 'track', 'loop'] },
        target: { ...TARGET, description: 'For "track" — which one.' },
      },
      required: ['what'],
    },
  },
  {
    name: 'strip_back',
    description:
      'STRIP BACK — leave only what they name and mute the rest, or bring it all back. "just the drums", "mute everything except the bass and the pad", "strip it back to the vocal", "bring everything back in". The fastest way to hear an arrangement idea, and worth several mute commands.',
    input_schema: {
      type: 'object',
      properties: {
        keep: { type: 'array', items: { type: 'string' }, description: 'The tracks to leave audible.' },
        restore: { type: 'boolean', description: 'True to unmute everything instead.' },
      },
    },
  },
  {
    name: 'chord_inversion',
    description:
      'INVERT A CHORD — move the bottom note up an octave, or the top note down, keeping the same chord. "invert the chords", "take the pad up an inversion", "put it in first inversion", "drop the top note". Changes the voicing and the bass note, not the harmony.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        direction: { type: 'string', enum: ['up', 'down'] },
        times: { type: 'number', description: 'How many inversions. Omit for one.' },
      },
    },
  },
  {
    name: 'modulate',
    description:
      'KEY CHANGE — move the song into a new key from a point onwards. "modulate up a tone for the last chorus", "key change at bar 33", "take it up a semitone from the drop". Transposes the notes from that point AND sets the key, which is the difference between a key change and a transpose.',
    input_schema: {
      type: 'object',
      properties: {
        at: { ...POSITION, description: 'Where the new key starts. Omit for the whole song.' },
        semitones: { type: 'number', description: 'How far. 2 is a tone up, -1 a semitone down.' },
        key: { type: 'string', description: 'Or the key by name: "D minor". Use this OR semitones.' },
      },
    },
  },

  // ── The four the audit called "needs work" ───────────────────────────────
  //
  // Brae: "Let's do the ones that are labeled 'Needs work'... Remember that we
  // are doing it primarily to make it work with AI mode."
  //
  // Written for the ASSISTANT first, which changes how they are shaped. A local
  // rule matches words; a model reads a description and decides. So each of
  // these says what it is FOR and when NOT to reach for it, because the failure
  // mode with a model is not that it cannot find the tool — it is that it uses
  // the wrong one confidently.
  {
    name: 'balance_levels',
    description:
      'BALANCE / LEVEL MATCH / NORMALISE — set track levels by MEASURING them rather than by guessing. "balance the mix", "match the vocal to the guitar", "normalise the drums", "even out the levels", "the bass is too loud compared to everything else". Give `reference` to match everything to one track; omit it to even the whole mix out. ⚠️ Use this when the request is about levels being WRONG RELATIVE TO EACH OTHER. For "turn the pad up", use set_track — that is a direct move and does not need measuring. This one renders the tracks to measure them, so it takes a few seconds and says so.',
    input_schema: {
      type: 'object',
      properties: {
        targets: {
          type: 'array', items: { type: 'string' },
          description: 'Track names to balance. Omit for every audible track.',
        },
        reference: { type: 'string', description: 'A track to match the others to. Omit to even everything out together.' },
      },
    },
  },
  {
    name: 'apply_groove',
    description:
      'GROOVE / FEEL / SHUFFLE — give a part a named feel by moving its notes and shaping its accents. "give the drums a shuffle", "swing the hats", "make the bass laid back", "put the drums back on the grid", "loosen it up". Named feels: straight, light swing, swing, shuffle, laid back, pushed, off-grid, hard accents. ⚠️ This is NOT set_swing — that sets one number for the whole song at playback time; this bakes a feel into one part\'s notes, where you can see it and undo it. Prefer this when they name a FEEL or a part; use set_swing when they ask for a swing percentage on the song.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        groove: { type: 'string', description: 'The feel, as they said it: "shuffle", "a bit of swing", "laid back", "straight".' },
        amount: { type: 'number', description: 'Percent, 0-200. 100 is the template as written.' },
      },
      required: ['groove'],
    },
  },
  {
    name: 'crossfade',
    description:
      'CROSSFADE — fade one clip out as the next fades in, so the join is smooth instead of a click. "crossfade the two vocal takes", "blend those clips together", "smooth the join between the pads". If the clips do not overlap, the second is pulled back to meet the first. ⚠️ For fading a whole TRACK in or out over a section, use automate_parameter instead — that is a volume move over time, not a join between two clips.',
    input_schema: {
      type: 'object',
      properties: {
        first: { ...TARGET, description: 'The clip that fades out. Omit to use the two that overlap.' },
        second: { ...TARGET, description: 'The clip that fades in.' },
        length: LENGTH,
      },
    },
  },
  {
    name: 'stutter',
    description:
      'STUTTER / RETRIGGER / ROLL — chop notes into fast repeats. "stutter the last note", "retrigger the snare at 32nds", "roll the last chord", "make the ending stutter". Classic on the last beat before a drop, and on a snare going into a chorus. `division` is how fast the repeats are: 8, 16 or 32. ⚠️ Only affects notes that are already there — it repeats them, it does not invent new ones.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        division: { type: 'number', description: '8, 16 or 32. Omit for 16ths.' },
        style: {
          type: 'string', enum: ['roll', 'flam', 'ghost'],
          description: 'roll repeats the note (the default); flam adds a grace note just before each hit; ghost adds quiet notes between them.',
        },
        scope: {
          type: 'string', enum: ['last', 'all'],
          description: '"last" repeats only the final note or chord, which is the usual ask. Omit for last.',
        },
      },
    },
  },

  // ── The compound ones ────────────────────────────────────────────────────
  //
  // Brae: "We need to take into consideration more complex tasks so that we can
  // make changes faster for users."
  //
  // Everything below replaces a sequence with a sentence. "Make the pad
  // brighter" is otherwise: add an EQ, find the high band, raise it, find the
  // low band, drop it — five actions and a memory of which band is which. The
  // words people already use for these moves are the fastest interface there
  // is, and they are the words this program did not know.
  {
    name: 'shape_tone',
    description:
      'TONE IN ONE WORD — brighter, darker, warmer, cleaner, punchier, fuller, thinner, softer. "make the pad brighter", "warm up the bass", "the drums need more punch", "clean up the low end". Each one is a small set of EQ or dynamics moves; say `more` or a percentage for a stronger version.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        quality: {
          type: 'string',
          enum: ['brighter', 'darker', 'warmer', 'cleaner', 'punchier', 'softer', 'fuller', 'thinner'],
        },
        amount: { type: 'number', description: 'Percent, 0-100. Omit for a normal move.' },
      },
      required: ['quality'],
    },
  },
  {
    name: 'set_width',
    description:
      'STEREO WIDTH — how far a track spreads. "make the pad wider", "narrow the bass", "put the kick in mono", "collapse it to mono". Bass in mono is the commonest reason anybody asks.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        width: { type: 'string', enum: ['wider', 'narrower', 'mono', 'normal'] },
      },
      required: ['width'],
    },
  },
  {
    name: 'duck_under',
    description:
      'DUCKING / SIDECHAIN — make one track step out of the way of another. "duck the pad under the kick", "sidechain the bass to the kick", "pump the pads with the drums". `target` is the one that gets quieter; `under` is the one it makes room for.',
    input_schema: {
      type: 'object',
      properties: {
        target: { ...TARGET, description: 'The track that will duck.' },
        under: { ...TARGET, description: 'The track it ducks under — usually the kick.' },
        amount: { type: 'number', description: 'Percent, 0-100. Omit for a normal amount.' },
      },
      required: ['under'],
    },
  },
  {
    name: 'time_feel',
    description:
      'FEEL — how the part sits against the beat. "make the drums half time", "double time the hats", "humanize the piano", "push it ahead of the beat", "lay it back", "straighten it out". Half and double time rewrite the note positions; the rest nudge them.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        feel: { type: 'string', enum: ['half', 'double', 'humanize', 'ahead', 'behind', 'straight'] },
        amount: { type: 'number', description: 'Percent, for humanize/ahead/behind.' },
      },
      required: ['feel'],
    },
  },
  {
    name: 'note_length',
    description:
      'ARTICULATION — how long the notes are held. "make the pad legato", "staccato the bass", "shorter notes on the keys", "let the chords ring". Legato joins notes up to the next one; staccato clips them short.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        style: { type: 'string', enum: ['legato', 'staccato', 'longer', 'shorter', 'slide'] },
        amount: { type: 'number', description: 'Percent, 0-100.' },
      },
      required: ['style'],
    },
  },
  {
    name: 'dynamics_ramp',
    description:
      'CRESCENDO / DIMINUENDO — get louder or quieter across a part. "crescendo the strings", "make the drums build", "fade the notes down across the pad". This shapes the note VELOCITIES, so the part plays harder rather than just being turned up.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        direction: { type: 'string', enum: ['crescendo', 'diminuendo'] },
      },
      required: ['direction'],
    },
  },
  {
    name: 'harmonize',
    description:
      'HARMONISE — add a second voice to a part. "harmonise the lead a third above", "add a fifth to the bass", "double it an octave down". Adds notes; it does not replace what is there.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        interval: { type: 'string', description: 'third, fourth, fifth, sixth or octave.' },
        direction: { type: 'string', enum: ['above', 'below'] },
      },
      required: ['interval'],
    },
  },
  {
    name: 'reverse_notes',
    description:
      'REVERSE — play a part backwards. "reverse the arp", "play the melody backwards", "flip the riff". The rhythm is mirrored in time; the notes keep their pitches.',
    input_schema: {
      type: 'object',
      properties: { target: TARGET },
    },
  },
  {
    name: 'section',
    description:
      'SECTIONS — work with a named part of the song. "loop the chorus", "go to the verse", "double the chorus", "how long is the bridge". Sections come from the markers in the song, so this only knows the ones that have been named.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The marker name: chorus, verse, bridge, drop…' },
        action: { type: 'string', enum: ['loop', 'go', 'duplicate', 'move', 'delete'], description: 'Omit for "go". `move` needs `at`.' },
        at: { ...POSITION, description: 'For `move` — where the section goes.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'open_editor',
    description:
      'OPEN SOMETHING — an editor, or a whole part of the app. Editors: "open the sequencer", "show me the piano roll for the pad", "make a new sequencer". Places: "open the video module", "take me to my projects", "open the library", "go to the community". Set `create` when they asked for a NEW editor rather than to see an existing one. ⚠️ Opening a place NAVIGATES — the studio stays open in the background and Light keeps listening, but the screen changes, so only do it when they asked to go somewhere.',
    input_schema: {
      type: 'object',
      properties: {
        editor: {
          type: 'string',
          enum: ['sequencer', 'pianoroll', 'video', 'audio', 'projects', 'library', 'community', 'dashboard', 'settings', 'apps', 'learn'],
          description: 'sequencer for drums, pianoroll for notes — or a place: video, audio (the studio), projects, library, community, dashboard, settings, apps, learn.',
        },
        target: { ...TARGET, description: 'Which track or clip. Omit for the selected one.' },
        create: { type: 'boolean', description: 'True to make a new empty one.' },
      },
      required: ['editor'],
    },
  },
  {
    name: 'record_take',
    description:
      'RECORD BY VOICE — the person wants to SAY a part in time and have it written down. "record a beat", "let me tap in the kick", "record chords into the piano roll", "I want to say the hi-hat part". The studio asks about the click, counts them in, listens, and places what they said on the grid. `drum` records one drum at a time, which is how a kit is usually built.',
    input_schema: {
      type: 'object',
      properties: {
        editor: { type: 'string', enum: ['sequencer', 'pianoroll'] },
        target: { ...TARGET, description: 'Which track or clip to record into. Omit for the selected one.' },
        drum: { type: 'string', description: 'One drum only — "kick", "closed hi hat", "snare". Omit to take whatever they say.' },
        bars: { type: 'number', description: 'How long, in bars. Omit for one.' },
      },
      required: ['editor'],
    },
  },
  {
    name: 'define_word',
    description:
      'SHORTHAND — the person is saying what a word means for this session: "ta means closed hi hat and cha means snare", "one means C major", "let bap be the kick". Pass their sentence through in `phrase` EXACTLY as they said it; the studio parses it. These last until they change them or clear them.',
    input_schema: {
      type: 'object',
      properties: {
        phrase: { type: 'string', description: 'The sentence, verbatim: "ta means closed hi hat, and cha means snare".' },
        clear: { type: 'boolean', description: 'True to forget every shorthand instead.' },
      },
    },
  },
  {
    name: 'metronome',
    description:
      'METRONOME / CLICK — turn the click on or off. "give me a click", "metronome on", "turn the click off", "count me in". Use `on` for the click itself. Say the tempo with set_tempo, not here.',
    input_schema: {
      type: 'object',
      properties: {
        on: { type: 'boolean', description: 'True to start the click, false to stop it.' },
      },
      required: ['on'],
    },
  },
  {
    name: 'name_notes',
    description:
      'WHAT NOTES — name the notes that are playing or selected. "what notes are being played", "what chord is this", "what note is that", "what key am I in". Give `target` to ask about one track or clip; omit it to ask about everything sounding at the playhead.',
    input_schema: {
      type: 'object',
      properties: {
        target: { ...TARGET, description: 'A track or clip to name the notes of. Omit for whatever is at the playhead.' },
      },
    },
  },
  {
    name: 'set_swing',
    description:
      'SWING — how far off the grid the offbeats sit. "add some swing", "swing 30 percent", "straighten it out" is 0.',
    input_schema: {
      type: 'object',
      properties: { amount: { type: 'number', description: 'Percentage, 0 (straight) to 100 (full swing).' } },
      required: ['amount'],
    },
  },
  {
    name: 'add_track',
    description:
      'ADD A TRACK — a new empty track. "add a bass track", "give me another track called Lead".',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'What to call it. Omit for a numbered default.' } },
    },
  },
  {
    name: 'rename_track',
    description:
      'RENAME — change what a track is called. "rename the pad to strings", "call track 2 Lead".',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        name: { type: 'string', description: 'The new name, as spoken.' },
      },
      required: ['target', 'name'],
    },
  },
  {
    name: 'duplicate_track',
    description:
      'DUPLICATE A TRACK — copy a whole track with its clips, effects and settings. "copy the drums track", "duplicate the bass", "make another one of these". ⚠️ Not duplicate_clip: that repeats ONE clip along the timeline on the track it is already on. This makes a second track.',
    input_schema: {
      type: 'object',
      properties: { target: TARGET },
      required: ['target'],
    },
  },
  {
    name: 'remove_track',
    description:
      'DELETE A TRACK — remove a track and everything on it. "delete the guitar track", "get rid of the pad", "remove that track". ⚠️ Destructive and confirmed out loud before it runs. If they only want it quiet, that is set_track with muted — reach for this only when they said delete or remove.',
    input_schema: {
      type: 'object',
      properties: { target: TARGET },
      required: ['target'],
    },
  },
  {
    name: 'add_marker',
    description:
      'MARKER — name a place in the song. "mark this as the chorus", "put a marker at bar 17 called drop".',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'What to call the section.' },
        at: { ...POSITION, description: 'Where. Omit for the playhead.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_effect',
    description:
      'EFFECT — put an effect on a track. "put reverb on the vocals", "add a delay to the guitar". Use set_effect to change how much of one already there.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        effect: { type: 'string', enum: SPEAKABLE_EFFECTS },
        amount: {
          type: 'number',
          description:
            'How much of the effect, 0-100 — more means MORE effect. For a filter that means more filtering: '
            + '100 is as dark as it goes (still audible), 0 leaves it open. Omit for a sensible default.',
        },
      },
      required: ['target', 'effect'],
    },
  },
  {
    name: 'set_effect',
    description:
      'EFFECT AMOUNT — change how much of an effect a track has. "more reverb on the pad", "less delay on the guitar", "take the reverb off the drums" is 0.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        effect: { type: 'string', enum: SPEAKABLE_EFFECTS },
        amount: {
          type: 'number',
          description: 'How much of the effect, 0-100 — more means MORE effect (for a filter, more filtering).',
        },
      },
      required: ['target', 'effect', 'amount'],
    },
  },
  {
    name: 'describe',
    description:
      'ANSWER A QUESTION without changing anything. About the song: "what is the tempo", "how many tracks are there", "is anything muted", "how long is it", "what notes are on the bass". About the LIBRARY: "what dark pads do I have", "what pianos are there" — pass the words they used in `target`. About LOADING: "is it still loading", "is it ready yet".',
    input_schema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: [
            'tempo', 'tracks', 'muted', 'length', 'clips', 'key', 'volume', 'position', 'help',
            // What a part is actually playing, and what is on it. Answerable
            // from the project alone — every note, effect and lane is here.
            'notes', 'effects', 'instrument', 'automation',
            // What is INSTALLED, not what is in the song — the library was
            // unreachable by voice even though the tag matching already existed.
            'library',
            // Whether the song has finished preparing itself. Studio state, not
            // document state, so it is passed in rather than read from the project.
            'loading',
          ],
        },
        target: { ...TARGET, description: 'For "clips" and "volume" — which track they asked about.' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'rename_clip',
    description:
      'RENAME A CLIP — change what one clip is called. "call that clip the intro", "rename the bass clip to verse". Worth doing: every command that takes a target finds things by name, so a well-named clip is an easier one to talk about later. ⚠️ For a TRACK use rename_track.',
    input_schema: {
      type: 'object',
      properties: { target: TARGET, name: { type: 'string' } },
      required: ['target', 'name'],
    },
  },
  {
    name: 'set_key_scale',
    description:
      'KEY — the key and scale the song is in. "put it in F minor", "set the key to D major". Affects the scale highlighting and the note grid, not the notes already written.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'number', description: 'Semitone from C, 0-11. C=0, C#=1, D=2 ... B=11.' },
        scale: { type: 'string', enum: ['major', 'minor', 'penta-maj', 'penta-min', 'dorian', 'chromatic'] },
      },
      required: ['key', 'scale'],
    },
  },
  {
    name: 'remove_clip',
    description:
      'DELETE A CLIP — remove one clip from the arrangement. "delete the second pad clip", "get rid of that clip", "take the crash out of bar 9". ⚠️ Destructive and confirmed before it runs. This removes the clip; remove_track removes the whole track it sits on.',
    input_schema: {
      type: 'object',
      properties: { target: TARGET },
      required: ['target'],
    },
  },
  {
    name: 'set_all_tracks',
    description:
      'EVERY TRACK AT ONCE — "mute everything", "unmute everything", "clear the solo". A forgotten solo is the most common way to lose a track, and clearing it is worth being able to say.',
    input_schema: {
      type: 'object',
      properties: {
        muted: { type: 'boolean' },
        solo: { type: 'boolean', description: 'Only false is useful — soloing everything is soloing nothing.' },
      },
    },
  },
  // ── Editing the notes themselves ─────────────────────────────────────────
  //
  // Brae: "I need to be able to fully edit using voice controls."
  //
  // Everything above changes arrangement or mix. These change the PERFORMANCE,
  // which is the half a musician spends most of their time on and the half the
  // studio had no words for.
  {
    name: 'quantize',
    description:
      'QUANTIZE — pull the notes onto the grid. "quantize the drums", "quantize the bass to eighth notes". Strength 100 snaps exactly; less moves them part of the way, which keeps the feel.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        division: { type: 'number', description: 'Grid in beats: 1 is a quarter note, 0.5 an eighth, 0.25 a sixteenth.' },
        strength: { type: 'number', description: 'Percentage, 0-100. Omit for 100.' },
      },
      required: ['target'],
    },
  },
  {
    name: 'edit_note',
    description:
      'ONE NOTE — put a single note in, or take one out. "put a C on beat three", "add an E flat at bar 5 beat 2", "delete the last note", "take out the highest note". ⚠️ For changing notes in BULK — transposing, quantising, lengthening, making them softer — use those commands instead; this is the one for a single note, which everything else could do except add or remove one.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        action: { type: 'string', enum: ['add', 'remove'] },
        note: { type: 'string', description: 'For add: the note as said — "C", "E flat", "F#4". Without an octave it lands near the rest of the part.' },
        at: POSITION,
        length: LENGTH,
        which: { type: 'string', enum: ['last', 'first', 'highest', 'lowest'], description: 'For remove, when they did not say a pitch.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'set_velocity',
    description:
      'VELOCITY — how hard the notes are played. "make the drums softer", "set the bass velocity to 100", "play it harder".',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        velocity: { type: 'number', description: 'Absolute, 1-127.' },
        scale: { type: 'number', description: 'Or a percentage change: 80 makes everything 80% as hard.' },
      },
      required: ['target'],
    },
  },
  {
    name: 'split_clip',
    description:
      'SPLIT — cut one clip into two at a position. "split the bass at bar 9", "cut the pad in half".',
    input_schema: {
      type: 'object',
      properties: { target: TARGET, at: POSITION },
      required: ['target', 'at'],
    },
  },
  {
    name: 'resize_clip',
    description:
      'LENGTH — make a clip longer or shorter. "make the pad 8 bars long". Notes past the new end are left alone; the clip simply stops there.',
    input_schema: {
      type: 'object',
      properties: { target: TARGET, length: LENGTH },
      required: ['target', 'length'],
    },
  },
  {
    name: 'remove_effect',
    description:
      'TAKE AN EFFECT OFF — remove it from the track entirely, rather than turning it down. "take the reverb off the vocals".',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        effect: { type: 'string', enum: SPEAKABLE_EFFECTS },
      },
      required: ['target', 'effect'],
    },
  },
  {
    name: 'remove_marker',
    description: 'REMOVE A MARKER — take a named place out of the song. "delete the chorus marker", "remove the bridge marker". ⚠️ The sections either side of it merge into one, because a section is the gap between two markers — so removing a marker changes what "loop the chorus" means.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  // ── The library, the note stream, and the mixer's folders ────────────────
  {
    name: 'set_instrument',
    description:
      'SOUND — put a library instrument on a track. "make the bass a violin", "put a piano on the pad". The caller resolves the name against the library and passes the id, because the library lives on the machine rather than in the song.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        presetId: { type: 'string', description: 'Library preset id, already resolved.' },
        presetName: { type: 'string', description: 'What it is called, for the read-back.' },
      },
      required: ['target', 'presetId'],
    },
  },
  {
    name: 'add_midi_effect',
    description:
      'MIDI EFFECT — shapes the NOTES before they reach the instrument, so it changes what is played rather than how it sounds. arp turns held notes into a pattern, chord adds harmony notes above each one, scale snaps everything into key, velocity reshapes dynamics. "arpeggiate the pad", "put a chord effect on the keys".',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        effect: { type: 'string', enum: ['arp', 'chord', 'scale', 'velocity'] },
        rate: { type: 'number', description: 'For arp — in beats. 0.25 is a sixteenth.' },
        style: { type: 'string', enum: ['up', 'down', 'updown', 'random'], description: 'For arp.' },
      },
      required: ['target', 'effect'],
    },
  },
  {
    name: 'remove_midi_effect',
    description: 'MIDI EFFECT (REMOVE) — take a MIDI effect off a track. "stop arpeggiating the pad".',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        effect: { type: 'string', enum: ['arp', 'chord', 'scale', 'velocity'] },
      },
      required: ['target', 'effect'],
    },
  },
  {
    name: 'add_clip_effect',
    description:
      'EFFECT BAR — a stretch of the timeline over which one sound parameter is dialled in and back out. Not an effect on the track: a region on it. "put a low-pass bar on the bass for 4 bars", "add drive over the chorus". The parameter follows a shape across the region, which is what makes it a bar rather than a setting. ⚠️ `target` is a TRACK, despite the name — say the track the bar goes on, not a clip.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        parameter: {
          type: 'string',
          description: 'A sound-shaping field: filterHz (low-pass), highpassHz, drive, reverbWet, delayWet, bitcrush, gain, distortion. Plain words work too — "lowpass", "reverb", "delay", "crush" are understood.',
        },
        amount: { type: 'number', description: 'How far it is dialled in, 0-100.' },
        at: POSITION,
        length: LENGTH,
      },
      required: ['target', 'parameter'],
    },
  },
  {
    name: 'group_tracks',
    description:
      'GROUP — fold tracks into one folder so their volume, mute and effects apply to all of them. "group the drums and the bass", "put the vocals in a group called Backing".',
    input_schema: {
      type: 'object',
      properties: {
        targets: { type: 'array', items: { type: 'string' }, description: 'Track names.' },
        name: { type: 'string', description: 'What to call the group.' },
      },
      required: ['targets'],
    },
  },
  {
    name: 'undo',
    description: 'UNDO — take back the last change. "undo that", "undo", "take that back", "no, put it back how it was". Reach for this whenever they say the last thing was wrong, rather than trying to work out the opposite edit and doing that instead — the opposite of a command is rarely the same as undoing it.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'redo',
    description: 'REDO — put back what was just undone. "redo that", "redo", "actually put it back". Only meaningful straight after an undo.',
    input_schema: { type: 'object', properties: {} },
  },
] as const

/** Every command name, for the executor to check itself against. */
export const MUSIC_TOOL_NAMES = MUSIC_TOOLS.map(t => t.name)

/**
 * What the model needs to know about the song to resolve a name or a bar.
 *
 * Deliberately small — names, tempo, meter, and where the clips are. It goes
 * into every request, and a whole project would be both expensive and worse:
 * the model does not need note data to work out which track "bass 2" is, and
 * sending it invites reasoning about music it cannot hear.
 *
 * Clip positions are given in BARS, because that is the unit every instruction
 * comes back in. Handing the model raw beats would make it do arithmetic that
 * lib/voice/position already does correctly, including across meter changes.
 */
/**
 * What the assistant is told about the song before it answers.
 *
 * ⚠️ This used to be structural only — tempo, meter, track names, which bars
 * hold clips. Everything about how the song SOUNDS was missing: what instrument
 * is on a track, how loud it is, what effects are on it, what the user has
 * selected. So "make this one warmer", "is the bass too loud", "put a phaser on
 * the one I'm on" were unanswerable, and not because the model was weak —
 * nobody had told it. A request that depends on unstated facts gets a guess,
 * and a guess that edits the wrong track is the failure this whole layer exists
 * to avoid.
 *
 * Kept terse on purpose. It is sent on EVERY turn and sits after the cache
 * breakpoint (it changes with every edit, so it cannot be cached), which makes
 * it the part of the prompt that is genuinely paid for each time.
 */
export function musicStateSummary(p: {
  tempo?: number
  timeSignatureNum?: number
  timeSignatureDen?: number
  tempoMarkers?: { beat: number; tempo: number }[]
  meterMarkers?: { beat: number; num: number; den: number }[]
  tracks?: {
    id: string
    name?: string
    volume?: number
    pan?: number
    mute?: boolean
    solo?: boolean
    kind?: string
    instrument?: { type?: string; params?: unknown }
    effects?: { type: string; params?: unknown }[]
  }[]
  arrangementClips?: { trackId: string; name?: string; startBeat: number; durationBeats: number }[]
  selectedTrackId?: string | null
  selectedClipId?: string | null
  /**
   * Was this selected AFTER the assistant's last reply?
   *
   * Brae: "the voice control should keep track of what I'm selecting in case I
   * say something like 'this track'. This would supersede context if the item
   * is selected after the previous context was created."
   *
   * ⚠️ The conversation carries up to forty previous messages, and several of
   * them may be about a track the user has since clicked away from. Pointing at
   * something with the mouse is the most direct statement of what "this" means
   * there is - more direct than anything said earlier - but the model has no
   * way to know the click happened after the sentence unless it is told.
   */
  selectionIsNew?: boolean
}): string {
  const num = p.timeSignatureNum ?? 4
  const den = p.timeSignatureDen ?? 4
  const bar = (beat: number) => Math.floor(beat / Math.max(1, num)) + 1

  // 0–1 fader → dB, because that is the unit the request is spoken in ("a
  // couple of dB down") and the number the user can see on the track.
  const db = (v: number) => (v <= 0.0001 ? '-inf' : `${(20 * Math.log10(v)).toFixed(1)}dB`)
  const panOf = (v: number) =>
    Math.abs(v) < 0.02 ? '' : ` pan ${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`

  const tracks = (p.tracks ?? []).map(t => {
    const clips = (p.arrangementClips ?? []).filter(c => c.trackId === t.id)
    const where = clips.length
      ? clips.slice().sort((a, b) => a.startBeat - b.startBeat)
          .map(c => `${c.name ? `"${c.name}" ` : ''}bar ${bar(c.startBeat)}–${bar(c.startBeat + c.durationBeats)}`)
          .join(', ')
      : 'empty'
    const ip = t.instrument?.params as { pack?: string; presetName?: string; name?: string } | undefined
    const inst = t.instrument ? (ip?.presetName || ip?.name || ip?.pack || t.instrument.type) : undefined
    // The device chain by name, in order — the assistant can now add to it and
    // automate it, so "what is already on this" is a question it has to be able
    // to answer without asking.
    const fx = (t.effects ?? []).map(e => {
      const u = (e.params as { unit?: { type?: string } } | undefined)?.unit
      const name = e.type === 'helios' && u?.type ? `apollo ${u.type}` : e.type
      return (e.params as { enabled?: boolean } | undefined)?.enabled === false ? `${name}(off)` : name
    })
    const flags = [
      t.mute ? 'muted' : '',
      t.solo ? 'soloed' : '',
      t.kind === 'group' ? 'group' : '',
      t.id === p.selectedTrackId ? 'SELECTED' : '',
    ].filter(Boolean)
    return [
      `"${t.name ?? t.id}"`,
      inst ? `[${inst}]` : '',
      typeof t.volume === 'number' ? db(t.volume) : '',
      typeof t.pan === 'number' ? panOf(t.pan).trim() : '',
      fx.length ? `fx: ${fx.join('→')}` : 'no fx',
      flags.length ? `(${flags.join(', ')})` : '',
      `— ${where}`,
    ].filter(Boolean).join(' ')
  })

  const changes = [
    ...(p.tempoMarkers ?? []).map(m => `tempo ${m.tempo} at bar ${bar(m.beat)}`),
    ...(p.meterMarkers ?? []).map(m => `${m.num}/${m.den} at bar ${bar(m.beat)}`),
  ]
  const selClip = p.selectedClipId
    ? (p.arrangementClips ?? []).find(c => (c as { id?: string }).id === p.selectedClipId)
    : undefined
  const selTrack = p.selectedTrackId
    ? (p.tracks ?? []).find(t => t.id === p.selectedTrackId)
    : undefined

  return [
    `${p.tempo ?? 120} bpm, ${num}/${den}.`,
    changes.length ? `Changes: ${changes.join('; ')}.` : '',
    tracks.length ? `Tracks — ${tracks.join(' | ')}.` : 'No tracks yet.',
    // "this one" / "here" have to mean something, and the only thing that can
    // give them meaning is what the user is actually pointing at.
    selClip ? `Selected clip: "${selClip.name ?? p.selectedClipId}" at bar ${bar(selClip.startBeat)}.` : '',
    // Stated as recency, not as a fact about the project, because that is the
    // part the model cannot work out for itself and the part that decides
    // which of two answers is right.
    p.selectionIsNew && (selTrack || selClip)
      ? `⚠️ SELECTED JUST NOW, since your last reply: ${[
        selTrack ? `track "${selTrack.name}"` : '',
        selClip ? `clip "${selClip.name ?? p.selectedClipId}"` : '',
      ].filter(Boolean).join(' and ')}. "this", "that", "it" and "here" mean THAT, and it supersedes anything selected or discussed earlier in this conversation.`
      : '',
  ].filter(Boolean).join(' ')
}

/**
 * A contents page for the toolbox.
 *
 * Brae: "We could also have better descriptions attached to the commands that
 * it's wired into so that it can navigate with more ease."
 *
 * ⚠️ THE DESCRIPTIONS WERE NOT THE WEAK PART — the index was missing. Nearly
 * every tool already opens with what it is for in capitals ("MIXER —",
 * "TEMPO —", "ANY DIAL INSIDE APOLLO, BY NAME —"), which is excellent once you
 * are reading the right one. With seventy-odd of them the harder problem is
 * getting there: the prompt already records what happens when that fails —
 * "a model that cannot find the right tool reaches for a neighbouring one far
 * more readily than it refuses" — which is how asking about a pad changed the
 * tempo.
 *
 * So this lists every tool under its own opening phrase, in one place, as
 * something to scan by intent. GENERATED from the tools themselves: a
 * hand-written index would be wrong within a week, and an index that disagrees
 * with the toolbox is worse than none.
 */
function toolIndex(): string {
  const groups = new Map<string, string[]>()
  for (const t of MUSIC_TOOLS) {
    const d = String(t.description ?? '')
    // The opening phrase, up to the em dash: "MIXER", "ANY DIAL INSIDE APOLLO".
    const head = /^([A-Z][A-Z0-9 /()]{2,60}?)\s+—/.exec(d)?.[1]?.trim() ?? 'OTHER'
    const list = groups.get(head) ?? []
    list.push(t.name)
    groups.set(head, list)
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([head, names]) => `  ${head}: ${names.join(', ')}`)
    .join('\n')
}

export const MUSIC_SYSTEM_HINT = [
  'The user is speaking commands out loud while making music, so the transcript may be casual and may include "Hey Light".',
  // ⚠️ Scan this BEFORE reaching for a tool. Picking a neighbouring tool
  // because the right one was not found is the single most damaging thing
  // that happens here — it edits the wrong part of somebody's song.
  `The tools, grouped by what they are for. Find the group first, then the tool:\n${toolIndex()}`,
  // Measured: "move everything over by one bar and have a 1 bar long crash at
  // the beginning, then restart" came back as ONE call — the move — silently
  // dropping two thirds of the sentence. A spoken sentence is often three
  // instructions joined by "and" and "then", and a half-performed command is
  // worse than a refused one, so this says it twice and gives the example.
  'ONE SENTENCE OFTEN CONTAINS SEVERAL REQUESTS. Emit a tool call for EVERY request in it, in the order they were said, all in this one reply. "Move everything over by one bar and have a 1 bar long crash at the beginning, then restart" is THREE calls: move_clips, insert_clip, transport. Do not stop after the first.',
  'Use the names they used for tracks and clips; the app resolves them against the real project and will refuse rather than guess if a name is ambiguous.',
  // Brae: "I told it 'change reverb so that it stays at 100% until the 6th
  // bar'. It told me 'Reverb at 100%' without changing anything, and moved
  // the playhead to the 6th bar." Three mistakes in one sentence: the span
  // was not recognised, the bar number was read as a destination, and a call
  // that changed nothing was reported as though it had.
  'A TIME WORD TURNS A SETTING INTO A SHAPE. "Make the reverb 100%" is a setting; "keep the reverb at 100% UNTIL BAR 6" is a shape over time, and needs automation — the same request whether it is said as a length ("for 4 bars") or as an endpoint ("until bar 6", "up to the chorus"). Setting the value once satisfies neither.',
  'DO NOT MOVE THE PLAYHEAD UNLESS MOVING IT IS THE REQUEST. A bar or time mentioned inside a larger sentence says WHERE the edit goes; it is not somewhere to go. Moving it is itself an unasked-for change, and it hides the fact that the real request was missed.',
  'IF A CALL WOULD CHANGE NOTHING, SAY SO RATHER THAN REPORTING SUCCESS. Telling somebody "reverb at 100%" when it was already 100% reads as done, and they only find out later that nothing happened. If what they asked for looks like it is already true, say what you found and what you think they meant instead.',
  'Positions are bars and beats counting from 1 ("the beginning" is bar 1). Lengths can be bars, beats or seconds — pass whichever unit they said and let the app convert, because the song may change tempo or time signature part way through.',
  // Brae: "I just said 'Can you make a beat like boom ka boom ka' and it didn't
  // know what I was talking about." Drum syllables look like a transcription
  // failure — the natural instinct is to tidy "boom ka" into "boom car" or to
  // ask what was meant. They are the request.
  'DRUM SYLLABLES ARE A BEAT, NOT A MISHEARING. "boom", "ka", "doom", "ts", "tss", "pah", "bap" and the like are somebody saying a rhythm out loud. "Can you make a beat like boom ka boom ka" is a make_beat call with pattern "boom ka boom ka". Pass the syllables through EXACTLY as they were said — do not correct them into real words, and do not ask what they meant. The rhythm comes from when they were said, so you only need to report which syllables there were, in order.',
  // Brae: "I told it that the pad should be lower and to add sub to pad in
  // Apollo and it just changed the tempo." Both sentences named a track. A
  // model that cannot find the right tool reaches for a neighbouring one far
  // more readily than it refuses, and the global commands are the most
  // dangerous neighbours there are — they change everything at once and look
  // nothing like what was asked for.
  // Apollo is the instrument this app is built around, and the reason the last
  // wrong-tool bug happened was that its layers were not reachable at all. The
  // assistant has to know the whole synth is now within reach, or it goes on
  // reaching for neighbours.
  // Said ONCE here instead of repeated into every tool schema — see the note
  // above POSITION. Identical information, ~2,500 tokens cheaper per command.
  'SHARED ARGUMENTS. `target` is a track or clip name exactly as spoken ("bass 2", "the pad") and the app resolves it — never an id, and "this"/"it" means whatever is selected. `at`/`from`/`to` are a place in the song: give `bar` counting from 1, optionally `beat` within that bar counting from 1, or `seconds` from the start if they gave a time. `length` is a duration: `bars`, `beats` or `seconds`, whichever they said. "The beginning" is bar 1.',
  'APOLLO\'S DIALS ARE REACHABLE, ITS SWITCHES ARE NOT. set_apollo_param sets any of the 166 numbered parameters — filter cutoff and resonance, envelope stages, oscillator tuning and level, wavetable position, scan, granular and spectral controls, LFO rates, macros, glide. set_apollo_filter chooses the filter MODEL and set_apollo_layer brings in the sub, the noise or an oscillator. What is NOT reachable yet: which ENGINE an oscillator runs (wavetable, sample, granular, spectral), warp MODES, unison, octave switches, the modulation matrix and the arpeggiator. Say plainly that you cannot do those rather than choosing a nearby dial instead. Do not answer an Apollo question with an EFFECT (add_effect, set_effect) unless they asked for a separate device: the synth\'s own filter and an effect filter after it are different sounds and different things to undo.',
  'IF THE SENTENCE NAMES A TRACK, THE COMMAND IS ABOUT THAT TRACK. Never answer a sentence that names a track with a song-wide change — set_tempo, set_time_signature, set_key_scale, set_master_volume and set_swing are about the WHOLE SONG and are almost never what somebody naming one track meant. "The pad should be lower" is the pad\'s volume. If you cannot find a tool for what they asked about that track, SAY SO in one sentence — a wrong global change is far worse than an admission, because it is loud, immediate and affects everything they have made.',
  'POINTING BEATS REMEMBERING. If the state summary says something was selected just now, "this track", "that clip", "it" and "here" mean the thing that is selected — even when an earlier message in this conversation was about something else. Somebody who clicks a track and then says "mute this" has told you which track twice, and the click is the more recent of the two.',
  'Percentages are 0-100. If a request is ambiguous or no tool fits, say so in one short sentence instead of guessing.',
].join(' ')
