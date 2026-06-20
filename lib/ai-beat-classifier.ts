import type { BeatHit, BeatType } from './beat-analyzer'

export interface AiClassifyResult {
  suggestions: Map<string, BeatType>
  deletions:   Set<string>
}

// Calls the /api/classify-beats route with hit spectral data.
// Returns suggestions (reclassifications) and deletions (noise/false hits to remove).
// Returns null if the call fails or there's no spectral data.
export async function aiClassifyHits(
  hits: BeatHit[],
  enabledTypes: BeatType[],
  groundTruth?: string,
): Promise<AiClassifyResult | null> {
  const hitsWithSpectral = hits.filter(h => h.spectral)
  if (hitsWithSpectral.length === 0) return null

  try {
    const res = await fetch('/api/classify-beats', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hits: hitsWithSpectral.map(h => ({
          id:       h.id,
          time:     h.time,
          type:     h.type,
          velocity: h.velocity,
          spectral: h.spectral,
        })),
        enabledTypes,
        groundTruth,
      }),
    })

    if (!res.ok) return null

    const data = await res.json() as { corrections?: Record<string, BeatType>; deletions?: string[] }
    if (!data.corrections && !data.deletions) return null

    return {
      suggestions: new Map(Object.entries(data.corrections ?? {}) as [string, BeatType][]),
      deletions:   new Set(data.deletions ?? []),
    }
  } catch {
    return null
  }
}
