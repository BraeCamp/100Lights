// Learning paths — ordered sequences of Learn articles that teach one skill
// end-to-end ("make your first beat", "mix so it doesn't sound muddy").
//
// This is a code registry (like lib/genres.ts / lib/article-tools.ts): the
// single source of truth for what paths exist and their order. Pages resolve
// each slug against the live article set (lib/learn-articles.ts) at render, so
// an article that isn't published yet simply shows as "coming soon" and never
// breaks the path. Add a path by adding an entry here; reorder by moving slugs.

export type PathLevel = 'beginner' | 'intermediate' | 'advanced'

export interface LearnPath {
  slug: string
  title: string
  /** The promise — what the reader will be able to DO at the end. */
  goal: string
  /** Short blurb for cards. */
  description: string
  emoji: string
  level: PathLevel
  /** Ordered article slugs (may reference not-yet-published articles). */
  articleSlugs: string[]
}

export const LEARN_PATHS: LearnPath[] = [
  {
    slug: 'make-your-first-beat',
    title: 'Make Your First Beat',
    goal: 'Go from never opening a DAW to a beat with groove — counting, tempo, drums, and swing.',
    description: 'The true starting line. No theory for its own sake — just the handful of things you need before anything else makes sense.',
    emoji: '🥁',
    level: 'beginner',
    articleSlugs: [
      'what-is-a-daw-beginners-guide',
      'what-are-bars-and-beats',
      'what-is-bpm-choosing-your-tempo',
      'how-to-make-a-beat-in-your-browser',
      'add-swing-to-your-beat',
    ],
  },
  {
    slug: 'chords-and-harmony',
    title: 'Chords & Harmony From Scratch',
    goal: 'Build chords, find a song’s key by ear, and write progressions that actually go somewhere.',
    description: 'The one note that flips a chord from bright to dark, the key under any song, and the progressions producers reach for on repeat.',
    emoji: '🎹',
    level: 'beginner',
    articleSlugs: [
      'major-vs-minor-happy-or-sad',
      'what-key-is-this-in',
      'five-chord-progressions-every-producer-should-know',
      'same-four-chords-five-genres',
      'andalusian-cadence-one-progression-four-genres',
    ],
  },
  {
    slug: 'melodies-and-bass',
    title: 'Write Melodies & Basslines',
    goal: 'Write a melody without a keyboard, steal licks the right way, and design a bass that fills the low end.',
    description: 'The piano roll is an instrument you already own. Learn to write lines by ear and shape the bass underneath them.',
    emoji: '🎼',
    level: 'intermediate',
    articleSlugs: [
      'piano-roll-basics-melodies-without-a-keyboard',
      'ten-licks-worth-stealing',
      'build-a-reese-bass-from-scratch',
      'code-a-poly-track-with-math',
    ],
  },
  {
    slug: 'mix-it-clean',
    title: 'Mix So It Doesn’t Sound Muddy',
    goal: 'Balance a mix with volume, pan, and EQ, then use reverb and sidechain without turning it to mush.',
    description: 'Why your track sounds cloudy and cramped — and the small handful of moves that open it up. Ears first, plugins second.',
    emoji: '🎚️',
    level: 'intermediate',
    articleSlugs: [
      'mixing-101-volume-pan-eq',
      'how-to-use-reverb-without-drowning-your-mix',
      'sidechain-compression-with-your-ears',
      'can-you-hear-the-difference',
      'you-dont-need-better-gear',
    ],
  },
  {
    slug: 'loop-to-finished-song',
    title: 'Turn a Loop Into a Finished Song',
    goal: 'Break out of the 8-bar loop: arrange sections, automate movement, and actually finish tracks.',
    description: 'You have a great loop and no song. This is the arranging and finishing habit that turns one into the other.',
    emoji: '🎵',
    level: 'intermediate',
    articleSlugs: [
      'why-your-loop-gets-boring',
      'song-structure-and-why-eight-bars',
      'automation-loop-into-song',
      'session-view-vs-arrangement-view',
      'you-have-nine-unfinished-projects',
    ],
  },
]
