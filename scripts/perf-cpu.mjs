// How much slower a machine can get before Beacon stops sounding right.
//
// Chrome can pretend to be a slower computer (CDP CPU throttling: 4 = four
// times slower). At each step this plays a deliberately busy song and measures
// the things that fail at DIFFERENT points, because only some of them are
// audible:
//
//   AUDIO ENERGY — the master output, captured in real time and compared with
//     the same capture on an unthrottled machine. Notes that never got
//     scheduled are notes that never sounded, and this is the only measure
//     that hears them go. THE ONE THAT MATTERS.
//   LONGEST SILENCE — the biggest gap in that capture. A dropout you would
//     notice rather than a general thinning.
//   AUDIO CLOCK DRIFT — how far the AudioContext's clock falls behind the wall
//     clock. The audio thread is separate and high priority, so this stays flat
//     long after everything else has fallen over.
//   EVENT-LOOP LAG — how late a timer fires against a FIXED schedule. The note
//     scheduler is such a timer, so this is what makes notes go missing.
//   BUSY LOOP — fixed arithmetic, timed, purely to prove the throttle is real.
//
// ⚠️ Not the offline render: __dawRenderWav captures in REAL TIME, so eight
// bars always takes eight bars' worth of seconds. Timing it measures the tempo.
// ⚠️ Not requestAnimationFrame: headless Chrome only paints when it has a
// reason to, so RAF reports nonsense here (0 fps at 1×, 60 at 4×). Event-loop
// lag is the honest stand-in for "the interface is stuttering".
//
// Usage: node .claude/perf-cpu.mjs [rates] [tracks]
import { chromium } from 'playwright'

const BASE = `http://localhost:${process.env.PORT || '3000'}`
const RATES = (process.argv[2] ?? '1,2,4,6,8,10,12,16,20').split(',').map(Number)
const TRACKS = Number(process.argv[3] ?? 8)

const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } })
await ctx.addCookies([{ name: '__clerk_db_jwt', value: 'dev', domain: 'localhost', path: '/' }])
const page = await ctx.newPage()
page.on('pageerror', e => console.log('  PAGE ERROR:', String(e).slice(0, 160)))
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 240000 })
await page.waitForFunction(() => !!window.__dawDispatch && !!window.__dawEngine && !!window.__dawRenderWav, { timeout: 240000 })
await page.waitForTimeout(2500)
const setup = page.locator('div[aria-label="Choose your studio setup"]')
if (await setup.count()) { await setup.locator('button').last().click(); await page.waitForTimeout(1500) }

/**
 * A song with enough going on to be worth measuring: eight tracks, each
 * playing a tone clip once a bar for sixteen bars, with EQ and reverb on every
 * one. Audio clips rather than instruments on purpose — an instrument track
 * with no preset loaded makes no sound, and the first version of this measured
 * silence against silence at every throttle rate.
 */
const loadSong = (tracks, bars) => page.evaluate(([tracks, bars]) => {
  const sr = 44100, n = Math.round(sr * 0.4)
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, (n - i) / (sr * 0.1))
    pcm[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / sr) * 0.5 * env * 32767)
  }
  const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf)
  const w = (o, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)) }
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true)
  new Int16Array(buf, 44).set(pcm)
  const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))

  const p = window.__dawProject()
  const mk = [], clips = []
  for (let t = 0; t < tracks; t++) {
    const id = `t${t}`
    mk.push({ id, name: `Part ${t + 1}`, type: 'audio', color: '#a78bfa', volume: 0.5, pan: (t % 3 - 1) * 0.3,
      mute: false, solo: false, armed: false, height: 64,
      effects: [
        { id: `${id}-eq`, type: 'eq3', enabled: true, params: { low: 1, mid: 0, high: 1 } },
        { id: `${id}-rv`, type: 'reverb', enabled: true, params: { wet: 0.15, decay: 1.5 } },
      ],
      instrument: { type: 'none', params: {} } })
    // A hit every beat, offset per track so they do not all land together.
    for (let b = t * 0.125; b < bars * 4; b += 1) {
      clips.push({ kind: 'audio', id: `${id}-c${b.toFixed(3)}`, trackId: id, name: 'hit', startBeat: b, durationBeats: 0.8,
        gain: 1, loopEnabled: false, reverse: false, fadeIn: 0, fadeOut: 0, trimStart: 0, trimEnd: 0, audioUrl: url, bufferDuration: 0.4 })
    }
  }
  window.__dawDispatch({ type: 'LOAD_PROJECT', project: { ...p, tempo: 120, tracks: mk, arrangementClips: clips,
    scenes: [], sessionGrid: {}, automationLanes: [], cueMarkers: [], loopEnabled: false } })
  return clips.length
}, [tracks, bars])

/** Timers and the audio clock, while the song plays. */
const timing = (seconds) => page.evaluate(async (seconds) => {
  const e = window.__dawEngine, ctx = e.ctx
  e.seek?.(0); e.play?.()
  await new Promise(r => setTimeout(r, 500))
  const t0 = performance.now(), a0 = ctx.currentTime
  // ⚠️ Against a FIXED schedule. Re-basing on each tick measures the gap since
  // the last fire, which is ~0 even when every tick is late — the first version
  // of this reported a perfectly punctual scheduler at twenty times slower.
  const want = 25
  let worstLate = 0, n = 0
  const iv = setInterval(() => { n++; worstLate = Math.max(worstLate, (performance.now() - t0) - n * want) }, want)
  await new Promise(r => setTimeout(r, seconds * 1000))
  clearInterval(iv)
  const wall = (performance.now() - t0) / 1000
  const audio = ctx.currentTime - a0
  e.stop?.()
  const busyStart = performance.now()
  let acc = 0
  for (let i = 0; i < 4_000_000; i++) acc += Math.sqrt(i % 1000)
  return { audioDriftMs: Math.round((wall - audio) * 1000), loopLagMs: Math.round(worstLate), busyMs: Math.round(performance.now() - busyStart), ok: acc > 0 }
}, seconds)

/** The master output itself: total energy, and the longest silence in it. */
const capture = (endBeat) => page.evaluate(async (endBeat) => {
  const r = await window.__dawRenderWav({ startBeat: 0, endBeat, tailSec: 0.05 })
  const bytes = Uint8Array.from(atob(r.master.replace(/^data:[^,]*,/, '')), c => c.charCodeAt(0))
  const dv = new DataView(bytes.buffer)
  const fmt = dv.getUint16(20, true), bits = dv.getUint16(34, true), rate = dv.getUint32(24, true), chans = dv.getUint16(22, true)
  let off = 12, dataOff = 44, dataLen = bytes.length - 44
  while (off + 8 <= bytes.length) { const id = String.fromCharCode(...bytes.slice(off, off + 4)); const len = dv.getUint32(off + 4, true); if (id === 'data') { dataOff = off + 8; dataLen = len; break } off += 8 + len }
  const float = fmt === 3 || bits === 32, bps = float ? 4 : 2
  const frames = Math.floor(dataLen / (bps * chans))
  const at = i => (float ? dv.getFloat32(dataOff + i * chans * bps, true) : dv.getInt16(dataOff + i * chans * bps, true) / 32768)
  const win = Math.round(rate * 0.02)
  let sum = 0, quiet = 0, worstQuiet = 0
  for (let i = 0; i + win < frames; i += win) {
    let e2 = 0
    for (let j = i; j < i + win; j++) { const v = at(j); e2 += v * v }
    const rms = Math.sqrt(e2 / win)
    sum += rms
    if (rms < 0.002) { quiet += win / rate; worstQuiet = Math.max(worstQuiet, quiet) } else quiet = 0
  }
  return { energy: +sum.toFixed(1), longestSilenceMs: Math.round(worstQuiet * 1000), seconds: +(frames / rate).toFixed(1) }
}, endBeat)

const cdp = await page.context().newCDPSession(page)
const clipCount = await loadSong(TRACKS, 16)
await page.waitForTimeout(4000)
console.log(`(${clipCount} audio clips across ${TRACKS} tracks)`)
await timing(3)                     // discarded: the first play builds voices

console.log(`CPU throttle · ${TRACKS} instrument tracks, a note every eighth, EQ + reverb on each`)
console.log('(audio energy is a 4-bar capture of the master, relative to the 1× run)\n')
console.log('rate   audio energy   longest silence   clock drift   loop lag   busy loop')
console.log('----   ------------   ---------------   -----------   --------   ---------')
const rows = []
let base = null
for (const rate of RATES) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  await page.waitForTimeout(800)
  const t = await timing(4)
  const c = await capture(16)
  if (base == null) base = c.energy
  const pct = base > 0 ? Math.round((c.energy / base) * 100) : 0
  rows.push({ rate, ...t, ...c, energyPct: pct })
  console.log(`${String(rate).padStart(3)}×   ${String(pct).padStart(9)} %   ${String(c.longestSilenceMs).padStart(12)} ms   ${String(t.audioDriftMs).padStart(8)} ms   ${String(t.loopLagMs).padStart(5)} ms   ${String(t.busyMs).padStart(6)} ms`)
}
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
console.log('\nJSON: ' + JSON.stringify(rows))
await browser.close()
