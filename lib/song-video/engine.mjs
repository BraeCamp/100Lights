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
  // Map the app's canonical drum pitches (lib/drum-presets DRUM_LANES, incl.
  // aliases) to a voice, so each pad sounds like itself. Fallback by register
  // for any off-map pitch.
  const DRUM_VOICE = {
    35: 'kick', 36: 'kick', 37: 'rim', 38: 'snare', 39: 'clap', 40: 'snare',
    41: 'tomLo', 42: 'hatC', 43: 'tomLo', 44: 'hatC', 45: 'tomMid', 46: 'hatO',
    47: 'tomMid', 48: 'tomHi', 49: 'crash', 50: 'tomHi', 51: 'rim', 57: 'crash',
  }
  // A burst of high-passed noise (hats, cymbals, snare/clap body).
  function noiseHit(t0, gain, dec, hpHz, hpQ) {
    const s = AC.createBufferSource(); s.buffer = noise()
    const hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = hpHz; if (hpQ) hp.Q.value = hpQ
    const g = AC.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0006, t0 + dec)
    s.connect(hp); hp.connect(g); g.connect(master); s.start(t0); s.stop(t0 + dec + 0.02)
  }
  // A pitched membrane (kick, toms): sine that drops from f0 to f1.
  function tone(t0, f0, f1, drop, gain, dec, type) {
    const o = AC.createOscillator(), g = AC.createGain()
    o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + drop)
    g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dec)
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dec + 0.02)
  }
  function drumHit(n, t0) {
    const vel = 0.4 + 0.6 * (n.v / 100), p = n.p
    const voice = DRUM_VOICE[p] || (p <= 37 ? 'kick' : p <= 40 ? 'snare' : p >= 46 ? 'hatO' : 'hatC')
    switch (voice) {
      case 'kick': tone(t0, 130, 48, 0.11, 0.98 * vel, 0.22); break
      case 'tomLo': tone(t0, 150, 95, 0.14, 0.7 * vel, 0.24); break
      case 'tomMid': tone(t0, 210, 140, 0.13, 0.66 * vel, 0.22); break
      case 'tomHi': tone(t0, 300, 200, 0.12, 0.62 * vel, 0.2); break
      case 'snare': noiseHit(t0, 0.55 * vel, 0.16, 1600, 0.6); tone(t0, 190, 150, 0.06, 0.3 * vel, 0.11, 'triangle'); break
      case 'clap': noiseHit(t0, 0.5 * vel, 0.13, 1200, 1.2); break
      case 'rim': noiseHit(t0, 0.4 * vel, 0.03, 3200); tone(t0, 440, 400, 0.01, 0.18 * vel, 0.03, 'square'); break
      case 'hatC': noiseHit(t0, 0.34 * vel, 0.045, 8500); break
      case 'hatO': noiseHit(t0, 0.32 * vel, 0.28, 7500); break
      case 'crash': noiseHit(t0, 0.34 * vel, 0.7, 5000); break
      default: noiseHit(t0, 0.3 * vel, 0.05, 8000)
    }
  }
  // A voice per track kind (from from-project). Not the real instrument — a
  // recognisable stand-in until the user bounces the real mix.
  const VOICE = {
    bass:    { type: 'triangle', atk: 0.006, rel: 0.16, gain: 0.60, cap: 1.2 },
    keys:    { type: 'triangle', atk: 0.004, rel: 0.55, gain: 0.42, cap: 1.2, shimmer: 1.5 },
    pad:     { type: 'sine',     atk: 0.24,  rel: 1.10, gain: 0.30, cap: 4.0, shimmer: 1.005 },
    pluck:   { type: 'triangle', atk: 0.002, rel: 0.26, gain: 0.50, cap: 0.7 },
    lead:    { type: 'sawtooth', atk: 0.02,  rel: 0.32, gain: 0.28, cap: 2.0, shimmer: 1.006 },
    melodic: { type: 'triangle', atk: 0.01,  rel: 0.45, gain: 0.34, cap: 2.4 },
  }
  function synth(n) {
    if (!AC) return
    const t0 = AC.currentTime
    const kind = (song.tracks[n.tr] && song.tracks[n.tr].kind) || 'melodic'
    if (kind === 'drum') { drumHit(n, t0); return }
    const v = VOICE[kind] || VOICE.melodic
    const freq = 440 * Math.pow(2, (n.p - 69) / 12)
    const peak = v.gain * (0.4 + 0.6 * (n.v / 100)), dur = Math.min(n.d * SPB, v.cap)
    const end = t0 + v.atk + dur + v.rel
    const osc = AC.createOscillator(); osc.type = v.type; osc.frequency.value = freq
    const g = AC.createGain()
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + v.atk); g.gain.exponentialRampToValueAtTime(0.0001, end)
    osc.connect(g); g.connect(master); osc.start(t0); osc.stop(end + 0.1)
    // Bass: a sub octave for weight. Others (keys/pad/lead): a detuned/octave
    // partial for a fuller, less pure tone.
    if (kind === 'bass') {
      const sub = AC.createOscillator(); sub.type = 'sine'; sub.frequency.value = freq / 2
      const sg = AC.createGain(); sg.gain.setValueAtTime(0.0001, t0); sg.gain.exponentialRampToValueAtTime(peak * 0.7, t0 + v.atk); sg.gain.exponentialRampToValueAtTime(0.0001, end)
      sub.connect(sg); sg.connect(master); sub.start(t0); sub.stop(end + 0.1)
    } else if (v.shimmer) {
      const o2 = AC.createOscillator(); o2.type = v.type; o2.frequency.value = freq * v.shimmer
      const g2 = AC.createGain(); g2.gain.setValueAtTime(0.0001, t0); g2.gain.exponentialRampToValueAtTime(peak * 0.4, t0 + v.atk); g2.gain.exponentialRampToValueAtTime(0.0001, end)
      o2.connect(g2); g2.connect(master); o2.start(t0); o2.stop(end + 0.1)
    }
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
