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

// ── The conversation, end to end ───────────────────────────────────────────
//
// Brae's example, exactly: a track called Bass with three clips on it, one of
// them also called Bass. "Loop the bass three more times" has two honest
// readings, so the studio asks — and then offers to fix the reason it had to.
{
  await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), {
    ...PROJECT,
    id: 'convo', name: 'Convo',
    tracks: [track('t1', 'Bass'), track('t2', 'Drums')],
    arrangementClips: [
      { kind: 'midi', id: 'k1', trackId: 't1', name: 'Intro', startBeat: 0, durationBeats: 4, isDrumClip: false, notes: notes(4, 40) },
      { kind: 'midi', id: 'k2', trackId: 't1', name: 'Middle', startBeat: 32, durationBeats: 4, isDrumClip: false, notes: notes(4, 40) },
      { kind: 'midi', id: 'k3', trackId: 't1', name: 'Bass', startBeat: 56, durationBeats: 4, isDrumClip: false, notes: notes(4, 40) },
    ],
  })
  await page.waitForTimeout(1200)

  const before = (await state()).clips
  await say('loop the bass 3 more times')

  const question = page.getByText('WHICH DID YOU MEAN', { exact: false })
  const askedIt = await question.first().waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true).catch(() => false)
  check('an ambiguous target asks instead of guessing', askedIt)
  check('and nothing has changed while it asks', (await state()).clips === before,
    `${(await state()).clips} clips`)

  const text = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')]
      .find(d => /Do you mean/i.test(d.textContent || '') && (d.textContent || '').length < 200)
    return el?.textContent ?? ''
  })
  check('the question names both readings',
    /bar 15/i.test(text) && /track/i.test(text), text.slice(0, 140))

  // Answer it the way a person would — in a fragment, not a sentence.
  await say('the bass clip at bar 15')
  await page.waitForTimeout(1000)
  check('answering it does the thing', (await state()).clips > before,
    `${before} → ${(await state()).clips} clips`)

  // And then the offer that stops it happening again.
  const offer = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')]
      .find(d => /rename/i.test(d.textContent || '') && (d.textContent || '').length < 250)
    return el?.textContent ?? ''
  })
  check('it offers to rename the clip that caused the confusion',
    /rename/i.test(offer), offer.slice(0, 140))

  await say('yes')
  await page.waitForTimeout(800)
  const prompt = await page.getByText('WHAT SHOULD IT BE CALLED', { exact: false }).count()
  check('saying yes asks what to call it', prompt > 0)

  await say('Outro')
  await page.waitForTimeout(1000)
  const names = await page.evaluate(() =>
    window.__dawProject().arrangementClips.map(c => c.name))
  check('and the clip is renamed', names.includes('Outro'), names.join(','))
}

// ── And the collision is actually gone ─────────────────────────────────────
//
// Checked on a fresh project rather than the one above, because duplicating a
// clip KEEPS its name — as it does in every DAW — so "loop the bass three more
// times" leaves three more clips called Bass behind it, and renaming the
// original cannot fix a collision the command itself just recreated. That is
// correct behaviour and a bad way to test the claim.
//
// So: cause the ambiguity with a command that changes no names, resolve it,
// accept the offer, and then check that the same sentence runs straight
// through. That is the whole point of the offer — not resolving one command,
// but not being asked again.
{
  await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), {
    ...PROJECT,
    id: 'convo2', name: 'Convo2',
    tracks: [track('t1', 'Bass'), track('t2', 'Drums')],
    arrangementClips: [
      { kind: 'midi', id: 'm1', trackId: 't1', name: 'Intro', startBeat: 0, durationBeats: 4, isDrumClip: false, notes: notes(4, 40) },
      { kind: 'midi', id: 'm2', trackId: 't1', name: 'Bass', startBeat: 56, durationBeats: 4, isDrumClip: false, notes: notes(4, 40) },
    ],
  })
  await page.waitForTimeout(1200)

  await say('take the bass up 3 semitones')
  const q = page.getByText('WHICH DID YOU MEAN', { exact: false })
  const asked = await q.first().waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true).catch(() => false)
  check('transposing an ambiguous target asks too', asked)

  await say('the bass clip at bar 15')
  await page.waitForTimeout(900)
  await say('yes')
  await page.waitForTimeout(800)
  await say('Ending')
  await page.waitForTimeout(1000)

  const names = await page.evaluate(() =>
    window.__dawProject().arrangementClips.map(c => c.name))
  check('the collision is gone', !names.some(n => (n || '').toLowerCase() === 'bass'),
    names.join(','))

  // The payoff, stated honestly. The NAME collision is gone, so the studio no
  // longer offers to rename anything. The track still holds two clips, so
  // "take the bass up" is still a real question — which of them, or both — and
  // the answer people almost always mean is "both", which is why it is offered
  // first and answerable in one word.
  const before = await page.evaluate(() =>
    window.__dawProject().arrangementClips.map(c => c.notes?.[0]?.pitch))
  await say('take the bass up 2 semitones')
  await page.waitForTimeout(1000)

  const question = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')]
      .find(d => /Do you mean/i.test(d.textContent || '') && (d.textContent || '').length < 200)
    return el?.textContent ?? ''
  })
  check('the rename offer is not made again', !/rename/i.test(question), question.slice(0, 120))
  check('and "all of them" is the first thing offered',
    /both clips/i.test(question), question.slice(0, 120))

  await say('all of them')
  await page.waitForTimeout(1000)
  const after = await page.evaluate(() =>
    window.__dawProject().arrangementClips.map(c => c.notes?.[0]?.pitch))
  check('and one word moves the whole part',
    after.every((p, i) => p === before[i] + 2),
    `${before.join(',')} → ${after.join(',')}`)
}

// ── Questions the studio answers ───────────────────────────────────────────
{
  await say('what is the tempo')
  const answer = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')]
      .find(d => /BPM/i.test(d.textContent || '') && (d.textContent || '').length < 80)
    return el?.textContent ?? ''
  })
  check('"what is the tempo" answers in words', /\d+\s*BPM/i.test(answer), answer)
}

// ── The gaps that were filled ──────────────────────────────────────────────
{
  await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), {
    ...PROJECT,
    id: 'gaps', name: 'Gaps',
    tracks: [track('t1', 'Bass 2'), track('t2', 'Pad'), track('t3', 'Drums')],
    arrangementClips: [
      { kind: 'midi', id: 'g1', trackId: 't1', name: 'Bass 2 clip', startBeat: 0, durationBeats: 4, isDrumClip: false, notes: notes(4, 40) },
    ],
  })
  await page.waitForTimeout(1200)

  await say('mute everything')
  {
    const s = await state()
    check('"mute everything" mutes every track', s.tracks.every(t => t.mute),
      s.tracks.map(t => `${t.name}:${t.mute}`).join(' '))
  }
  await say('unmute everything')
  check('"unmute everything" brings them all back',
    (await state()).tracks.every(t => !t.mute))

  await say('solo the pad')
  await say('clear the solo')
  check('"clear the solo" clears it', (await state()).tracks.every(t => !t.solo))

  await say('put it in a minor')
  {
    const k = await page.evaluate(() => ({
      key: window.__dawProject().key, scale: window.__dawProject().scale,
    }))
    check('"put it in a minor" sets the key — A is a note, not an article',
      k.key === 9 && k.scale === 'minor', JSON.stringify(k))
  }

  await say('what key is this')
  {
    const shown = await page.evaluate(() => {
      const el = [...document.querySelectorAll('div')]
        .find(d => /minor|major/i.test(d.textContent || '') && (d.textContent || '').length < 60)
      return el?.textContent ?? ''
    })
    check('and it can say the key back', /A\s*minor/i.test(shown), shown)
  }
}

// ── A sentence that names nothing means the selected track ────────────────
{
  await page.evaluate(() => {
    const p = window.__dawProject()
    window.__dawSelectTrack?.(p.tracks[1].id)
  })
  // Selecting through the UI, since the studio owns that state: click the
  // track's header row.
  const padRow = page.getByText('Pad', { exact: true }).first()
  if (await padRow.count()) { await padRow.click(); await page.waitForTimeout(500) }

  await say('mute this')
  const muted = (await state()).tracks.find(t => t.name === 'Pad')?.mute
  check('"mute this" mutes the selected track', muted === true,
    (await state()).tracks.map(t => `${t.name}:${t.mute}`).join(' '))
  await say('unmute this')
}

// ── And none of it cost anything ───────────────────────────────────────────
check('not one command reached the assistant', assistCalls === 0, `${assistCalls} calls`)

await browser.close()
console.log(failures
  ? `\n${failures} failing — a command that resolves is not the same as one that works`
  : '\nevery command changed the song it claimed to change')
process.exit(failures ? 1 : 0)
