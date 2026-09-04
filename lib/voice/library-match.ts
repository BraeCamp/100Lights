// Finding a library sound from what was SAID about it.
//
// Brae: "I asked for it to change presets and it didn't understand. It said
// 'There is no hihat sample' but it should be in the sample library as a whole
// folder."
//
// Three things went wrong at once, and this is the one matcher that answers
// for all of them, in both places a sound is chosen — the rules and the
// planner — so the two cannot drift apart again:
//
//   • A NAME was only ever matched word for word. "Hi-Hat" folds to "hi hat",
//     two words, and the recogniser wrote "hihat", one — so the library's own
//     hi-hat was invisible. Names now match squashed too: "hi hat" ⇄ "hihat".
//   • A FOLDER was never a way to ask. A folder of forty hats is what a person
//     means by "a hihat"; naming one takes the plainest sound in it.
//   • A KIND was never a way to ask either. Every drum in the library carries
//     a category — kick, snare, hihat, clap — and "a hihat" names the kind, not
//     a file. The kind picks a sound that IS that kind.
//
// ⚠️ Kinds and folders are wider than names, and the words are ordinary — "kick"
// is also a track, "make the kick louder" is not a request for a kick sample.
// So in the rules (strict) a kind or folder only counts when the sentence is
// visibly about a sound: it says preset / sample / sound / instrument, or the
// phrase sits where an object goes — "to a hihat", "put a hi hat on". The
// planner, which only runs once the assistant has decided the sentence IS an
// instrument change, matches loosely.
import { foldName } from './resolve'

export interface LibrarySoundLike {
  id: string
  name: string
  group?: string
  folder?: string | null
  category?: string | null
  tags?: string[] | null
}

export interface LibraryHit {
  sound: LibrarySoundLike
  /** The sentence tokens that named it — so the track can be read from the rest. */
  words: string[]
  by: 'name' | 'kind' | 'folder'
}

/** What people call each drum category. Folded already; longest first. */
export const KIND_WORDS: Record<string, string[]> = {
  'open-hihat': ['open hi hat', 'open hihat', 'open hat', 'open hats'],
  'hihat': ['closed hi hat', 'closed hihat', 'closed hat', 'hi hat', 'hi hats', 'hihat', 'hihats', 'hats', 'hat'],
  'kick': ['kick drum', 'bass drum', 'kicks', 'kick'],
  '808': ['eight oh eight', '808'],
  'snare': ['snare drum', 'snares', 'snare'],
  'clap': ['hand clap', 'handclap', 'claps', 'clap'],
  'tom': ['tom tom', 'toms', 'tom'],
  'crash': ['crash cymbal', 'crash'],
  'ride': ['ride cymbal', 'ride'],
  'rim': ['rim shot', 'rimshot', 'side stick', 'sidestick', 'rim'],
  'shaker': ['shakers', 'shaker'],
}

const SOUND_WORDS = new Set(['preset', 'presets', 'sample', 'samples', 'sound', 'sounds', 'instrument', 'instruments', 'patch', 'kit', 'kits'])
const ARTICLES = new Set(['a', 'an', 'the', 'some', 'that', 'this'])
const OBJECT_VERBS = new Set(['to', 'into', 'with', 'use', 'using', 'load', 'put', 'swap', 'for', 'as', 'try'])

/** "hat" is "hats" is "hat". */
const same = (a: string, b: string) => a === b || a + 's' === b || a === b + 's'

/** A token as the rules hand it over ("hi-hat", "808's") split into the plain
 *  words a name folds to, each remembering which token it came from — so the
 *  words returned for the track to be read from are the tokens themselves. */
interface Piece { word: string; from: number }
function pieces(tokens: string[]): Piece[] {
  const out: Piece[] = []
  // Split on the hyphen and drop the apostrophe, but keep every word — the
  // guard below needs "the" and "a", which foldName throws away.
  tokens.forEach((t, from) => {
    for (const word of t.toLowerCase().replace(/[''`]/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean)) out.push({ word, from })
  })
  return out
}

/** Where `phrase` sits in the pieces, allowing "hi hat" ⇄ "hihat" and a plural. */
function findPhrase(ps: Piece[], phrase: string[]): { words: string[]; at: number } | null {
  if (!phrase.length) return null
  const joined = phrase.join('')
  const hit = (i: number, n: number) => ({ words: [...new Set(ps.slice(i, i + n).map(p => p.word))], at: i, from: ps[i].from })
  for (let i = 0; i < ps.length; i++) {
    if (phrase.every((p, k) => i + k < ps.length && same(ps[i + k].word, p))) return hit(i, phrase.length)
    if (phrase.length > 1 && same(ps[i].word, joined)) return hit(i, 1)
    if (phrase.length === 1 && i + 1 < ps.length && same(ps[i].word + ps[i + 1].word, joined)) return hit(i, 2)
  }
  return null
}

/** Is the sentence visibly asking for a SOUND here, rather than using the word
 *  for something else? Read from the RAW sentence, because the rules' token
 *  list has already dropped the "a" and the "to" that show where the object is. */
function aboutASound(ps: Piece[], raw: string | undefined, phrase: string[]): boolean {
  if (ps.some(p => SOUND_WORDS.has(p.word))) return true
  if (!raw) return false
  const full = pieces(raw.split(/\s+/))
  const at = findPhrase(full, phrase)?.at
  if (at == null) return false
  const before = full[at - 1]?.word, before2 = full[at - 2]?.word
  return !!before && ARTICLES.has(before) && !!before2 && OBJECT_VERBS.has(before2)
}

const parts = (s: string) => foldName(s).split(' ').filter(Boolean)

/** The plainest sound in a pool for the words said: one NAMED by them, else one whose name carries them, else the shortest name. */
function pick(pool: LibrarySoundLike[], words: string[]): LibrarySoundLike {
  const said = words.join(' ')
  const exact = pool.find(s => foldName(s.name) === said)
  if (exact) return exact
  const carrying = pool.filter(s => { const p = parts(s.name); return words.every(w => p.some(x => same(x, w))) })
  const from = carrying.length ? carrying : pool
  return [...from].sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))[0]
}

/**
 * The library sound a sentence names — by name, by kind, or by folder.
 *
 * `tokens` are the sentence's folded words. `strict` is the rules' setting:
 * a kind or folder counts only when the sentence is about a sound.
 */
export function findLibrarySound(tokens: string[], library: LibrarySoundLike[], opts: { strict?: boolean; raw?: string } = {}): LibraryHit | null {
  if (!tokens.length || !library.length) return null
  const ps = pieces(tokens)
  // The words handed back are the TOKENS that matched, as the rules know them.
  const tokensOf = (hit: { at: number; words: string[] }, n: number) => [...new Set(ps.slice(hit.at, hit.at + n).map(p => tokens[p.from]))]

  // ── By name: the longest name the sentence contains ──────────────────────
  let best: LibraryHit | null = null
  for (const sound of library) {
    const p = parts(sound.name)
    if (!p.length) continue
    let words: string[] | null = null
    if (p.every(x => ps.some(t => same(t.word, x)))) {
      words = [...new Set(ps.filter(t => p.some(x => same(t.word, x))).map(t => tokens[t.from]))]
    } else {
      const hit = findPhrase(ps, p)
      if (hit) words = tokensOf(hit, hit.words.length)
    }
    if (words && (!best || p.length > parts(best.sound.name).length)) best = { sound, words, by: 'name' }
  }
  if (best) return best

  const allowed = (phrase: string[]) => !opts.strict || aboutASound(ps, opts.raw, phrase)

  // ── By kind: "a hihat" is any sound whose category is hihat ──────────────
  for (const [kind, phrases] of Object.entries(KIND_WORDS)) {
    const pool = library.filter(s => s.category === kind)
    if (!pool.length) continue
    for (const phrase of phrases) {
      const p = phrase.split(' ')
      const hit = findPhrase(ps, p)
      if (hit && allowed(p)) return { sound: pick(pool, hit.words), words: tokensOf(hit, hit.words.length), by: 'kind' }
    }
  }

  // ── By folder: "the vocal chops" is the plainest sound in that folder ─────
  const folders = new Map<string, LibrarySoundLike[]>()
  for (const s of library) if (s.folder) { const g = folders.get(s.folder) ?? []; g.push(s); folders.set(s.folder, g) }
  let fromFolder: { hit: LibraryHit; n: number } | null = null
  for (const [folder, pool] of folders) {
    const candidates = [parts(folder), ...folder.split('/').map(parts)].filter(seg => seg.length)
    for (const seg of candidates) {
      const hit = findPhrase(ps, seg)
      if (hit && allowed(seg) && (!fromFolder || seg.length > fromFolder.n)) {
        fromFolder = { hit: { sound: pick(pool, hit.words), words: tokensOf(hit, hit.words.length), by: 'folder' }, n: seg.length }
      }
    }
  }
  return fromFolder?.hit ?? null
}

/** "kick 60, snare 41, hihat 48 …" — what kinds the library holds, most first. */
export function describeLibraryKinds(library: LibrarySoundLike[], max = 12): string {
  const counts = new Map<string, number>()
  for (const s of library) if (s.category && s.category !== 'custom') counts.set(s.category, (counts.get(s.category) ?? 0) + 1)
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max)
  return rows.length ? `The library has ${rows.map(([k, n]) => `${k} ${n}`).join(', ')}.` : ''
}
