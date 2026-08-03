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

// ── RHYTHM + SUSTAIN: hear how a part moves in TIME, not just its spectrum ────
// Amplitude envelope (short-window RMS over time). Returns {t:[sec], e:[rms]}.
export function envelope(signal, sr, win = 1024, hop = 256) {
  const t = [], e = []
  for (let s = 0; s + win <= signal.length; s += hop) {
    let sq = 0; for (let j = 0; j < win; j++) sq += signal[s + j] * signal[s + j]
    e.push(Math.sqrt(sq / win)); t.push((s + win / 2) / sr)
  }
  return { t, e }
}
// Onset detection — "hears the rhythm": how many hits, where, inter-onset gaps.
// Hysteresis threshold-crossing on the amplitude envelope (arm above openRel of
// the peak, re-arm only after dropping below closeRel). Robust to instant note
// starts and to soft attacks; a held note = ONE onset, silence between notes =
// a new onset. (For notes that change pitch without an amplitude dip, drive the
// per-note check from the known MIDI note times instead — see noteProfiles.)
export function detectOnsets(signal, sr, { minGapSec = 0.06, openRel = 0.18, closeRel = 0.10 } = {}) {
  const { t, e } = envelope(signal, sr, 512, 128)
  const mx = Math.max(1e-9, ...e)
  const openT = openRel * mx, closeT = closeRel * mx
  const times = []; let active = false, last = -1e9
  for (let i = 0; i < e.length; i++) {
    if (!active) { if (e[i] > openT && t[i] - last > minGapSec) { times.push(+t[i].toFixed(3)); last = t[i]; active = true } }
    else if (e[i] < closeT) active = false
  }
  const iois = times.slice(1).map((x, i) => +(x - times[i]).toFixed(3))
  return { times, count: times.length, iois }
}
// Per-note sustain profile — does the note HOLD FLAT, or decay / release early?
// For each note region: held duration (env above 30% of its peak), sustain
// flatness (CV of the held portion — low = steady), attack time, and the near-
// silent GAP before the next onset (a re-trigger/release chop).
export function noteProfiles(signal, sr, onsetTimes) {
  const { t, e } = envelope(signal, sr, 1024, 256)
  const at = sec => { let i = 0; while (i < t.length - 1 && t[i] < sec) i++; return i }
  const out = []
  const bounds = [...onsetTimes, t[t.length - 1] + 1]
  for (let k = 0; k < onsetTimes.length; k++) {
    const a = at(bounds[k]), z = at(bounds[k + 1])
    let peak = 0, pi = a; for (let i = a; i < z; i++) if (e[i] > peak) { peak = e[i]; pi = i }
    if (peak < 1e-5) continue
    const floor = 0.30 * peak
    let end = pi; for (let i = pi; i < z; i++) { if (e[i] >= floor) end = i; else if (e[i] < 0.12 * peak) break }
    const heldSec = +(t[end] - t[a]).toFixed(3)
    // sustained portion = from just after the peak to end
    const s0 = Math.min(pi + 1, end); const seg = e.slice(s0, end + 1)
    const mean = seg.reduce((x, y) => x + y, 0) / (seg.length || 1)
    const sd = Math.sqrt(seg.reduce((x, y) => x + (y - mean) ** 2, 0) / (seg.length || 1))
    const cv = mean > 0 ? +(sd / mean).toFixed(3) : 0
    const attackMs = Math.round((t[pi] - t[a]) * 1000)
    const gapMs = k + 1 < onsetTimes.length ? Math.round(Math.max(0, bounds[k + 1] - t[end]) * 1000) : 0
    out.push({ onset: +t[a].toFixed(3), heldSec, sustainCV: cv, attackMs, gapMs, peak: +peak.toFixed(4) })
  }
  return out
}
// Harmonic content around a fundamental — "hears the tone": is it a PURE sub
// (energy in the fundamental) or harmonically rich? purity = f0 share of the
// harmonic series; richness = overtone energy / fundamental.
export function detectF0(signal, sr, fmax = 400, fftSize = 8192) {
  const { bandPct } = spectrum(signal, sr, fftSize)   // unused, ensures power-of-2 path
  const half = fftSize / 2, hann = new Float32Array(fftSize)
  for (let i = 0; i < fftSize; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1))
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize)
  const start = Math.max(0, Math.floor(signal.length / 2) - fftSize)   // mid, past the attack
  for (let i = 0; i < fftSize; i++) { re[i] = (signal[start + i] || 0) * hann[i]; im[i] = 0 }
  fft(re, im)
  const binHz = sr / fftSize; let best = 0, bf = 0
  for (let i = 1; i < half; i++) { const f = i * binHz; if (f < 20 || f > fmax) continue; const m = re[i] * re[i] + im[i] * im[i]; if (m > best) { best = m; bf = f } }
  return Math.round(bf)
}
export function harmonics(signal, sr, f0, fftSize = 8192) {
  const half = fftSize / 2, hann = new Float32Array(fftSize)
  for (let i = 0; i < fftSize; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1))
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize)
  const start = Math.max(0, Math.floor(signal.length / 2) - fftSize)
  for (let i = 0; i < fftSize; i++) { re[i] = (signal[start + i] || 0) * hann[i]; im[i] = 0 }
  fft(re, im)
  const binHz = sr / fftSize
  const magAt = f => { const b = Math.round(f / binHz); let m = 0; for (let i = Math.max(1, b - 2); i <= b + 2 && i < half; i++) m = Math.max(m, Math.sqrt(re[i] * re[i] + im[i] * im[i])); return m }
  const partials = []; for (let k = 1; k <= 8; k++) partials.push(+magAt(k * f0).toFixed(4))
  const p2 = partials.map(m => m * m); const tot = p2.reduce((a, b) => a + b, 0) || 1
  return { f0, partials, purity: +(p2[0] / tot).toFixed(3), richness: +((tot - p2[0]) / (p2[0] || 1)).toFixed(3) }
}
// Package: hear a stem's rhythm + sustain + tone, with verdicts. opts.expectHeldSec
// = the shortest a note should sustain; opts.expectPureSub = check sub purity.
export function analyzeStem(signal, sr, opts = {}) {
  const on = detectOnsets(signal, sr)
  const notes = noteProfiles(signal, sr, on.times)
  const f0 = opts.f0 || detectF0(signal, sr)
  const harm = f0 > 0 ? harmonics(signal, sr, f0) : null
  const verdicts = []
  const held = notes.map(n => n.heldSec)
  const medHeld = held.length ? held.slice().sort((a, b) => a - b)[Math.floor(held.length / 2)] : 0
  if (opts.expectHeldSec && medHeld < opts.expectHeldSec) verdicts.push(`notes too short — median hold ${medHeld}s < expected ${opts.expectHeldSec}s (re-triggering / not sustaining)`)
  const wob = notes.filter(n => n.sustainCV > 0.28).length
  if (wob > notes.length / 2) verdicts.push(`notes don't hold FLAT — ${wob}/${notes.length} have sustainCV>0.28 (decay/wobble instead of a steady drone)`)
  const chops = notes.filter(n => n.gapMs > 60).length
  if (chops) verdicts.push(`${chops} release GAP(s) >60ms between notes — the drone is being chopped, not held`)
  if (opts.expectPureSub && harm && harm.purity < 0.6) verdicts.push(`not a pure sub — fundamental is only ${(harm.purity * 100).toFixed(0)}% of the harmonic energy (${f0}Hz, richness ${harm.richness}); heavier lowpass / less saturation`)
  return { onsets: on, notes, f0, harmonics: harm, medHeldSec: medHeld, verdicts }
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

// ── AUTO-MIX-BALANCE — turn per-stem levels into concrete gain trims ──────────
// Target loudness per ROLE (dBFS, dark-pop-ish). autoBalance() returns, per
// stem, the gain multiplier to move it toward its role target — so instead of
// hand-nudging one level per slow render, apply these to the track volumes and
// re-render once. Clamped so it never makes a wild jump.
export const BALANCE_TARGETS = {
  'dark-pop':  { drums: -13, bass: -13, stab: -17, lead: -16, pad: -24, other: -20 },
  'synthwave': { drums: -13, bass: -14, stab: -16, lead: -14, pad: -23, other: -19 },
  default:     { drums: -13, bass: -14, stab: -17, lead: -15, pad: -24, other: -20 },
}
export function autoBalance(stems, opts = {}) {
  const T = BALANCE_TARGETS[opts.genre] || BALANCE_TARGETS.default
  const out = {}
  for (const name in stems) {
    const v = stems[name], role = v.role || roleOf(name)
    const target = T[role] != null ? T[role] : T.other
    let mult = Math.pow(10, (target - v.dBFS) / 20)
    mult = Math.max(0.35, Math.min(2.8, mult))
    out[name] = { role, currentDb: v.dBFS, targetDb: target, gainMult: +mult.toFixed(3), adjustDb: +(20 * Math.log10(mult)).toFixed(1) }
  }
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
