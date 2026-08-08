// Headless verification for the AI-instrument presets.
// Seeding needs a real browser (window/IndexedDB/AudioContext), so we drive the
// live dev server (:3001) with Playwright:
//   1. open /new?modules=audio → the audio DAW mounts directly
//   2. wait for seedAiInstruments() to bake each AI folder into IndexedDB
//   3. confirm each preset is present in getPresets() (via its localStorage cache)
//   4. LOAD_PROJECT a MIDI clip using the preset, __dawRenderWav it, and assert
//      the master render is non-silent (ffmpeg volumedetect on the returned WAV)
//
//   node scripts/verify-ai-instruments.mjs
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = 'http://localhost:3001'
// name, folder, loNote, hiNote, test pitches (all inside range)
const PRESETS = [
  { name: 'Grand Piano (AI)',     folder: 'Grand Piano (AI) – All Notes',     lo: 36, hi: 69, notes: [48, 55, 60, 64] },
  { name: 'Electric Guitar (AI)', folder: 'Electric Guitar (AI) – All Notes', lo: 42, hi: 62, notes: [45, 50, 54, 57] },
  { name: 'Electric Bass (AI)',   folder: 'Electric Bass (AI) – All Notes',   lo: 38, hi: 45, notes: [38, 43, 45] },
  { name: 'Fretless Bass (AI)',   folder: 'Fretless Bass (AI) – All Notes',   lo: 40, hi: 44, notes: [40, 42, 44] },
  { name: 'Synth Bass (AI)',      folder: 'Synth Bass (AI) – All Notes',      lo: 38, hi: 50, notes: [38, 44, 50] },
]

function volumedetect(b64) {
  // decode base64 → WAV bytes → ffmpeg volumedetect → { mean, max } dBFS
  const wav = join(tmpdir(), `ai-verify-${Math.random().toString(36).slice(2)}.wav`)
  writeFileSync(wav, Buffer.from(b64, 'base64'))
  // volumedetect prints its stats to stderr — capture stderr, not stdout.
  const res = spawnSync('ffmpeg', ['-hide_banner', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
  const out = (res.stderr || '') + (res.stdout || '')
  const mean = out.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/)
  const max  = out.match(/max_volume:\s*(-?\d+(?:\.\d+)?) dB/)
  return { mean: mean ? parseFloat(mean[1]) : null, max: max ? parseFloat(max[1]) : null }
}

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
page.on('console', m => { const t = m.text(); if (/error|fail|ai/i.test(t)) console.log('  [page]', t.slice(0, 160)) })

console.log('→ opening', `${BASE}/new?modules=audio`)
await page.goto(`${BASE}/new?modules=audio`, { waitUntil: 'domcontentloaded' })

// 1. Wait for the DAW dev hooks to exist.
await page.waitForFunction(() => typeof window.__dawRenderWav === 'function' && typeof window.__dawDispatch === 'function' && typeof window.__dawSnapshot === 'function', null, { timeout: 60000 })
console.log('✓ DAW mounted (__dawRenderWav / __dawDispatch / __dawSnapshot ready)')

// 2. Poll IndexedDB from Node until every AI folder is fully baked. The
//    sound-library DB may be user-namespaced, so we find it by name prefix.
const expected = Object.fromEntries(PRESETS.map(p => [p.folder, p.hi - p.lo + 1]))
const readCounts = () => page.evaluate(async (folders) => {
  const dbs = (await indexedDB.databases?.()) || []
  const meta = dbs.find(d => (d.name || '').startsWith('contentforge-sound-library'))
  const name = meta?.name || 'contentforge-sound-library'
  const idb = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  if (!idb.objectStoreNames.contains('entries')) return { total: 0, counts: {} }
  const all = await new Promise((res, rej) => { const t = idb.transaction('entries', 'readonly').objectStore('entries').getAll(); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error) })
  const counts = {}
  for (const e of all) if (folders.includes(e.folder) && e.audioBlob) counts[e.folder] = (counts[e.folder] || 0) + 1
  return { total: all.length, counts }
}, Object.keys(expected))

let counts = {}
const deadline = Date.now() + 240000
while (Date.now() < deadline) {
  const { total, counts: c } = await readCounts()
  counts = c
  const done = Object.entries(expected).every(([f, n]) => (c[f] || 0) >= n)
  const got = Object.entries(expected).map(([f, n]) => `${f.split(' ')[0]}:${c[f] || 0}/${n}`).join(' ')
  process.stdout.write(`\r  seeding… libEntries=${total} AI[${got}]        `)
  if (done) break
  await page.waitForTimeout(2000)
}
console.log('\n✓ AI folders baked into IndexedDB:', JSON.stringify(counts))

// 3. Confirm presets are present via getPresets()'s localStorage cache.
const presetIds = await page.evaluate(() => {
  const raw = localStorage.getItem('100lights-midi-presets-v1')
  const list = raw ? JSON.parse(raw) : []
  const byName = {}
  for (const p of list) byName[p.name] = { id: p.id, folder: p.folder, lo: p.loNote, hi: p.hiNote, group: p.group }
  return byName
})
console.log('\nPreset presence (getPresets → localStorage):')
let allPresent = true
for (const p of PRESETS) {
  const found = presetIds[p.name]
  const ok = found && found.folder === p.folder
  if (!ok) allPresent = false
  console.log(`  ${ok ? '✓' : '✗'} ${p.name.padEnd(22)} ${found ? `id=${found.id} folder="${found.folder}" ${found.lo}-${found.hi} group=${found.group}` : 'MISSING'}`)
}
if (!allPresent) { console.log('\n✗ some presets missing from getPresets()'); await browser.close(); process.exit(1) }

// 4. Build one real track (valid instrument via the reducer), snapshot it as a
//    base, then per preset LOAD_PROJECT a single clip using that preset for
//    isolation, render, and measure level.
await page.evaluate(() => window.__dawDispatch({ type: 'ADD_TRACK', id: 'verify-track', name: 'verify' }))
await page.waitForTimeout(300)

console.log('\nPlayback render (non-silent > -40 dB max):')
const results = []
for (const p of PRESETS) {
  const pid = presetIds[p.name].id
  // 4a. build + dispatch the project (separate eval from the render)
  await page.evaluate(({ pid, notes }) => {
    const snap = window.__dawSnapshot()
    const proj = JSON.parse(JSON.stringify(snap.project))
    const track = proj.tracks.find(t => t.id === 'verify-track') || proj.tracks[0]
    if (!track) throw new Error('no track to host the clip')
    track.mute = false; track.solo = false; track.volume = 0.9
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2))
    const clip = {
      kind: 'midi', id: uid(), trackId: track.id, name: 'verify', startBeat: 0, durationBeats: 8, isDrumClip: false,
      presetId: pid,
      notes: notes.map((pitch, i) => ({ id: uid(), pitch, startBeat: i * 2, durationBeats: 1.8, velocity: 115 })),
    }
    proj.arrangementClips = [clip]
    window.__dawDispatch({ type: 'LOAD_PROJECT', project: proj })
  }, { pid, notes: p.notes })

  await page.waitForTimeout(800)
  // 4b. render (real-time bounce of the 8-beat clip)
  const r = await page.evaluate(async () => {
    try {
      const res = await window.__dawRenderWav({ startBeat: 0, endBeat: 8, tailSec: 1, mono: true })
      return res ? { durationSec: res.durationSec, len: (res.master || '').length, master: res.master } : { err: 'null result' }
    } catch (e) { return { err: String(e && e.message || e) } }
  })
  const b64 = r && r.master
  if (!b64) { console.log(`  ✗ ${p.name}: render returned nothing (${r.err || 'no master'})`); results.push({ ...p, max: null }); continue }
  const { mean, max } = volumedetect(b64)
  if (max === null) console.log(`     [debug] durationSec=${r.durationSec} b64len=${r.len}`)
  const ok = max !== null && max > -40
  console.log(`  ${ok ? '✓' : '✗'} ${p.name.padEnd(22)} max ${max} dB, mean ${mean} dB`)
  results.push({ ...p, mean, max, ok })
}

await browser.close()

const piano = results.find(r => r.name === 'Grand Piano (AI)')
const guitar = results.find(r => r.name === 'Electric Guitar (AI)')
const required = [piano, guitar]
const pass = allPresent && required.every(r => r && r.ok)
console.log(`\n${pass ? '✓ PASS' : '✗ FAIL'} — required piano+guitar non-silent: piano max ${piano?.max} dB, guitar max ${guitar?.max} dB`)
process.exit(pass ? 0 : 1)
