import { isAdmin } from '@/lib/admin-auth'
import { listAllObjects, objectInfo } from '@/lib/r2'
import { voiceKey, normaliseSpoken, looksSpeakable } from '@/lib/voice/voice-cache'
import phrases from '@/lib/voice/phrases.json'

export const runtime = 'nodejs'
export const maxDuration = 60

// GET /api/admin/voice-phrases — everything the studio can say, and which of it
// has been paid for.
//
// The awkward part is that the cache is keyed by a HASH of the text, which is
// what makes it shared — two users muting a track called Drums land on the same
// object without anything knowing they are related — and also what makes the
// bucket unreadable on its own. So the answer comes from two directions:
//
//   The phrases we KNOW about (lib/voice/phrases.json, generated at build time
//   from the source) have their keys computed here and matched against a single
//   bucket listing. No per-phrase request.
//
//   Anything left over is a templated phrase somebody actually said — "Bass 2:
//   muted." — and its text is only in the object's metadata, which a listing
//   does not return. Those cost one HEAD each, so they are capped and fetched
//   newest-first: the recent ones are the interesting ones, and an admin panel
//   should not turn into a thousand round trips because the product got popular.

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'

/** How many unknown recordings to look up the text of. */
const LOOKUP_CAP = 300
/** HEADs in flight at once. Enough to be quick, few enough to be polite. */
const CONCURRENCY = 12

/** Dollars per 1,000 characters. The account's real rate cannot be read — the
 *  API key lacks that permission — so this is the published tier, and the panel
 *  says so rather than presenting an estimate as a bill. */
const RATE_PER_1K = 0.22

const cost = (chars: number) => +((chars / 1000) * RATE_PER_1K).toFixed(4)

export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })

  const prefix = `voice/${VOICE_ID}/`
  let objects: { key: string; size: number; modified: string | null }[]
  try {
    objects = await listAllObjects(prefix)
  } catch (e) {
    return Response.json(
      { error: `R2 unavailable: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 502 },
    )
  }
  const stored = new Map(objects.map(o => [o.key, o]))

  // ── The phrases we know the text of ──────────────────────────────────────
  const known = new Set<string>()
  const describe = (p: { text: string; display: string; where: string }, kind: 'fixed' | 'shape') => {
    // A shape has no single final string, so it has no key and cannot be
    // looked up — it is listed for completeness, not for status.
    if (kind === 'shape') {
      return { ...p, kind, bought: false, speakable: true, chars: null, key: null, size: 0, modified: null }
    }
    const key = voiceKey(p.text, VOICE_ID)
    known.add(key)
    const hit = stored.get(key)
    return {
      ...p,
      kind,
      key,
      // Refused by the endpoint's own gate, so it will always use the browser
      // voice however much is pre-rendered. Worth surfacing: it means a
      // response is too long or too odd to be spoken, which is a content bug.
      speakable: looksSpeakable(p.text),
      bought: !!hit,
      chars: normaliseSpoken(p.text).length,
      size: hit?.size ?? 0,
      modified: hit?.modified ?? null,
    }
  }

  const fixed = phrases.fixed.map(p => describe(p, 'fixed'))
  const shapes = phrases.shapes.map(p => describe(p, 'shape'))

  // ── The ones somebody said ───────────────────────────────────────────────
  const unknown = objects
    .filter(o => !known.has(o.key))
    .sort((a, b) => String(b.modified ?? '').localeCompare(String(a.modified ?? '')))

  const lookup = unknown.slice(0, LOOKUP_CAP)
  const spoken: { text: string | null; key: string; size: number; modified: string | null }[] = []
  for (let i = 0; i < lookup.length; i += CONCURRENCY) {
    const batch = await Promise.all(lookup.slice(i, i + CONCURRENCY).map(async o => {
      const info = await objectInfo(o.key)
      return {
        // Null for anything written before the metadata existed, or by
        // something else. Shown as such rather than guessed at.
        text: info?.meta.phrase ?? null,
        key: o.key,
        size: o.size,
        modified: o.modified,
      }
    }))
    spoken.push(...batch)
  }

  const fixedBought = fixed.filter(p => p.bought)
  const fixedPending = fixed.filter(p => !p.bought && p.speakable)

  return Response.json({
    voiceId: VOICE_ID,
    // Whether a recording can be made at all right now. The key in use has been
    // scoped to music generation, so the honest answer has usually been "no" —
    // and a panel showing 0 bought without saying why is a mystery, not a
    // report.
    configured: {
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
      storage: !!process.env.R2_BUCKET && !!process.env.R2_PUBLIC_BASE,
    },
    generated: phrases.generated,
    rate: RATE_PER_1K,
    totals: {
      fixed: fixed.length,
      shapes: shapes.length,
      bought: fixedBought.length,
      pending: fixedPending.length,
      // What it would cost to buy the rest — once, for every user there will
      // ever be.
      pendingCost: cost(fixedPending.reduce((n, p) => n + (p.chars ?? 0), 0)),
      spentSoFar: cost(fixedBought.reduce((n, p) => n + (p.chars ?? 0), 0)),
      inStorage: objects.length,
      bytes: objects.reduce((n, o) => n + o.size, 0),
      spokenCount: unknown.length,
      spokenShown: spoken.length,
    },
    fixed,
    shapes,
    spoken,
  })
}
