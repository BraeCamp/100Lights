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
  //
  // Crest and loudness are the two measurements that a MASTER changes and a
  // bounce has not had yet. The reference set is released music: it has been
  // levelled and limited, so its crest is lower by construction. Comparing an
  // unmastered bounce against it and calling the difference a fault is an
  // apples-to-oranges warning, and it fires on every correctly-made bounce.
  // Band balance and centroid are level-independent and stay full warnings.
  const unmastered = mix.lufs < -22
  if (outside(mix.crestDb, target.crestDb))
    add(unmastered && mix.crestDb > target.crestDb[1] ? 'note' : 'warn', 'dynamics',
      `crest factor ${mix.crestDb} dB${unmastered ? ' (bounce is unmastered — expected to run high)' : ''}`,
      mix.crestDb < target.crestDb[0]
        ? 'Squashed — transients are not getting through. Back off compression or drive.'
        : unmastered
          ? 'Probably fine: the reference is mastered and this is not. Worth a look only if one percussive layer is towering over the rest — check the stem table.'
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
  // ENTRANCES only. Several layers arriving together is the sound of a loop
  // being switched on; several LEAVING together is a drop-out, which is one of
  // the strongest gestures an arrangement has. Counting them the same way told
  // a strip-back section it was broken for doing the thing it existed to do.
  sym.arrangement.forEach((r, i) => {
    if (i === 0) return                       // everything "arrives" at bar 1; that is the song starting
    const entering = (r.entering ?? []).length
    if (entering <= target.maxSectionChurn) return
    // Exempt the return from a drop-out: the band coming back together is the
    // release the drop set up, not a loop being switched on.
    const prev = sym.arrangement[i - 1], before = sym.arrangement[i - 2]
    if (prev && before && prev.layers.length < before.layers.length) return
    add('warn', 'arrangement', `${entering} layers arrive at once entering "${r.name}" (bar ${r.startBar})`,
      `Stagger them — bring one in a phrase early so the section builds instead of switching on. Arriving: ${(r.entering ?? []).join(', ')}.`, entering)
  })
  const emptied = sym.arrangement.find(r => (r.layers ?? []).length === 0)
  if (emptied) add('note', 'arrangement', `"${emptied.name}" has nothing playing`,
    'A silent section is usually a mistake in the layer schedule rather than a rest.')
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

    // Where the parts should sit relative to the whole mix. These are measured
    // numbers rather than an opinion: eight engineers mixing the same eight
    // songs, from De Man's QMUL thesis, in LU relative to the full mix. They are
    // a sanity check on the arrangement's balance, not a prescription — a track
    // with no vocal and a bass-led hook will and should differ.
    const RELATIVE_LU = { bass: -9.5, kick: -13.2, snare: -16.8, drums: -12.7 }
    const roleOf = name => {
      const n = name.toLowerCase()
      if (/\bsub|bass\b/.test(n)) return 'bass'
      if (/kick/.test(n)) return 'kick'
      if (/snare|clap|snap/.test(n)) return 'snare'
      if (/hat|perc|rim|tom|ride|cymbal|tick/.test(n)) return 'drums'
      return null
    }
    // Measured against the SUM OF THE STEMS, not against the finished mix, and
    // by RMS rather than gated loudness. Two errors made the first version of
    // this nonsense: the mix has already had the master fader applied, so every
    // stem read ~10 dB hotter than it is; and BS.1770 gating discards the bars
    // where a sparse part is silent, so a kick playing a third of the time read
    // as loud as the whole record.
    const sumPower = stems.filter(s => !s.silent).reduce((a, s) => a + Math.pow(10, s.rmsDb / 10), 0)
    const sumDb = 10 * Math.log10(Math.max(1e-12, sumPower))
    for (const s of stems) {
      const role = roleOf(s.track)
      if (!role || s.silent || s.rmsDb == null) continue
      const rel = s.rmsDb - sumDb
      const want = RELATIVE_LU[role]
      const off = rel - want
      if (Math.abs(off) > 7)
        add('note', 'mix', `"${s.track}" sits ${rel.toFixed(1)} dB under the summed layers (reference mixes average ${want})`,
          off < 0
            ? `It is ${Math.abs(off).toFixed(0)} dB quieter than the reference balance — bring it up, or accept that this part is background.`
            : `It is ${off.toFixed(0)} dB louder than the reference balance, which usually means it is eating the headroom everything else needs.`,
          +rel.toFixed(1))
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
