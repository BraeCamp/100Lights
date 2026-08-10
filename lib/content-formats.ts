// Content taxonomy for the social test — every post is tagged by FORMAT + HOOK + PLATFORM so we can
// rank what actually retains and, later, have the program suggest the highest-odds format/hook. Client-
// safe (no DB) so the app and the CLI logger share one vocabulary. This is a disposable research corpus
// (see lib/content-metrics.ts purge) — kept only until the model is trained off it.

export interface ContentFormat { id: string; name: string; hook: string; makesWith: string }

// The formats we're testing (ranked fit for a music/audio brand — retention × automatable × demos 100Lights).
export const CONTENT_FORMATS: ContentFormat[] = [
  { id: 'multi-genre',   name: 'Same melody, N genres',        hook: '"This melody as lofi → trap → orchestral…"',        makesWith: 'compose/Claude-music + song-video' },
  { id: 'guess-the',     name: 'Guess the genre/instrument',   hook: '"Can you name this in 3 notes?"',                    makesWith: '/play widgets, screen-recorded' },
  { id: 'before-after',  name: 'Before → After transform',     hook: '"I turned this hum into a song"',                    makesWith: 'ElevenLabs raw→shaped / history-capture' },
  { id: 'satisfying',    name: 'Satisfying falling-notes',     hook: 'audio-visual sync, no words needed',                 makesWith: 'song-video falling-notes template' },
  { id: 'tip',           name: '30-sec production tip',        hook: '"The trick pros use for [X]"',                       makesWith: 'Capture (screen-record + highlights)' },
  { id: 'speedrun',      name: 'Built this beat in 30s',       hook: 'speed challenge + satisfying build',                 makesWith: 'history-capture timelapse' },
  { id: 'ai-novelty',    name: 'AI turned my voice into X',    hook: 'surprise transformation',                           makesWith: 'Firefly / VoiceMIDI' },
  { id: 'trend-remix',   name: 'Trending sound, recreated',    hook: '"why this sound is everywhere"',                     makesWith: 'compose + Capture, from the trends page' },
]

// Hook archetypes — the first <3s decides everything, so we tag the hook TYPE separately from the format.
export const HOOK_TYPES = [
  'value-upfront',   // states the payoff in words immediately
  'curiosity-gap',   // poses a question, answers later
  'transformation',  // "before → after" tease
  'interactive',     // asks the viewer to guess/answer
  'satisfying',      // pure audio-visual, no verbal hook
  'bold-claim',      // "the only X you need"
  'trend',           // rides a trending sound/topic
] as const
export type HookType = typeof HOOK_TYPES[number]

export const PLATFORMS = ['youtube', 'tiktok', 'reels', 'shorts', 'other'] as const
export type Platform = typeof PLATFORMS[number]

export const isFormat = (id: string) => CONTENT_FORMATS.some(f => f.id === id)
