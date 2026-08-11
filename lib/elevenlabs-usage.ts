// Exact ElevenLabs credit accounting.
//
// ElevenLabs bills "credits" (the API reports them as `character_count`) against
// a per-period `character_limit`. The subscription endpoint is the source of
// truth for the running total, so a snapshot taken immediately BEFORE and AFTER
// a generation yields the EXACT number of credits that one request consumed —
// independent of whatever (possibly undocumented) per-request cost header the
// audio endpoint may or may not return.
//
// We ALSO dump every response header into the usage row's metadata, so if the
// audio endpoint does carry a per-request cost header, it is captured verbatim
// (by whatever name ElevenLabs uses) rather than guessed at.

export interface ElevenLabsCredits {
  used: number          // character_count — credits consumed this billing period
  limit: number         // character_limit — the period allowance
  remaining: number
  tier: string
  nextResetUnix: number | null
}

// Fail-soft: never throw, never block the measured request for long. Returns
// null if the subscription can't be read (missing key, network, rate limit).
export async function getElevenLabsCredits(key: string | undefined): Promise<ElevenLabsCredits | null> {
  if (!key) return null
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const d = await res.json() as {
      character_count?: number
      character_limit?: number
      tier?: string
      next_character_count_reset_unix?: number
    }
    const used = Number(d.character_count ?? 0)
    const limit = Number(d.character_limit ?? 0)
    return {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      tier: String(d.tier ?? ''),
      nextResetUnix: d.next_character_count_reset_unix ?? null,
    }
  } catch {
    return null
  }
}

// The exact credits a request consumed = after.used - before.used, when both
// snapshots succeeded. Guards against a period reset landing between the two
// reads (delta would go negative) by returning undefined in that case.
export function creditsDelta(
  before: ElevenLabsCredits | null,
  after: ElevenLabsCredits | null,
): number | undefined {
  if (!before || !after) return undefined
  const d = after.used - before.used
  return d >= 0 ? d : undefined
}

// Every response header as a plain object, so an unknown per-request cost header
// is captured by name+value instead of guessed. Small (a handful of headers).
export function headerMap(res: Response): Record<string, string> {
  const o: Record<string, string> = {}
  res.headers.forEach((v, k) => { o[k] = v })
  return o
}
