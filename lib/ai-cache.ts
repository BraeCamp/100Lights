// Deterministic-AI result cache. Some AI calls are pure functions of their input: the SAME sheet-music
// image always transcribes to the SAME notes. For those, a repeat request should cost $0 — not another
// paid model call. This is a content-addressed cache keyed on a hash of the input: on a hit we return the
// stored result and skip the model entirely; on a miss we run the model and store the answer for next time.
//
// ONLY use this for genuinely deterministic AI (analysis/recognition — sheet music, audio→text). Do NOT
// cache generative AI (music/image generation) where users expect fresh variety each run.
//
// Lazy self-creating table (mirrors lib/user-prefs.ts). Every path fails soft: a DB hiccup degrades to
// "no cache" (run the model), never an error to the caller.
import { createHash } from 'node:crypto'
import { sql } from '@/lib/db'
import { schemaManaged } from './schema-guard'

let ready = false
async function ensure(): Promise<void> {
  if (ready || schemaManaged) return
  await sql`
    CREATE TABLE IF NOT EXISTS ai_cache (
      hash        TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      result      JSONB NOT NULL,
      hits        INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_hit_at TIMESTAMPTZ
    )`
  ready = true
}

/** Stable content hash for a cache key. `kind` namespaces it so two features never collide on the same
 *  bytes, and any model/prompt version string invalidates old entries when the transcription logic changes. */
export function cacheKey(kind: string, content: string, version = 'v1'): string {
  return createHash('sha256').update(`${kind}\0${version}\0${content}`).digest('hex')
}

/** Cached result for this key, or null on miss / any DB trouble. On a hit, bumps the hit counter so we can
 *  later see how much the cache is actually saving (fire-and-forget — never blocks the response). */
export async function getCached<T>(hash: string): Promise<T | null> {
  try {
    await ensure()
    const r = await sql`SELECT result FROM ai_cache WHERE hash = ${hash}`
    if (!r.length) return null
    sql`UPDATE ai_cache SET hits = hits + 1, last_hit_at = NOW() WHERE hash = ${hash}`.catch(() => {})
    return r[0].result as T
  } catch { return null }
}

/** Store a result. Fails soft — a cache-write failure must never break the request that produced a good
 *  answer. First writer wins (ON CONFLICT DO NOTHING) since the value is deterministic anyway. */
export async function putCached(hash: string, kind: string, result: unknown): Promise<void> {
  try {
    await ensure()
    await sql`
      INSERT INTO ai_cache (hash, kind, result) VALUES (${hash}, ${kind}, ${JSON.stringify(result)})
      ON CONFLICT (hash) DO NOTHING`
  } catch { /* cache is best-effort */ }
}
