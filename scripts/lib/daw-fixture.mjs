// A project the app will actually accept.
//
// Hand-building a DawProject for a test looks harmless and is not. `defaultProject()`
// ships with NO tracks, so `...(base.tracks[0] ?? {})` — the obvious way to
// borrow the shape — contributes nothing, and the track that comes out has no
// `volume`. The engine then calls setTargetAtTime(undefined), throws, and the
// editor's error boundary replaces the whole studio with "Something went wrong".
//
// That failed silently in the worst way: `__dawDispatch` and `__combineStats`
// live outside React, so they kept answering perfectly while the entire UI was
// gone. Several of this session's loading measurements were taken against a
// crashed editor without my noticing — the loader numbers were real, but any
// claim about the interface would not have been.
//
// So there is one fixture, and it fills every field ADD_TRACK fills.

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `f${Math.random().toString(36).slice(2)}`)

/** A track with every field the reducer would have given it. */
export function makeTrack({ id, name, instrument, color = '#7c8cff' } = {}) {
  return {
    id: id ?? uuid(),
    name: name ?? 'Track',
    type: 'midi',
    color,
    volume: 0.8,      // the one whose absence crashes the audio engine
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    inputSource: null,
    height: 96,
    effects: [],
    instrument: instrument ?? { type: 'none', params: {} },
  }
}

/** A midi clip with the fields the arrangement and the renderer both expect. */
export function makeClip({ id, trackId, name, startBeat = 0, durationBeats = 16, notes } = {}) {
  return {
    id: id ?? uuid(),
    trackId,
    kind: 'midi',
    name: name ?? 'Clip',
    startBeat,
    durationBeats,
    loopEnabled: false,
    notes: notes ?? [],
  }
}

/** Evenly spaced notes, for a clip that costs something real to render. */
export function makeNotes(count = 10, { pitchBase = 45, spread = 24, step = 1.5, length = 1.2 } = {}) {
  return Array.from({ length: count }, (_, n) => ({
    id: uuid(),
    pitch: pitchBase + ((n * 3) % spread),
    startBeat: n * step,
    durationBeats: length,
    velocity: 96,
  }))
}

/**
 * A whole project, built on the app's own defaults so nothing is missing.
 * `defaultProject` is passed in rather than imported, because these scripts
 * already load it through importTs and there is no reason to do it twice.
 */
export function makeProject(defaultProject, { tempo = 120, tracks = [], clips = [] } = {}) {
  return { ...defaultProject(), tempo, timeSignatureNum: 4, timeSignatureDen: 4, tracks, arrangementClips: clips }
}
