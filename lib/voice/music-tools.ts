// What the assistant is allowed to do to a song.
//
// These are the tools Claude may call when someone speaks a command in Beacon,
// and they are the security boundary of the whole voice feature: free-form text
// goes IN, and only a call to one of these names, with these fields, comes out.
// The executor (lib/voice/execute-music.ts) refuses anything else by name, so a
// model that invents `delete_everything` gets an error message rather than an
// effect.
//
// They are deliberately shaped like the sentence a musician says, not like the
// reducer underneath. Brae's example is "loop 'bass 2' 3 more times and add an
// ascending low pass filter from 80% to 0% over the first 8 seconds of it" —
// that is two calls, and each field is a thing he actually said. Anything the
// app has to work out (which clip, how many beats 8 seconds is, whether a Crash
// track already exists) is the executor's job, because it can be tested and a
// language model cannot.
//
// Every duration accepts seconds OR bars OR beats, because people mix them
// freely in one breath — "eight seconds", "one bar", "two beats".

export const MUSIC_TOOLS = [
  {
    name: 'loop_clip',
    description:
      'Repeat a clip N more times, back to back, immediately after itself. Use for "loop the bass 3 more times", "double that", "repeat it twice".',
    input_schema: {
      type: 'object',
      properties: {
        clip: { type: 'string', description: 'What the user called it — a clip name or a track name, exactly as spoken ("bass 2").' },
        times: { type: 'number', description: 'How many EXTRA copies. "3 more times" is 3.' },
      },
      required: ['clip', 'times'],
    },
  },
  {
    name: 'filter_sweep',
    description:
      'Add a filter to a clip\'s track and automate its cutoff from one value to another over a span of time. Use for "a low pass sweep from 80% to 0% over the first 8 seconds", "open the filter up across the intro".',
    input_schema: {
      type: 'object',
      properties: {
        clip: { type: 'string', description: 'Clip or track name as spoken.' },
        type: { type: 'string', enum: ['lowpass', 'highpass'], description: 'Defaults to lowpass.' },
        from: { type: 'number', description: 'Starting cutoff as a percentage, 0-100. "from 80%" is 80.' },
        to: { type: 'number', description: 'Ending cutoff as a percentage, 0-100.' },
        seconds: { type: 'number', description: 'How long the sweep lasts, in seconds.' },
        bars: { type: 'number', description: 'How long the sweep lasts, in bars (instead of seconds).' },
        startSeconds: { type: 'number', description: 'Offset from the start of the clip. Omit for "the first N seconds of it".' },
      },
      required: ['clip', 'from', 'to'],
    },
  },
  {
    name: 'shift_all',
    description:
      'Move every clip in the arrangement later or earlier. Use for "move everything over by one bar", "push it all back 2 bars". Negative moves earlier.',
    input_schema: {
      type: 'object',
      properties: { bars: { type: 'number', description: 'Bars to move by. Negative moves earlier.' } },
      required: ['bars'],
    },
  },
  {
    name: 'add_drum_hit',
    description:
      'Put a drum sound in the arrangement — a crash, a kick, a snare. Reuses a track of that name if one exists. Use for "have a 1 bar long crash at the beginning".',
    input_schema: {
      type: 'object',
      properties: {
        sound: { type: 'string', description: 'crash, kick, snare, hat …' },
        atBar: { type: 'number', description: 'Bar to place it at, counting from 1. "at the beginning" is 1.' },
        bars: { type: 'number', description: 'How long it lasts, in bars.' },
      },
      required: ['sound'],
    },
  },
  {
    name: 'set_tempo',
    description: 'Change the song tempo. Use for "take it to 128", "slow it down to 90".',
    input_schema: {
      type: 'object',
      properties: { bpm: { type: 'number' } },
      required: ['bpm'],
    },
  },
  {
    name: 'set_track',
    description:
      'Mute, solo or set the volume of one track. Use for "mute the hats", "bring the bass up", "solo the vocal".',
    input_schema: {
      type: 'object',
      properties: {
        track: { type: 'string', description: 'Track name as spoken.' },
        muted: { type: 'boolean' },
        solo: { type: 'boolean' },
        volume: { type: 'number', description: 'Volume as a percentage, 0-100.' },
      },
      required: ['track'],
    },
  },
  {
    name: 'transport',
    description: 'Play, stop or restart playback. Use for "then restart", "play it", "stop".',
    input_schema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['play', 'stop', 'pause', 'restart', 'toggle'] } },
      required: ['action'],
    },
  },
] as const

/**
 * What the model needs to know about the song to resolve a name.
 *
 * Deliberately small: names, tempo, and where the clips are. It goes into every
 * request, and a whole project would be both expensive and worse — the model
 * does not need note data to work out which track "bass 2" is, and sending it
 * invites the model to reason about music it cannot hear.
 */
export function musicStateSummary(p: {
  tempo?: number
  timeSignatureNum?: number
  tracks?: { id: string; name?: string }[]
  arrangementClips?: { trackId: string; name?: string; startBeat: number; durationBeats: number }[]
}): string {
  const tempo = p.tempo ?? 120
  const sig = p.timeSignatureNum ?? 4
  const tracks = (p.tracks ?? []).map(t => {
    const clips = (p.arrangementClips ?? []).filter(c => c.trackId === t.id)
    const where = clips.length
      ? clips.map(c => `bar ${Math.round(c.startBeat / sig) + 1}+${Math.round(c.durationBeats / sig)}`).join(', ')
      : 'empty'
    return `"${t.name ?? t.id}" (${clips.length} clip${clips.length === 1 ? '' : 's'}: ${where})`
  })
  return [
    `${tempo} bpm, ${sig}/4.`,
    tracks.length ? `Tracks: ${tracks.join('; ')}.` : 'No tracks yet.',
  ].join(' ')
}

export const MUSIC_SYSTEM_HINT =
  'The user is speaking commands out loud while making music, so the transcript may be casual, may include "Hey Light", and may run several requests into one sentence — call one tool per request, in the order they said them. Use the names they used; the app resolves them against the real project. Percentages are 0-100. Bars count from 1. If a request is ambiguous or you cannot do it with the tools, say so briefly instead of guessing.'
