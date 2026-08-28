// Shared machinery for pulling a sample library off GitHub into a folder the
// catalog importer can read.
//
// Extracted from fetch-vcsl.mjs when a second pack arrived. The parts worth
// having in one place are the ones that were wrong the first time and are
// invisible when they are wrong again:
//
//   - URL encoding. encodeURI() does not escape '#', so every SHARP 404s and
//     every natural succeeds. It reads as a flaky network, not a bug.
//   - Manifest rows built once from the selection, never per download attempt,
//     or a retried file appears in the manifest twice.
//   - Durations from the WAV header, or every sound displays 0:00.
//
// The per-library knowledge — which files, what to call the instrument — stays
// in the caller. Only the mechanics live here.

import { mkdirSync, writeFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The repo's whole file list, with sizes. */
export async function githubTree(owner, repo) {
  const meta = await (await fetch(`https://api.github.com/repos/${owner}/${repo}`)).json()
  if (!meta.default_branch) throw new Error(`${owner}/${repo}: ${meta.message || 'no branch'}`)
  const tree = await (await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${meta.default_branch}?recursive=1`)).json()
  if (tree.truncated) throw new Error(`${owner}/${repo}: tree truncated — needs paging`)
  return {
    branch: meta.default_branch,
    license: meta.license?.spdx_id ?? null,
    files: (tree.tree || []).filter(x => x.type === 'blob'),
  }
}

/** Encode PER SEGMENT — see the note at the top about '#'. */
export const rawUrl = (owner, repo, branch, path) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/` +
  path.split('/').map(encodeURIComponent).join('/')

// ── Reading a filename ──────────────────────────────────────────────────────

const NOTE = /^([A-Ga-g])(#|b|s)?(-?\d)$/
const MIC = /^(main|close|room|far|mid|dist|amb|di|neck|bridge)$/i

/** Dynamic markings, as a velocity layer. VSCO writes `_v1_`, Karoryfer's
 *  double bass writes `_mf_` — same idea, different alphabet. */
const DYNAMIC = { ppp: 1, pp: 1, p: 2, mp: 3, mf: 3, f: 4, ff: 5, fff: 5 }

const ARTIC = {
  stac: 'staccato', staccato: 'staccato', sus: 'sustain', sustain: 'sustain',
  legato: 'legato', trem: 'tremolo', tremolo: 'tremolo', pizz: 'pizzicato',
  pizzicato: 'pizzicato', pizzcato: 'pizzicato', spic: 'spiccato', arco: 'arco',
  hammer: 'hammer-on', ord: 'ordinary', reg: 'regular', ghost: 'ghost',
  hard: 'hard', soft: 'soft', med: 'medium', roll: 'roll', mute: 'muted',
  open: 'open', damp: 'damped', vib: 'vibrato',
}

// Bow direction is not an articulation, it is a second axis — "arco … down" is
// one bowed note played downward. Folding it into `artic` meant whichever word
// came first won and the other was thrown away, which for the double bass
// silently discarded the up/down distinction on all 296 pitched samples.
const BOW = /^(up|down)$/i

/**
 * Everything a sample filename is willing to say about itself.
 *
 * Handles the spellings actually seen across these libraries: `A#3` and `a3`
 * and `bb4`, `rr1`/`RR1`, `v1`/`vl1`/`mf`, and a mic or articulation word.
 */
export function parseSampleName(file) {
  const stem = file.split('/').pop().replace(/\.(wav|flac|ogg|mp3|aiff?)$/i, '')
  let note = '', rr = '', vel = '', artic = '', mic = '', bow = ''
  for (const p of stem.split(/[_\-. ]/)) {
    if (!p) continue
    if (!note && NOTE.test(p)) { note = p.toUpperCase(); continue }
    if (/^rr\d+$/i.test(p)) { rr = p.toLowerCase(); continue }
    if (/^v(l)?\d+$/i.test(p)) { vel = p.replace(/\D/g, ''); continue }
    if (!vel && DYNAMIC[p.toLowerCase()]) { vel = String(DYNAMIC[p.toLowerCase()]); continue }
    const a = ARTIC[p.toLowerCase()]
    if (a && !artic) { artic = a; continue }
    if (BOW.test(p)) { bow = p.toLowerCase(); continue }
    if (MIC.test(p)) mic = p.toLowerCase()
  }
  return { note, rr, vel, artic, mic, bow, stem }
}

/**
 * Is this a sound the instrument makes when you STOP playing, or one it makes
 * without a pitch at all?
 *
 * Releases (damper falling, string let go) and noises (fret squeak, fingering)
 * sit at real pitches and would otherwise become half the zones of an
 * instrument — a guitar that plays mostly fret squeak.
 */
export const isNonNote = path =>
  /(^|[\/_])(rel|release|releases|noise|noises|fx|extra)([\/_.]|$)/i.test(path)

/**
 * The library folder a sample belongs in — and the reason it matters.
 *
 * Apollo builds an instrument from everything in ONE folder, taking a single
 * take per pitch. So a folder must hold exactly one ARTICULATION, not just one
 * instrument. Put a tenor saxophone's Vibrato, Non-Vibrato and Staccato in
 * "Tenor Saxophone" and the instrument that comes out is staccato on some
 * notes and sustained on others, chosen by nothing in particular. It is the
 * same failure as mixing velocity layers, one level up, and it is silent.
 *
 * So the articulation goes in the folder name, the way commercial libraries
 * present it: "Tenor Saxophone (Staccato)". An instrument with one articulation
 * gets no suffix and stays plain.
 *
 * The wrapper words are dropped — "Sustains/Normal" is just "Normal" — because
 * every sustain folder would otherwise be prefixed with the word Sustains and
 * the useful half would be the part nobody reads.
 */
const WRAPPER = /^(samples?|sustains?|notes?)$/i
const RELEASE_WORD = /^(rel|releases?|noises?|fx|extra)$/i

/**
 * Sample libraries name their articulation folders for the engineer who cut
 * them: `ord`, `spic`, `pizzT`, `susNV`, `btb`. This folder name is what a
 * player reads in the instrument list, so it is worth spelling out — the
 * difference between a library and a dump of directories.
 *
 * Anything unrecognised is title-cased and passed through rather than dropped:
 * a code we have not seen is still information.
 */
const VARIANT_LABEL = {
  ord: 'Ordinary', stac: 'Staccato', spic: 'Spiccato', trem: 'Tremolo',
  pizz: 'Pizzicato', pizzt: 'Pizzicato', pizzcato: 'Pizzicato',
  sus: 'Sustain', susvib: 'Sustain Vibrato', susnv: 'Sustain Non-Vibrato',
  nosus: 'No Sustain Pedal', arco: 'Arco', legato: 'Legato',
  reg: 'Regular', ghost: 'Ghost Notes', hammer: 'Hammer-On',
  btb: 'Behind the Bridge', fb: 'Feedback', vib: 'Vibrato',
  'non-vibrato': 'Non-Vibrato', normal: 'Normal', hand: 'Hand',
}

const prettyPart = p =>
  VARIANT_LABEL[p.toLowerCase()] ?? p.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

/** Non-note buckets keep their OWN name. Collapsing "arco/noises" and
 *  "arco/extra" both to "Releases Arco" merged two different sets of sounds
 *  into one folder — the exact thing this function exists to prevent. */
const NON_NOTE_LABEL = {
  rel: 'Releases', release: 'Releases', releases: 'Releases',
  noise: 'Noises', noises: 'Noises', extra: 'Extra', fx: 'FX',
}

/**
 * @param forceNonNote  the FILENAME says this is a release/noise even though no
 *   folder does. Only a fallback: a variant naming its own bucket ("arco/noises")
 *   keeps that name. Prepending "Releases/" instead shadowed the specific word
 *   and merged arco/noises with arco/extra.
 */
export function variantSuffix(variant, forceNonNote = false) {
  const parts = String(variant || '').split('/').filter(Boolean)
  const nonNote = parts.map(p => NON_NOTE_LABEL[p.toLowerCase()]).find(Boolean)
    ?? (forceNonNote ? 'Releases' : null)
  const rest = parts.filter(p => !WRAPPER.test(p) && !RELEASE_WORD.test(p)).map(prettyPart)
  // Two folder levels can say the same thing ("Sustains/Sus"); saying it twice
  // in the instrument list just looks like a mistake.
  const seen = new Set()
  const uniq = rest.filter(p => (seen.has(p) ? false : (seen.add(p), true)))
  return [nonNote, ...uniq].filter(Boolean).join(' ')
}

/** "<family>/<Instrument> (<Articulation>)" — the importer's folder column. */
export function folderFor(instrument, variant, forceNonNote = false) {
  const suffix = variantSuffix(variant, forceNonNote)
  return suffix ? `${instrument} (${suffix})` : instrument
}

// ── Fetching ────────────────────────────────────────────────────────────────

/**
 * Download every row (`{ remote, file }`) into `out`, resuming what is there.
 * Three attempts each, then the file is reported rather than retried forever.
 */
export async function download(rows, out, { concurrency = 12, urlOf, log = console.log } = {}) {
  mkdirSync(out, { recursive: true })
  let done = 0, skipped = 0
  const failed = []
  const attempts = new Map()
  const queue = rows.slice()

  async function worker() {
    while (queue.length) {
      const r = queue.shift()
      const dest = join(out, r.file)
      if (existsSync(dest) && statSync(dest).size > 0) { skipped++; continue }
      try {
        const res = await fetch(urlOf(r), { signal: AbortSignal.timeout(120000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, buf)
        done++
        if (done % 250 === 0) log(`  ${done} fetched, ${queue.length} to go`)
      } catch (e) {
        const n = (attempts.get(r.file) ?? 0) + 1
        attempts.set(r.file, n)
        if (n < 3) queue.push(r)
        else failed.push(`${r.remote}: ${String(e.message).slice(0, 60)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return { done, skipped, failed }
}

// ── Manifest ────────────────────────────────────────────────────────────────

/**
 * Seconds, from the WAV header — a 4 KB read, not a decode.
 *
 * Both numbers are found by WALKING the chunk list, never at a fixed offset.
 * A WAV is only guaranteed to start "RIFF….WAVE"; what follows is chunks in
 * whatever order the encoder felt like. Karoryfer's bass releases open with a
 * 28-byte JUNK chunk (alignment padding) before `fmt `, so reading the byte
 * rate from offset 28 — the position it occupies in the common layout — reads
 * JUNK's zero bytes instead and every one of those 168 files reported 0:00.
 */
export function wavSeconds(path) {
  try {
    const fd = openSync(path, 'r')
    const head = Buffer.alloc(4096)
    const n = readSync(fd, head, 0, 4096, 0)
    closeSync(fd)
    if (n < 12 || head.toString('ascii', 0, 4) !== 'RIFF') return 0

    let byteRate = 0, dataSize = 0
    let off = 12
    while (off + 8 <= n) {
      const id = head.toString('ascii', off, off + 4)
      const size = head.readUInt32LE(off + 4)
      const body = off + 8
      if (id === 'fmt ' && body + 16 <= n) byteRate = head.readUInt32LE(body + 8)
      if (id === 'data') { dataSize = size; break }
      off = body + size + (size % 2)          // chunks are word-aligned
    }
    if (!byteRate || !dataSize) return 0
    return Number((dataSize / byteRate).toFixed(3))
  } catch { return 0 }
}

/**
 * Write MANIFEST.csv for the rows whose files actually landed.
 *
 * A row pointing at a missing file fails inside the importer, after its
 * neighbours have already been uploaded to R2.
 */
export function writeManifest(out, rows, { licenseText } = {}) {
  const onDisk = rows.filter(r => {
    try { return statSync(join(out, r.file)).size > 0 } catch { return false }
  })
  for (const r of onDisk) r.duration_s = wavSeconds(join(out, r.file))
  const cols = [...new Set(onDisk.flatMap(Object.keys))].filter(c => c !== 'remote')
  const esc = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''))
  const csv = [cols.join(','), ...onDisk.map(r => cols.map(c => esc(r[c])).join(','))]
  writeFileSync(join(out, 'MANIFEST.csv'), csv.join('\n'))
  if (licenseText) writeFileSync(join(out, 'LICENSE.txt'), licenseText)
  return onDisk
}
