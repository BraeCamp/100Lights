// Three-way project merge for offline / branched editing.
//
// Given the BASE you branched from, YOUR local version, and THEIRS (the current
// shared version), produce a merged project plus a list of conflicts a human
// must resolve. Non-colliding edits merge automatically by item id; a clip or
// track edited on BOTH sides differently becomes a conflict.
//
// Deliberately decoupled from the concrete DawProject and the reducer: it works
// structurally over "a project with id-keyed collections", so it's a pure,
// isolated module. If we ever adopt a CRDT (which auto-merges), this file is
// simply retired — nothing in the core state depends on it.

export type Side = 'mine' | 'theirs'

export interface Keyed { id: string; name?: string }

/** The parts we merge. DawProject satisfies this structurally (an index
 *  signature would exclude concrete interfaces, so dynamic keys are read via a
 *  cast inside). */
export interface ProjectLike {
  arrangementClips: Keyed[]
  tracks: Keyed[]
}

type AnyRec = Record<string, unknown>

export interface MergeConflict {
  /** What kind of thing collided — drives the review UI's labelling. */
  kind: 'clip' | 'track' | 'effect' | 'return' | 'automation' | 'scene' | 'field'
  /** The DawProject key the item lives in (null for a scalar 'field'). */
  collection: string | null
  /** Item id, or the field name for a 'field' conflict. */
  id: string
  label: string
  base: unknown | null
  /** null = the item was deleted on that side. */
  mine: unknown | null
  theirs: unknown | null
}

export interface MergeResult<P> {
  merged: P
  conflicts: MergeConflict[]
}

// Structural equality good enough for change-detection on our JSON state.
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const KEYED_COLLECTIONS: Array<{ key: string; kind: MergeConflict['kind'] }> = [
  { key: 'arrangementClips', kind: 'clip' },
  { key: 'tracks',           kind: 'track' },
  { key: 'clipEffects',      kind: 'effect' },
  { key: 'returnTracks',     kind: 'return' },
  { key: 'automationLanes',  kind: 'automation' },
  { key: 'takeLanes',        kind: 'automation' },
  { key: 'scenes',           kind: 'scene' },
  { key: 'cueMarkers',       kind: 'scene' },
  { key: 'comments',         kind: 'scene' },
  { key: 'sections',         kind: 'scene' },
  { key: 'tempoMarkers',     kind: 'field' },
]

const SCALAR_FIELDS = [
  'name', 'tempo', 'timeSignatureNum', 'timeSignatureDen',
  'loopStart', 'loopEnd', 'loopEnabled', 'masterVolume',
  'crossfaderValue', 'swing', 'key', 'scale',
]

function labelFor(item: Keyed | undefined, fallbackId: string): string {
  return (item?.name && String(item.name)) || fallbackId
}

/** Three-way merge of one id-keyed collection. Order follows THEIRS, then any
 *  items added only on MINE. Deleted items drop out. */
function mergeKeyed(
  base: Keyed[], mine: Keyed[], theirs: Keyed[], kind: MergeConflict['kind'], collection: string,
): { merged: Keyed[]; conflicts: MergeConflict[] } {
  const B = new Map(base.map(x => [x.id, x]))
  const M = new Map(mine.map(x => [x.id, x]))
  const T = new Map(theirs.map(x => [x.id, x]))
  const conflicts: MergeConflict[] = []
  const resolved = new Map<string, Keyed | undefined>()  // undefined = deleted

  const ids = new Set<string>([...B.keys(), ...M.keys(), ...T.keys()])
  for (const id of ids) {
    const inB = B.has(id), inM = M.has(id), inT = T.has(id)
    const b = B.get(id), m = M.get(id), t = T.get(id)

    if (inB) {
      const mineChanged = !inM || !eq(b, m)     // edited or deleted
      const theirsChanged = !inT || !eq(b, t)
      if (!mineChanged && !theirsChanged) { resolved.set(id, b); continue }
      if (mineChanged && !theirsChanged)  { resolved.set(id, m); continue }  // m may be undefined
      if (!mineChanged && theirsChanged)  { resolved.set(id, t); continue }
      if (eq(m, t)) { resolved.set(id, m); continue }  // both changed to the same thing
      conflicts.push({ kind, collection, id, label: labelFor(m ?? t ?? b, id), base: b ?? null, mine: m ?? null, theirs: t ?? null })
      resolved.set(id, t)  // default to theirs; the review can flip it
    } else {
      // added (absent from base)
      if (inM && !inT) { resolved.set(id, m); continue }
      if (!inM && inT) { resolved.set(id, t); continue }
      if (eq(m, t))    { resolved.set(id, m); continue }
      conflicts.push({ kind, collection, id, label: labelFor(m ?? t, id), base: null, mine: m ?? null, theirs: t ?? null })
      resolved.set(id, t)
    }
  }

  // Preserve theirs' order, then append mine-only additions, dropping deletes.
  const order: string[] = []
  const seen = new Set<string>()
  for (const x of theirs) if (!seen.has(x.id)) { order.push(x.id); seen.add(x.id) }
  for (const x of mine)   if (!seen.has(x.id)) { order.push(x.id); seen.add(x.id) }
  for (const x of base)   if (!seen.has(x.id)) { order.push(x.id); seen.add(x.id) }
  const merged = order.map(id => resolved.get(id)).filter((x): x is Keyed => x != null)
  return { merged, conflicts }
}

export function mergeProjects<P extends ProjectLike>(base: P, mine: P, theirs: P): MergeResult<P> {
  const B = base as unknown as AnyRec, M = mine as unknown as AnyRec, T = theirs as unknown as AnyRec
  // Start from THEIRS (the authoritative shared state); overlay merged
  // collections/fields. Anything not explicitly merged stays as theirs.
  const merged = structuredClone(theirs) as AnyRec
  const conflicts: MergeConflict[] = []

  for (const { key, kind } of KEYED_COLLECTIONS) {
    const b = B[key], m = M[key], t = T[key]
    // Only merge when all present sides are arrays of {id}.
    if (!Array.isArray(t ?? []) || !Array.isArray(m ?? []) || !Array.isArray(b ?? [])) continue
    const r = mergeKeyed((b as Keyed[]) ?? [], (m as Keyed[]) ?? [], (t as Keyed[]) ?? [], kind, key)
    merged[key] = r.merged
    conflicts.push(...r.conflicts)
  }

  for (const f of SCALAR_FIELDS) {
    const b = B[f], m = M[f], t = T[f]
    const mineChanged = !eq(b, m), theirsChanged = !eq(b, t)
    if (mineChanged && !theirsChanged) merged[f] = m
    else if (mineChanged && theirsChanged && !eq(m, t)) {
      conflicts.push({ kind: 'field', collection: null, id: f, label: f, base: b ?? null, mine: m ?? null, theirs: t ?? null })
      merged[f] = t  // default theirs
    }
    // unchanged, or only-theirs-changed, or both-changed-same → theirs (already in merged)
  }

  return { merged: merged as unknown as P, conflicts }
}

/** Apply the user's per-conflict picks to a merged project (which defaults every
 *  conflict to 'theirs'). Keyed by conflict id → the chosen side. */
export function applyResolutions<P extends ProjectLike>(
  merged: P, conflicts: MergeConflict[], choices: Record<string, Side>,
): P {
  const out = structuredClone(merged) as Record<string, unknown>
  for (const c of conflicts) {
    if ((choices[c.id] ?? 'theirs') === 'theirs') continue  // already the default
    const value = c.mine  // flipping to mine
    if (c.kind === 'field') {
      if (value !== null) out[c.id] = value
      continue
    }
    if (!c.collection) continue
    const arr = ((out[c.collection] as Keyed[]) ?? []).filter(x => x.id !== c.id)
    if (value != null) arr.push(value as Keyed)  // deleted-on-mine → stays removed
    out[c.collection] = arr
  }
  return out as unknown as P
}

/** True when a local branch has diverged from the base (i.e. there's something
 *  to sync). Cheap structural check. */
export function hasDiverged<P extends ProjectLike>(base: P, mine: P): boolean {
  return !eq(base, mine)
}
