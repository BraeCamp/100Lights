// Tags for the things in the library that are not samples — drum patterns and
// recipes — and the filter that reads them.
//
// Brae: "the pattern section looks good though it needs a filter system. The
// recipe section should look like that and stuff should be taken out of
// folders, but they need to keep the tags and maybe add more and a filter
// system should be applied to that too."
//
// Nothing here is typed in by hand for every row. A pattern's name and
// description already say its genre and feel, and its hits say how busy it is
// and what it uses; a recipe's title, tagline, genre and notes say the same
// for chords. Written tags, where they exist, come first and are never
// dropped. Derived ones follow, so a new pattern added tomorrow is filterable
// the day it lands.

import type { DrumPattern } from './drum-presets'
import type { PracticeRecipe } from './practice-recipes'

const GENRE_WORDS: [RegExp, string][] = [
  [/\bhouse\b/i, 'House'], [/\bdeep house\b/i, 'Deep House'], [/\btech house\b/i, 'Tech House'],
  [/\btechno\b/i, 'Techno'], [/\btrance\b/i, 'Trance'], [/\bedm\b/i, 'EDM'], [/\bdubstep\b/i, 'Dubstep'],
  [/\bdrum ?(?:and|&|n)? ?bass\b|\bdnb\b|\bjungle\b/i, 'Drum & Bass'], [/\bgarage\b|\buk garage\b|\b2-?step\b/i, 'UK Garage'],
  [/\bhip[ -]?hop\b|\bboom ?bap\b/i, 'Hip-Hop'], [/\btrap\b/i, 'Trap'], [/\bdrill\b/i, 'Drill'], [/\blo-?fi\b/i, 'Lo-Fi'],
  [/\brock\b/i, 'Rock'], [/\bpunk\b/i, 'Punk'], [/\bmetal\b/i, 'Metal'], [/\bpop\b/i, 'Pop'], [/\bindie\b/i, 'Indie'],
  [/\bdisco\b/i, 'Disco'], [/\bfunk\b/i, 'Funk'], [/\bsoul\b/i, 'Soul'], [/\br&b\b|\brnb\b/i, 'R&B'], [/\bjazz\b|\bswing\b/i, 'Jazz'],
  [/\bblues\b/i, 'Blues'], [/\bbreak ?beat\b|\bamen\b/i, 'Breakbeat'], [/\breggaeton\b|\bdembow\b/i, 'Reggaeton'],
  [/\breggae\b|\bdub\b/i, 'Reggae'], [/\bafro ?beat\b|\bafro\b/i, 'Afrobeat'], [/\blatin\b|\bsamba\b|\bbossa\b|\bsalsa\b|\bcumbia\b/i, 'Latin'],
  [/\bjersey\b/i, 'Jersey Club'], [/\bfootwork\b|\bjuke\b/i, 'Footwork'], [/\bambient\b/i, 'Ambient'], [/\bcinematic\b|\bfilm\b/i, 'Cinematic'],
  [/\bclassical\b|\bbaroque\b/i, 'Classical'], [/\bcountry\b|\bfolk\b/i, 'Folk'], [/\bworld\b/i, 'World'], [/\bgospel\b/i, 'Gospel'],
  [/\bsynthwave\b|\bretro\b|\b80s\b/i, 'Synthwave'], [/\bphonk\b/i, 'Phonk'], [/\bbounce\b/i, 'Bounce'],
  [/\bamapiano\b/i, 'Amapiano'], [/\bdancehall\b|\briddim\b/i, 'Dancehall'], [/\bska\b/i, 'Ska'], [/\bmotown\b/i, 'Motown'],
  [/\bnew jack\b/i, 'New Jack Swing'], [/\bneo[ -]?soul\b/i, 'Neo-Soul'], [/\bhyperpop\b/i, 'Hyperpop'], [/\bhardstyle\b|\bgabber\b|\bhardcore\b/i, 'Hardcore'],
  [/\bfuture bass\b/i, 'Future Bass'], [/\bliquid\b/i, 'Liquid'], [/\bbig room\b|\bfestival\b/i, 'Big Room'], [/\bprogressive\b/i, 'Progressive'],
  [/\bbaile\b|\btamborz/i, 'Baile Funk'], [/\bballad\b/i, 'Ballad'], [/\bclave\b/i, 'Clave'], [/\bconga\b|\bpercussion\b/i, 'Percussion'],
]
const FEEL_WORDS: [RegExp, string][] = [
  [/\bswing\b|\bshuffle\b/i, 'Swing'], [/\bhalf[ -]?time\b/i, 'Half-Time'], [/\bdouble[ -]?time\b/i, 'Double-Time'],
  [/\broll\b|\brolling\b/i, 'Hat Roll'], [/\bfill\b/i, 'Fill'], [/\bsyncopat/i, 'Syncopated'], [/\bstraight\b/i, 'Straight'],
  [/\bghost/i, 'Ghost Notes'], [/\btriplet/i, 'Triplets'], [/\bfour[ -]on[ -]the[ -]floor\b|\bfour[ -]floor\b/i, 'Four on the Floor'],
  [/\bbackbeat\b/i, 'Backbeat'], [/\bbroken\b/i, 'Broken'], [/\bminimal\b/i, 'Minimal'], [/\bheavy\b|\bhard\b/i, 'Heavy'],
  [/\bdark\b/i, 'Dark'], [/\bbright\b|\bsparkle\b/i, 'Bright'], [/\blaid[ -]back\b|\brelaxed\b|\bchill\b/i, 'Laid-back'],
  [/\bdriving\b|\benergetic\b|\bpunchy\b/i, 'Driving'], [/\bdusty\b|\bcrushed\b|\bvinyl\b/i, 'Dusty'],
]
const MOOD_WORDS: [RegExp, string][] = [
  [/\bsad\b|\bmelanchol/i, 'Sad'], [/\bhappy\b|\buplifting\b|\bjoy/i, 'Happy'], [/\bdark\b|\bbrooding\b|\bominous\b/i, 'Dark'],
  [/\bbright\b/i, 'Bright'], [/\bdream/i, 'Dreamy'], [/\btense\b|\btension\b|\bsuspense/i, 'Tense'], [/\bwarm\b/i, 'Warm'],
  [/\bepic\b|\bcinematic\b|\bhuge\b/i, 'Epic'], [/\bnostalg/i, 'Nostalgic'], [/\bhopeful\b/i, 'Hopeful'], [/\bromantic\b|\blove\b/i, 'Romantic'],
  [/\bgroov/i, 'Groovy'], [/\bfunky\b/i, 'Funky'], [/\bmellow\b|\bsoft\b|\bgentle\b/i, 'Mellow'], [/\bheavy\b|\bhard\b|\baggressive\b/i, 'Heavy'],
]
const FORM_WORDS: [RegExp, string][] = [
  [/\bwalking bass\b|\bbass ?line\b|\bbass\b/i, 'Bass'], [/\barp(?:eggio|eggiat)?/i, 'Arpeggio'], [/\bpad\b/i, 'Pad'],
  [/\bmelody\b|\bhook\b|\briff\b|\blead\b/i, 'Melody'], [/\bprogression\b|\bchords?\b|\bcadence\b|\bturnaround\b/i, 'Chords'],
  [/\b12[ -]bar\b|\btwelve[ -]bar\b/i, '12-Bar'], [/\bminor\b|\bvi\b|\bii\b/i, 'Minor'], [/\bmajor\b/i, 'Major'],
  [/\bmodal\b|\bdorian\b|\blydian\b|\bmixolydian\b|\bphrygian\b/i, 'Modal'], [/\bseventh|\b7ths?\b|\bmaj7\b|\bm7\b|\bdominant\b/i, '7ths'],
  [/\bsus\b|\bsuspended\b/i, 'Sus'], [/\bostinato\b|\bloop\b|\bvamp\b/i, 'Vamp'], [/\bstab/i, 'Stabs'], [/\bdrone\b/i, 'Drone'],
]

function words(text: string, table: [RegExp, string][]): string[] {
  const out: string[] = []
  for (const [re, tag] of table) if (re.test(text) && !out.includes(tag)) out.push(tag)
  return out
}
function uniq(tags: string[]): string[] {
  const seen = new Set<string>()
  return tags.filter(t => { const k = t.toLowerCase(); if (!t || seen.has(k)) return false; seen.add(k); return true })
}

/**
 * Every tag a drum pattern answers to: what it was tagged, then the genre and
 * feel its name and description say, then what its hits say — how busy it is,
 * which lanes it uses, whether it is a one-bar loop or a phrase.
 */
export function patternTags(p: Pick<DrumPattern, 'name' | 'desc' | 'bars' | 'hits' | 'builtIn'> & { tags?: string[] }): string[] {
  const text = `${p.name} ${p.desc}`
  const hits = Object.values(p.hits ?? {}).reduce((n, steps) => n + (steps?.length ?? 0), 0)
  const steps = Math.max(1, (p.bars || 1) * 16)
  const density = hits / steps
  const lanes = Object.keys(p.hits ?? {}).filter(k => (p.hits[k]?.length ?? 0) > 0)
  const derived = [
    ...words(text, GENRE_WORDS),
    ...words(text, FEEL_WORDS),
    density < 0.3 ? 'Sparse' : density > 0.7 ? 'Busy' : 'Medium',
    lanes.includes('openHat') ? 'Open Hats' : '',
    lanes.includes('clap') ? 'Claps' : '',
    lanes.includes('rim') ? 'Rimshot' : '',
    lanes.some(k => /tom/i.test(k)) ? 'Toms' : '',
    (p.bars ?? 1) > 1 ? `${p.bars} bars` : '1 bar',
    p.builtIn === false ? 'Mine' : '',
  ]
  return uniq([...(p.tags ?? []), ...derived])
}

/**
 * Every tag a recipe answers to: its genre and its written tags first, then
 * what the title and tagline say (form, mood, key colour), then what the
 * notes say — chords or a single line, how long, how low.
 */
export function recipeTags(
  r: Pick<PracticeRecipe, 'id' | 'title' | 'tagline' | 'genre' | 'tags'>,
  spec?: { notes: { pitch: number; startBeat: number; durationBeats: number }[]; durationBeats?: number } | null,
): string[] {
  const text = `${r.title} ${r.tagline}`
  const derived: string[] = [r.genre ?? '', ...words(text, FORM_WORDS), ...words(text, MOOD_WORDS), ...words(text, GENRE_WORDS)]
  if (spec?.notes?.length) {
    const notes = spec.notes
    // Chords: two or more notes starting together, anywhere in the part.
    const byStart = new Map<number, number>()
    for (const n of notes) { const k = Math.round(n.startBeat * 8); byStart.set(k, (byStart.get(k) ?? 0) + 1) }
    const stacked = [...byStart.values()].filter(c => c >= 2).length
    derived.push(stacked >= Math.max(1, byStart.size * 0.4) ? 'Chords' : 'Single Line')
    const beats = Math.max(spec.durationBeats ?? 0, ...notes.map(n => n.startBeat + n.durationBeats))
    const bars = Math.max(1, Math.round(beats / 4))
    derived.push(bars <= 1 ? '1 bar' : bars <= 4 ? `${bars} bars` : bars <= 8 ? '8 bars' : 'Long')
    const mean = notes.reduce((s, n) => s + n.pitch, 0) / notes.length
    // Middle C and the octave above it is where chords are voiced; "High"
    // starts where a melody sits above them.
    derived.push(mean < 48 ? 'Low' : mean < 72 ? 'Mid' : 'High')
    const avgLen = notes.reduce((s, n) => s + n.durationBeats, 0) / notes.length
    if (avgLen >= 2) derived.push('Sustained')
    else if (avgLen <= 0.5) derived.push('Rhythmic')
  }
  if (r.id.startsWith('user-')) derived.push('Mine')
  if (r.id.startsWith('community-')) derived.push('Community')
  return uniq([...(r.tags ?? []), ...derived])
}

/** Every tag across a set, with counts, most common first — the filter bar. */
export function tagCounts<T>(items: T[], tagsOf: (t: T) => string[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const it of items) for (const t of new Set(tagsOf(it))) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** Does an item carry EVERY active tag? A filter narrows; it never widens. */
export function matchesTags(tags: string[], active: Iterable<string>): boolean {
  const mine = new Set(tags.map(t => t.toLowerCase()))
  for (const a of active) if (!mine.has(a.toLowerCase())) return false
  return true
}

/** A search box over the same words: name, description and tags. */
export function matchesQuery(text: string, tags: string[], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${text} ${tags.join(' ')}`.toLowerCase().includes(q)
}
