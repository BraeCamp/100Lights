// ── Song TEMPLATES — a song-TYPE axis above genre ─────────────────────────────
//
// The genre engine (compose.mjs) already varies progressions, timbres and a big
// seed-gated technique palette — but every song still funnels through one
// "full produced arrangement" character. A TEMPLATE is a *character*, not a
// parts-list: it reshapes the WHOLE song — its tempo band, structure, which
// layers exist, how it breathes (dynamics/mix) — so two templates sound like
// different KINDS of music, not the same song in a new key.
//
// Each template draws a genre from its own pool and carries VARIANTS, so even
// two songs from one template differ (different sub-style, timbre, mix). On top
// of that the composition seed varies everything else. So:
//   template  → the kind of song (slow burn vs club tool vs beat tape…)
//   variant   → a sub-flavor within that kind (piano-swell vs guitar-burn…)
//   seed      → everything else (progressions, motif, entry order, textures…)
//
// A template supplies overrides the composer reads through `opts`:
//   tempo       [lo,hi]   picked per seed; omit → use the genre's own bpm
//   formFamily  'edm'|'song'|'loop'   structure archetype (overrides genre default)
//   lengthen    number    scale section lengths (slow, spacious forms)
//   sig         mix signature ('space'|'crush'|'pump'|'guitar')
//   roster      { drums:'full'|'none', ensembles:[[roles…]…] }  the LINEUP
//   bias        forced technique switches (see compose — each is `bias?.x ?? default`)
//   presets     per-role timbre overrides { keys,pad,lead,bass,arp } (builtin-N)
// Variants override any of: genre, sig, bias, presets.

// ── MOODS — the "feeling" of a song, connected to templates ───────────────────
//
// Brae: "assign feelings to each recipe and pattern so the computer uses darker
// sounds in dark music — less note change, lower. Connect feelings and apply them
// to templates, which changes the foundation and rhythm."
//
// A mood reshapes the FOUNDATION (register, brightness, harmony darkness, timbre)
// and the LEAD/RHYTHM (how much the lead moves, whether there's a lead at all,
// drum energy). Templates carry a mood; variants may override it. compose reads
// `opts.mood` and applies every field.
//
//   leadRegister  semitones added to the lead's (now lower) base — dark = lower
//   leadMotion    0..1  how busy the lead is: 0 = held/repeated & resty, 1 = running
//   leadPolicy    'none' | 'sparse' | 'peak' | 'featured'  — how present the lead is
//   bright        0..1  scales the energy→cutoff curve — dark music stays darker
//   drumEnergy    added to each section's drum energy (dark/chill = calmer)
//   darkness      0..1  target harmonic darkness; recipes are scored & matched
//   swing         optional swing override (0..~0.3)
export const MOODS = {
  dark:        { leadRegister: -12, leadMotion: 0.22, leadPolicy: 'sparse',   bright: 0.5,  drumEnergy: -0.05, darkness: 0.85 },
  melancholic: { leadRegister: -12, leadMotion: 0.38, leadPolicy: 'peak',     bright: 0.62, drumEnergy: -0.03, darkness: 0.7 },
  tense:       { leadRegister: -12, leadMotion: 0.5,  leadPolicy: 'peak',     bright: 0.6,  drumEnergy: 0.02,  darkness: 0.75 },
  chill:       { leadRegister: -12, leadMotion: 0.32, leadPolicy: 'sparse',   bright: 0.72, drumEnergy: -0.05, darkness: 0.45 },
  dreamy:      { leadRegister: -7,  leadMotion: 0.3,  leadPolicy: 'sparse',   bright: 0.82, drumEnergy: -0.04, darkness: 0.5 },
  warm:        { leadRegister: -7,  leadMotion: 0.5,  leadPolicy: 'peak',     bright: 0.85, drumEnergy: 0,     darkness: 0.35 },
  bright:      { leadRegister: 0,   leadMotion: 0.7,  leadPolicy: 'featured', bright: 1.0,  drumEnergy: 0.03,  darkness: 0.15 },
  energetic:   { leadRegister: -5,  leadMotion: 0.85, leadPolicy: 'featured', bright: 1.0,  drumEnergy: 0.05,  darkness: 0.3 },
}

export const TEMPLATES = {
  // 1 ── SLOW BURN — sparse long-note opening that swells into a full peak.
  'slow-burn': {
    name: 'Slow Burn',
    desc: 'Starts bare and patient, then swells section by section into a big emotional peak.',
    mood: 'melancholic',
    genres: ['ambient', 'synthwave', 'future-bass', 'trance', 'rnb'],
    tempo: [72, 100],
    formFamily: 'edm',
    lengthen: 1.4,
    sig: 'space',
    roster: { ensembles: [
      ['keys', 'pad', 'lead'], ['pad', 'lead'], ['keys', 'pad', 'lead', 'counter'],
      ['pad', 'lead', 'counter'], ['keys', 'pad', 'arp'],
    ] },
    bias: { introStyle: 'soft', filterArc: true, sweeps: true, rolls: false, riser: true,
      impact: true, stutter: false, halfTime: false, humanize: 0.012, voicing: 'open' },
    variants: {
      'piano-swell': { presets: { keys: 'builtin-2', lead: 'builtin-2' }, sig: 'space' },
      'guitar-burn': { sig: 'guitar', mood: 'dark' },
      'analog-rise': { presets: { pad: 'builtin-30' }, sig: 'space', mood: 'dreamy' },
      'strings-lift': { presets: { lead: 'builtin-24', pad: 'builtin-28' }, sig: 'space', mood: 'warm' },
    },
  },

  // 2 ── CLUB TOOL — hypnotic four-on-the-floor loop built for DJ mixing.
  'club-tool': {
    name: 'Club Tool',
    desc: 'Relentless four-on-the-floor groove — tight lineup, heavy sidechain pump, long mixable intro/outro.',
    mood: 'energetic',
    genres: ['house', 'deep-house', 'techno', 'trance'],
    tempo: [122, 130],
    formFamily: 'edm',
    sig: 'pump',
    roster: { ensembles: [
      ['keys', 'pad'], ['keys', 'arp'], ['pad', 'arp'], ['keys', 'pad', 'arp'], ['pad', 'lead'],
    ] },
    bias: { sidechain: true, introStyle: 'layered', filterArc: true, sweeps: true, rolls: true,
      riser: true, impact: true, stutter: false, halfTime: false, keyChange: false, humanize: 0, voicing: 'close' },
    variants: {
      'rolling-bass': { genre: 'deep-house', presets: { bass: 'builtin-4' }, mood: 'chill' },
      'stab-house': { genre: 'house', presets: { keys: 'builtin-1' } },
      'hypno-arp': { genre: 'techno', presets: { arp: 'builtin-8' }, mood: 'tense' },
      'trance-pulse': { genre: 'trance', presets: { arp: 'builtin-3' }, sig: 'space', mood: 'dreamy' },
    },
  },

  // 3 ── BEAT TAPE — short, swung lo-fi loop; mellow, no big arc.
  'beat-tape': {
    name: 'Beat Tape',
    desc: 'Short, dusty, swung loop — keys-and-bass forward, no builds or drops, just a mood.',
    mood: 'chill',
    genres: ['lofi', 'boombap', 'rnb'],
    tempo: [70, 92],
    formFamily: 'loop',
    sig: null,
    roster: { ensembles: [
      ['keys', 'pad'], ['keys', 'lead'], ['keys', 'pad', 'lead'], ['keys', 'arp'], ['pad', 'lead'],
    ] },
    bias: { introStyle: 'plain', filterArc: true, sweeps: false, rolls: false, riser: false,
      impact: false, stutter: false, halfTime: false, keyChange: false, humanize: 0.015, voicing: 'open' },
    variants: {
      'dusty-jazz': { genre: 'lofi', presets: { keys: 'builtin-2', lead: 'builtin-36' } },
      'boom-bap': { genre: 'boombap', mood: 'dark' },
      'chillhop': { genre: 'lofi', presets: { keys: 'builtin-27' } },
      'tape-soul': { genre: 'rnb', presets: { keys: 'builtin-26' }, mood: 'warm' },
    },
  },

  // 4 ── POP SONG — verse/chorus/bridge, hook-forward, final-chorus key change.
  'pop-song': {
    name: 'Pop Song',
    desc: 'Bright verse–chorus–bridge structure with a hook up front and a lift into the last chorus.',
    mood: 'bright',
    genres: ['pop', 'disco', 'funk', 'synthwave'],
    tempo: [100, 124],
    formFamily: 'song',
    sig: null,
    roster: { ensembles: [
      ['keys', 'lead'], ['keys', 'pad', 'lead'], ['keys', 'lead', 'counter'], ['keys', 'pad', 'lead', 'counter'],
    ] },
    bias: { introStyle: 'layered', filterArc: false, sweeps: false, rolls: true, riser: false,
      impact: false, stutter: false, keyChange: true, humanize: 0.008, voicing: 'close' },
    variants: {
      'dance-pop': { genre: 'disco', sig: 'pump', mood: 'energetic' },
      'synth-pop': { genre: 'synthwave', sig: 'space', mood: 'dreamy' },
      'funk-pop': { genre: 'funk', mood: 'warm' },
      'bright-pop': { genre: 'pop' },
    },
  },

  // 5 ── AMBIENT DRIFT — no drums, evolving pads, very long notes.
  'ambient-drift': {
    name: 'Ambient Drift',
    desc: 'Beatless, weightless — evolving pads and long tones drifting through slow filter motion.',
    mood: 'dreamy',
    genres: ['ambient'],
    tempo: [60, 82],
    formFamily: 'edm',
    lengthen: 1.6,
    sig: 'space',
    roster: { drums: 'none', ensembles: [
      ['pad', 'lead'], ['keys', 'pad'], ['pad', 'arp'], ['keys', 'pad', 'lead'], ['pad', 'lead', 'counter'],
    ] },
    bias: { introStyle: 'soft', filterArc: true, sweeps: true, rolls: false, riser: false,
      impact: false, stutter: false, halfTime: false, keyChange: false, humanize: 0.02, voicing: 'open' },
    variants: {
      'drone': { presets: { pad: 'builtin-13', lead: 'builtin-43' }, mood: 'dark' },
      'glass-arp': { presets: { arp: 'builtin-39' } },
      'piano-space': { presets: { keys: 'builtin-2', lead: 'builtin-2' } },
      'warm-analog': { presets: { pad: 'builtin-30' }, mood: 'warm' },
    },
  },

  // 6 ── FESTIVAL DROP — EDM build→drop with risers, impacts, false-drops.
  'festival-drop': {
    name: 'Festival Drop',
    desc: 'Big-room build-and-drop energy — risers, impacts, false-drops and stacked leads at the peak.',
    mood: 'energetic',
    genres: ['future-bass', 'dubstep', 'trance', 'dnb'],
    // no tempo override → each genre keeps its own idiomatic bpm
    formFamily: 'edm',
    sig: 'space',
    roster: { ensembles: [
      ['keys', 'pad', 'lead', 'arp'], ['pad', 'lead', 'arp'], ['keys', 'lead', 'arp'], ['keys', 'pad', 'lead'],
    ] },
    bias: { introStyle: 'layered', filterArc: true, sweeps: true, rolls: true, riser: true,
      impact: true, stutter: true, falseDrop: true, humanize: 0, voicing: 'open' },
    variants: {
      'melodic-drop': { genre: 'future-bass', sig: 'space', mood: 'dreamy' },
      'bass-drop': { genre: 'dubstep', sig: 'crush', mood: 'tense' },
      'trance-peak': { genre: 'trance', sig: 'space' },
      'liquid-dnb': { genre: 'dnb', sig: 'space', mood: 'dreamy' },
    },
  },

  // 7 ── GROOVE JAM — funk/disco live-band feel, syncopated and humanized.
  'groove-jam': {
    name: 'Groove Jam',
    desc: 'Live-band pocket — syncopated, humanized, bass-and-keys forward with riffing leads.',
    mood: 'warm',
    genres: ['funk', 'disco', 'afrobeat', 'rnb'],
    tempo: [100, 120],
    formFamily: 'song',
    sig: null,
    roster: { ensembles: [
      ['keys', 'lead'], ['keys', 'pad', 'lead'], ['keys', 'lead', 'counter'], ['keys', 'arp', 'lead'],
    ] },
    bias: { introStyle: 'layered', filterArc: false, sweeps: false, rolls: false, riser: false,
      impact: false, stutter: false, halfTime: false, humanize: 0.015, voicing: 'inv1' },
    variants: {
      'funk-jam': { genre: 'funk', sig: 'crush', mood: 'energetic' },
      'disco-strut': { genre: 'disco', sig: 'pump', mood: 'energetic' },
      'afro-groove': { genre: 'afrobeat' },
      'neo-soul': { genre: 'rnb', presets: { keys: 'builtin-2' } },
    },
  },
}

// Resolve a template (+ optional forced variant/genre) into concrete compose opts.
// Deterministic given `rand` — same seed → same variant/genre/tempo picks.
export function resolveTemplate(tid, rand, { variant, genre } = {}) {
  const t = TEMPLATES[tid]
  if (!t) throw new Error(`unknown template "${tid}" — try: ${Object.keys(TEMPLATES).join(', ')}`)
  // Decorrelate: the resolver draws only 2-3 values, and the LCG's first outputs
  // for nearby seeds are near-identical — so warm it up first, or every seed near
  // N picks the same variant/genre. A few steps amplify seed differences.
  for (let i = 0; i < 6; i++) rand()
  const vnames = Object.keys(t.variants || {})
  const vname = (variant && t.variants?.[variant]) ? variant : (vnames.length ? rand.pick(vnames) : null)
  const v = vname ? t.variants[vname] : {}
  const genreId = genre || v.genre || rand.pick(t.genres)
  const tempo = t.tempo ? rand.int(t.tempo[0], t.tempo[1]) : undefined
  const sig = v.sig !== undefined ? v.sig : t.sig
  const moodName = v.mood || t.mood || null
  const mood = moodName ? MOODS[moodName] : null
  return {
    templateId: tid, templateName: t.name, variantName: vname, genreId, moodName,
    opts: {
      tempo,
      sig: sig || undefined,
      formFamily: t.formFamily,
      lengthen: t.lengthen,
      roster: t.roster,
      bias: { ...(t.bias || {}), ...(v.bias || {}) },
      presets: { ...(t.presets || {}), ...(v.presets || {}) },
      mood, moodName,
      templateName: t.name,
      variantName: vname,
    },
  }
}
