#!/usr/bin/env node
/**
 * The voice command bench — say something, see exactly what it would do.
 *
 *   node scripts/voice-try.mjs "loop bass 2 three more times"
 *   node scripts/voice-try.mjs --song 3-4 "move everything over by one bar"
 *   node scripts/voice-try.mjs --calls '[{"name":"transpose","input":{"target":"bass 2","semitones":12}}]'
 *
 * Brae: "Fix the test environment to play with this a bit."
 *
 * Iterating on a command vocabulary through a browser and a microphone is
 * miserable: every change costs a build, a page load, a permission prompt and a
 * sentence spoken out loud. Everything interesting happens between the words
 * and the actions, and none of it needs any of that.
 *
 * So this runs the real path with the ends cut off. It sends the sentence to
 * the real model with the real tools, then plans the result against a real
 * project with the real executor — and prints the tool calls, the DAW actions
 * and the read-back. No browser, no microphone, no clicking. `--calls` skips
 * the model entirely when the question is about the executor rather than the
 * interpretation, which also means it works with no API key.
 *
 * Nothing here writes to a project. It is a dry run on purpose: the point is to
 * see whether "the first 8 seconds of it" landed on the right beats before ever
 * letting it near a song.
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { importTs } from './lib/ts-import.mjs'
import { makeTrack, makeClip, makeNotes } from './lib/daw-fixture.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = n => (process.env[n] || (() => {
  try {
    return readFileSync(join(ROOT, '.env.local'), 'utf8')
      .match(new RegExp(`^\\s*${n}\\s*=\\s*(.+)\\s*$`, 'm'))?.[1] ?? ''
  } catch { return '' }
})()).trim().replace(/^["']|["']$/g, '')

const { MUSIC_TOOLS, MUSIC_SYSTEM_HINT, musicStateSummary } = await importTs('lib/voice/music-tools.ts')
const { planVoiceCalls } = await importTs('lib/voice/execute-music.ts')
const { musicMaps, describeBeat } = await importTs('lib/voice/position.ts')

const argv = process.argv.slice(2)
const flag = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const songKind = flag('--song') ?? '4-4'
const rawCalls = flag('--calls')
const sentence = argv.filter(a => !a.startsWith('--') && a !== songKind && a !== rawCalls).join(' ')

// ── Songs to try things against ─────────────────────────────────────────────
//
// The awkward ones are here on purpose. A command vocabulary that only works in
// 4/4 at one tempo is a vocabulary that works on almost no real song.
function song(kind) {
  const tracks = [
    makeTrack({ id: 'tk', name: 'Kick' }),
    makeTrack({ id: 'tb1', name: 'Bass 1' }),
    makeTrack({ id: 'tb2', name: 'Bass 2' }),
    makeTrack({ id: 'tp', name: 'Pad' }),
  ]
  const clips = [
    makeClip({ id: 'ck', trackId: 'tk', name: 'Kick loop', startBeat: 0, durationBeats: 16, notes: makeNotes(8, { pitchBase: 36, spread: 1 }) }),
    makeClip({ id: 'cb1', trackId: 'tb1', name: 'Bass 1 line', startBeat: 0, durationBeats: 16, notes: makeNotes(8, { pitchBase: 40 }) }),
    makeClip({ id: 'cb2', trackId: 'tb2', name: 'Bass 2 line', startBeat: 16, durationBeats: 8, notes: makeNotes(6, { pitchBase: 43 }) }),
    makeClip({ id: 'cp', trackId: 'tp', name: 'Pad', startBeat: 8, durationBeats: 24, notes: makeNotes(4, { pitchBase: 60, step: 4, length: 4 }) }),
  ]
  const base = { id: 'try', name: 'Bench', tracks, arrangementClips: clips, tempoMarkers: [], meterMarkers: [] }
  if (kind === '3-4') return { ...base, tempo: 120, timeSignatureNum: 3, timeSignatureDen: 4 }
  if (kind === 'tempo-change') {
    return { ...base, tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
      tempoMarkers: [{ id: 'tm', beat: 16, tempo: 60 }] }
  }
  if (kind === 'meter-change') {
    return { ...base, tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
      meterMarkers: [{ id: 'mm', beat: 16, num: 3, den: 4 }] }
  }
  return { ...base, tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4 }
}

const project = song(songKind)
const maps = musicMaps(project)

console.log(`song: ${songKind} — ${project.tempo}bpm ${project.timeSignatureNum}/${project.timeSignatureDen}`)
if (project.tempoMarkers?.length) console.log(`  tempo change: ${project.tempoMarkers.map(m => `${m.tempo}bpm at ${describeBeat(m.beat, maps)}`).join(', ')}`)
if (project.meterMarkers?.length) console.log(`  meter change: ${project.meterMarkers.map(m => `${m.num}/${m.den} at ${describeBeat(m.beat, maps)}`).join(', ')}`)
console.log(`  ${musicStateSummary(project)}\n`)

// ── Words → tool calls ──────────────────────────────────────────────────────
async function ask(text) {
  const key = env('ANTHROPIC_API_KEY')
  if (!key) {
    console.error('No ANTHROPIC_API_KEY — use --calls to test the executor without the model.')
    process.exit(2)
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1200,
      system: [
        'You are the 100Lights assistant, working hands-on inside Beacon, the music studio.',
        'You take actions by calling the provided tools; the app executes them for real.',
        MUSIC_SYSTEM_HINT,
        `Current song: ${musicStateSummary(project)}`,
      ].join('\n\n'),
      tools: MUSIC_TOOLS,
      messages: [{ role: 'user', content: text }],
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) { console.error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1) }
  const data = await res.json()
  const blocks = data.content ?? []
  return {
    text: blocks.filter(b => b.type === 'text').map(b => b.text).join(' ').trim(),
    calls: blocks.filter(b => b.type === 'tool_use').map(b => ({ name: b.name, input: b.input ?? {} })),
    usage: data.usage,
  }
}

let calls, modelText = ''
if (rawCalls) {
  try { calls = JSON.parse(rawCalls) } catch { console.error('--calls is not valid JSON'); process.exit(1) }
} else {
  if (!sentence) {
    console.error('Say something: node scripts/voice-try.mjs "loop bass 2 three more times"')
    process.exit(1)
  }
  console.log(`you said: "${sentence}"\n`)
  const r = await ask(sentence)
  calls = r.calls
  modelText = r.text
  if (r.usage) console.log(`(${r.usage.input_tokens} in / ${r.usage.output_tokens} out)\n`)
}

if (modelText) console.log(`it said: ${modelText}\n`)

if (!calls.length) {
  console.log('No tool calls — it chose to answer rather than act.')
  process.exit(0)
}

console.log('tool calls:')
for (const c of calls) console.log(`  ${c.name}(${JSON.stringify(c.input)})`)

const plan = planVoiceCalls(calls, project)
console.log()
if (plan.problem) {
  console.log(`REFUSED: ${plan.problem}`)
  process.exit(0)
}

console.log(`actions (${plan.actions.length}):`)
for (const a of plan.actions) {
  const t = a.type
  // Show positions as bars, because that is the only way to tell at a glance
  // whether "the first 8 seconds" landed where it should have.
  const where = a.clip?.startBeat != null ? ` at ${describeBeat(a.clip.startBeat, maps)}`
    : a.startBeat != null ? ` to ${describeBeat(a.startBeat, maps)}`
      : a.point?.beat != null ? ` at ${describeBeat(a.point.beat, maps)} = ${Math.round((a.point.value ?? 0) * 100)}%`
        : a.marker?.beat != null ? ` at ${describeBeat(a.marker.beat, maps)}`
          : a.start != null ? ` ${describeBeat(a.start, maps)}–${describeBeat(a.end, maps)}`
            : ''
  const extra = t === 'UPDATE_MIDI_NOTE' ? ` pitch→${a.patch?.pitch}`
    : t === 'UPDATE_TRACK' ? ` ${JSON.stringify(a.patch)}`
      : t === 'TRANSPORT' ? ` ${a.action}` : ''
  console.log(`  ${t}${where}${extra}`)
}
console.log(`\nreads back: ${plan.say}`)
