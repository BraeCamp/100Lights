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
  // Shared white-noise buffer for the drum voices (created lazily on first hit).
  let noiseBuf = null
  function noise() {
    if (noiseBuf) return noiseBuf
    const len = Math.floor(AC.sampleRate * 0.4)
    noiseBuf = AC.createBuffer(1, len, AC.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    return noiseBuf
  }
  // Percussion for drum tracks — pitched oscillators made drum notes sound like a
  // bassline. Voice by GM-ish pitch: low = kick, mid = snare/clap, high = hat/cymbal.
  function drumHit(n, t0) {
    const vel = 0.4 + 0.6 * (n.v / 100), p = n.p
    if (p < 41) { // kick
      const o = AC.createOscillator(), g = AC.createGain()
      o.type = 'sine'; o.frequency.setValueAtTime(125, t0); o.frequency.exponentialRampToValueAtTime(45, t0 + 0.11)
      g.gain.setValueAtTime(0.95 * vel, t0); g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.22)
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.24)
    } else if (p < 46) { // snare / clap: filtered noise + a short body tone
      const s = AC.createBufferSource(); s.buffer = noise()
      const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8
      const g = AC.createGain(); g.gain.setValueAtTime(0.6 * vel, t0); g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.16)
      s.connect(bp); bp.connect(g); g.connect(master); s.start(t0); s.stop(t0 + 0.18)
      const o = AC.createOscillator(), og = AC.createGain(); o.type = 'triangle'; o.frequency.value = 190
      og.gain.setValueAtTime(0.28 * vel, t0); og.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.11)
      o.connect(og); og.connect(master); o.start(t0); o.stop(t0 + 0.13)
    } else { // hats / cymbals: high-passed noise, short (open a touch longer)
      const open = p === 46 || p >= 49, dec = open ? 0.26 : 0.05
      const s = AC.createBufferSource(); s.buffer = noise()
      const hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500
      const g = AC.createGain(); g.gain.setValueAtTime(0.32 * vel, t0); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dec)
      s.connect(hp); hp.connect(g); g.connect(master); s.start(t0); s.stop(t0 + dec + 0.02)
    }
  }
  function synth(n) {
    if (!AC) return
    const t0 = AC.currentTime
    const kind = (song.tracks[n.tr] && song.tracks[n.tr].kind) || 'melodic'
    if (kind === 'drum') { drumHit(n, t0); return }
    const freq = 440 * Math.pow(2, (n.p - 69) / 12)
    // Bass gets a punchy low voice so it actually reads; melodic keeps the timbres.
    const tb = kind === 'bass'
      ? { type: 'triangle', atk: 0.006, rel: 0.16, gain: 0.6 }
      : TIMBRE[clamp(n.tr, 0, TIMBRE.length - 1)]
    const osc = AC.createOscillator(); osc.type = tb.type; osc.frequency.value = freq
    const g = AC.createGain(), peak = tb.gain * (0.4 + 0.6 * (n.v / 100)), dur = Math.min(n.d * SPB, 2.4)
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + tb.atk); g.gain.exponentialRampToValueAtTime(0.0001, t0 + tb.atk + dur + tb.rel)
    if (kind === 'bass') { const sub = AC.createOscillator(); sub.type = 'sine'; sub.frequency.value = freq / 2; const sg = AC.createGain(); sg.gain.setValueAtTime(0.0001, t0); sg.gain.exponentialRampToValueAtTime(peak * 0.7, t0 + tb.atk); sg.gain.exponentialRampToValueAtTime(0.0001, t0 + tb.atk + dur + tb.rel); sub.connect(sg); sg.connect(master); sub.start(t0); sub.stop(t0 + tb.atk + dur + tb.rel + 0.1) }
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
