// Content recipe catalog for the make-content producer + A/B testing across channels.
//
// The song-video engine ships 10 visual FORMATS (lib/song-video/formats.mjs):
//   falling-notes · piano · stems · eq-bars · bars · waveform · radial · flow · tunnel · lights
// Cross those with genres + hooks + lengths and you get a huge, diverse content surface. Each
// EXPERIMENT below changes exactly ONE variable across its variants — that's what makes it a clean
// A/B test: post variant A to channel A and variant B to channel B, then compare views/retention.

export const VISUALS = {
  'falling-notes': 'piano-roll notes raining onto a keybed (approved flagship look)',
  piano:           'a lit piano keyboard, keys firing with the notes',
  stems:           'stacked stem lanes lighting up per track',
  'eq-bars':       'classic reactive spectrum bars',
  bars:            'chunky beat-driven bars, big on the drop',
  waveform:        'a living waveform ribbon',
  radial:          'circular radial burst synced to the beat',
  flow:            'flowing particle field, ambient',
  tunnel:          'first-person light tunnel, hypnotic',
  lights:          'soft bokeh light points blooming to the music',
}

// Backing genres sheet-accompany / ElevenLabs can target. Ordered loosely by TikTok tailwind.
export const GENRES = ['phonk', 'drift phonk', 'lofi hip hop', 'hip hop', 'synthwave', 'trap', 'ambient', 'house', 'dnb', 'cinematic']

// On-screen hook lines (the engine shows a 2-part hook). Hook framing is the single biggest lever on
// retention — these lean into the research: transformation, curiosity, POV, education, flex.
export const HOOKS = {
  aiWrote:      [{ text: 'an AI wrote this' }, { text: 'in one pass.', accent: true }],
  madeInBrowser:[{ text: 'made entirely' }, { text: 'in a browser.', accent: true }],
  sameMelody:   [{ text: 'same melody.' }, { text: 'different genre.', accent: true }],
  guessGenre:   [{ text: 'guess the genre' }, { text: 'before the drop', accent: true }],
  povFinished:  [{ text: 'POV: you finally' }, { text: 'finished a song', accent: true }],
  waitForIt:    [{ text: 'wait for the' }, { text: 'drop 🎧', accent: true }],
  howLong:      [{ text: 'this took' }, { text: '4 minutes.', accent: true }],
  studyThis:    [{ text: 'lock in.' }, { text: 'focus mode.', accent: true }],
}

// ── EXPERIMENTS ──────────────────────────────────────────────────────────────
// Each experiment = a base spec + variants that flip ONE variable. `channelHint` suggests which
// A/B channel each variant should go to (the producer tags posts; you map hints → real channels).
export const EXPERIMENTS = [
  {
    id: 'visual-showdown', tests: 'which VISUAL format retains best (same song)',
    base: { genre: 'drift phonk', hook: 'waitForIt', seconds: 15, song: 'auto' },
    variants: [
      { label: 'A-falling-notes', visual: 'falling-notes', channelHint: 'A' },
      { label: 'B-lights',        visual: 'lights',        channelHint: 'B' },
      { label: 'C-tunnel',        visual: 'tunnel',        channelHint: 'C' },
    ],
  },
  {
    id: 'hook-showdown', tests: 'which HOOK line wins (same song + visual)',
    base: { genre: 'phonk', visual: 'falling-notes', seconds: 15, song: 'auto' },
    variants: [
      { label: 'A-aiWrote',   hook: 'aiWrote',    channelHint: 'A' },
      { label: 'B-povFinished',hook: 'povFinished', channelHint: 'B' },
      { label: 'C-guessGenre', hook: 'guessGenre',  channelHint: 'C' },
    ],
  },
  {
    id: 'genre-showdown', tests: 'which GENRE pulls best (same visual + hook)',
    base: { visual: 'falling-notes', hook: 'madeInBrowser', seconds: 15, song: 'auto' },
    variants: [
      { label: 'A-phonk',     genre: 'phonk',        channelHint: 'A' },
      { label: 'B-lofi',      genre: 'lofi hip hop', channelHint: 'B' },
      { label: 'C-synthwave', genre: 'synthwave',    channelHint: 'C' },
    ],
  },
  {
    id: 'length-showdown', tests: 'does 8s or 21s retain better (same everything)',
    base: { genre: 'trap', visual: 'bars', hook: 'waitForIt', song: 'auto' },
    variants: [
      { label: 'A-8s',  seconds: 8,  channelHint: 'A' },
      { label: 'B-21s', seconds: 21, channelHint: 'B' },
    ],
  },
  {
    id: 'same-melody', tests: 'the "one melody, N genres" format vs a single-genre cut',
    base: { visual: 'piano', hook: 'sameMelody', seconds: 20, song: 'auto' },
    variants: [
      { label: 'A-multi', multiGenre: ['phonk', 'lofi hip hop', 'house'], channelHint: 'A' },
      { label: 'B-single', genre: 'phonk',                                channelHint: 'B' },
    ],
  },
  {
    id: 'vibe-loop', tests: 'ambient "study/drive to this" loops vs energetic cut',
    base: { seconds: 30, song: 'auto' },
    variants: [
      { label: 'A-ambient', genre: 'ambient',    visual: 'flow',    hook: 'studyThis',  channelHint: 'A' },
      { label: 'B-energy',  genre: 'drift phonk', visual: 'radial', hook: 'waitForIt', channelHint: 'B' },
    ],
  },
]

// Flatten experiments → concrete render jobs (base merged with each variant).
export function renderJobs(experimentIds = null) {
  const chosen = experimentIds ? EXPERIMENTS.filter(e => experimentIds.includes(e.id)) : EXPERIMENTS
  const jobs = []
  for (const exp of chosen) {
    for (const v of exp.variants) {
      jobs.push({
        experiment: exp.id, tests: exp.tests, variant: v.label, channelHint: v.channelHint,
        ...exp.base, ...v,   // variant overrides base
      })
    }
  }
  return jobs
}
