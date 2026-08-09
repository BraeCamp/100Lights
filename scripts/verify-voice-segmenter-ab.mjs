// A/B: onset-aware segmenter vs the note-level HMM (lib/voice-hmm) as the VoiceMidi
// backfill note segmenter. Both are run through the FULL synthetic-audio suite via the
// in-page window.__voiceAnalyzeBuffer, so the frames come from the REAL offline scan
// (sample-rendered melodies), not hand-built HmmFrames. Reports an onset-vs-hmm table.
//
//   node scripts/verify-voice-segmenter-ab.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:3001'

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream'],
})
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

await page.goto(`${BASE}/apps/voicemidi`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.__voiceAnalyzeBuffer === 'function', null, { timeout: 60000 })

const out = await page.evaluate(() => {
  const SR = 44100
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12)

  // Deterministic PRNG (mulberry32) so the noisy case is reproducible.
  let _seed = 987654321
  const rnd = () => {
    _seed |= 0; _seed = (_seed + 0x6d2b79f5) | 0
    let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 2   // ~N(0,~0.29)

  function render(totalDur, freqAt, ampAt, noiseAt) {
    const N = Math.round(totalDur * SR)
    const out = new Float32Array(N)
    let ph = 0
    for (let i = 0; i < N; i++) {
      const t = i / SR
      ph += freqAt(t) / SR; ph -= Math.floor(ph)
      const a = ampAt(t)
      let s = 2 * (ph - 0.5) * a
      if (noiseAt) s += noiseAt(t) * gauss()
      out[i] = s
    }
    return out
  }
  function schedule(midis, noteDur, gap, start = 0.1) {
    const notes = []; let t = start
    for (const m of midis) { notes.push({ midi: m, start: t, dur: noteDur }); t += noteDur + gap }
    return notes
  }
  function noteAt(notes, t) {
    let cur = notes[0]
    for (const n of notes) { if (t >= n.start) cur = n; if (t >= n.start && t < n.start + n.dur) return n }
    return { ...cur, _silent: true }
  }
  function renderMelody(notes, totalDur, noiseLevel = 0) {
    const freqAt = t => mtof(noteAt(notes, t).midi)
    const ampAt = t => {
      const n = noteAt(notes, t)
      if (n._silent) return 0
      const e = Math.min(t - n.start, n.start + n.dur - t)
      return (n.amp ?? 0.3) * Math.max(0, Math.min(1, e / 0.008))
    }
    // Breathy noise rides the note's amplitude envelope (silent in gaps → no phantom notes).
    const noiseAt = noiseLevel > 0 ? (t => {
      const n = noteAt(notes, t)
      if (n._silent) return 0
      const e = Math.min(t - n.start, n.start + n.dur - t)
      return noiseLevel * Math.max(0, Math.min(1, e / 0.008))
    }) : null
    const total = totalDur ?? (notes[notes.length - 1].start + notes[notes.length - 1].dur)
    return render(total, freqAt, ampAt, noiseAt)
  }
  function renderScoop() {
    const start = 0.1, dur = 0.5
    const freqAt = t => { const e = t - start; const m = (e >= 0 && e < 0.06) ? 61 - (e / 0.06) : 60; return mtof(m) }
    const ampAt = t => { const e = Math.min(t - start, start + dur - t); return e < 0 ? 0 : 0.3 * Math.max(0, Math.min(1, e / 0.008)) }
    return render(start + dur + 0.05, freqAt, ampAt)
  }

  const analyze = (buf, seg, opts) => window.__voiceAnalyzeBuffer(buf, SR, { minDuration: 0.08, segmenter: seg, ...opts }).notes
  const seq = notes => notes.map(n => n.midi)
  const dedupe = a => a.filter((v, i) => i === 0 || v !== a[i - 1])
  const contourOk = (got, exp) => { const g = dedupe(got); return g.length === exp.length && g.every((v, i) => Math.abs(v - exp[i]) <= 1) }
  const uniqSorted = a => [...new Set(a)].sort((x, y) => x - y)

  // Run one buffer through BOTH segmenters; grade with a per-case predicate.
  const both = (buf, grade, opts) => {
    const on = analyze(buf, 'onset', opts)
    const hm = analyze(buf, 'hmm', opts)
    return {
      onset: { notes: seq(on), count: on.length, pass: grade(on) },
      hmm:   { notes: seq(hm), count: hm.length, pass: grade(hm) },
    }
  }

  const cases = {}

  // 1) NOISY / BREATHY pitch — tone + heavy Gaussian noise so the scan produces bad frames.
  {
    const midis = [62, 64, 65, 67, 69]
    const notes = schedule(midis, 0.34, 0.06)
    const buf = renderMelody(notes, undefined, 0.20)   // heavy breath
    cases.noisy = both(buf, ns => ns.length >= midis.length && contourOk(seq(ns), midis))
    cases.noisy.expected = midis
  }

  // 2) Re-articulation — same note ×3, no gap-worthy silence between hits.
  {
    const notes = schedule([64, 64, 64], 0.30, 0.03)
    const buf = renderMelody(notes)
    cases.reartic = both(buf, ns => ns.length === 3 && ns.every(n => Math.abs(n.midi - 64) <= 1))
    cases.reartic.expected = [64, 64, 64]
  }

  // 3) Adjacent [64,65,64,65]
  {
    const notes = schedule([64, 65, 64, 65], 0.28, 0.04)
    const buf = renderMelody(notes)
    cases.adjacent = both(buf, ns => ns.length === 4 && contourOk(seq(ns), [64, 65, 64, 65]))
    cases.adjacent.expected = [64, 65, 64, 65]
  }

  // 4) Quick notes 110ms / 120ms
  {
    const midis = [67, 69, 71, 72, 74]
    for (const [name, dur] of [['quick110', 0.11], ['quick120', 0.12]]) {
      const buf = renderMelody(schedule(midis, dur, 0.03))
      cases[name] = both(buf, ns => ns.length >= 4 && contourOk(seq(ns), midis))
      cases[name].expected = midis
    }
  }

  // 5) Low scale A2→A3 (45..57)
  {
    const low = [45, 47, 48, 50, 52, 53, 55, 57]
    const buf = renderMelody(schedule(low, 0.34, 0.06))
    cases.lowScale = both(buf, ns => ns.length >= low.length && contourOk(seq(ns), low))
    cases.lowScale.expected = low
  }

  // 6) Note at the buffer END (short final note, ends at the edge)
  {
    const notes = [{ midi: 69, start: 0.10, dur: 0.40 }, { midi: 76, start: 0.60, dur: 0.12 }]
    const buf = renderMelody(notes, notes[1].start + notes[1].dur)
    const hasLast = ns => uniqSorted(seq(ns)).some(m => Math.abs(m - 76) <= 1)
    cases.tail = both(buf, ns => hasLast(ns) && ns.length >= 2)
    cases.tail.expected = [69, 76]
  }

  // 7) Held 2.5s — must stay ONE note
  {
    const buf = renderMelody(schedule([62], 2.5, 0))
    cases.held = both(buf, ns => ns.length === 1 && Math.abs(ns[0]?.midi - 62) <= 1)
    cases.held.expected = [62]
  }

  // 8) Scoop 61→60 (HMM path: no re-pitch; must still land on 60)
  {
    const buf = renderScoop()
    cases.scoop = both(buf, ns => ns.length >= 1 && ns.every(n => n.midi === 60))
    cases.scoop.expected = [60]
  }
  // 8b) Scoop with HMM re-pitch FORCED ON, to confirm re-pitch is redundant on the HMM path.
  {
    const buf = renderScoop()
    const hmNo = analyze(buf, 'hmm', {})
    const hmYes = analyze(buf, 'hmm', { repitch: true })
    cases.scoopRepitch = {
      hmmNoRepitch: seq(hmNo), hmmRepitch: seq(hmYes),
      same: JSON.stringify(seq(hmNo)) === JSON.stringify(seq(hmYes)),
      bothCorrect: hmNo.every(n => n.midi === 60) && hmYes.every(n => n.midi === 60),
    }
  }

  // 8c) WIDE VIBRATO — one note (57) with ±1.0-semitone confident vibrato at ~6Hz. This
  //     EXCEEDS the onset segmenter's PITCH_SPLIT_SEMI (0.7) at high clarity, so the pitch
  //     rule can over-split; the HMM's self-loop + bounded emission should hold it as 1 note.
  {
    const start = 0.1, dur = 1.2
    const freqAt = t => { const e = t - start; const w = 1.0 * Math.sin(e * 2 * Math.PI * 6); return mtof(57 + (e >= 0 ? w : 0)) }
    const ampAt = t => { const e = Math.min(t - start, start + dur - t); return e < 0 ? 0 : 0.3 * Math.max(0, Math.min(1, e / 0.008)) }
    const buf = render(start + dur + 0.05, freqAt, ampAt)
    cases.wideVibrato = both(buf, ns => ns.length === 1 && Math.abs(ns[0]?.midi - 57) <= 1)
    cases.wideVibrato.expected = [57]
  }

  // 8d) CONFIDENT PITCH-SCATTER — a held note (60) whose pitch jitters ±1 semitone frame
  //     to frame (still fully voiced/confident, no amplitude dip). Simulates an unstable but
  //     loud voice. The bounded (Huber-capped) emission + self-loop should keep it ONE note;
  //     a naive per-frame rounding would fragment. No re-attack transients, so onsets are quiet.
  {
    _seed = 135790                 // deterministic jitter pattern
    const start = 0.1, dur = 1.0
    const jitter = []
    for (let i = 0; i < 200; i++) jitter.push((rnd() < 0.5 ? -1 : 1) * (rnd() < 0.4 ? 1 : 0) * 0.9)
    const freqAt = t => { const e = t - start; if (e < 0) return mtof(60); const idx = Math.min(jitter.length - 1, Math.floor(e / 0.01)); return mtof(60 + jitter[idx]) }
    const ampAt = t => { const e = Math.min(t - start, start + dur - t); return e < 0 ? 0 : 0.3 * Math.max(0, Math.min(1, e / 0.008)) }
    const buf = render(start + dur + 0.05, freqAt, ampAt)
    cases.scatter = both(buf, ns => ns.length === 1 && Math.abs(ns[0]?.midi - 60) <= 1)
    cases.scatter.expected = [60]
  }

  // 9) Ascending + descending full scale (contour)
  {
    const up = [48, 50, 52, 53, 55, 57, 59, 60]
    const contour = up.concat([59, 57, 55, 53, 52, 50, 48])
    const buf = renderMelody(schedule(contour, 0.22, 0.05))
    cases.contour = both(buf, ns => contourOk(seq(ns), contour))
    cases.contour.expected = contour
  }

  // 1b) NOISE SWEEP — grade both segmenters as breath noise rises, to characterize which
  //     degrades more gracefully (HMM's expected strength: bounded emission smooths bad
  //     frames instead of fragmenting). Fresh seed per level for reproducibility.
  const sweep = []
  {
    const midis = [62, 64, 65, 67, 69]
    for (const lvl of [0.15, 0.25, 0.35, 0.45]) {
      _seed = 424242              // reset PRNG so each level is comparable
      const buf = renderMelody(schedule(midis, 0.34, 0.06), undefined, lvl)
      const on = analyze(buf, 'onset', {})
      const hm = analyze(buf, 'hmm', {})
      sweep.push({
        level: lvl,
        onset: { count: on.length, contour: contourOk(seq(on), midis), notes: seq(on) },
        hmm:   { count: hm.length, contour: contourOk(seq(hm), midis), notes: seq(hm) },
      })
    }
  }

  // Timing — a ~15s buffer through each segmenter.
  const timing = {}
  {
    const up = [48, 50, 52, 53, 55, 57, 59, 60]
    const contour = up.concat([59, 57, 55, 53, 52, 50, 48])
    let midis = []
    while (midis.length < 60) midis = midis.concat(contour)
    const notes = schedule(midis, 0.22, 0.02)
    const total = notes[notes.length - 1].start + notes[notes.length - 1].dur
    const buf = renderMelody(notes, total)
    for (const seg of ['onset', 'hmm']) {
      const t0 = performance.now()
      const n = window.__voiceAnalyzeBuffer(buf, SR, { minDuration: 0.08, segmenter: seg }).notes.length
      timing[seg] = { bufferSec: +total.toFixed(1), ms: +(performance.now() - t0).toFixed(1), notes: n }
    }
  }

  return { cases, timing, sweep }
})

await browser.close()

// ── Report ───────────────────────────────────────────────────────────────────────
const P = ok => ok ? '✓' : '✗'
const { cases, timing, sweep } = out

const ORDER = [
  ['noisy',    'NOISY/BREATHY  ⭐'],
  ['reartic',  're-artic ×3'],
  ['adjacent', 'adjacent 64-65'],
  ['quick110', 'quick 110ms'],
  ['quick120', 'quick 120ms'],
  ['lowScale', 'low scale A2-A3'],
  ['tail',     'note at end'],
  ['held',     'held 2.5s'],
  ['scoop',    'scoop 61→60'],
  ['wideVibrato', 'wide vibrato ±1'],
  ['scatter',  'pitch-scatter ±1'],
  ['contour',  'asc+desc scale'],
]

console.log('\n════════ ONSET vs HMM — segmenter A/B ════════\n')
console.log('  case              | onset               | hmm                 | winner')
console.log('  ------------------+---------------------+---------------------+--------')
let onsetWins = 0, hmmWins = 0, ties = 0
let hmmRegressions = []
for (const [key, label] of ORDER) {
  const c = cases[key]
  const oCell = `${P(c.onset.pass)} ${c.onset.count}n ${JSON.stringify(c.onset.notes).slice(0, 14)}`.padEnd(19)
  const hCell = `${P(c.hmm.pass)} ${c.hmm.count}n ${JSON.stringify(c.hmm.notes).slice(0, 14)}`.padEnd(19)
  let win
  if (c.onset.pass === c.hmm.pass) { win = 'tie'; ties++ }
  else if (c.hmm.pass) { win = 'HMM'; hmmWins++ }
  else { win = 'onset'; onsetWins++; hmmRegressions.push(label.trim()) }
  console.log(`  ${label.padEnd(17)} | ${oCell} | ${hCell} | ${win}`)
}
console.log('\n  detail:')
for (const [key, label] of ORDER) {
  const c = cases[key]
  console.log(`   ${label.trim()}: expected ${JSON.stringify(c.expected)}`)
  console.log(`      onset ${P(c.onset.pass)} → ${JSON.stringify(c.onset.notes)}`)
  console.log(`      hmm   ${P(c.hmm.pass)} → ${JSON.stringify(c.hmm.notes)}`)
}

console.log('\n  noise sweep (5-note melody, expected [62,64,65,67,69]):')
console.log('    breath | onset (count, contourOk)      | hmm (count, contourOk)')
console.log('    -------+-------------------------------+------------------------------')
for (const s of sweep) {
  const oc = `${s.onset.count}n ${s.onset.contour ? '✓' : '✗'} ${JSON.stringify(s.onset.notes)}`.padEnd(30)
  const hc = `${s.hmm.count}n ${s.hmm.contour ? '✓' : '✗'} ${JSON.stringify(s.hmm.notes)}`
  console.log(`    ${String(s.level).padEnd(6)} | ${oc}| ${hc}`)
}

const sr = cases.scoopRepitch
console.log(`\n  scoop re-pitch redundancy (HMM path):`)
console.log(`      no-repitch ${JSON.stringify(sr.hmmNoRepitch)}  repitch ${JSON.stringify(sr.hmmRepitch)}  → ${sr.same ? 'IDENTICAL (re-pitch redundant)' : 'DIFFER'}, bothCorrect=${sr.bothCorrect}`)

console.log(`\n  timing:  onset ${timing.onset.ms}ms (${timing.onset.notes}n)  ·  hmm ${timing.hmm.ms}ms (${timing.hmm.notes}n)  on a ${timing.onset.bufferSec}s buffer`)

console.log(`\n  tally: HMM wins ${hmmWins}, onset wins ${onsetWins}, ties ${ties}`)
if (hmmRegressions.length) console.log(`  ⚠ HMM WORSE on: ${hmmRegressions.join(', ')}`)
console.log(`\n  console errors: ${errors.length}`)
for (const e of errors.slice(0, 6)) console.log('   [err]', e.slice(0, 160))

// The chosen default should not regress vs onset overall.
const defaultOk = hmmWins >= onsetWins && errors.length === 0
console.log(`\n  → recommended default: ${hmmWins > onsetWins ? 'hmm' : hmmWins === onsetWins ? 'hmm (tie — HMM equal, richer model)' : 'onset'}`)
console.log(`${defaultOk ? '✓ HMM does not regress overall' : '✗ REVIEW — HMM regresses'}`)
process.exit(defaultOk ? 0 : 1)
