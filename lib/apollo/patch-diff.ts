import { initPatch, type ApolloPatch } from '@/lib/apollo/patch'

// Store an Apollo patch as what makes it DIFFERENT, not as a full copy.
//
// A patch is a big object: three oscillators each carrying wavetable, sample,
// granular, spectral and multisample settings, four envelopes, ten LFOs, a mod
// matrix and three FX buses. Serialised whole it is about 9.4KB even when the
// patch is a plain sine — and a seven-track song was carrying seven of them,
// 67KB of mostly default values, over half the project file. That is paid on
// every save, every load, and every row read out of the database.
//
// So: strip anything equal to the Init patch on the way out, and merge back
// over Init on the way in. The round trip has to be exact — this decides how a
// track SOUNDS, and a value silently reverting to its default is a wrong note,
// not a cosmetic bug. See the round-trip test in scripts/qa-patch-diff.mjs.

type Json = unknown
const isObj = (v: Json): v is Record<string, Json> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function same(a: Json, b: Json): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => same(x, b[i]))
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a), kb = Object.keys(b)
    return ka.length === kb.length && ka.every(k => same(a[k], b[k]))
  }
  return false
}

/** Keys of `value` that differ from `base`. Returns undefined when identical. */
function diff(value: Json, base: Json): Json | undefined {
  if (same(value, base)) return undefined

  if (Array.isArray(value) && Array.isArray(base) && value.length === base.length) {
    // Fixed-shape arrays (oscs, envs, lfos): keep the length so an element's
    // index still lines up, and put {} where nothing changed.
    return value.map((v, i) => {
      const d = diff(v, base[i])
      return d === undefined ? (isObj(v) ? {} : v) : d
    })
  }
  // Variable-length arrays (matrix, fx units, clips) and everything else: the
  // whole value, because a partial list cannot be merged back unambiguously.
  if (Array.isArray(value) || !isObj(value) || !isObj(base)) return value

  const out: Record<string, Json> = {}
  for (const k of Object.keys(value)) {
    const d = diff(value[k], base[k])
    if (d !== undefined) out[k] = d
  }
  return out
}

function merge(partial: Json, base: Json): Json {
  if (partial === undefined) return base
  if (Array.isArray(base) && Array.isArray(partial) && partial.length === base.length) {
    return partial.map((p, i) => merge(p, base[i]))
  }
  if (!isObj(partial) || !isObj(base)) return partial
  const out: Record<string, Json> = { ...base }
  for (const k of Object.keys(partial)) out[k] = merge(partial[k], base[k])
  return out
}

/** A patch reduced to what differs from Init. */
export function slimPatch(patch: ApolloPatch): Record<string, unknown> {
  return (diff(patch as unknown as Json, initPatch() as unknown as Json) ?? {}) as Record<string, unknown>
}

/** A slim patch expanded back to a complete one. Full patches pass through
 *  unchanged, so old projects and new ones both load correctly. */
export function fatPatch(partial: unknown): ApolloPatch {
  return merge(partial as Json, initPatch() as unknown as Json) as unknown as ApolloPatch
}
