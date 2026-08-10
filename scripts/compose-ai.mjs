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
// SILENCED 2026-08-10 (Brae): superseded by Claude authoring music directly in the program
// (scripts/sheet-accompany.mjs). Kept for reference; pass --force to run.
if (!argv.includes('--force')) {
  console.log('\n⏸  compose-ai.mjs is SILENCED (deprecated 2026-08-10) — use the Claude-authored music path (scripts/sheet-accompany.mjs). Pass --force to override.\n')
  process.exit(0)
}
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
  · Use "crush" ONLY for aggressive, heavy styles (trap, dubstep, dnb, future-bass, phonk, hyperpop). For mellow, minimal, clean, dreamy, or ambient songs it sounds harshly distorted — omit sig or use "space" instead.

You ALSO write the actual musical MATERIAL — the composer realizes it into editable notes:
- progression: an array of roman numerals, the harmonic backbone (drives the verse + chorus). 4 or 8 chords. Use lowercase for minor triads and UPPERCASE for major (the composer treats case as a diatonic-stacking hint). Diatonic to your chosen key/mode — use only i ii iii iv v vi vii (any case). e.g. ["i","VI","III","VII"] or ["i","iv","v","i"].
- hook: a short, singable melodic hook as an array of [beatOffset, scaleDegree] pairs. beatOffset is 0..3.99 within one bar; scaleDegree is an integer scale-degree index (0 = the tonic, negative or >6 reach other octaves). 4-8 notes, mostly stepwise with ONE leap, resolving toward the tonic. e.g. [[0,0],[1,2],[2,4],[3,2]].

Reply with ONLY a JSON object (no prose, no markdown fence):
{"genre":"<id>","key":"<Root mode>","tempo":<bpm or omit for the genre default>,"presets":{"keys":"builtin-N","pad":"builtin-N","bass":"builtin-N","lead":"builtin-N"},"sig":"<one of the signatures or omit>","progression":["i","VI","III","VII"],"hook":[[0,0],[1,2],[2,4],[3,2]],"moodName":"<2-4 word mood label>","rationale":"<ONE short sentence, max 20 words>"}
Keep the rationale to ONE short sentence — a long rationale can truncate the JSON.`

const userMsg = direction
  ? `Design a song around this direction: ${direction}`
  : `Design a distinctive song of your own choosing — surprise me, avoid the obvious default for the genre you pick.`

// The director occasionally emits a long rationale that trips the token cap (or,
// rarely, a flaky/empty response), truncating the JSON. Give it generous headroom
// and retry up to 3× on any no-JSON / truncated / bad-genre response.
console.log('▸ asking the director…')
let brief = null
for (let attempt = 1; attempt <= 3 && !brief; attempt++) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 2048, system, messages: [{ role: 'user', content: userMsg }] }),
    signal: AbortSignal.timeout(60_000),
  }).catch(e => { console.error(`  attempt ${attempt}: could not reach Anthropic API — ${e.message}`); return null })
  if (!res) continue
  if (!res.ok) { console.error(`  attempt ${attempt}: Anthropic API ${res.status} — ${(await res.text().catch(() => '')).slice(0, 200)}`); continue }
  const data = await res.json()
  if (data.stop_reason === 'max_tokens') { console.error(`  attempt ${attempt}: response hit the token cap (truncated) — retrying…`); continue }
  const text = (data.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n')
  const jsonStr = (text.match(/\{[\s\S]*\}/) || [])[0]
  if (!jsonStr) { console.error(`  attempt ${attempt}: director returned no JSON — retrying…`); continue }
  let parsed
  try { parsed = JSON.parse(jsonStr) } catch (e) { console.error(`  attempt ${attempt}: bad brief JSON (${e.message}) — retrying…`); continue }
  if (!GENRES.some(([g]) => g === parsed.genre)) { console.error(`  attempt ${attempt}: unknown genre "${parsed.genre}" — retrying…`); continue }
  brief = parsed
}
if (!brief) { console.error('director failed to return a valid brief after 3 attempts.'); process.exit(3) }

// Validate the musical MATERIAL. Both are OPTIONAL — if missing or malformed we
// OMIT them so the composer falls back to its own random recipe/hook (that path
// must keep working). The composer also sanitizes defensively; this is the first
// gate so we only ever hand it well-formed material.
const ROMAN_OK = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'])
const okProg = Array.isArray(brief.progression)
  && (brief.progression.length === 4 || brief.progression.length === 8)
  && brief.progression.every(n => typeof n === 'string' && ROMAN_OK.has(n.trim().replace(/[^a-zA-Z]/g, '').toLowerCase()))
const okHook = Array.isArray(brief.hook)
  && brief.hook.length >= 4 && brief.hook.length <= 8
  && brief.hook.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
    && p[0] >= 0 && p[0] < 4)
if (!okProg && brief.progression !== undefined) console.log(`  (dropped invalid progression → composer will use its own)`)
if (!okHook && brief.hook !== undefined) console.log(`  (dropped invalid hook → composer will use its own)`)
if (!okProg) delete brief.progression
if (!okHook) delete brief.hook

console.log(`▸ director: ${brief.genre}${brief.tempo ? ' @' + brief.tempo : ''} · ${brief.key} · ${brief.moodName || ''}`)
if (brief.progression) console.log(`  progression: ${brief.progression.join(' ')}`)
if (brief.hook) console.log(`  hook: ${brief.hook.map(([b, d]) => `${b}:${d}`).join(' ')}`)
console.log(`  presets: ${JSON.stringify(brief.presets || {})}${brief.sig ? ' · sig:' + brief.sig : ''}`)
console.log(`  “${brief.rationale || ''}”`)

// ── Hand the brief to the composer (its recipe becomes the recommendation) ────
const tmp = join(mkdtempSync(join(tmpdir(), 'brief-')), 'brief.json')
writeFileSync(tmp, JSON.stringify(brief))
console.log('▸ composing to the brief…')
execFileSync('node', ['scripts/compose.mjs', '--brief=' + tmp, `--seed=${seed}`, `--best=${best}`, `--out=${out}`], { cwd: ROOT, stdio: 'inherit' })
