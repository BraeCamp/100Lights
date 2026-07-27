// The canonical genre list. Before creating ANY audio in the program (article
// demo clips, widget grooves, demo projects, starter templates), pick a genre
// from here and vary the tempo / key / rhythm / instrumentation accordingly —
// so the app's music represents many styles, not one house loop. See CONTEXT.md
// ("diversify the music"). Loop specs for a subset are implemented in
// lib/article-loop.ts; demo projects can pick a genre with `pickGenre()`.

export type Scale = 'major' | 'minor' | 'dorian' | 'phrygian' | 'mixolydian' | 'lydian'

export interface Genre {
  id: string
  name: string
  bpm: number          // representative tempo
  swing: number        // 0 = straight … ~0.62 heavy shuffle
  scale: Scale
  feel: string         // rhythm + instrumentation character, to guide creation
  drums: 'four-floor' | 'backbeat' | 'breakbeat' | 'half-time' | 'trap' | 'dembow' | 'none' | 'shuffle' | 'syncopated'
}

export const GENRES: Genre[] = [
  { id: 'house',       name: 'House',            bpm: 124, swing: 0,    scale: 'minor',      drums: 'four-floor', feel: 'Four-on-the-floor kick, off-beat open hats, bright stabs, driving bass.' },
  { id: 'deep-house',  name: 'Deep House',       bpm: 120, swing: 0.06, scale: 'minor',      drums: 'four-floor', feel: 'Warm pads, jazzy 7th chords, soft four-floor, rolling sub bass.' },
  { id: 'techno',      name: 'Techno',           bpm: 132, swing: 0,    scale: 'minor',      drums: 'four-floor', feel: 'Hypnotic, hard kick, minimal, percussive loops, tension over melody.' },
  { id: 'trance',      name: 'Trance',           bpm: 138, swing: 0,    scale: 'minor',      drums: 'four-floor', feel: 'Uplifting supersaw arps, big rolling bass, euphoric breakdowns.' },
  { id: 'dnb',         name: 'Drum & Bass',      bpm: 174, swing: 0,    scale: 'minor',      drums: 'breakbeat',  feel: 'Fast chopped breakbeats, deep sub / reese bass, sparse pads.' },
  { id: 'dubstep',     name: 'Dubstep',          bpm: 140, swing: 0,    scale: 'minor',      drums: 'half-time',  feel: 'Half-time drums, heavy wobble/growl bass, big drops.' },
  { id: 'trap',        name: 'Trap',             bpm: 140, swing: 0,    scale: 'minor',      drums: 'trap',       feel: 'Rolling triplet hats, booming 808 sub, sparse dark keys.' },
  { id: 'boombap',     name: 'Boom-Bap',         bpm: 90,  swing: 0.58, scale: 'minor',      drums: 'shuffle',    feel: 'Swung dusty drums, punchy kick/snare, sampled soul chords, walking bass.' },
  { id: 'lofi',        name: 'Lo-Fi Hip-Hop',    bpm: 72,  swing: 0.58, scale: 'major',      drums: 'shuffle',    feel: 'Sparse laid-back beat, warm jazzy keys, vinyl character, soft bass.' },
  { id: 'future-bass', name: 'Future Bass',      bpm: 150, swing: 0,    scale: 'major',      drums: 'half-time',  feel: 'Detuned supersaw chords, pitched vocal chops, big half-time drops.' },
  { id: 'synthwave',   name: 'Synthwave',        bpm: 100, swing: 0,    scale: 'minor',      drums: 'backbeat',   feel: 'Retro 80s analog synths, gated snare, arpeggios, neon nostalgia.' },
  { id: 'ambient',     name: 'Ambient',          bpm: 68,  swing: 0,    scale: 'lydian',     drums: 'none',       feel: 'No beat, evolving pads and textures, long reverbs, space and stillness.' },
  { id: 'rock',        name: 'Rock',             bpm: 120, swing: 0,    scale: 'major',      drums: 'backbeat',   feel: 'Loud backbeat kit, distorted guitars, driving root-note bass.' },
  { id: 'pop',         name: 'Pop',              bpm: 116, swing: 0,    scale: 'major',      drums: 'backbeat',   feel: 'Clean punchy drums, catchy hook, bright synths, simple diatonic chords.' },
  { id: 'rnb',         name: 'R&B / Neo-Soul',   bpm: 88,  swing: 0.55, scale: 'minor',      drums: 'shuffle',    feel: 'Smooth swung groove, lush extended 7th/9th chords, mellow keys, round bass.' },
  { id: 'funk',        name: 'Funk',             bpm: 108, swing: 0.16, scale: 'dorian',     drums: 'syncopated', feel: 'Syncopated tight drums, slap bass, wah guitar, horn stabs.' },
  { id: 'reggaeton',   name: 'Reggaeton',        bpm: 94,  swing: 0,    scale: 'minor',      drums: 'dembow',     feel: 'Dembow rim/snare pattern, deep bass, sparse minor melody.' },
  { id: 'bossa-nova',  name: 'Bossa Nova',       bpm: 130, swing: 0,    scale: 'major',      drums: 'syncopated', feel: 'Gentle brush-like clave, nylon guitar comping, jazzy chords, soft.' },
  { id: 'afrobeat',    name: 'Afrobeat',         bpm: 110, swing: 0.1,  scale: 'mixolydian', drums: 'syncopated', feel: 'Layered polyrhythmic percussion, guitar/keys ostinatos, bright horns.' },
  { id: 'disco',       name: 'Disco',            bpm: 120, swing: 0,    scale: 'major',      drums: 'four-floor', feel: 'Four-floor with open hats, string stabs, octave bass, live-band feel.' },
]

export const genreById = (id: string): Genre | undefined => GENRES.find(g => g.id === id)

/** Pick a genre for a new piece of audio. Pass a seed (e.g. a slug or index) so
 *  it's stable/varied per caller instead of everything defaulting to house. */
export function pickGenre(seed?: string | number): Genre {
  if (typeof seed === 'string') {
    let h = 0
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0x7fffffff
    return GENRES[h % GENRES.length]
  }
  if (typeof seed === 'number') return GENRES[Math.abs(Math.floor(seed)) % GENRES.length]
  return GENRES[0]
}
