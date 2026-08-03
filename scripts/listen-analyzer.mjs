// ── The "ear": objective spectral + balance analysis of a render ──────────────
// Pure DSP (no DOM / no Node APIs) so it runs BOTH in Node (unit-tested against
// synthetic signals — see test-listen-analyzer.mjs) and in the browser (bundled
// to public/dev/listen-analyzer.js, where the __dawRenderWav Float32 stems live,
// so there's no giant byte-transfer out of the page).
//
// It answers what RMS-only checks couldn't:
//   · DARK or just DULL?         → MELODIC centroid (drums excluded) vs a genre range
//   · any presence / air?        → 2–6 kHz band, and a "presence-hole/scoop" test
//   · a part (stab) BURIED?      → per-stem loudness vs the mix, role-aware
//   · MUDDY / THIN / HARSH / SCOOPED? → band-shape descriptor
//   · which parts MASK others?   → dominant-band overlap between stems
// …and turns it into prioritised, plain-language verdicts + a 0–100 score.
//
// A key lesson baked in: a single mix-wide spectral centroid LIES when one
// element (hi-hats) has extreme HF content — it reads "bright" while every
// musical voice is dark. So brightness judgements use the drums-excluded
// melodic sum, and presence is judged per-role.

// ── FFT (iterative radix-2 Cooley–Tukey, in place; length must be power of 2) ──
export function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2
        const vr = re[b] * cwr - im[b] * cwi, vi = re[b] * cwi + im[b] * cwr
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi
        const ncwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = ncwr
      }
    }
  }
}

// 8-band split (finer than before: separate lowMid/mid/highMid so a presence
// hole vs mud vs harshness are distinguishable). Ranges in Hz.
const BAND_EDGES = {
  sub: [20, 60], low: [60, 120], lowMid: [120, 350], mid: [350, 900],
  highMid: [900, 2000], presence: [2000, 6000], brilliance: [6000, 10000], air: [10000, 18000],
}
export const PRESENCE_BANDS = ['highMid', 'presence']   // where a lead/stab "cuts"

// Averaged Hann-windowed magnitude spectrum → centroid, rolloff, 8-band % split.
export function spectrum(signal, sr, fftSize = 4096) {
  const half = fftSize / 2
  const hann = new Float32Array(fftSize)
  for (let i = 0; i < fftSize; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1))
  const power = new Float64Array(half)
  const hop = fftSize >> 1
  let frames = 0
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize)
  for (let start = 0; start + fftSize <= signal.length; start += hop) {
    for (let i = 0; i < fftSize; i++) { re[i] = signal[start + i] * hann[i]; im[i] = 0 }
    fft(re, im)
    for (let i = 0; i < half; i++) power[i] += re[i] * re[i] + im[i] * im[i]
    frames++
  }
  if (!frames) {
    for (let i = 0; i < fftSize; i++) { re[i] = (i < signal.length ? signal[i] : 0) * hann[i]; im[i] = 0 }
    fft(re, im); for (let i = 0; i < half; i++) power[i] = re[i] * re[i] + im[i] * im[i]; frames = 1
  }
  const binHz = sr / fftSize
  let num = 0, den = 0, total = 0
  const bandP = {}; for (const b in BAND_EDGES) bandP[b] = 0
  const mags = new Float64Array(half)
  for (let i = 1; i < half; i++) {
    const f = i * binHz, mag = Math.sqrt(power[i] / frames), p = power[i] / frames
    mags[i] = mag; num += f * mag; den += mag; total += p
    for (const b in BAND_EDGES) { const [lo, hi] = BAND_EDGES[b]; if (f >= lo && f < hi) bandP[b] += p }
  }
  // 85% spectral rolloff (Hz below which 85% of energy sits)
  let cum = 0, rolloff = 0; const target = total * 0.85
  for (let i = 1; i < half; i++) { cum += mags[i] * mags[i]; if (cum >= target) { rolloff = i * binHz; break } }
  const centroid = den > 0 ? num / den : 0
  const bandPct = {}; for (const b in bandP) bandPct[b] = total > 0 ? +(bandP[b] / total).toFixed(4) : 0
  return { centroid: Math.round(centroid), rolloff: Math.round(rolloff), bandPct, energy: total }
}

const rms = s => { let sq = 0; for (let i = 0; i < s.length; i++) sq += s[i] * s[i]; return Math.sqrt(sq / (s.length || 1)) }
const peak = s => { let p = 0; for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (a > p) p = a } return p }
const dbfs = r => r > 0 ? +(20 * Math.log10(r)).toFixed(1) : -99
const presencePct = bp => (bp.highMid || 0) + (bp.presence || 0)
const weightPct = bp => (bp.sub || 0) + (bp.low || 0)

// Classify a stem by name → a role, so expectations are role-appropriate.
export function roleOf(name) {
  const n = (name || '').toLowerCase()
  if (/drum|kick|snare|hat|perc|beat/.test(n)) return 'drums'
  if (/sub|808|bass/.test(n)) return 'bass'
  if (/pad/.test(n)) return 'pad'
  if (/stab|pluck|chord|key/.test(n)) return 'stab'
  if (/lead|melod|arp|counter|riff|synth/.test(n)) return 'lead'
  return 'other'
}
const CUTTING_ROLES = new Set(['stab', 'lead'])   // must have presence to be heard
const DARK_OK_ROLES = new Set(['bass', 'pad'])    // allowed to be dark/low

// Per-genre reference envelopes. Tunable starting points — the whole point is
// that these are editable as the ear refines them.
export const GENRE_TARGETS = {
  'dark-pop':  { melodicCentroidHz: [800, 2200], presencePct: [0.05, 0.20], weightPct: [0.28, 0.62], rolloffHz: [1500, 6000], leadRole: 'stab', leadMaxUnderDb: 6, crestDb: [6, 16] },
  'synthwave': { melodicCentroidHz: [1000, 3000], presencePct: [0.07, 0.24], weightPct: [0.22, 0.55], rolloffHz: [2500, 9000], leadRole: 'lead', leadMaxUnderDb: 6, crestDb: [6, 16] },
  default:     { melodicCentroidHz: [900, 3200], presencePct: [0.06, 0.26], weightPct: [0.20, 0.58], rolloffHz: [2000, 9000], leadRole: null, leadMaxUnderDb: 8, crestDb: [5, 18] },
}

// Sum equal-length Float32 signals into one buffer.
function sumSignals(list) {
  if (!list.length) return new Float32Array(0)
  const n = list[0].length, out = new Float32Array(n)
  for (const s of list) for (let i = 0; i < n && i < s.length; i++) out[i] += s[i]
  return out
}

// render = { sampleRate, master:Float32, stems:{ name:Float32 } }
export function analyzeMix(render, opts = {}) {
  const sr = render.sampleRate || 48000
  const genre = opts.genre || 'default'
  const T = GENRE_TARGETS[genre] || GENRE_TARGETS.default
  const M = render.master
  const mSpec = spectrum(M, sr)
  const mPk = +peak(M).toFixed(3), mRms = rms(M)
  const mix = { ...mSpec, dBFS: dbfs(mRms), peak: mPk, clip: mPk >= 1, crestDb: mRms > 0 ? +(20 * Math.log10(mPk / mRms)).toFixed(1) : 0, presencePct: +presencePct(mSpec.bandPct).toFixed(4), weightPct: +weightPct(mSpec.bandPct).toFixed(4) }

  const stems = {}
  const melodic = []
  for (const name in (render.stems || {})) {
    const s = render.stems[name]
    const sp = spectrum(s, sr), pk = +peak(s).toFixed(3), rm = rms(s)
    const role = roleOf(name)
    stems[name] = { role, ...sp, dBFS: dbfs(rm), peak: pk, presencePct: +presencePct(sp.bandPct).toFixed(4) }
    if (role !== 'drums') melodic.push(s)
  }
  // MELODIC-ONLY centroid — the honest "dark vs bright", immune to hi-hat HF.
  const melodicSpec = melodic.length ? spectrum(sumSignals(melodic), sr) : null

  // Balance: rank by loudness, gap under the loudest.
  const ranked = Object.entries(stems).map(([n, v]) => ({ n, role: v.role, dBFS: v.dBFS })).sort((a, b) => b.dBFS - a.dBFS)
  const loudest = ranked[0]
  const balance = ranked.map(r => ({ stem: r.n, role: r.role, dBFS: r.dBFS, underLoudestDb: loudest ? +(loudest.dBFS - r.dBFS).toFixed(1) : 0 }))

  // Masking: two stems whose dominant band is the same and are close in level
  // fight each other. Flag the quieter as masked when within 6 dB in-band.
  const domBand = bp => Object.entries(bp).sort((a, b) => b[1] - a[1])[0][0]
  const masks = []
  const names = Object.keys(stems)
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = stems[names[i]], b = stems[names[j]]
    if (domBand(a.bandPct) === domBand(b.bandPct) && Math.abs(a.dBFS - b.dBFS) < 6) masks.push({ a: names[i], b: names[j], band: domBand(a.bandPct) })
  }

  const verdicts = []
  const V = (sev, tag, msg) => verdicts.push({ sev, tag, msg })   // sev: 1 hi … 3 lo

  // ── Brightness / dull / dark — judged on MELODIC content, not the drum-HF mix.
  if (melodicSpec) {
    const mc = melodicSpec.centroid, [lo, hi] = T.melodicCentroidHz
    if (mc < lo) V(1, 'dull', `DULL, not dark — the musical voices average ${mc}Hz (drums excluded), below the ${genre} range ${lo}-${hi}Hz. Dark ≠ muffled: brighten/grit the tonal parts, don't just lowpass.`)
    else if (mc > hi) V(2, 'bright', `Melodic content bright — ${mc}Hz above ${hi}Hz; may sound thin/harsh for ${genre}.`)
  }
  // ── Presence hole / scoop — heavy lows + some air but an empty 2–6 kHz.
  const p = mix.presencePct, air = (mix.bandPct.brilliance || 0) + (mix.bandPct.air || 0), w = mix.weightPct
  if (p < T.presencePct[0]) {
    const scoop = w > 0.4 && air > p   // lows heavy, air outweighs presence = smiley/scooped
    V(1, scoop ? 'scooped' : 'no-presence', `${scoop ? 'SCOOPED mix' : 'No presence'} — 2-6kHz(+highMid) is only ${(p * 100).toFixed(1)}% (want ≥${(T.presencePct[0] * 100).toFixed(0)}%)${scoop ? `, while lows are ${(w * 100).toFixed(0)}% and the only highs are drum fizz` : ''}. Nothing in the band where leads/stabs cut — the mix reads dull.`)
  } else if (p > T.presencePct[1]) V(3, 'harsh', `Possibly harsh — presence ${(p * 100).toFixed(1)}% above ${(T.presencePct[1] * 100).toFixed(0)}%.`)
  // ── Weight / mud.
  if (w < T.weightPct[0]) V(2, 'thin', `Thin — sub+low ${(w * 100).toFixed(0)}% (want ≥${(T.weightPct[0] * 100).toFixed(0)}%); no low-end body.`)
  if ((mix.bandPct.lowMid || 0) > 0.42) V(2, 'muddy', `Muddy — 120-350Hz is ${((mix.bandPct.lowMid) * 100).toFixed(0)}% of the mix; carve low-mids.`)
  // ── Crest (punch vs over-compression).
  if (mix.crestDb < T.crestDb[0]) V(3, 'squashed', `Low crest ${mix.crestDb}dB — over-compressed/flat, little punch.`)

  // ── Role-aware: cutting parts (stab/lead) must have presence and be audible.
  for (const [name, v] of Object.entries(stems)) {
    if (!CUTTING_ROLES.has(v.role)) continue
    if (v.presencePct < T.presencePct[0]) V(1, 'part-dull', `${name} (${v.role}) is dull — ${(v.presencePct * 100).toFixed(1)}% presence, centroid ${v.centroid}Hz. It can't cut. Design a brighter/grittier voice, not just louder.`)
    const bal = balance.find(b => b.stem === name)
    if (bal && bal.underLoudestDb > T.leadMaxUnderDb) V(2, 'part-buried', `${name} (${v.role}) buried — ${bal.underLoudestDb}dB under ${loudest.n}; bring it up ~${Math.round(bal.underLoudestDb - T.leadMaxUnderDb + 2)}dB or thin what masks it.`)
  }
  for (const m of masks) if (CUTTING_ROLES.has(stems[m.a].role) || CUTTING_ROLES.has(stems[m.b].role)) V(3, 'masking', `${m.a} & ${m.b} both pile into the ${m.band} band at similar level — they'll smear; separate by EQ or level.`)

  if (mix.clip) V(1, 'clip', `Clipping — peak ${mix.peak}. Pull gain.`)

  verdicts.sort((a, b) => a.sev - b.sev)
  // Score: start 100, subtract by severity.
  let score = 100; for (const vd of verdicts) score -= vd.sev === 1 ? 22 : vd.sev === 2 ? 11 : 5
  score = Math.max(0, score)

  return {
    genre, targets: T, score, pass: verdicts.length === 0,
    mix, melodicCentroid: melodicSpec ? melodicSpec.centroid : null,
    stems, balance, masks,
    verdicts: verdicts.map(v => ({ sev: v.sev, tag: v.tag, msg: v.msg })),
  }
}
