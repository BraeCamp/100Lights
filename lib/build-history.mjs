// ── Synthesized build-history (for the timelapse content type) ───────────────
// The composer emits a FINISHED project (no construction log). This turns a
// finished DawProject into an ordered `history: DawHistoryEntry[]` that, replayed
// from a content-free base, looks like the song being built: tempo set, tracks
// appear one by one (with their instruments), then clips fill the arrangement
// left-to-right, section by section.
//
// It does NOT need to fold PERFECTLY — the studio's history replay snaps the final
// frame to the real project, and the driver's reveal uses the real track/clip
// objects. It only has to look like a plausible build. Steps use the exact action
// shapes the DAW reducer + describeStep() understand (ADD_TRACK / ADD_CLIP /
// SET_TEMPO / SET_SWING), so this replays in the in-app recorder too.

/** Finished project → ordered build-log. */
export function buildHistoryFor(project) {
  const steps = []
  const push = (action, label) => steps.push({ action, label })

  if (project.tempo) push({ type: 'SET_TEMPO', tempo: Math.round(project.tempo) }, `Tempo ${Math.round(project.tempo)} BPM`)

  const audioTracks = project.tracks.filter(t => t.kind !== 'group')
  for (const t of audioTracks) {
    push({ type: 'ADD_TRACK', id: t.id, name: t.name, instrument: t.instrument }, `Add ${t.name}`)
  }

  // Clips left-to-right (by start), tie-broken by track order → the arrangement
  // fills in section by section rather than all at once.
  const order = new Map(audioTracks.map((t, i) => [t.id, i]))
  const clips = [...project.arrangementClips].sort(
    (a, b) => (a.startBeat - b.startBeat) || ((order.get(a.trackId) ?? 99) - (order.get(b.trackId) ?? 99)),
  )
  for (const c of clips) push({ type: 'ADD_CLIP', clip: c }, `Add ${c.name || 'clip'}`)

  if (project.swing) push({ type: 'SET_SWING', swing: project.swing }, `Swing ${Math.round(project.swing * 100)}%`)
  return steps
}

/** Fold a build-history into progressive project SNAPSHOTS (for the headless
 *  timelapse driver — each snapshot is LOAD_PROJECT-ed in turn). Uses the real
 *  track/clip objects from `project`, so the revealed content looks final. */
export function foldRevealSnapshots(project, history) {
  const byId = new Map(project.tracks.map(t => [t.id, t]))
  let s = { ...project, tracks: [], arrangementClips: [] }
  const snaps = []
  for (const { action } of history) {
    if (action.type === 'ADD_TRACK') {
      const t = byId.get(action.id)
      if (t) s = { ...s, tracks: [...s.tracks, t] }
    } else if (action.type === 'ADD_CLIP') {
      s = { ...s, arrangementClips: [...s.arrangementClips, action.clip] }
    }
    snaps.push(s)
  }
  snaps.push(project) // final frame = the true finished project
  return snaps
}
