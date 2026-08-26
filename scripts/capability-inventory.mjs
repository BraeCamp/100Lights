// What can a person actually DO in this studio, and can they find it?
//
//   npm run inventory
//
// This exists because I audited the DAW by grepping for identifier names I
// invented — SPLIT_CLIP, quantize, fadeIn — concluded seven standard features
// were missing, and was wrong about six of them. Split exists; the codebase
// calls it "Splice at Playhead". Quantize is behind an unlabelled Q. LUFS
// metering is in the master strip. Freeze existed for months and only surfaced
// because Brae asked for it by name.
//
// So this reads the PRODUCT, not my guesses: every labelled control, menu item
// and keyboard shortcut in the studio, and whether the command palette can
// reach it. A capability nobody can find is indistinguishable from one that
// doesn't exist — that is the actual failure this codebase has, and it is
// invisible to every other check we have.

import { readFileSync, readdirSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DAW_DIR = join(ROOT, 'components/editor/daw')
const EDITOR_DIR = join(ROOT, 'components/editor')

/** Words that look like UI labels but are code, config or copy. */
const NOISE = /^(Arrow|Escape|Enter|Backspace|Delete$|Shift|Control|Meta|Alt|Tab$|[A-Z][a-z]+Error|[A-Z][a-z]*Event|Math|JSON|Object|Array|Promise|Audio|Float|Uint|Int\d|Map$|Set$|Infinity|NaN)/

const files = []
for (const dir of [DAW_DIR, EDITOR_DIR]) {
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.tsx') && !f.endsWith('.test.tsx')) files.push(join(dir, f))
  }
}

/** Labels a user could plausibly read on screen. */
function labelsIn(src) {
  const out = new Set()
  // Quoted strings that read like labels: start with a capital, contain a space
  // or are a known single-word control, and are not obviously code.
  for (const m of src.matchAll(/'([A-Z][^'\\]{2,40})'/g)) {
    const s = m[1]
    if (NOISE.test(s)) continue
    // SCREAMING_SNAKE is a reducer action or a constant, never something a
    // person reads on a button. Same for ALLCAPS with no lowercase at all.
    if (/^[A-Z0-9_]+$/.test(s)) continue
    // A label has lower-case letters in it; identifiers like 'AudioContext' or
    // 'trackId' that slipped past NOISE do not read as sentences.
    if (!/[a-z]/.test(s)) continue
    if (/^[A-Za-z]+$/.test(s) && s.length < 5) continue
    out.add(s)
  }
  for (const m of src.matchAll(/title="([^"]{3,40})"/g)) {
    if (!NOISE.test(m[1])) out.add(m[1])
  }
  return out
}

/** Single-key and modifier shortcuts the component binds. */
function shortcutsIn(src) {
  const out = new Set()
  for (const m of src.matchAll(/e\.key(?:\.toLowerCase\(\))?\s*===\s*'([^']{1,12})'/g)) out.add(m[1])
  for (const m of src.matchAll(/key\s*===\s*'([a-z0-9])'/g)) out.add(m[1])
  return out
}

const perFile = []
const allLabels = new Set()
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const labels = labelsIn(src)
  const keys = shortcutsIn(src)
  if (!labels.size && !keys.size) continue
  perFile.push({ file: basename(f), labels, keys })
  for (const l of labels) allLabels.add(l)
}

// What the command palette can reach.
const registered = new Set()
for (const f of [join(EDITOR_DIR, 'AudioEditor.tsx'), join(EDITOR_DIR, 'ProjectEditor.tsx'), join(EDITOR_DIR, 'VideoEditor.tsx')]) {
  let src = ''
  try { src = readFileSync(f, 'utf8') } catch { continue }
  for (const m of src.matchAll(/label:\s*[`']([^`']{3,60})[`']/g)) registered.add(m[1])
  // Template-literal labels built from state — count them, they are reachable.
  for (const m of src.matchAll(/label:\s*`([^`]{3,60})`/g)) registered.add(m[1])
}

console.log(`STUDIO CAPABILITY INVENTORY\n`)
console.log(`${perFile.length} surfaces, ${allLabels.size} distinct labelled actions`)
console.log(`${registered.size} reachable from the command palette\n`)

perFile.sort((a, b) => b.labels.size - a.labels.size)
console.log('surface                          actions  shortcuts')
for (const p of perFile.slice(0, 16)) {
  console.log(`  ${p.file.replace('.tsx', '').padEnd(30)} ${String(p.labels.size).padStart(5)} ${String(p.keys.size).padStart(10)}`)
}

// The gap: things a user can do that ⌘K cannot reach. Matching is fuzzy on
// purpose — a palette command called "Switch to Mixer view" covers a button
// labelled "Mixer".
const norm = s => s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
const regNorm = [...registered].map(norm)
const covered = l => regNorm.some(r => r.includes(norm(l)) || norm(l).includes(r))
const missing = [...allLabels].filter(l => !covered(l)).sort()

console.log(`\nNOT REACHABLE FROM THE PALETTE: ${missing.length} of ${allLabels.size}`)
for (const m of missing.slice(0, 60)) console.log(`  ${m}`)
if (missing.length > 60) console.log(`  … and ${missing.length - 60} more`)

const pct = Math.round((allLabels.size - missing.length) / allLabels.size * 100)
console.log(`\npalette coverage: ${pct}%`)
process.exitCode = 0
