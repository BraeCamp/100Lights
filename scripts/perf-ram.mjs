// How much song Beacon can hold before memory becomes the problem.
//
// ⚠️ Capping the JS heap at launch (--max-old-space-size) does NOT work here:
// the renderer ignored it and used 141 MB under a 96 MB cap. So instead of
// pretending to take memory away, this ADDS song until memory is the thing
// that hurts — which is the number somebody can actually act on ("how big can
// my project get"), and it is measured rather than asserted.
//
// At each size: how long the project takes to load, how much JS heap it holds,
// whether the audio still comes out, and how long a real-time capture takes to
// start. Then, at the largest size, Chrome is told it is under CRITICAL memory
// pressure — the signal a phone or a loaded laptop sends — and the audio is
// measured again.
//
// Usage: node .claude/perf-ram.mjs [sizes as tracks×bars]
import { chromium } from 'playwright'

const BASE = `http://localhost:${process.env.PORT || '3000'}`
const SIZES = (process.argv[2] ?? '8x16,16x32,32x32,48x64,64x64').split(',').map(s => {
  const [t, b] = s.split('x').map(Number)
  return { tracks: t, bars: b }
})

const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--enable-precise-memory-info'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addCookies([{ name: '__clerk_db_jwt', value: 'dev', domain: 'localhost', path: '/' }])
const page = await ctx.newPage()
const problems = []
page.on('crash', () => problems.push('the page crashed'))
page.on('pageerror', e => problems.push(String(e).slice(0, 80)))
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 240000 })
await page.waitForFunction(() => !!window.__dawDispatch && !!window.__dawEngine && !!window.__dawRenderWav, { timeout: 240000 })
await page.waitForTimeout(2500)
const setup = page.locator('div[aria-label="Choose your studio setup"]')
if (await setup.count()) { await setup.locator('button').last().click(); await page.waitForTimeout(1500) }

const build = (tracks, bars) => page.evaluate(async ([tracks, bars]) => {
  const sr = 44100, n = Math.round(sr * 0.4)
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) { const env = Math.min(1, (n - i) / (sr * 0.1)); pcm[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / sr) * 0.5 * env * 32767) }
  const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf)
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true)
  new Int16Array(buf, 44).set(pcm)
  window.__perfUrl = window.__perfUrl ?? URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))

  const p = window.__dawProject()
  const mk = [], clips = []
  for (let t = 0; t < tracks; t++) {
    const id = `t${t}`
    mk.push({ id, name: `Part ${t + 1}`, type: 'audio', color: '#a78bfa', volume: 0.4, pan: 0, mute: false, solo: false, armed: false, height: 64,
      effects: [{ id: `${id}-eq`, type: 'eq3', enabled: true, params: { low: 1, mid: 0, high: 1 } }, { id: `${id}-rv`, type: 'reverb', enabled: true, params: { wet: 0.15, decay: 1.5 } }],
      instrument: { type: 'none', params: {} } })
    for (let b = (t % 8) * 0.125; b < bars * 4; b += 1) {
      clips.push({ kind: 'audio', id: `${id}-c${b.toFixed(3)}`, trackId: id, name: 'hit', startBeat: b, durationBeats: 0.8,
        gain: 1, loopEnabled: false, reverse: false, fadeIn: 0, fadeOut: 0, trimStart: 0, trimEnd: 0, audioUrl: window.__perfUrl, bufferDuration: 0.4 })
    }
  }
  const t0 = performance.now()
  window.__dawDispatch({ type: 'LOAD_PROJECT', project: { ...p, tempo: 120, tracks: mk, arrangementClips: clips, scenes: [], sessionGrid: {}, automationLanes: [], cueMarkers: [], loopEnabled: false } })
  await new Promise(r => setTimeout(r, 0))
  return { clips: clips.length, loadMs: Math.round(performance.now() - t0) }
}, [tracks, bars])

const heapMb = () => page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null))

/** Four bars of the master: energy, and the longest hole in it. */
const audio = () => page.evaluate(async () => {
  const t0 = performance.now()
  const r = await window.__dawRenderWav({ startBeat: 0, endBeat: 16, tailSec: 0.05 })
  const wall = Math.round(performance.now() - t0)
  const bytes = Uint8Array.from(atob(r.master.replace(/^data:[^,]*,/, '')), c => c.charCodeAt(0))
  const dv = new DataView(bytes.buffer)
  const fmt = dv.getUint16(20, true), bits = dv.getUint16(34, true), rate = dv.getUint32(24, true), chans = dv.getUint16(22, true)
  let off = 12, dataOff = 44, dataLen = bytes.length - 44
  while (off + 8 <= bytes.length) { const id = String.fromCharCode(...bytes.slice(off, off + 4)); const len = dv.getUint32(off + 4, true); if (id === 'data') { dataOff = off + 8; dataLen = len; break } off += 8 + len }
  const float = fmt === 3 || bits === 32, bps = float ? 4 : 2
  const frames = Math.floor(dataLen / (bps * chans))
  const at = i => (float ? dv.getFloat32(dataOff + i * chans * bps, true) : dv.getInt16(dataOff + i * chans * bps, true) / 32768)
  const win = Math.round(rate * 0.02)
  let sum = 0, quiet = 0, worst = 0
  for (let i = 0; i + win < frames; i += win) {
    let e2 = 0
    for (let j = i; j < i + win; j++) { const v = at(j); e2 += v * v }
    const rms = Math.sqrt(e2 / win)
    sum += rms
    if (rms < 0.002) { quiet += win / rate; worst = Math.max(worst, quiet) } else quiet = 0
  }
  return { energy: +sum.toFixed(1), longestSilenceMs: Math.round(worst * 1000), captureMs: wall }
})

console.log('Song size · audio clips, EQ + reverb on every track\n')
console.log('    size   clips   load   heap    audio   longest silence')
console.log('--------   -----   ----   -----   -----   ---------------')
const rows = []
for (const { tracks, bars } of SIZES) {
  problems.length = 0
  const b = await build(tracks, bars)
  await page.waitForTimeout(3000)
  const h = await heapMb()
  const a = await audio()
  rows.push({ tracks, bars, ...b, heapMb: h, ...a, problems: [...problems] })
  console.log(`${String(tracks).padStart(3)}×${String(bars).padEnd(4)}   ${String(b.clips).padStart(5)}   ${String(b.loadMs).padStart(3)}ms   ${String(h ?? '?').padStart(4)}M   ${String(a.energy).padStart(5)}   ${String(a.longestSilenceMs).padStart(12)} ms${problems.length ? '   ⚠ ' + problems[0] : ''}`)
}

// ── And under real memory pressure ───────────────────────────────────────────
// The signal a phone or a loaded laptop sends when it wants memory back.
const cdp = await page.context().newCDPSession(page)
try {
  await cdp.send('Memory.simulatePressureNotification', { level: 'critical' })
  await page.waitForTimeout(2000)
  const a = await audio()
  console.log(`\nafter a CRITICAL memory-pressure signal at the largest size: audio ${a.energy}, longest silence ${a.longestSilenceMs} ms, heap ${await heapMb()} M`)
} catch (e) {
  console.log('\ncritical-pressure signal not available: ' + String(e).split('\n')[0].slice(0, 80))
}

console.log('\nJSON: ' + JSON.stringify(rows))
await browser.close()
