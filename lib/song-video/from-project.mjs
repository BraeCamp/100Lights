// ── DawProject → song-video data ─────────────────────────────────────────────
// Turns any 100Lights project into the compact {tempo, key, tracks, notes} the
// song-video engine renders. Same shape whether it comes from a generated song
// (our pipeline) or a user's own project (the in-app feature).

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/**
 * @param {object} daw  a DawProject (tracks + arrangementClips with notes)
 * @param {object} [opts]
 * @param {number} [opts.startBeat=0]  window start
 * @param {number} [opts.beats=32]     window length (a loopable section)
 * @param {string} [opts.genre]        optional tag for the meta line
 * @returns {{tempo:number, keyLabel:string, genre?:string, tracks:{name:string,color:string}[], notes:{tr:number,p:number,s:number,d:number,v:number}[]}}
 */
// Classify a track so the preview synth can voice it in the right ballpark:
// percussion for drums, a low punch for bass, a soft swell for pads, a bright
// decay for keys/plucks, etc. It's a stand-in — "Use real mix" plays the real
// instruments — but a decent guess makes the preview recognisable. Signal order:
// instrument type (drums are unmistakable) → name → register.
function classifyTrack(t, avgPitch) {
  if (t.instrument && t.instrument.type === 'drum') return 'drum'
  const n = (t.name || '').toLowerCase()
  if (/(drum|beat|kick|snare|perc|hat|clap|cymbal|\btom\b)/.test(n)) return 'drum'
  if (/(bass|\bsub\b|808)/.test(n)) return 'bass'
  if (/(pad|drone|atmos|ambient|string|choir|swell|texture)/.test(n)) return 'pad'
  if (/(piano|keys|rhodes|\bep\b|organ|wurli|clav)/.test(n)) return 'keys'
  if (/(pluck|guitar|harp|mallet|marimba|kalimba|bell|koto)/.test(n)) return 'pluck'
  if (/(lead|arp|melody|saw|square)/.test(n)) return 'lead'
  if (avgPitch < 48) return 'bass'
  return 'melodic'
}

export function songVideoData(daw, opts = {}) {
  const startBeat = opts.startBeat ?? 0
  const beats = opts.beats ?? 32
  const audioTracks = daw.tracks.filter(t => t.kind !== 'group')
  const idxById = new Map(audioTracks.map((t, i) => [t.id, i]))

  const notes = []
  const pSum = new Array(audioTracks.length).fill(0)
  const pCnt = new Array(audioTracks.length).fill(0)
  for (const c of daw.arrangementClips) {
    if (!c.notes || !c.notes.length) continue
    const tr = idxById.get(c.trackId) ?? 0
    for (const n of c.notes) {
      const s = +(c.startBeat + n.startBeat - startBeat).toFixed(3)
      if (s < 0 || s >= beats) continue
      notes.push({ tr, p: n.pitch, s, d: +Math.max(0.1, n.durationBeats).toFixed(3), v: +((n.velocity ?? 0.8) * 100).toFixed(0) })
      pSum[tr] += n.pitch; pCnt[tr]++
    }
  }
  notes.sort((a, b) => a.s - b.s)

  const tracks = audioTracks.map((t, i) => ({
    name: t.name, color: t.color || '#a78bfa',
    kind: classifyTrack(t, pCnt[i] ? pSum[i] / pCnt[i] : 60),
    // Carry the track's mix level + mute so the preview synth balances like the
    // project does (the real-mix bounce already reflects the true mix).
    vol: typeof t.volume === 'number' ? t.volume : 0.8,
    muted: !!t.mute,
  }))

  const keyLabel = `${NOTE_NAMES[(((daw.key ?? 0) % 12) + 12) % 12]} ${daw.scale || 'minor'}`
  return { tempo: Math.round(daw.tempo || 120), keyLabel, genre: opts.genre, tracks, notes, loopBeats: beats }
}

/** A default meta line: "D MINOR · 82 BPM · LO-FI". */
export function defaultMeta(data) {
  return [data.keyLabel, `${data.tempo} BPM`, data.genre].filter(Boolean).join(' · ').toUpperCase()
}

/** Pick the busiest `beats`-long window (nicer than always starting at 0). */
export function bestWindow(daw, beats = 32) {
  const ends = daw.arrangementClips.map(c => c.startBeat + c.durationBeats)
  const end = ends.length ? Math.max(...ends) : beats
  let best = 0, bestCount = -1
  for (let start = 0; start + beats <= Math.max(beats, end); start += 4) {
    let count = 0
    for (const c of daw.arrangementClips) for (const n of (c.notes || [])) {
      const t = c.startBeat + n.startBeat
      if (t >= start && t < start + beats) count++
    }
    if (count > bestCount) { bestCount = count; best = start }
  }
  return best
}
