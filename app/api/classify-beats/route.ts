import { auth } from '@clerk/nextjs/server'
import type { BeatType } from '@/lib/beat-analyzer'

interface HitInput {
  id: string
  time: number
  type: BeatType
  velocity: number
  spectral: { sub: number; lowMid: number; mid: number; hiMid: number; hi: number }
}

const VALID_TYPES: BeatType[] = ['kick', 'snare', 'hihat', 'open-hihat', 'clap', 'tom', 'crash', 'rim']

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return Response.json({ error: 'AI not configured' }, { status: 503 })

  let hits: HitInput[], enabledTypes: BeatType[], groundTruth: string | undefined
  try {
    const body = await req.json()
    hits = body.hits
    enabledTypes = body.enabledTypes ?? VALID_TYPES
    groundTruth = typeof body.groundTruth === 'string' && body.groundTruth.trim() ? body.groundTruth.trim() : undefined
    if (!Array.isArray(hits) || hits.length === 0) throw new Error()
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  const table = hits.map((h, i) => {
    const s = h.spectral
    return `${String(i + 1).padStart(2)}. t=${h.time.toFixed(3)}s  cur=${h.type.padEnd(10)}  v=${h.velocity.toFixed(2)}  sub=${s.sub.toFixed(3)}  lowMid=${s.lowMid.toFixed(3)}  mid=${s.mid.toFixed(3)}  hiMid=${s.hiMid.toFixed(3)}  hi=${s.hi.toFixed(3)}`
  }).join('\n')

  const groundTruthSection = groundTruth
    ? `\nGROUND TRUTH — the user declared what they were beatboxing:
"${groundTruth}"
This is authoritative. Use it to correct misclassifications. Match the hit sequence to the
declared pattern (considering timing and rhythm), then correct the labels accordingly.
Even if spectral data is ambiguous, the declared pattern takes priority.\n`
    : ''

  const prompt = `You are an expert at classifying beatbox drum sounds from spectral data.

A user beatboxed a drum pattern and the app detected ${hits.length} hits. Your job is to
review the current classifications and fix mistakes using the spectral data.
${groundTruthSection}
CRITICAL BEATBOX FACTS:
- Human mouths CANNOT produce real sub-bass (<100 Hz). Sub values will always be low.
- Beatbox KICKS peak in "lowMid" (150-600 Hz) — not sub. lowMid is the kick indicator.
- SNARES and CLAPS are mid-range dominant (mid band). Snares have some lowMid body; claps are brighter.
- HI-HATS are high frequency (hiMid + hi dominant). Closed hats are short; open hats sustain.
- TOM is like kick but with more "mid" body riding on top.
- The user was beatboxing these types: ${enabledTypes.join(', ')}

SPECTRAL BANDS (each is a fraction 0-1 of total energy at that hit):
- sub: 0–150 Hz
- lowMid: 150–600 Hz  ← beatbox kicks/toms peak here
- mid: 600–3000 Hz    ← snares/claps
- hiMid: 3–8 kHz      ← hi-hats, snare crack
- hi: 8+ kHz           ← hi-hats, sibilants

HIT DATA:
${table}

CLASSIFICATION RULES OF THUMB:
- lowMid is highest band → kick (or tom if mid also high)
- hiMid+hi > 0.50 → hihat family (open-hihat if hi is very high and sustained)
- mid is highest, sub low → snare or clap (snare has more lowMid body; clap is sharper)
- mid > 0.45 and sub < 0.12 → rim
- Look for rhythmic patterns: kicks on beats 1/3, snares on 2/4, hihats subdivide

Respond with ONLY a valid JSON array of exactly ${hits.length} type strings, in the same order as the input hits.
Use only these labels: ${VALID_TYPES.join(', ')}
Example format: ["kick","hihat","snare","hihat"]`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type':      'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key':         apiKey,
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    return Response.json({ error: err }, { status: res.status })
  }

  const data = await res.json() as { content: Array<{ type: string; text: string }> }
  const text = (data.content.find(b => b.type === 'text')?.text ?? '').trim()

  // Parse JSON array from response
  let types: BeatType[]
  try {
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('no array')
    types = JSON.parse(match[0])
    if (!Array.isArray(types) || types.length !== hits.length) throw new Error('length mismatch')
    // Validate each type
    types = types.map(t => VALID_TYPES.includes(t as BeatType) ? t as BeatType : hits[0].type)
  } catch {
    return Response.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 })
  }

  // Return map of hitId → aiType
  const corrections: Record<string, BeatType> = {}
  hits.forEach((h, i) => {
    if (types[i] !== h.type) corrections[h.id] = types[i]
  })

  return Response.json({ corrections, totalHits: hits.length })
}
