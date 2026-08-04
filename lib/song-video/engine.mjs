// ── Song-video harness ───────────────────────────────────────────────────────
// The shared machinery every FORMAT runs on: canvas sizing, the beat clock (from
// a tempo clock, or synced to an HTMLMediaElement), a soft preview synth, note-
// onset detection, and the consistent brand/meta/hook/progress chrome. Formats
// (lib/song-video/formats.mjs) just draw the note visualization inside the field.
//
//   const vid = mountSongVideo(canvas, song, { format:'lights', hook:[…], meta:'…' })
//   vid.play(); … ; vid.destroy()

import { FORMATS } from './formats.mjs'

const DEFAULTS = {
  format: 'falling-notes',
  brand: '100LIGHTS', meta: '', hook: [], accent: '#a78bfa',
  loopBeats: 32, synth: true, media: null,
  // Look controls (live-updatable via the returned update()): the title/caption
  // font, a text-size multiplier, and the two-stop background gradient.
  font: 'system-ui', textScale: 1, bg: ['#0a0912', '#050409'],
}
const hexa = (c, a) => { const n = parseInt(c.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})` }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

export function mountSongVideo(canvas, song, options = {}) {
  const o = { ...DEFAULTS, ...options }
  const format = FORMATS[o.format] || FORMATS['falling-notes']
  const ctx = canvas.getContext('2d')
  const SPB = 60 / song.tempo, LOOP = o.loopBeats
  const pmin = Math.min(...song.notes.map(n => n.p)) - 1, pmax = Math.max(...song.notes.map(n => n.p)) + 1
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath() }

  const f = { ctx, W: 0, H: 0, beat: 0, pulse: 0, SPB, LOOP, now: 0, hexa, rr, accent: o.accent, tracks: song.tracks, fieldTop: 0, fieldBot: 0,
    px: p => (0.08 + (p - pmin) / (pmax - pmin) * 0.84) * f.W }

  function resize() {
    const r = canvas.getBoundingClientRect()
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
    canvas.width = Math.max(2, Math.round(r.width * dpr)); canvas.height = Math.max(2, Math.round(r.height * dpr))
    f.W = canvas.width; f.H = canvas.height; f.fieldTop = f.H * 0.13; f.fieldBot = f.H * 0.82; ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  const fmt = format.create(song, o)

  // ── soft preview synth (skipped when driven by real `media`) ──
  let AC = null, master = null, capDest = null
  const TIMBRE = [{ type: 'sine', atk: 0.02, rel: 0.30, gain: 0.5 }, { type: 'triangle', atk: 0.01, rel: 0.45, gain: 0.34 }, { type: 'sawtooth', atk: 0.35, rel: 0.9, gain: 0.10 }]
  function initAudio() {
    if (AC || !o.synth || o.media || typeof window === 'undefined') return
    const ACtor = window.AudioContext || window.webkitAudioContext; if (!ACtor) return
    AC = new ACtor(); master = AC.createGain(); master.gain.value = 0.42 // more headroom (was 0.9 → clipped on chords)
    // Brick-wall-ish limiter so stacked notes can't distort the master.
    const comp = AC.createDynamicsCompressor(); comp.threshold.value = -12; comp.knee.value = 6; comp.ratio.value = 14; comp.attack.value = 0.003; comp.release.value = 0.12
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.4
    const dly = AC.createDelay(); dly.delayTime.value = SPB * 0.75; const fb = AC.createGain(); fb.gain.value = 0.2; const wet = AC.createGain(); wet.gain.value = 0.14
    master.connect(comp); comp.connect(lp); lp.connect(AC.destination); lp.connect(dly); dly.connect(fb); fb.connect(dly); dly.connect(wet); wet.connect(AC.destination)
    capDest = AC.createMediaStreamDestination(); lp.connect(capDest); wet.connect(capDest) // tap for video export
  }
  function synth(n) {
    if (!AC) return
    const tb = TIMBRE[clamp(n.tr, 0, TIMBRE.length - 1)], t0 = AC.currentTime, freq = 440 * Math.pow(2, (n.p - 69) / 12)
    const osc = AC.createOscillator(); osc.type = tb.type; osc.frequency.value = freq
    const g = AC.createGain(), peak = tb.gain * (0.4 + 0.6 * (n.v / 100)), dur = Math.min(n.d * SPB, 2.4)
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + tb.atk); g.gain.exponentialRampToValueAtTime(0.0001, t0 + tb.atk + dur + tb.rel)
    if (tb.type === 'sawtooth') { const o2 = AC.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = freq * 1.006; o2.connect(g); o2.start(t0); o2.stop(t0 + tb.atk + dur + tb.rel + 0.1) }
    osc.connect(g); g.connect(master); osc.start(t0); osc.stop(t0 + tb.atk + dur + tb.rel + 0.1)
  }

  let playing = false, startPerf = 0, lastBeat = 0, raf = 0
  const beatNow = () => ((o.media ? o.media.currentTime : (performance.now() - startPerf) / 1000) / SPB) % LOOP
  // A format may gate audio per note via fmt.audible(n, f) — e.g. the stem-builder
  // only lets a track sound once its layer has entered, so the preview builds up.
  function fireOnsets(a, b) { for (const n of song.notes) if (a < b ? (n.s > a && n.s <= b) : (n.s > a || n.s <= b)) { if (!o.media && (!fmt.audible || fmt.audible(n, f))) synth(n); if (fmt.onHit) fmt.onHit(n, f) } }

  function drawChrome() {
    const { W, H, pulse } = f, pad = W * 0.06
    ctx.textBaseline = 'alphabetic'
    const ts = o.textScale || 1
    ctx.fillStyle = hexa(o.accent, 0.9 + 0.1 * pulse); ctx.beginPath(); ctx.arc(pad + 6, H * 0.062, 6, 0, 7); ctx.fill()
    ctx.fillStyle = '#eceafd'; ctx.font = `800 ${Math.round(W * 0.046 * ts)}px ${o.font}`; ctx.textAlign = 'left'; ctx.fillText(o.brand, pad + 22, H * 0.075)
    if (o.meta) { ctx.fillStyle = '#8b88a8'; ctx.font = `600 ${Math.round(W * 0.026 * ts)}px ui-monospace, monospace`; ctx.fillText(o.meta, pad + 1, H * 0.108) }
    ctx.textAlign = 'center'
    o.hook.slice(0, 2).forEach((ln, i) => { if (!ln || !ln.text) return; ctx.fillStyle = ln.accent ? hexa(o.accent, 0.95) : '#eceafd'; ctx.font = `800 ${Math.round(W * 0.062 * ts)}px ${o.font}`; ctx.fillText(ln.text, W / 2, H * (0.865 + i * 0.04)) })
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; rr(pad, H * 0.94, W - 2 * pad, 4, 2); ctx.fill()
    ctx.fillStyle = hexa(o.accent, 0.85); rr(pad, H * 0.94, (W - 2 * pad) * (f.beat / LOOP), 4, 2); ctx.fill()
  }

  function loop() {
    f.beat = beatNow(); f.pulse = Math.pow(1 - (f.beat - Math.floor(f.beat)), 3); f.now = performance.now()
    if (playing) { if (f.beat >= lastBeat) fireOnsets(lastBeat, f.beat); else { fireOnsets(lastBeat, LOOP); fireOnsets(0, f.beat) } }
    lastBeat = f.beat
    ctx.globalCompositeOperation = 'source-over' // formats may set 'lighter'; never let it leak between frames
    ctx.clearRect(0, 0, f.W, f.H)
    const bg = ctx.createLinearGradient(0, 0, 0, f.H); bg.addColorStop(0, (o.bg && o.bg[0]) || '#0a0912'); bg.addColorStop(1, (o.bg && o.bg[1]) || '#050409'); ctx.fillStyle = bg; ctx.fillRect(0, 0, f.W, f.H)
    fmt.draw(f)
    drawChrome()
    raf = requestAnimationFrame(loop)
  }

  const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(resize) : null
  resize(); if (ro) ro.observe(canvas); startPerf = performance.now(); raf = requestAnimationFrame(loop)

  return {
    canvas,
    play() { initAudio(); if (AC && AC.resume) AC.resume(); if (o.media) { o.media.currentTime = 0; o.media.play().catch(() => {}) } playing = true; startPerf = performance.now(); lastBeat = 0 },
    pause() { playing = false; if (o.media) o.media.pause() },
    resize, destroy() { cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (AC && AC.close) AC.close() },
    /** Live-update look opts (text/hook/meta/accent/font/textScale/bg) without a
     *  remount — the draw loop reads these each frame, so edits apply instantly. */
    update(partial) { Object.assign(o, partial) },
    /** A MediaStream of the preview audio, for recording an export (null if no synth). */
    getAudioStream() { initAudio(); if (AC && AC.resume) AC.resume(); return capDest ? capDest.stream : null },
    get playing() { return playing },
  }
}
