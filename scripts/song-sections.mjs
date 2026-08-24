// "Does the arrangement actually breathe?" — section-by-section analysis of a
// rendered song.
//
// I can't hear, so I check numbers. But the numbers have to be the right ones:
// a whole-mix loudness figure says nothing about whether the breakdown is
// actually quieter than the peak, and that contrast is the entire point of an
// arrangement. This reads the rendered wav and reports, per section, the level,
// the spectral centroid (is the filter really moving?), and the energy split
// across sub / bass / mid / air (did each layer actually sound?).
//
// It also exists because of a specific failure mode: a sampled preset can drop
// out of a headless render entirely and everything still "succeeds". A section
// whose sub band is empty when the sub is supposed to be playing catches that.
//
//   node scripts/song-sections.mjs <file.wav> --sections="Intro:0:8,Groove:8:20" --bpm=122 [--bpb=4]
//   (section spec is name:startBar:endBar)

import { readFileSync } from 'fs'

const argv = process.argv.slice(2)
const file = argv.find(a => !a.startsWith('--'))
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const BPM = Number(flag('bpm', 120))
const BPB = Number(flag('bpb', 4))
if (!file) { console.error('usage: song-sections.mjs <file.wav> --sections=Name:startBar:endBar,… --bpm=N'); process.exit(1) }

// ── WAV decode (PCM16 / PCM24 / PCM32 / float32) ────────────────────────────
function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file')
  let pos = 12, fmt = null, dataOff = 0, dataLen = 0
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(pos + 8), channels: buf.readUInt16LE(pos + 10),
              sampleRate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) }
    } else if (id === 'data') { dataOff = pos + 8; dataLen = size }
    pos += 8 + size + (size % 2)
  }
  if (!fmt || !dataOff) throw new Error('missing fmt/data chunk')
  const bytes = fmt.bits / 8
  const frames = Math.floor(dataLen / (bytes * fmt.channels))
  const ch = Array.from({ length: fmt.channels }, () => new Float32Array(frames))
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const o = dataOff + (i * fmt.channels + c) * bytes
      let v
      if (fmt.format === 3 && fmt.bits === 32) v = buf.readFloatLE(o)
      else if (fmt.bits === 16) v = buf.readInt16LE(o) / 32768
      else if (fmt.bits === 24) { const x = buf.readUIntLE(o, 3); v = ((x & 0x800000) ? x - 0x1000000 : x) / 8388608 }
      else if (fmt.bits === 32) v = buf.readInt32LE(o) / 2147483648
      else throw new Error(`unsupported bit depth ${fmt.bits}`)
      ch[c][i] = v
    }
  }
  return { ...fmt, frames, ch }
}

// ── Minimal radix-2 FFT ─────────────────────────────────────────────────────
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr
      }
    }
  }
}

const db = v => v <= 1e-9 ? -Infinity : 20 * Math.log10(v)
const fmtDb = v => (v === -Infinity ? '  -inf' : v.toFixed(1).padStart(6))

/** Average spectrum over a range, returned as band energies + centroid. */
function spectrum(mono, from, to, sampleRate) {
  const SIZE = 4096
  const hop = SIZE
  const acc = new Float64Array(SIZE / 2)
  let windows = 0
  for (let s = from; s + SIZE <= to; s += hop) {
    const re = new Float64Array(SIZE), im = new Float64Array(SIZE)
    for (let i = 0; i < SIZE; i++) re[i] = mono[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / SIZE)) // Hann
    fft(re, im)
    for (let k = 0; k < SIZE / 2; k++) acc[k] += Math.hypot(re[k], im[k])
    windows++
  }
  if (!windows) return null
  const binHz = sampleRate / SIZE
  let num = 0, den = 0
  const bands = { sub: 0, bass: 0, mid: 0, air: 0 }
  for (let k = 1; k < SIZE / 2; k++) {
    const mag = acc[k] / windows, hz = k * binHz
    num += hz * mag; den += mag
    if (hz < 100) bands.sub += mag
    else if (hz < 400) bands.bass += mag
    else if (hz < 4000) bands.mid += mag
    else bands.air += mag
  }
  const total = bands.sub + bands.bass + bands.mid + bands.air || 1
  return {
    centroid: den ? num / den : 0,
    sub: bands.sub / total, bass: bands.bass / total, mid: bands.mid / total, air: bands.air / total,
    lowRatio: (bands.sub + bands.bass) / total,
  }
}

const wav = decodeWav(readFileSync(file))
const L = wav.ch[0], R = wav.ch[1] ?? wav.ch[0]
const mono = new Float32Array(wav.frames)
for (let i = 0; i < wav.frames; i++) mono[i] = (L[i] + R[i]) / 2

const rms = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, to - from)) }
const peak = (a, from, to) => { let p = 0; for (let i = from; i < to; i++) p = Math.max(p, Math.abs(a[i])); return p }

const secPerBar = BPB * 60 / BPM
const specs = (flag('sections', '') || '').split(',').filter(Boolean).map(s => {
  const [name, a, b] = s.split(':')
  return { name, from: Math.round(Number(a) * secPerBar * wav.sampleRate), to: Math.round(Number(b) * secPerBar * wav.sampleRate) }
})

console.log(`${file.split('/').pop()} — ${wav.sampleRate}Hz ${wav.channels}ch, ${(wav.frames / wav.sampleRate).toFixed(1)}s`)
const clipped = (() => { let n = 0; for (let i = 0; i < wav.frames; i++) if (Math.abs(mono[i]) >= 0.999) n++; return n })()
console.log(`whole mix: peak ${fmtDb(db(peak(mono, 0, wav.frames)))} dBFS · rms ${fmtDb(db(rms(mono, 0, wav.frames)))} dBFS · ${clipped} clipped samples`)

// Stereo width: 1 = identical channels (mono), lower = wider.
let sxy = 0, sxx = 0, syy = 0
for (let i = 0; i < wav.frames; i++) { sxy += L[i] * R[i]; sxx += L[i] * L[i]; syy += R[i] * R[i] }
console.log(`stereo correlation: ${(sxy / Math.sqrt(sxx * syy || 1)).toFixed(3)}  (1.000 = fully mono)`)

if (!specs.length) process.exit(0)
console.log('\nsection            level    peak   centroid    sub   bass    mid    air')
console.log('─'.repeat(76))
const rows = []
for (const s of specs) {
  const to = Math.min(s.to, wav.frames)
  const sp = spectrum(mono, s.from, to, wav.sampleRate)
  const lvl = db(rms(mono, s.from, to))
  rows.push({ name: s.name, lvl, sp })
  console.log(
    `${s.name.padEnd(16)} ${fmtDb(lvl)}  ${fmtDb(db(peak(mono, s.from, to)))}   ` +
    `${sp ? String(Math.round(sp.centroid)).padStart(6) + 'Hz' : '     —'}   ` +
    (sp ? `${(sp.sub * 100).toFixed(0).padStart(3)}%  ${(sp.bass * 100).toFixed(0).padStart(3)}%  ${(sp.mid * 100).toFixed(0).padStart(4)}%  ${(sp.air * 100).toFixed(0).padStart(4)}%` : ''))
}
const loud = rows.reduce((a, b) => (b.lvl > a.lvl ? b : a))
const quiet = rows.reduce((a, b) => (b.lvl < a.lvl ? b : a))
console.log('─'.repeat(76))
console.log(`dynamic range across sections: ${(loud.lvl - quiet.lvl).toFixed(1)} dB  (loudest "${loud.name}", quietest "${quiet.name}")`)
const cents = rows.filter(r => r.sp).map(r => r.sp.centroid)
console.log(`centroid swing: ${Math.round(Math.min(...cents))}Hz → ${Math.round(Math.max(...cents))}Hz`)
