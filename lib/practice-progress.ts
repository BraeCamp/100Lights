/**
 * Practice-path progress, shared between the studio and the dashboard.
 *
 * The store already existed but lived privately inside
 * components/editor/daw/PracticeButton.tsx, so nothing outside the editor could
 * read it — which is why the dashboard showed a user no evidence they were
 * getting better, despite that being the product's whole pitch.
 *
 * Shape is unchanged and backward compatible: { [pathId]: string[] } of
 * completed step ids. Steps are sticky — undoing the action (un-soloing a
 * track, say) does not take the checkmark back.
 */

import { PRACTICE_PATHS, PRACTICE_CATEGORY_ORDER, type PracticePath } from './practice-paths'

export const PRACTICE_STORAGE_KEY = '100lights-practice-progress'

export type PracticeProgress = Record<string, string[]>

export function loadPracticeProgress(): PracticeProgress {
  if (typeof window === 'undefined') return {}
  try {
    const raw = JSON.parse(localStorage.getItem(PRACTICE_STORAGE_KEY) || '{}') as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    // Tolerate anything that isn't the expected shape rather than throwing on
    // a half-written value from an older build.
    const out: PracticeProgress = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string')
    }
    return out
  } catch {
    return {}
  }
}

export function savePracticeProgress(p: PracticeProgress): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(PRACTICE_STORAGE_KEY, JSON.stringify(p)) } catch { /* private mode */ }
}

export interface PracticeSummary {
  /** Steps completed across every path. */
  stepsDone: number
  /** Steps that exist across every path. */
  stepsTotal: number
  /** Paths with every step complete. */
  pathsComplete: number
  /** Paths with at least one step but not all — i.e. in progress. */
  pathsStarted: number
  /** The path to nudge next: the furthest-along unfinished one, else the first
   *  unstarted one in curriculum order. Null only when everything is done. */
  nextPath: PracticePath | null
  /** Steps remaining in `nextPath`. */
  nextRemaining: number
  /** True when the user has never completed a single step. */
  fresh: boolean
}

/** Curriculum order: category first, then declaration order within it. */
function orderedPaths(): PracticePath[] {
  return [...PRACTICE_PATHS].sort((a, b) => {
    const ai = PRACTICE_CATEGORY_ORDER.indexOf(a.category)
    const bi = PRACTICE_CATEGORY_ORDER.indexOf(b.category)
    if (ai !== bi) return ai - bi
    return PRACTICE_PATHS.indexOf(a) - PRACTICE_PATHS.indexOf(b)
  })
}

export function summarisePractice(progress: PracticeProgress): PracticeSummary {
  const paths = orderedPaths()
  let stepsDone = 0
  let stepsTotal = 0
  let pathsComplete = 0
  let pathsStarted = 0

  let bestPartial: { path: PracticePath; remaining: number; done: number } | null = null
  let firstUnstarted: PracticePath | null = null

  for (const path of paths) {
    const total = path.steps.length
    stepsTotal += total
    const doneIds = new Set(progress[path.id] ?? [])
    // Count only ids that still exist — a renamed step shouldn't inflate the total.
    const done = path.steps.reduce((n, s) => n + (doneIds.has(s.id) ? 1 : 0), 0)
    stepsDone += done

    if (total > 0 && done >= total) { pathsComplete++; continue }
    if (done > 0) {
      pathsStarted++
      // Furthest along wins, so we nudge toward finishing rather than starting more.
      if (!bestPartial || done > bestPartial.done) bestPartial = { path, remaining: total - done, done }
    } else if (!firstUnstarted) {
      firstUnstarted = path
    }
  }

  const nextPath = bestPartial?.path ?? firstUnstarted ?? null
  const nextRemaining = bestPartial
    ? bestPartial.remaining
    : (firstUnstarted ? firstUnstarted.steps.length : 0)

  return {
    stepsDone,
    stepsTotal,
    pathsComplete,
    pathsStarted,
    nextPath,
    nextRemaining,
    fresh: stepsDone === 0,
  }
}

// ── React binding ────────────────────────────────────────────────────────────
// localStorage is an external store, so components read it through
// useSyncExternalStore rather than a setState-in-effect. Two reasons beyond the
// lint rule: the server snapshot is `null`, which removes any hydration
// mismatch, and subscribing to `storage` means progress made in the studio shows
// up on a dashboard open in another tab without a refresh.
//
// getSnapshot must return a STABLE reference or React re-renders forever, so the
// parsed summary is cached against the raw string it came from.

let cachedRaw: string | null = null
let cachedSummary: PracticeSummary | null = null

export function subscribePracticeProgress(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent) => { if (!e.key || e.key === PRACTICE_STORAGE_KEY) onChange() }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

/** Cached, reference-stable summary for useSyncExternalStore. */
export function getPracticeSummarySnapshot(): PracticeSummary | null {
  if (typeof window === 'undefined') return null
  let raw: string | null
  try { raw = localStorage.getItem(PRACTICE_STORAGE_KEY) } catch { return null }
  if (raw !== cachedRaw || cachedSummary === null) {
    cachedRaw = raw
    cachedSummary = summarisePractice(loadPracticeProgress())
  }
  return cachedSummary
}

/** Server render has no localStorage — render nothing until mounted. */
export function getPracticeSummaryServerSnapshot(): PracticeSummary | null {
  return null
}
