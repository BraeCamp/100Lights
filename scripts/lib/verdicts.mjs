// Turning measurements into a ranked list of things to fix.
//
// The separation matters: `audio-features` and `song-symbolic` measure and never
// judge, and everything opinionated lives here, in one place, against a target
// profile that can be swapped per genre. A lo-fi track being dark is correct and
// a disco track being dark is not, and no analyzer that hardcodes "dark is bad"
// can tell those apart — which is how the old tooling ended up recommending EQ
// that would have taken the soul out of the genres it was wrong about.
//
// Targets are of two kinds and they are labelled differently:
//   · ENGINEERING targets (true peak, clipping, silence, polyphony) are facts.
//     They do not vary by genre and they are never provisional.
//   · BALANCE targets (band shares, brightness, width, dynamics) are provisional
//     until `scripts/build-targets.mjs` has measured a real reference set for
//     that genre with these same measurements. Until then they carry a `~`.

const dbOf = v => 20 * Math.log10(Math.max(1e-9, v))

/**
 * The starting profile. Ranges are [min, max]; null means "no opinion".
 *
 * The band numbers are the honest weak point: they were chosen to bracket what
 * commercially released music tends to do, but they have not yet been measured
 * against a reference set with this analyzer, so they are marked provisional and
 * a violation is a `note`, never a `fail`.
 */
export const DEFAULT_TARGET = {
  name: 'general (provisional)',
  provisional: true,
  // Engineering
  truePeakDb: [null, -1.0],
  clippedSamples: [null, 0],
  // Loudness — a project bounce should leave headroom; loudness is a post step.
  lufs: [-30, -8],
  // Balance
  bands: {
    sub: [0.02, 0.30],
    bass: [0.05, 0.30],
    lowMid: [0.08, 0.35],
    mid: [0.05, 0.30],
    highMid: [0.03, 0.25],
    presence: [0.01, 0.15],
    brilliance: [0.005, 0.10],
    air: [0.002, 0.06],
  },
  centroidHz: [300, 3500],
  // Movement
  crestDb: [8, 22],
  dynamicRangeDb: [3, 16],
  // Image
  correlation: [0.0, 0.85],
  // Feel
  maxOnGridPct: 85,          // a part more quantised than this reads as programmed
  minVelocitySpread: 4,
  maxSectionChurn: 2,        // layers arriving or leaving at one seam
  minSections: 4,
  minSeconds: 90,
}

const sev = { fail: 0, warn: 1, note: 2 }

export function judge({ symbolic: sym, mix, stems = [], target = DEFAULT_TARGET, refused = [] }) {
  const f = []
  const add = (severity, area, what, fix, number = null) => f.push({ severity, area, what, fix, number })
  const outside = (v, [lo, hi]) => (lo != null && v < lo) || (hi != null && v > hi)
  const tag = target.provisional ? '~' : ''

  // ── Facts ─────────────────────────────────────────────────────────────────
  for (const r of refused) add('fail', 'render', r, 'Render this one through the browser path, or replace the part with an Apollo patch.')

  for (const s of stems) {
    if (s.silent) add('fail', 'render', `"${s.track}" produced no sound at all`,
      'A track that does not sound makes the mix measure CLEANER, so nothing else here can be trusted until it is fixed. Check the patch loaded and the notes are in range.')
  }
  if (mix.clipped > 0) add('fail', 'mix', `${mix.clipped} clipped samples`,
    `Lower masterVolume until the peak sits below -1 dBFS. Do loudness in post with ffmpeg loudnorm, not in the bounce.`, mix.clipped)
  if (mix.truePeakDb != null && outside(mix.truePeakDb, target.truePeakDb))
    add('warn', 'mix', `true peak ${mix.truePeakDb} dBTP is above -1.0`,
      'Inter-sample overs distort after a lossy encode even though the sample peak looks fine. Trim the master.', mix.truePeakDb)

  // ── Balance ───────────────────────────────────────────────────────────────
  for (const [band, range] of Object.entries(target.bands)) {
    const v = mix.bands[band]
    if (v == null || !outside(v, range)) continue
    const high = v > range[1]
    const pct = (v * 100).toFixed(1)
    const want = `${(range[0] * 100).toFixed(1)}–${(range[1] * 100).toFixed(1)}%`
    add(target.provisional ? 'note' : 'warn', 'balance',
      `${tag}${band} is ${pct}% of audible energy (expected ${want})`,
      high
        ? `Too much ${band}. Thin the part that owns it rather than EQing the master — find it in the stem table below.`
        : `Almost nothing in ${band}. EQ cannot add what the source does not have; pick a brighter voice or add a layer that lives there.`,
      v)
  }
  if (outside(mix.centroidHz, target.centroidHz))
    add('note', 'balance', `${tag}spectral centroid ${mix.centroidHz} Hz`,
      mix.centroidHz < target.centroidHz[0]
        ? 'The whole mix is weighted low. Check whether the sub is simply louder than everything else before reaching for treble.'
        : 'The mix is weighted high; check the low end is actually present.', mix.centroidHz)

  // ── Movement ──────────────────────────────────────────────────────────────
  if (outside(mix.crestDb, target.crestDb))
    add('warn', 'dynamics', `crest factor ${mix.crestDb} dB`,
      mix.crestDb < target.crestDb[0]
        ? 'Squashed — transients are not getting through. Back off compression or drive.'
        : 'Very peaky: a few transients tower over everything. Usually one loud percussive layer.', mix.crestDb)
  if (mix.dynamicRangeDb != null && mix.dynamicRangeDb < target.dynamicRangeDb[0])
    add('warn', 'arrangement', `the song only moves ${mix.dynamicRangeDb} dB from quietest to loudest passage`,
      'This is the "constant density" problem: every section is as busy as every other. Strip a section back to two layers and let the next one arrive.', mix.dynamicRangeDb)

  // ── Image ─────────────────────────────────────────────────────────────────
  if (mix.correlation > target.correlation[1])
    add('warn', 'stereo', `stereo correlation ${mix.correlation} — the mix is nearly mono`,
      'Panning alone cannot widen anything: it changes level, not correlation. Real width comes from decorrelated sources — Apollo unison spread per voice, or a wider reverb.', mix.correlation)
  if (mix.bandCorrelation) {
    const subCorr = mix.bandCorrelation.sub
    if (subCorr != null && subCorr < 0.7)
      add('note', 'stereo', `the sub band is not mono (correlation ${subCorr})`,
        'Low frequencies should be centred: a wide sub loses energy on any mono system and eats headroom.', subCorr)
  }

  // ── Feel ──────────────────────────────────────────────────────────────────
  const flat = sym.groove.filter(g => g.onGridPct >= target.maxOnGridPct && g.notes > 8)
  for (const g of flat)
    add('warn', 'feel', `"${g.track}" is ${g.onGridPct}% dead on the grid`,
      'Nothing about this part is played. Give it a consistent lean, not symmetric jitter.', g.onGridPct)

  const noLean = sym.groove.filter(g => Math.abs(g.meanOffsetMs) < 1.5 && g.spreadMs > 0.5 && g.notes > 16)
  if (noLean.length >= Math.max(2, sym.groove.length - 1))
    add('warn', 'feel',
      `every part averages within ±1.5 ms of the grid (${noLean.map(g => g.track).join(', ')})`,
      'Random jitter around zero is motion without feel — it measures loose and still sounds like a machine, because no part leans. ' +
      'Give each part a DIRECTION: snare and clap a few ms late, bass slightly early, hats loosest. That difference between parts is what a groove is.')

  const stiff = sym.dynamics.filter(d => d.spread < target.minVelocitySpread)
  for (const d of stiff)
    add('note', 'feel', `"${d.track}" velocities barely vary (±${d.spread})`,
      'Vary velocity with the bar — downbeats harder, ghost notes much softer.', d.spread)

  if ((sym.swing ?? 0) === 0) {
    const sw = sym.groove.filter(g => Math.abs(g.swingPct - 50) < 1)
    if (sw.length === sym.groove.length)
      add('note', 'feel', 'the song is perfectly straight — no swing anywhere',
        'Straight is a valid choice, but it should be a choice. Most groove-based idioms want 52–58% on the sixteenths, and hats want it more than kick and snare do.')
  }

  // ── Arrangement ───────────────────────────────────────────────────────────
  for (const r of sym.arrangement) {
    if ((r.churn ?? 0) > target.maxSectionChurn)
      add('warn', 'arrangement', `${r.churn} layers change at once entering "${r.name}" (bar ${r.startBar})`,
        `Add and remove one layer at a time. Entering: ${(r.entering ?? []).join(', ') || 'none'}. Leaving: ${(r.leaving ?? []).join(', ') || 'none'}.`, r.churn)
  }
  if (sym.arrangement.length < target.minSections)
    add('warn', 'arrangement', `only ${sym.arrangement.length} sections`,
      'A two-minute piece wants somewhere to go: an intro, a build, a peak, a strip-back, a return, an outro.', sym.arrangement.length)
  if (mix.seconds < target.minSeconds)
    add('note', 'arrangement', `${Math.round(mix.seconds)}s long`,
      'Under 90 seconds rarely has room for an arc.', mix.seconds)

  const densities = sym.arrangement.map(r => r.notesPerBar).filter(v => v > 0)
  if (densities.length > 2) {
    const lo = Math.min(...densities), hi = Math.max(...densities)
    if (hi / Math.max(1e-6, lo) < 1.8)
      add('warn', 'arrangement', `every section has the same density (${lo}–${hi} notes per bar)`,
        'The arrangement is a loop with layers muted, not a shape. Make the quietest section genuinely sparse — long notes, fewer parts.', +(hi / lo).toFixed(2))
  }

  // ── Register ──────────────────────────────────────────────────────────────
  for (const c of sym.registers.clashes.slice(0, 4))
    add('warn', 'register', `"${c.a}" and "${c.b}" occupy the same ${c.semitones} semitones`,
      'Two parts in one octave mask each other whatever the fader does. Move one an octave, or thin one to sustained notes while the other moves.', c.overlap)

  // ── Stems ─────────────────────────────────────────────────────────────────
  if (stems.length) {
    const loudest = Math.max(...stems.map(s => s.rmsDb))
    for (const s of stems) {
      const under = loudest - s.rmsDb
      if (under > 26 && !s.silent)
        add('note', 'mix', `"${s.track}" sits ${under.toFixed(0)} dB under the loudest layer`,
          'Either it is inaudible in context, or it is doing nothing and should come out.', +under.toFixed(1))
    }
  }

  return f.sort((a, b) => sev[a.severity] - sev[b.severity])
}

/** A one-line human summary, and an exit code. */
export function summarize(findings) {
  const n = s => findings.filter(x => x.severity === s).length
  return {
    fail: n('fail'), warn: n('warn'), note: n('note'),
    verdict: n('fail') ? 'FAIL' : n('warn') ? 'NEEDS WORK' : 'CLEAN',
  }
}
