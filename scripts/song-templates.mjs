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

export const TEMPLATES = {
  // 1 ── SLOW BURN — sparse long-note opening that swells into a full peak.
  'slow-burn': {
    name: 'Slow Burn',
    desc: 'Starts bare and patient, then swells section by section into a big emotional peak.',
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
      'guitar-burn': { sig: 'guitar' },
      'analog-rise': { presets: { pad: 'builtin-29' }, sig: 'space' },
      'strings-lift': { presets: { lead: 'builtin-24', pad: 'builtin-6' }, sig: 'space' },
    },
  },

  // 2 ── CLUB TOOL — hypnotic four-on-the-floor loop built for DJ mixing.
  'club-tool': {
    name: 'Club Tool',
    desc: 'Relentless four-on-the-floor groove — tight lineup, heavy sidechain pump, long mixable intro/outro.',
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
      'rolling-bass': { genre: 'deep-house', presets: { bass: 'builtin-4' } },
      'stab-house': { genre: 'house', presets: { keys: 'builtin-1' } },
      'hypno-arp': { genre: 'techno', presets: { arp: 'builtin-8' } },
      'trance-pulse': { genre: 'trance', presets: { arp: 'builtin-3' }, sig: 'space' },
    },
  },

  // 3 ── BEAT TAPE — short, swung lo-fi loop; mellow, no big arc.
  'beat-tape': {
    name: 'Beat Tape',
    desc: 'Short, dusty, swung loop — keys-and-bass forward, no builds or drops, just a mood.',
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
      'boom-bap': { genre: 'boombap' },
      'chillhop': { genre: 'lofi', presets: { keys: 'builtin-27' } },
      'tape-soul': { genre: 'rnb', presets: { keys: 'builtin-26' } },
    },
  },

  // 4 ── POP SONG — verse/chorus/bridge, hook-forward, final-chorus key change.
  'pop-song': {
    name: 'Pop Song',
    desc: 'Bright verse–chorus–bridge structure with a hook up front and a lift into the last chorus.',
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
      'dance-pop': { genre: 'disco', sig: 'pump' },
      'synth-pop': { genre: 'synthwave', sig: 'space' },
      'funk-pop': { genre: 'funk' },
      'bright-pop': { genre: 'pop' },
    },
  },

  // 5 ── AMBIENT DRIFT — no drums, evolving pads, very long notes.
  'ambient-drift': {
    name: 'Ambient Drift',
    desc: 'Beatless, weightless — evolving pads and long tones drifting through slow filter motion.',
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
      'drone': { presets: { pad: 'builtin-29', lead: 'builtin-43' } },
      'glass-arp': { presets: { arp: 'builtin-39' } },
      'piano-space': { presets: { keys: 'builtin-2', lead: 'builtin-2' } },
      'warm-analog': { presets: { pad: 'builtin-6' } },
    },
  },

  // 6 ── FESTIVAL DROP — EDM build→drop with risers, impacts, false-drops.
  'festival-drop': {
    name: 'Festival Drop',
    desc: 'Big-room build-and-drop energy — risers, impacts, false-drops and stacked leads at the peak.',
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
      'melodic-drop': { genre: 'future-bass', sig: 'space' },
      'bass-drop': { genre: 'dubstep', sig: 'crush' },
      'trance-peak': { genre: 'trance', sig: 'space' },
      'liquid-dnb': { genre: 'dnb', sig: 'space' },
    },
  },

  // 7 ── GROOVE JAM — funk/disco live-band feel, syncopated and humanized.
  'groove-jam': {
    name: 'Groove Jam',
    desc: 'Live-band pocket — syncopated, humanized, bass-and-keys forward with riffing leads.',
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
      'funk-jam': { genre: 'funk', sig: 'crush' },
      'disco-strut': { genre: 'disco', sig: 'pump' },
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
  return {
    templateId: tid, templateName: t.name, variantName: vname, genreId,
    opts: {
      tempo,
      sig: sig || undefined,
      formFamily: t.formFamily,
      lengthen: t.lengthen,
      roster: t.roster,
      bias: { ...(t.bias || {}), ...(v.bias || {}) },
      presets: { ...(t.presets || {}), ...(v.presets || {}) },
      templateName: t.name,
      variantName: vname,
    },
  }
}
