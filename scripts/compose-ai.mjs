#!/usr/bin/env node
// ── AI-in-the-loop composer ──────────────────────────────────────────────────
// The composer (compose.mjs) knows genre RECIPES — good defaults. This wraps it
// with an LLM "creative director" that reads the palette and makes the actual
// creative calls: genre, key, tempo, per-role instrument timbres, and a character
// signature. The composer's recipe stays a RECOMMENDATION; the AI overrides it
// for a more distinctive, less templated result — then the deterministic composer
// realises that brief into an editable arrangement.
//
//   ANTHROPIC_API_KEY=… node scripts/compose-ai.mjs [direction] [--seed=N] [--best=3] [--out=path]
//   e.g.  node scripts/compose-ai.mjs "a nocturnal, spacious neo-soul in a minor key" --best=3 --out=song.json
//
// Needs ANTHROPIC_API_KEY in the environment (same key the app's article tools use).

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const direction = argv.filter(a => !a.startsWith('--')).join(' ').trim()
const seed = flag('seed', String(Math.floor(1 + (Date.now() % 90000))))   // vary by default
const best = flag('best', '3')
const out = flag('out', join(ROOT, 'public', '_songgen', `ai-${seed}.json`))
const model = flag('model', 'claude-sonnet-5')

let KEY = process.env.ANTHROPIC_API_KEY
if (!KEY) {   // fall back to .env.local so it "just runs" locally (same key the app uses)
  try { KEY = (readFileSync(join(ROOT, '.env.local'), 'utf8').match(/^\s*ANTHROPIC_API_KEY\s*=\s*["']?([^"'\n]+)/m) || [])[1]?.trim() } catch { /* none */ }
}
if (!KEY) { console.error('ANTHROPIC_API_KEY is not set (checked env + .env.local).'); process.exit(1) }

// ── The palette the director chooses from ────────────────────────────────────
const GENRES = [
  ['house', 124], ['deep-house', 120], ['techno', 132], ['trance', 138], ['dnb', 174],
  ['dubstep', 140], ['trap', 140], ['boombap', 90], ['lofi', 72], ['future-bass', 150],
  ['synthwave', 100], ['ambient', 68], ['rock', 120], ['pop', 116], ['rnb', 88],
  ['funk', 108], ['reggaeton', 94], ['bossa-nova', 130], ['afrobeat', 110], ['disco', 120],
]
const SIGS = {
  space: 'lush, spacious reverb wash on pads/leads',
  crush: 'saturated, gritty, bit-crushed bass/lead',
  pump: 'sidechain pump + chorus on keys/pad (club energy)',
  guitar: 'an electric-guitar lead voice',
}
// builtin-N → name/group, parsed from the preset library so ids stay in sync.
const mp = readFileSync(join(ROOT, 'lib/midi-presets.ts'), 'utf8')
const bi = mp.slice(mp.indexOf('const BUILT_IN'), mp.indexOf('// ── Helpers'))
const PRESETS = [...bi.matchAll(/\{\s*name:\s*['"]([^'"]+)['"][^}]*?group:\s*['"]([^'"]+)['"]/g)]
  .map((m, i) => ({ id: `builtin-${i}`, name: m[1], group: m[2] }))
const byGroup = (...g) => PRESETS.filter(p => g.includes(p.group)).map(p => `${p.id} (${p.name})`).join(', ')
const PALETTE = {
  keys: byGroup('Piano', 'Mallets', 'Organ'),
  pad: byGroup('Synth', 'Strings'),
  bass: byGroup('Bass'),
  lead: byGroup('Synth', 'Guitar', 'Mallets', 'Strings', 'Brass', 'Woodwinds'),
}

// ── Ask the director for a creative brief ────────────────────────────────────
const system = `You are a creative music director working with an algorithmic composer.
The composer has solid per-genre RECIPES, but they are RECOMMENDATIONS, not law — your job is to make bolder, more distinctive, less templated creative choices on top of them. Design ONE song.

Choose from these palettes:
- genre (id · bpm): ${GENRES.map(([g, b]) => `${g}·${b}`).join(', ')}
- key: "<Root> <mode>" where Root is one of C C# D D# E F F# G G# A A# B and mode is one of: minor, major, dorian, mixolydian, phrygian, lydian
- instrument presets by role (pick ONE id per role that fits your vision — you may go against the genre norm for character):
  · keys/chords: ${PALETTE.keys}
  · pad: ${PALETTE.pad}
  · bass: ${PALETTE.bass}
  · lead: ${PALETTE.lead}
- character signature (optional): ${Object.entries(SIGS).map(([k, v]) => `${k} = ${v}`).join('; ')}

Reply with ONLY a JSON object (no prose, no markdown fence):
{"genre":"<id>","key":"<Root mode>","tempo":<bpm or omit for the genre default>,"presets":{"keys":"builtin-N","pad":"builtin-N","bass":"builtin-N","lead":"builtin-N"},"sig":"<one of the signatures or omit>","moodName":"<2-4 word mood label>","rationale":"<one sentence on the creative intent>"}`

const userMsg = direction
  ? `Design a song around this direction: ${direction}`
  : `Design a distinctive song of your own choosing — surprise me, avoid the obvious default for the genre you pick.`

console.log('▸ asking the director…')
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
  body: JSON.stringify({ model, max_tokens: 1024, system, messages: [{ role: 'user', content: userMsg }] }),
  signal: AbortSignal.timeout(60_000),
}).catch(e => { console.error('could not reach Anthropic API:', e.message); return null })
if (!res) process.exit(2)
if (!res.ok) { console.error(`Anthropic API ${res.status}:`, (await res.text().catch(() => '')).slice(0, 300)); process.exit(2) }
const data = await res.json()
const text = (data.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n')
const jsonStr = (text.match(/\{[\s\S]*\}/) || [])[0]
if (!jsonStr) { console.error('director returned no JSON:\n', text.slice(0, 400)); process.exit(3) }
let brief
try { brief = JSON.parse(jsonStr) } catch (e) { console.error('bad brief JSON:', e.message, '\n', jsonStr.slice(0, 400)); process.exit(3) }

// Validate genre; drop it (fall back) if the director hallucinated one.
if (!GENRES.some(([g]) => g === brief.genre)) { console.error(`director picked unknown genre "${brief.genre}"`); process.exit(3) }

console.log(`▸ director: ${brief.genre}${brief.tempo ? ' @' + brief.tempo : ''} · ${brief.key} · ${brief.moodName || ''}`)
console.log(`  presets: ${JSON.stringify(brief.presets || {})}${brief.sig ? ' · sig:' + brief.sig : ''}`)
console.log(`  “${brief.rationale || ''}”`)

// ── Hand the brief to the composer (its recipe becomes the recommendation) ────
const tmp = join(mkdtempSync(join(tmpdir(), 'brief-')), 'brief.json')
writeFileSync(tmp, JSON.stringify(brief))
console.log('▸ composing to the brief…')
execFileSync('node', ['scripts/compose.mjs', '--brief=' + tmp, `--seed=${seed}`, `--best=${best}`, `--out=${out}`], { cwd: ROOT, stdio: 'inherit' })
