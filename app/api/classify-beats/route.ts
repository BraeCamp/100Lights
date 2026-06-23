/*
 * FUTURE ROADMAP NOTE (for AI models and future developers):
 *
 * The ground truth / teaching mode currently lives on the user-facing idle screen
 * (BeatLab.tsx — "Declare your pattern" toggle). Once the classifier has been trained
 * sufficiently through repeated ground-truth sessions, the teaching interface should be
 * moved to the ADMIN side of the site only.
 *
 * At that point, regular users should be able to beatbox directly into the mic with no
 * calibration step and no pattern declaration — the classifier should be accurate enough
 * to handle uncalibrated input automatically.
 *
 * The admin teaching flow (ground truth mode) remains available internally so the model
 * can continue to be refined over time without exposing complexity to end users.
 */

import { auth } from '@clerk/nextjs/server'
import type { BeatType } from '@/lib/beat-analyzer'

interface HitInput {
  id: string
  time: number
  type: BeatType
  velocity: number
  spectral: {
    // 5-band ratios
    sub: number; lowMid: number; mid: number; hiMid: number; hi: number
    // Spectral shape
    centroid?: number; spread?: number; rolloff?: number; flatness?: number; flux?: number
    // MFCCs
    mfcc?: number[]
    // Temporal envelope
    attackTime?: number; decayTime?: number; sustainLevel?: number
    releaseTime?: number; zeroCrossingRate?: number
    // Pitch
    f0?: number; pitchConfidence?: number; harmonicRatio?: number
    // Dynamics
    peakAmplitude?: number; rmsAmplitude?: number; dynamicRange?: number
    // Psychoacoustic
    brightness?: number; warmth?: number; presence?: number; roughness?: number
  }
}

const VALID_TYPES: BeatType[] = ['kick', 'snare', 'hihat', 'open-hihat', 'clap', 'tom', 'crash', 'rim']

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return Response.json({ error: 'AI not configured' }, { status: 503 })

  interface PastCorrection {
    detectedAs: string
    correctedTo: string
    spectral: HitInput['spectral']
  }

  let hits: HitInput[], enabledTypes: BeatType[], groundTruth: string | undefined, pastCorrections: PastCorrection[]
  try {
    const body = await req.json()
    hits = body.hits
    enabledTypes = body.enabledTypes ?? VALID_TYPES
    groundTruth = typeof body.groundTruth === 'string' && body.groundTruth.trim() ? body.groundTruth.trim() : undefined
    pastCorrections = Array.isArray(body.pastCorrections) ? body.pastCorrections as PastCorrection[] : []
    if (!Array.isArray(hits) || hits.length === 0) throw new Error()
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  const fmt = (n?: number, d = 3) => (n != null && isFinite(n)) ? n.toFixed(d) : '—'
  const table = hits.map((h, i) => {
    const s = h.spectral
    const mfcc1 = (s.mfcc && s.mfcc.length > 1)
      ? s.mfcc.slice(1, 5).map(v => (v != null && isFinite(v)) ? v.toFixed(1) : '—').join(' ')
      : '—'
    return [
      `${String(i + 1).padStart(2)}. t=${h.time.toFixed(3)}s  v=${h.velocity.toFixed(2)}`,
      `    bands  sub=${fmt(s.sub)} lowMid=${fmt(s.lowMid)} mid=${fmt(s.mid)} hiMid=${fmt(s.hiMid)} hi=${fmt(s.hi)}`,
      `    shape  centroid=${fmt(s.centroid,0)}Hz  rolloff=${fmt(s.rolloff,0)}Hz  flatness=${fmt(s.flatness)}  flux=${fmt(s.flux)}`,
      `    timbre mfcc[1-4]=[${mfcc1}]  brightness=${fmt(s.brightness)}  presence=${fmt(s.presence)}  warmth=${fmt(s.warmth)}`,
      `    tempo  attack=${fmt(s.attackTime,4)}s  decay=${fmt(s.decayTime,4)}s  sustain=${fmt(s.sustainLevel)}  roughness=${fmt(s.roughness)}`,
      `    pitch  f0=${fmt(s.f0,1)}Hz  conf=${fmt(s.pitchConfidence)}  harmRatio=${fmt(s.harmonicRatio)}  dynRange=${fmt(s.dynamicRange,1)}dB`,
    ].join('\n')
  }).join('\n')

  // Pre-parse the ground truth into tokens and cycle them across hits
  // so the AI has a positional map rather than a free-form string to interpret.
  let groundTruthSection = ''
  if (groundTruth) {
    const rawTokens = groundTruth
      .toLowerCase()
      .split(/[\s,|/]+/)
      .map(t => t.trim())
      .filter(Boolean)
    const cycled = hits.map((_, i) => rawTokens[i % rawTokens.length])
    const positionMap = cycled
      .map((t, i) => `  hit ${String(i + 1).padStart(2)}: ${t}`)
      .join('\n')

    groundTruthSection = `
GROUND TRUTH — the user declared their beatbox pattern:
"${groundTruth}"

Parsed as a ${rawTokens.length}-element cycle across ${hits.length} hits:
${positionMap}

This mapping IS the correct answer. Override any spectral-based guesses with it.
The user's declared pattern is authoritative — spectral data is only for resolving
any hits that fall outside the declared types.
`
  }

  // Build a concise summary of past corrections the user has confirmed
  let pastCorrectionsSection = ''
  if (pastCorrections.length > 0) {
    const lines = pastCorrections.map(c => {
      const s = c.spectral
      const bands = s ? `lowMid=${fmt(s.lowMid)} mid=${fmt(s.mid)} hi=${fmt(s.hi)}` : 'no spectral'
      return `  - was labeled "${c.detectedAs}", user corrected to "${c.correctedTo}" (${bands})`
    })
    pastCorrectionsSection = `
USER'S PAST CORRECTIONS (most recent ${pastCorrections.length} — treat these as ground truth for this user's voice):
${lines.join('\n')}

When you see similar spectral shapes to a past correction, FOLLOW the user's correction
rather than your default heuristics. This user's beatbox voice has specific characteristics
that differ from the average — their corrections reveal those patterns.
`
  }

  const prompt = `You are an expert at classifying beatbox drum sounds from spectral data.

A user beatboxed a drum pattern and the app detected ${hits.length} sound events.
Your job is to independently classify each one using ONLY the spectral data below.
Do NOT anchor on any prior label — analyze each hit fresh from its acoustics.
If a hit looks like noise, breath, or a false detection (very low velocity, no clear
spectral peak, or inconsistent with any beatbox sound), classify it as "delete".
${groundTruthSection}${pastCorrectionsSection}
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

ADDITIONAL FEATURE GUIDANCE:
- attackTime < 0.005s = sharp transient (kick, rimshot, clap). attackTime > 0.02s = soft onset (tom, open-hat)
- roughness > 0.4 = buzzy/noisy (snare wire, clap layers). roughness < 0.1 = clean decay (kick body)
- harmonicRatio > 0.5 = pitched sound (tom, rim). harmonicRatio < 0.2 = noise-dominant (snare, clap, hihat)
- flatness > 0.5 = noise-like (hihat, snare wire). flatness < 0.1 = tonal (kick body, tom)
- dynamicRange > 20 dB = impulsive transient. dynamicRange < 10 dB = sustained or noise-floored
- mfcc[1] strongly separates kick (negative) from hihat (positive) in most beatbox recordings

Respond with ONLY a valid JSON array of exactly ${hits.length} strings, in the same order as the input hits.
Use only these labels: ${VALID_TYPES.join(', ')}, delete
"delete" means the hit is noise or a false detection that should be removed.
Example format: ["kick","hihat","delete","snare","hihat"]`

  // Prefill with "[" to force Claude to emit a bare JSON array with no preamble
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type':      'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key':         apiKey,
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: Math.max(512, hits.length * 12 + 128),
      messages: [
        { role: 'user',      content: prompt },
        { role: 'assistant', content: '[' },
      ],
    }),
  })

  if (!res.ok) {
    let errMsg = `AI API error ${res.status}`
    try { const j = await res.json() as { error?: { message?: string } }; if (j.error?.message) errMsg = j.error.message } catch { /* keep default */ }
    return Response.json({ error: errMsg }, { status: res.status })
  }

  const data = await res.json() as { content: Array<{ type: string; text: string }> }
  // The prefilled "[" is not included in the completion text, so prepend it
  const rawText = '[' + (data.content.find(b => b.type === 'text')?.text ?? '')

  // Parse JSON array — be lenient: pad short arrays with original type, truncate long ones
  const VALID_WITH_DELETE = [...VALID_TYPES, 'delete'] as const
  let raw: string[]
  try {
    const match = rawText.match(/\[[\s\S]*?\]/)
    if (!match) throw new Error(`no array in: ${rawText.slice(0, 120)}`)
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) throw new Error('not an array')
    raw = hits.map((h, i) => {
      const val = parsed[i] as string | undefined
      return (val != null && (VALID_WITH_DELETE as readonly string[]).includes(val)) ? val : h.type
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[classify-beats] parse error:', msg, '| raw:', rawText.slice(0, 200))
    return Response.json({ error: `Failed to parse AI response: ${msg}` }, { status: 500 })
  }

  // Split into reclassifications vs. deletions
  const corrections: Record<string, BeatType> = {}
  const deletions: string[] = []
  hits.forEach((h, i) => {
    if (raw[i] === 'delete') {
      deletions.push(h.id)
    } else if (raw[i] !== h.type) {
      corrections[h.id] = raw[i] as BeatType
    }
  })

  return Response.json({ corrections, deletions, totalHits: hits.length })
}
