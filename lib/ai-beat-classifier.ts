import type { BeatHit, BeatType } from './beat-analyzer'

// Calls the /api/classify-beats route with hit spectral data.
// Returns a map of hitId → corrected BeatType for hits that Claude would reclassify.
// Returns null if the call fails or there's no spectral data.
export async function aiClassifyHits(
  hits: BeatHit[],
  enabledTypes: BeatType[],
): Promise<Map<string, BeatType> | null> {
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
      }),
    })

    if (!res.ok) return null

    const data = await res.json() as { corrections?: Record<string, BeatType> }
    if (!data.corrections) return null

    return new Map(Object.entries(data.corrections) as [string, BeatType][])
  } catch {
    return null
  }
}
