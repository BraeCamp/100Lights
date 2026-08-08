#!/usr/bin/env node
// ── Generate solo single-instrument source clips for multisampling ────────────
// Asks ElevenLabs for ONE instrument alone, playing single notes ascending (a
// plain pass, silence, then a slide pass). Verified test: it returns a genuinely
// solo instrument. The mix IS the instrument (no stem separation needed), so this
// only generates the mix — fast + cheap. Output feeds the multisample/preset
// builder + the learning corpus.
//
//   node scripts/gen-instrument-samples.mjs [--length=45000]
//
// Reads ELEVENLABS_API_KEY from env or .env.local. ~5 instruments × 45s < 5 min.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const LENGTH_MS = Math.max(3000, Math.min(600000, parseInt(flag('length', '45000'), 10) || 45000))

let KEY = process.env.ELEVENLABS_API_KEY
if (!KEY) { try { KEY = (readFileSync(join(ROOT, '.env.local'), 'utf8').match(/^\s*ELEVENLABS_API_KEY\s*=\s*["']?([^"'\n]+)/m) || [])[1]?.trim() } catch { /* none */ } }
if (!KEY) { console.error('ELEVENLABS_API_KEY not set (env or .env.local).'); process.exit(1) }

const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders', 'instrument-samples')
mkdirSync(OUT_DIR, { recursive: true })

// The instrument set (electric guitar / "clean guitar" was already captured as the test).
const INSTRUMENTS = [
  { slug: 'electric-guitar', name: 'Electric Guitar', desc: 'overdriven electric guitar' },
  { slug: 'electric-bass',   name: 'Electric Bass',   desc: 'fingered electric bass guitar' },
  { slug: 'grand-piano',     name: 'Grand Piano',     desc: 'grand piano' },
  { slug: 'fretless-bass',   name: 'Fretless Bass',   desc: 'fretless electric bass' },
  { slug: 'synth-bass',      name: 'Synth Bass',      desc: 'analog synth bass' },
]

const promptFor = (desc) =>
  `Solo ${desc} completely alone — absolutely no drums, no other instruments, no backing whatsoever, just one ${desc}. ` +
  `Play single separate notes one at a time, ascending slowly and evenly from the LOWEST note all the way up to the HIGHEST note, ` +
  `covering as much of the instrument's range as possible, about one note per beat, each note clearly separated. ` +
  `Then two full seconds of silence. Then play the same slow ascending run again, but this time slide/glissando smoothly up from each note into the next.`

async function generate(desc) {
  const res = await fetch('https://api.elevenlabs.io/v1/music', {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: promptFor(desc), model_id: 'music_v2', music_length_ms: LENGTH_MS, force_instrumental: true }),
    signal: AbortSignal.timeout(290_000),
  })
  if (!res.ok) throw new Error(`ElevenLabs /music ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
  return Buffer.from(await res.arrayBuffer())
}

const manifest = []
for (const inst of INSTRUMENTS) {
  process.stdout.write(`▸ ${inst.name} (${(LENGTH_MS / 1000).toFixed(0)}s)… `)
  try {
    const mp3 = await generate(inst.desc)
    const out = join(OUT_DIR, `${inst.slug}__mix.mp3`)
    writeFileSync(out, mp3)
    manifest.push({ ...inst, file: out, ok: true })
    console.log(`✓ ${(mp3.length / 1024).toFixed(0)} KB`)
  } catch (e) {
    manifest.push({ ...inst, ok: false, error: e.message })
    console.log(`✗ ${e.message}`)
  }
}
writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
const ok = manifest.filter(m => m.ok).length
console.log(`\n${ok}/${INSTRUMENTS.length} generated → ${OUT_DIR}`)
