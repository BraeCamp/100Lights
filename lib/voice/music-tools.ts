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
const POSITION = {
  type: 'object',
  description: 'A place in the song. Give bar (+ optional beat), or seconds. Bars and beats count from 1.',
  properties: {
    bar: { type: 'number', description: 'Bar number, counting from 1. "the beginning" is bar 1.' },
    beat: { type: 'number', description: 'Beat within that bar, counting from 1.' },
    seconds: { type: 'number', description: 'Seconds from the start, if they gave a time instead.' },
  },
} as const

const LENGTH = {
  type: 'object',
  description: 'A length of time. Give bars, beats, or seconds — whichever they said.',
  properties: {
    bars: { type: 'number' },
    beats: { type: 'number' },
    seconds: { type: 'number' },
  },
} as const

const TARGET = {
  type: 'string',
  description: 'What they called it — a track or clip name, exactly as spoken ("bass 2"). The app resolves it.',
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
      'AUTOMATION — write a ramp on a parameter over a span of the song. This is what "an ascending low pass filter from 80% to 0% over the first 8 seconds", "fade the volume out over the last 2 bars", "open the filter across the intro" mean.',
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
    description: 'TEMPO — change the song tempo in BPM. "take it to 128", "slow down to 90".',
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
      'TRANSPORT — play, stop, or return to the start. ALWAYS call this when the sentence ends with "then restart", "then play it", "and play it back", or similar: "restart" means go back to the beginning and play, and it is a real request like any other, not a closing remark. "go to bar 9" moves the playhead.',
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
      'DUPLICATE A TRACK — copy a whole track with its clips and effects. Not the same as duplicate_clip, which repeats one clip along the timeline.',
    input_schema: {
      type: 'object',
      properties: { target: TARGET },
      required: ['target'],
    },
  },
  {
    name: 'remove_track',
    description:
      'DELETE A TRACK — remove it and everything on it. Destructive: the caller confirms before this runs.',
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
      'ANSWER A QUESTION about the song without changing anything. "what is the tempo", "how many tracks are there", "is anything muted", "how long is it", "how many clips are on the bass".',
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
      'RENAME A CLIP — change what one clip is called. Mostly reached by accepting the offer made when a clip and its track share a name.',
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
      'DELETE A CLIP — remove one clip from the arrangement. Destructive: the caller confirms before this runs.',
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
    description: 'REMOVE A MARKER — "delete the chorus marker".',
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
    description: 'Take a MIDI effect off a track. "stop arpeggiating the pad".',
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
      'EFFECT BAR — a stretch of the timeline over which one sound parameter is dialled in and back out. Not an effect on the track: a region on it. "put a low-pass bar on the bass for 4 bars", "add drive over the chorus". The parameter follows a shape across the region, which is what makes it a bar rather than a setting.',
    input_schema: {
      type: 'object',
      properties: {
        target: TARGET,
        parameter: {
          type: 'string',
          description: 'A sound-shaping field: filterHz, highpassHz, drive, reverbWet, delayWet, bitcrush, gain, distortion.',
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
    description: 'UNDO — take back the last change. Carried out by the editor, which owns the history.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'redo',
    description: 'REDO — put back what was just undone.',
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

  return [
    `${p.tempo ?? 120} bpm, ${num}/${den}.`,
    changes.length ? `Changes: ${changes.join('; ')}.` : '',
    tracks.length ? `Tracks — ${tracks.join(' | ')}.` : 'No tracks yet.',
    // "this one" / "here" have to mean something, and the only thing that can
    // give them meaning is what the user is actually pointing at.
    selClip ? `Selected clip: "${selClip.name ?? p.selectedClipId}" at bar ${bar(selClip.startBeat)}.` : '',
  ].filter(Boolean).join(' ')
}

export const MUSIC_SYSTEM_HINT = [
  'The user is speaking commands out loud while making music, so the transcript may be casual and may include "Hey Light".',
  // Measured: "move everything over by one bar and have a 1 bar long crash at
  // the beginning, then restart" came back as ONE call — the move — silently
  // dropping two thirds of the sentence. A spoken sentence is often three
  // instructions joined by "and" and "then", and a half-performed command is
  // worse than a refused one, so this says it twice and gives the example.
  'ONE SENTENCE OFTEN CONTAINS SEVERAL REQUESTS. Emit a tool call for EVERY request in it, in the order they were said, all in this one reply. "Move everything over by one bar and have a 1 bar long crash at the beginning, then restart" is THREE calls: move_clips, insert_clip, transport. Do not stop after the first.',
  'Use the names they used for tracks and clips; the app resolves them against the real project and will refuse rather than guess if a name is ambiguous.',
  'Positions are bars and beats counting from 1 ("the beginning" is bar 1). Lengths can be bars, beats or seconds — pass whichever unit they said and let the app convert, because the song may change tempo or time signature part way through.',
  // Brae: "I just said 'Can you make a beat like boom ka boom ka' and it didn't
  // know what I was talking about." Drum syllables look like a transcription
  // failure — the natural instinct is to tidy "boom ka" into "boom car" or to
  // ask what was meant. They are the request.
  'DRUM SYLLABLES ARE A BEAT, NOT A MISHEARING. "boom", "ka", "doom", "ts", "tss", "pah", "bap" and the like are somebody saying a rhythm out loud. "Can you make a beat like boom ka boom ka" is a make_beat call with pattern "boom ka boom ka". Pass the syllables through EXACTLY as they were said — do not correct them into real words, and do not ask what they meant. The rhythm comes from when they were said, so you only need to report which syllables there were, in order.',
  'Percentages are 0-100. If a request is ambiguous or no tool fits, say so in one short sentence instead of guessing.',
].join(' ')
