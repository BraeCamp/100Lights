#!/usr/bin/env node
/**
 * Does the server actually RENDER a clip, end to end?
 *
 *   PORT=3000 node scripts/check-server-render.mjs
 *
 * Brae: "The server render gave up trying. Please fix."
 *
 * It gave up because /api/render-clip could only SERVE renders and nothing
 * anywhere ever made one — a cache with no producer. This drives the producer
 * over HTTP the way the studio does: compute a clip's stamp, ask for it (expect
 * a miss), POST it, and check that what comes back is audio with sound in it.
 *
 * ⚠️ Needs the dev server with DEV_OPEN=1 — the route is signed-in only, and
 * this authenticates as a synthetic user via x-test-user, exactly as the other
 * headless checks do.
 */

import { importTs } from './lib/ts-import.mjs'

const BASE = `http://localhost:${process.env.PORT || '3000'}`
const USER = 'check-server-render'

const { initPatch } = await importTs('lib/apollo/patch.ts')
// clip-stamp, not daw-freeze: daw-freeze reaches engine-client, which cannot
// be loaded in plain Node. That is the reason the stamp now lives on its own.
const { freezeStamp } = await importTs('lib/apollo/clip-stamp.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const patch = initPatch()
const bpm = 120
const clipId = `clip-${Date.now().toString(36)}`
// A short chord, and a fresh clip id every run so this always exercises the
// RENDER path rather than reading back a previous run's cache.
const notes = [40, 47, 52, 59].map((pitch, i) => ({
  id: `n${i}`, pitch, startBeat: i * 0.25, durationBeats: 2, velocity: 104,
}))
const key = `${clipId}|${freezeStamp(notes, patch, bpm)}`

const headers = { 'x-test-user': USER, 'content-type': 'application/json' }

// 1. Nobody has rendered this, so it must miss — and must say a renderer exists.
const miss = await fetch(`${BASE}/api/render-clip?stamp=${encodeURIComponent(key)}`, { headers })
check('an unrendered clip misses', miss.status === 404, `status ${miss.status}`)
const missBody = await miss.json().catch(() => ({}))
// This flag is the whole fix: it is what tells the studio to ask for a render
// instead of giving up on server loading.
check('and the miss advertises a renderer', missBody.renderer === true, JSON.stringify(missBody).slice(0, 120))

// 2. Ask for it to be made.
const t0 = Date.now()
const made = await fetch(`${BASE}/api/render-clip`, {
  method: 'POST', headers,
  body: JSON.stringify({ key, clipId, notes, patch, bpm }),
})
const ms = Date.now() - t0
// Show the server's own words on a failure — a bare status code sends you to
// the log file, and the log file is on the other side of a deploy.
const detail = made.ok ? '' : (await made.clone().text()).slice(0, 300).replace(/\s+/g, ' ')
check('the server accepts the render request', made.ok, `status ${made.status} ${detail}`)
if (!made.ok) { console.log(`\n${failures} failing`); process.exit(1) }

const type = made.headers.get('content-type') ?? ''
if (type.includes('json')) {
  const why = await made.json().catch(() => ({}))
  check('it returned audio, not a refusal', false, JSON.stringify(why).slice(0, 200))
} else {
  const bytes = new Uint8Array(await made.arrayBuffer())
  check('it returned audio', bytes.byteLength > 1000, `${bytes.byteLength} bytes in ${ms}ms`)

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const riff = String.fromCharCode(...bytes.slice(0, 4))
  check('the audio is a WAV', riff === 'RIFF', riff)
  check('at the canonical render rate', view.getUint32(24, true) === 48000, String(view.getUint32(24, true)))

  // ⚠️ The failure that looks like success. A silent render is stored under a
  // key every listener of this song reads, and nothing downstream can tell it
  // from "this part is meant to be quiet".
  let peak = 0
  for (let o = 44; o + 1 < bytes.byteLength; o += 2) peak = Math.max(peak, Math.abs(view.getInt16(o, true)))
  check('and it has sound in it', peak > 1000, `peak ${(peak / 32768).toFixed(3)}`)
}

// 3. Now it is rendered, the plain GET must serve it — the part that was
//    already working, and the reason any of this is worth doing: one render,
//    served to everyone who opens the song.
const hit = await fetch(`${BASE}/api/render-clip?stamp=${encodeURIComponent(key)}`, { headers })
check('a second request is served from storage', hit.ok, `status ${hit.status}`)

// 4. A stamp that does not match its contents must be refused, or this endpoint
//    writes whatever anyone likes under a key other people read.
const forged = await fetch(`${BASE}/api/render-clip`, {
  method: 'POST', headers,
  body: JSON.stringify({ key: `${clipId}|forged-stamp-value`, clipId, notes, patch, bpm }),
})
const forgedBody = await forged.json().catch(() => ({}))
check('a forged stamp is refused', forgedBody.reason === 'stamp-mismatch', JSON.stringify(forgedBody).slice(0, 120))

console.log(failures ? `\n${failures} failing` : '\nthe server renders clips and serves them back')
process.exit(failures ? 1 : 0)
