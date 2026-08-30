#!/usr/bin/env node
/**
 * Do spoken commands actually change the song?
 *
 *   PORT=4661 node scripts/check-voice-commands.mjs
 *
 * Every other voice test reasons about actions: it asks whether the right
 * `UPDATE_TRACK` came out of the right sentence. That is worth checking and it
 * is not the same question as whether the studio ends up muted, as this project
 * has already demonstrated at some length — every mixer command produced a
 * perfectly well-formed action addressed to a track called "[object Object]",
 * and the suites were green throughout because they compared the parser's
 * output against the parser's own idea of the right answer.
 *
 * So this one drives the real UI in a real browser and then reads the real
 * project back. A command counts as working when the track is muted.
 *
 * The assistant is intercepted and never reached, so this spends nothing.
 */

import { chromium } from 'playwright'

const BASE = process.env.BASE || `http://localhost:${process.env.PORT || '4700'}`

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 140)))

let assistCalls = 0
await page.route('**/api/ai/assist*', async route => {
  assistCalls++
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{"calls":[]}' })
})

await page.addInitScript(() => {
  try { localStorage.setItem('100lights-ui-tier', 'full') } catch { /* private mode */ }
})
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })

// This one needs the dev hooks: it loads a known song and reads the project
// back, and neither is possible in a production build. Say so in two seconds
// rather than timing out in four minutes looking for something that is not
// coming — a test that fails slowly and vaguely gets ignored.
const hooked = await page.waitForFunction(
  () => !!window.__dawDispatch && !!window.__dawProject, null, { timeout: 90000 },
).then(() => true).catch(() => false)
if (!hooked) {
  console.log(`\nThis check drives the studio through window.__dawDispatch and reads it back`)
  console.log(`through window.__dawProject. Both are development-only, so it needs a dev`)
  console.log(`server rather than ${BASE}:\n`)
  console.log(`    PORT=4662 npm run dev`)
  console.log(`    PORT=4662 node scripts/check-voice-commands.mjs\n`)
  await browser.close()
  process.exit(2)
}
await page.waitForTimeout(1500)

// ── A song with names worth resolving ───────────────────────────────────────
// The REAL clip and note shapes, checked against lib/daw-types rather than
// written from memory. A fixture that is nearly right is worse than no fixture:
// the reducer skips any clip whose `kind` is not 'midi', so a fixture using
// `type` made transpose look broken when it was working perfectly.
const notes = (n, pitch) => Array.from({ length: n }, (_, i) => ({
  id: `n${pitch}-${i}`, pitch, startBeat: i, durationBeats: 1, velocity: 100,
}))
const track = (id, name) => ({
  id, name, type: 'midi', color: '#8b5cf6', volume: 0.8, pan: 0,
  mute: false, solo: false, armed: false, height: 80,
  effects: [], instrument: { type: 'poly', params: {} },
})
const PROJECT = {
  id: 'voice-check', name: 'Voice Check', tempo: 120,
  timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [track('t1', 'Bass 2'), track('t2', 'Pad'), track('t3', 'Drums')],
  arrangementClips: [
    { kind: 'midi', id: 'c1', trackId: 't1', name: 'Bass 2 clip', startBeat: 0, durationBeats: 4, isDrumClip: false, notes: notes(4, 40) },
    { kind: 'midi', id: 'c2', trackId: 't2', name: 'Pad clip', startBeat: 0, durationBeats: 4, isDrumClip: false, notes: notes(4, 60) },
    { kind: 'midi', id: 'c3', trackId: 't3', name: 'Drums clip', startBeat: 0, durationBeats: 4, isDrumClip: true, notes: notes(4, 36) },
  ],
  scenes: [], sessionGrid: {}, loopStart: 0, loopEnd: 16, loopEnabled: false,
  masterVolume: 1, automationLanes: [], clipEffects: [], returnTracks: [],
  takeLanes: [], crossfaderValue: 0.5, waveformZoom: 1, swing: 0, cueMarkers: [],
}
await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), PROJECT)
await page.waitForTimeout(1200)

const typeBtn = page.locator('button[title="Type a command instead of speaking"]')
const typeField = page.locator('input[placeholder*="loop bass"]').first()
const state = () => page.evaluate(() => {
  const p = window.__dawProject()
  return {
    tempo: p.tempo,
    loopEnabled: p.loopEnabled,
    loopStart: p.loopStart,
    loopEnd: p.loopEnd,
    tracks: p.tracks.map(t => ({ name: t.name, mute: t.mute, solo: t.solo, volume: t.volume, pan: t.pan })),
    clips: p.arrangementClips.length,
  }
})

/** Say something the way a person would, and wait for the studio to settle. */
async function say(sentence) {
  if (!(await typeField.isVisible().catch(() => false))) await typeBtn.click()
  await typeField.waitFor({ state: 'visible', timeout: 15000 })
  await typeField.fill(sentence)
  await typeField.press('Enter')
  await page.waitForTimeout(900)
}

const trackNamed = (s, name) => s.tracks.find(t => t.name === name)

// ── The mixer, which is the family that was silently broken ────────────────
await say('mute the drums')
{
  const s = await state()
  check('"mute the drums" mutes the drums', trackNamed(s, 'Drums')?.mute === true,
    JSON.stringify(trackNamed(s, 'Drums')))
  check('and leaves the other tracks alone',
    trackNamed(s, 'Pad')?.mute === false && trackNamed(s, 'Bass 2')?.mute === false)
}

await say('unmute the drums')
check('"unmute the drums" undoes it', trackNamed(await state(), 'Drums')?.mute === false)

await say('solo the pad')
check('"solo the pad" solos the pad', trackNamed(await state(), 'Pad')?.solo === true)
await say('unsolo the pad')
check('and unsolo clears it', trackNamed(await state(), 'Pad')?.solo === false)

await say('set the pad to 40 percent')
{
  const v = trackNamed(await state(), 'Pad')?.volume
  check('"set the pad to 40 percent" sets the level', Math.abs(v - 0.4) < 0.02, String(v))
}

await say('turn the pad up')
{
  const v = trackNamed(await state(), 'Pad')?.volume
  check('"turn the pad up" is relative to where it already was',
    v > 0.4 && v < 0.7, String(v))
}

await say('pan the bass 2 left')
{
  const pan = trackNamed(await state(), 'Bass 2')?.pan
  // Asserted EXACTLY, not merely "negative". The loose version of this check
  // passed while the command was panning two percent left — the "2" of "Bass 2"
  // was being read as the pan amount — and a test that only asks for the sign
  // cannot tell a working command from that.
  check('"pan the bass 2 left" pans hard left, not 2% left',
    Math.abs(pan - -0.6) < 0.02, String(pan))
}

await say('take the bass 2 up 3 semitones')
{
  const pitches = await page.evaluate(() => {
    const p = window.__dawProject()
    const clip = p.arrangementClips.find(c => c.trackId === 't1')
    return clip?.notes?.map(n => n.pitch) ?? []
  })
  check('"take the bass 2 up 3 semitones" moves the notes 3, not 2',
    pitches.length > 0 && pitches.every(p => p === 43), pitches.join(','))
}

// ── Timing ─────────────────────────────────────────────────────────────────
await say('set the tempo to 96')
check('"set the tempo to 96" changes the tempo', (await state()).tempo === 96, String((await state()).tempo))

await say('speed it up')
{
  const t = (await state()).tempo
  check('"speed it up" is relative to the tempo it had', t > 96 && t <= 112, String(t))
}

await say('loop bars 2 to 4')
{
  const s = await state()
  check('"loop bars 2 to 4" sets the loop region',
    s.loopStart === 4 && s.loopEnd === 12, `${s.loopStart}–${s.loopEnd} beats`)
}
await say('turn looping off')
check('"turn looping off" disables it', (await state()).loopEnabled === false)

// ── Arrangement ────────────────────────────────────────────────────────────
{
  const before = (await state()).clips
  await say('repeat the drums twice')
  const after = (await state()).clips
  check('"repeat the drums twice" adds clips', after > before, `${before} → ${after} clips`)
}

// ── The studio around the song ─────────────────────────────────────────────
await say('put reverb on the pad')
{
  const fx = await page.evaluate(() =>
    window.__dawProject().tracks.find(t => t.name === 'Pad')?.effects.map(e => e.type) ?? [])
  check('"put reverb on the pad" adds a reverb', fx.includes('reverb'), fx.join(',') || 'none')
}
await say('more reverb on the pad')
{
  const wet = await page.evaluate(() => {
    const t = window.__dawProject().tracks.find(x => x.name === 'Pad')
    return t?.effects.find(e => e.type === 'reverb')?.params?.wet
  })
  check('"more reverb on the pad" turns it up, not adds a second one',
    wet === 0.6, String(wet))
}

await say('rename the pad to strings')
{
  const names = (await state()).tracks.map(t => t.name)
  check('"rename the pad to strings" renames it',
    names.includes('Strings') && !names.includes('Pad'), names.join(','))
}

await say('turn everything down')
{
  const master = await page.evaluate(() => window.__dawProject().masterVolume)
  check('"turn everything down" lowers the master', master < 1, String(master))
}

await say('add some swing')
{
  const swing = await page.evaluate(() => window.__dawProject().swing)
  check('"add some swing" swings it', swing > 0, String(swing))
}

await say('mark bar 3 as the chorus')
{
  const markers = await page.evaluate(() =>
    window.__dawProject().cueMarkers.map(m => `${m.name}@${m.beat}`))
  check('"mark bar 3 as the chorus" names the place',
    markers.includes('Chorus@8'), markers.join(',') || 'none')
}

{
  const before = (await state()).tracks.length
  await say('add a track')
  check('"add a track" adds one', (await state()).tracks.length === before + 1)
}

// ── Deleting asks first ────────────────────────────────────────────────────
//
// The one command where being wrong is not recoverable by saying the opposite.
{
  const before = (await state()).tracks.length
  await say('delete the drums track')
  const confirm = page.getByText('THIS CANNOT BE UNDONE', { exact: false })
  // Waited for rather than counted immediately: a dev build takes its time, and
  // a fixed pause that is usually long enough is a test that fails on a busy
  // machine and gets rerun until it passes, which is worse than no test.
  const asked = await confirm.first().waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true).catch(() => false)
  check('"delete the drums track" asks before doing it', asked)
  check('and the track is still there while it asks',
    (await state()).tracks.length === before, `${(await state()).tracks.length} tracks`)

  await page.locator('button', { hasText: 'CANCEL' }).first().click()
  await page.waitForTimeout(500)
  check('cancelling keeps the track', (await state()).tracks.length === before)

  await say('delete the drums track')
  await confirm.first().waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('button', { hasText: 'DO IT' }).first().click()
  await page.waitForTimeout(700)
  const after = await state()
  check('and confirming deletes it',
    after.tracks.length === before - 1 && !after.tracks.some(t => t.name === 'Drums'),
    after.tracks.map(t => t.name).join(','))
}

// ── Undo, which is what someone says after confirming too quickly ──────────
{
  const before = (await state()).tracks.map(t => t.name)
  await say('mute the bass 2')
  check('a change to undo', trackNamed(await state(), 'Bass 2')?.mute === true)
  await say('undo that')
  check('"undo that" takes it back', trackNamed(await state(), 'Bass 2')?.mute === false,
    JSON.stringify(trackNamed(await state(), 'Bass 2')))
  await say('redo that')
  check('"redo that" puts it back', trackNamed(await state(), 'Bass 2')?.mute === true)
  await say('undo that')
  check('and the track list is where it was', (await state()).tracks.map(t => t.name).join(',') === before.join(','))
}

// ── And none of it cost anything ───────────────────────────────────────────
check('not one command reached the assistant', assistCalls === 0, `${assistCalls} calls`)

await browser.close()
console.log(failures
  ? `\n${failures} failing — a command that resolves is not the same as one that works`
  : '\nevery command changed the song it claimed to change')
process.exit(failures ? 1 : 0)
