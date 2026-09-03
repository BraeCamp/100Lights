// Build step: read every response string the studio can say out of the source
// and write lib/voice/phrases.json.
//
// Two reasons this is generated rather than written by hand.
//
// The app cannot read the filesystem at runtime — source files are not in the
// serverless bundle — so the admin panel that lists these phrases needs them
// baked in, the same way lib/site-pages.json bakes in the routes.
//
// And a hand-kept list would drift the first time somebody rewords a response.
// Nobody would notice: the studio would simply start saying something the list
// does not mention, and a phrase already bought under the old wording would sit
// in storage forever while the new one was bought again.
//
// Run by `prebuild`, and by `npm run voice:phrases`.

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Every file that puts words in the studio's mouth. A response added somewhere
// else is invisible here, which is the one failure mode worth knowing about —
// check:voice-cache reports the count so a sudden drop is noticeable.
const FILES = [
  'lib/voice/execute-music.ts',
  'lib/voice/queue.ts',
  'lib/voice/calibrate.ts',
  'lib/voice/ask.ts',
  'lib/voice/notices.ts',
  'components/editor/daw/VoiceControl.tsx',
  'components/editor/daw/VoicePanel.tsx',
]

// The ways a response reaches a person. Matched on the CALL rather than on
// every string literal in the file, so command names, tool ids and CSS do not
// end up in the list.
const CALLS = /\b(?:say:|fail\(|respond\(|setSaid\(|setProblem\()\s*/g

/**
 * Read one string literal, starting at its opening quote.
 *
 * A regex cannot do this, and the first version of this file proved it: a
 * template literal may contain another template literal inside `${…}` —
 *
 *     `"${track.name}" already has ${kind === 'arp' ? 'an arpeggiator' : `a ${kind} effect`}.`
 *
 * — and `` `[^`]*` `` stops dead at that inner backtick, silently producing
 * half a sentence. Four responses came out truncated mid-clause, which would
 * have been listed to an admin as if that were what the studio says.
 *
 * So the nesting is actually tracked: depth for `${ … }`, and a recursive step
 * for a nested template. Returns null if the literal never closes, rather than
 * guessing.
 */
function readLiteral(src, start) {
  const quote = src[start]
  if (quote !== '`' && quote !== "'" && quote !== '"') return null
  let i = start + 1
  let depth = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') { i += 2; continue }
    if (quote === '`') {
      if (c === '$' && src[i + 1] === '{') { depth++; i += 2; continue }
      if (c === '}' && depth > 0) { depth--; i++; continue }
      // Inside an interpolation, a quote of any kind opens a nested literal —
      // including another backtick. Skip the whole thing.
      if (depth > 0 && (c === '`' || c === "'" || c === '"')) {
        const inner = readLiteral(src, i)
        if (!inner) return null
        i = inner.end
        continue
      }
      if (c === '`' && depth === 0) return { text: src.slice(start + 1, i), end: i + 1 }
    } else {
      // A plain quoted string ends at its quote, and never spans a line.
      if (c === '\n') return null
      if (c === quote) return { text: src.slice(start + 1, i), end: i + 1 }
    }
    i++
  }
  return null
}

/**
 * The string as JavaScript will actually produce it.
 *
 * The literal is read out of source, so `Couldn\'t` arrives with its backslash
 * still attached. Cosmetic in a list — and NOT cosmetic anywhere else: the
 * cache key is a hash of the text, so a phrase pre-rendered as "Couldn\'t reach
 * the assistant." lands on a different key from the "Couldn't reach the
 * assistant." the running app asks for. It would have been bought, stored,
 * never found, and quietly bought again by every user who heard it.
 */
function unescape(text) {
  return text.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (whole, esc) => {
    if (esc[0] === 'u' || esc[0] === 'x') {
      const hex = esc.replace(/^u\{|\}$|^u|^x/g, '')
      return String.fromCodePoint(parseInt(hex, 16))
    }
    const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' }
    return simple[esc] ?? esc
  })
}

/**
 * The shape, written for a person rather than for the compiler.
 *
 * `${track.name}` is noise in a list of things the studio says; "{track name}"
 * is the same information and readable at a glance. An expression that is not
 * simply a value — a ternary, a call — collapses to "{…}", because spelling it
 * out would be quoting code at somebody who wants to read sentences.
 */
function humanise(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const at = text.indexOf('${', i)
    if (at === -1) { out += text.slice(i); break }
    out += text.slice(i, at)
    // Find the matching brace, counting nesting.
    let depth = 1
    let j = at + 2
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') depth--
      j++
    }
    const expr = text.slice(at + 2, j - 1).trim()
    out += /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(expr)
      ? `{${expr.replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}}`
      : '{…}'
    i = j
  }
  return out.replace(/\s+/g, ' ').trim()
}

const fixed = new Map()
const shapes = new Map()

for (const file of FILES) {
  let src
  try { src = readFileSync(join(ROOT, file), 'utf8') } catch { continue }
  for (const m of src.matchAll(CALLS)) {
    const lit = readLiteral(src, m.index + m[0].length)
    if (!lit) continue
    const text = unescape(lit.text).trim()
    if (!text || text.length < 3) continue
    // Where it lives, so the panel can say which file to edit rather than
    // leaving somebody to grep for a sentence.
    const where = `${file}:${src.slice(0, m.index).split('\n').length}`
    // A string with an interpolation is a SHAPE — its final form depends on a
    // track name, so it cannot be rendered until somebody actually says it.
    const into = text.includes('${') ? shapes : fixed
    if (!into.has(text)) into.set(text, where)
  }
}

const entry = ([text, where]) => ({ text, display: humanise(text), where })
const byText = (a, b) => a.display.localeCompare(b.display)
const out = {
  // Rendered once, up front, and then free for every user there will ever be.
  fixed: [...fixed].map(entry).sort(byText),
  // Bought lazily, one distinct final string at a time. Track names overlap
  // heavily between users, so these converge too — just not on a schedule.
  shapes: [...shapes].map(entry).sort(byText),
  generated: new Date().toISOString().slice(0, 10),
}

writeFileSync(join(ROOT, 'lib', 'voice', 'phrases.json'), JSON.stringify(out, null, 0) + '\n')
console.log(`voice phrases: ${out.fixed.length} fixed, ${out.shapes.length} templated`)
