// Programmatic drum synthesis — no sample files required.
// Each function returns a Float32Array of normalized PCM samples.
// All synthesis is done with pure math (no Web Audio API) so it works
// server-side too. Algorithms are classic FM / noise / filter combinations.

// ── Kick ──────────────────────────────────────────────────────────────────
// Sine wave with exponential frequency sweep (punch) + dual-decay envelope.
export function synthKick(sampleRate: number): Float32Array {
  const n = Math.floor(sampleRate * 0.55)
  const data = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const freq = 155 * Math.exp(-38 * t) + 48     // 203 Hz → 48 Hz sweep
    phase += (2 * Math.PI * freq) / sampleRate
    const amp  = 0.45 * Math.exp(-4 * t) + 0.55 * Math.exp(-0.6 * t)
    const click = (Math.random() * 2 - 1) * 0.04 * Math.exp(-90 * t)  // transient click
    data[i] = (Math.sin(phase) * amp + click) * 0.95
  }
  return data
}

// ── Snare ─────────────────────────────────────────────────────────────────
// White noise (crack) + low sine body, one-pole highpass for brightness.
export function synthSnare(sampleRate: number): Float32Array {
  const n = Math.floor(sampleRate * 0.28)
  const data = new Float32Array(n)
  let xp = 0, yp = 0
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const noise = Math.random() * 2 - 1
    // One-pole highpass ~1kHz
    const y = noise - xp + 0.94 * yp;  xp = noise;  yp = y
    const body = Math.sin(2 * Math.PI * 180 * t) * 0.35
    data[i] = (y * Math.exp(-22 * t) * 0.72 + body * Math.exp(-20 * t)) * 0.9
  }
  return data
}

// ── Hi-hat (closed) ───────────────────────────────────────────────────────
// Two cascaded highpasses for metallic sheen, very short decay.
export function synthHat(sampleRate: number, open = false): Float32Array {
  const dur   = open ? 0.38 : 0.048
  const decay = open ? 13   : 160
  const n     = Math.floor(sampleRate * dur)
  const data  = new Float32Array(n)
  let x1 = 0, y1 = 0, x2 = 0, y2 = 0
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const noise = Math.random() * 2 - 1
    let y = noise - x1 + 0.978 * y1;  x1 = noise;  y1 = y
        y = y    - x2 + 0.978 * y2;  x2 = y;      y2 = y
    data[i] = y * Math.exp(-decay * t) * 0.68
  }
  return data
}

// ── Clap ─────────────────────────────────────────────────────────────────
// Two noise bursts ~8ms apart simulating multi-hand slap character.
export function synthClap(sampleRate: number): Float32Array {
  const n = Math.floor(sampleRate * 0.14)
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const b1 = Math.exp(-130 * t)
    const b2 = Math.exp(-90 * Math.abs(t - 0.009)) * (t > 0.007 ? 1 : 0)
    data[i] = (Math.random() * 2 - 1) * (b1 + b2 * 0.55) * 0.88
  }
  return data
}

// ── Tom ───────────────────────────────────────────────────────────────────
// Sine with frequency sweep, tunable pitch.
export function synthTom(sampleRate: number, basePitch = 110): Float32Array {
  const n = Math.floor(sampleRate * 0.42)
  const data = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const freq = basePitch * 1.5 * Math.exp(-18 * t) + basePitch
    phase += (2 * Math.PI * freq) / sampleRate
    data[i] = Math.sin(phase) * Math.exp(-7 * t) * 0.88
  }
  return data
}

// ── Rim shot ──────────────────────────────────────────────────────────────
// Short high-pitched click with resonant decay.
export function synthRim(sampleRate: number): Float32Array {
  const n = Math.floor(sampleRate * 0.06)
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    data[i] = (
      Math.sin(2 * Math.PI * 1200 * t) * 0.6 +
      Math.sin(2 * Math.PI * 530  * t) * 0.4 +
      (Math.random() * 2 - 1) * 0.15
    ) * Math.exp(-80 * t) * 0.85
  }
  return data
}

// ── Crash cymbal ──────────────────────────────────────────────────────────
export function synthCrash(sampleRate: number): Float32Array {
  const n = Math.floor(sampleRate * 1.2)
  const data = new Float32Array(n)
  let x1 = 0, y1 = 0
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const noise = Math.random() * 2 - 1
    const y = noise - x1 + 0.994 * y1;  x1 = noise;  y1 = y
    data[i] = y * Math.exp(-5 * t) * 0.55
  }
  return data
}

// ── Kick variants ────────────────────────────────────────────────────────
export function synthKickDeep(sr: number): Float32Array {
  const n = Math.floor(sr * 0.65)
  const data = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const freq = 80 * Math.exp(-22 * t) + 38
    phase += (2 * Math.PI * freq) / sr
    data[i] = Math.sin(phase) * (0.3 * Math.exp(-2.5 * t) + 0.7 * Math.exp(-0.4 * t)) * 0.92
  }
  return data
}

export function synthKickPunchy(sr: number): Float32Array {
  const n = Math.floor(sr * 0.38)
  const data = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const freq = 260 * Math.exp(-55 * t) + 55
    phase += (2 * Math.PI * freq) / sr
    const click = (Math.random() * 2 - 1) * 0.12 * Math.exp(-200 * t)
    data[i] = (Math.sin(phase) * Math.exp(-9 * t) + click) * 0.94
  }
  return data
}

// ── Snare variants ───────────────────────────────────────────────────────
export function synthSnareFat(sr: number): Float32Array {
  const n = Math.floor(sr * 0.35)
  const data = new Float32Array(n)
  let xp = 0, yp = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const noise = Math.random() * 2 - 1
    const y = noise - xp + 0.91 * yp;  xp = noise;  yp = y
    const body = (Math.sin(2 * Math.PI * 140 * t) + Math.sin(2 * Math.PI * 220 * t) * 0.5) * 0.5
    data[i] = (y * Math.exp(-14 * t) * 0.65 + body * Math.exp(-12 * t) * 0.55) * 0.88
  }
  return data
}

// ── Hat variant ──────────────────────────────────────────────────────────
export function synthHatLoose(sr: number): Float32Array {
  const n = Math.floor(sr * 0.09)
  const data = new Float32Array(n)
  let x1 = 0, y1 = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const noise = Math.random() * 2 - 1
    const y = noise - x1 + 0.975 * y1;  x1 = noise;  y1 = y
    data[i] = y * Math.exp(-60 * t) * 0.62
  }
  return data
}

// ── Clap variant ─────────────────────────────────────────────────────────
export function synthClapRoom(sr: number): Float32Array {
  const n = Math.floor(sr * 0.28)
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const b1 = Math.exp(-100 * t)
    const b2 = Math.exp(-70 * Math.abs(t - 0.012)) * (t > 0.01 ? 1 : 0)
    const tail = Math.exp(-8 * t) * (t > 0.03 ? 1 : 0) * 0.3
    data[i] = (Math.random() * 2 - 1) * (b1 + b2 * 0.6 + tail) * 0.82
  }
  return data
}

// ── Tom variant ──────────────────────────────────────────────────────────
export function synthTomHigh(sr: number): Float32Array {
  return synthTom(sr, 190)
}

// ── Plucked string (guitar-clean) ─────────────────────────────────────────
// Karplus-Strong with per-sample lowpass feedback.
export function synthGuitar(sr: number): Float32Array {
  const freq = 220  // A3 guitar string
  const bufLen = Math.round(sr / freq)
  const buf = Array.from({ length: bufLen }, () => Math.random() * 2 - 1)
  const n = Math.floor(sr * 1.5)
  const data = new Float32Array(n)
  let idx = 0
  for (let i = 0; i < n; i++) {
    const s = buf[idx]
    data[i] = s * 0.85
    const next = (buf[idx] + buf[(idx + 1) % bufLen]) * 0.498
    buf[idx] = next
    idx = (idx + 1) % bufLen
  }
  return data
}

// ── Struck string / piano (piano-note) ───────────────────────────────────
export function synthPiano(sr: number): Float32Array {
  const f0 = 261.6  // C4
  const n = Math.floor(sr * 2.0)
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    data[i] = (
      Math.sin(2 * Math.PI * f0       * t) * 0.55 * Math.exp(-1.8 * t) +
      Math.sin(2 * Math.PI * f0 * 2   * t) * 0.25 * Math.exp(-2.6 * t) +
      Math.sin(2 * Math.PI * f0 * 3   * t) * 0.12 * Math.exp(-3.8 * t) +
      Math.sin(2 * Math.PI * f0 * 4   * t) * 0.06 * Math.exp(-5.5 * t) +
      (Math.random() * 2 - 1) * 0.008 * Math.exp(-40 * t)
    ) * 0.82
  }
  return data
}

// ── Synth lead (sawtooth + ADSR) ─────────────────────────────────────────
export function synthLead(sr: number): Float32Array {
  const f0 = 440
  const n = Math.floor(sr * 1.0)
  const data = new Float32Array(n)
  const attack = 0.01, decay = 0.08, sustain = 0.6, release = 0.25
  const total = n / sr
  for (let i = 0; i < n; i++) {
    const t = i / sr
    let env: number
    if      (t < attack)                              env = t / attack
    else if (t < attack + decay)                      env = 1 - (1 - sustain) * (t - attack) / decay
    else if (t < total - release)                     env = sustain
    else                                              env = sustain * (1 - (t - (total - release)) / release)
    // Band-limited sawtooth approximation (8 harmonics)
    let saw = 0
    for (let k = 1; k <= 8; k++) saw += Math.sin(2 * Math.PI * f0 * k * t) / k
    data[i] = saw * env * (2 / Math.PI) * 0.5
  }
  return data
}

// ── Synth bass (square + pitch env) ──────────────────────────────────────
export function synthBass(sr: number): Float32Array {
  const f0 = 110  // A2
  const n = Math.floor(sr * 0.8)
  const data = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const freq = f0 * (1 + 0.15 * Math.exp(-30 * t))
    phase += (2 * Math.PI * freq) / sr
    const sq = phase % (2 * Math.PI) < Math.PI ? 0.6 : -0.6
    const env = 0.4 * Math.exp(-2.5 * t) + 0.6 * Math.exp(-0.8 * t)
    data[i] = sq * env * 0.88
  }
  return data
}

// ── Router ────────────────────────────────────────────────────────────────
// Maps a BeatType string to the right synth function.
export function synthDrum(type: string, sampleRate: number): Float32Array {
  switch (type) {
    case 'kick':       return synthKick(sampleRate)
    case 'snare':      return synthSnare(sampleRate)
    case 'hihat':      return synthHat(sampleRate, false)
    case 'open-hihat': return synthHat(sampleRate, true)
    case 'clap':       return synthClap(sampleRate)
    case 'tom':        return synthTom(sampleRate, 110)
    case 'rim':        return synthRim(sampleRate)
    case 'crash':      return synthCrash(sampleRate)
    default:           return synthKick(sampleRate)
  }
}

// ── Visual identity ───────────────────────────────────────────────────────
export const DRUM_COLORS: Record<string, string> = {
  kick:        '#dc2626',
  snare:       '#d97706',
  hihat:       '#16a34a',
  'open-hihat':'#0891b2',
  clap:        '#7c3aed',
  tom:         '#db2777',
  rim:         '#ea580c',
  crash:       '#0e7490',
}

export const DRUM_LABELS: Record<string, string> = {
  kick:        'Kick',
  snare:       'Snare',
  hihat:       'Hi-Hat',
  'open-hihat':'Open Hat',
  clap:        'Clap',
  tom:         'Tom',
  rim:         'Rim',
  crash:       'Crash',
}

// Ordered list for the kit configurator UI (must match what synthDrum supports)
export const DRUM_TYPES = ['kick', 'snare', 'hihat', 'open-hihat', 'clap', 'tom', 'rim', 'crash'] as const

// ── Catalog sample router ─────────────────────────────────────────────────
// Maps a catalog sample id (from SAMPLE_CATALOG) to synthesized PCM data.
export function synthCatalogSample(sampleId: string, sampleRate: number): Float32Array {
  switch (sampleId) {
    case 'kick-classic':  return synthKick(sampleRate)
    case 'kick-deep':     return synthKickDeep(sampleRate)
    case 'kick-punchy':   return synthKickPunchy(sampleRate)
    case 'snare-crisp':   return synthSnare(sampleRate)
    case 'snare-fat':     return synthSnareFat(sampleRate)
    case 'snare-rimshot': return synthRim(sampleRate)
    case 'hihat-tight':   return synthHat(sampleRate, false)
    case 'hihat-loose':   return synthHatLoose(sampleRate)
    case 'hihat-open':    return synthHat(sampleRate, true)
    case 'clap-sharp':    return synthClap(sampleRate)
    case 'clap-room':     return synthClapRoom(sampleRate)
    case 'tom-low':       return synthTom(sampleRate, 110)
    case 'tom-high':      return synthTomHigh(sampleRate)
    case 'crash-soft':    return synthCrash(sampleRate)
    case 'guitar-clean':  return synthGuitar(sampleRate)
    case 'piano-note':    return synthPiano(sampleRate)
    case 'synth-lead-1':  return synthLead(sampleRate)
    case 'synth-bass-1':  return synthBass(sampleRate)
    default:              return synthKick(sampleRate)
  }
}
