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

  // Summarise past corrections as positive spectral examples, not a correction narrative.
  // Group by correctedTo so Claude sees "a kick sounds like this: ..." rather than a
  // confusing "was X, changed to Y" list that could read as a demotion of Y.
  let pastCorrectionsSection = ''
  if (pastCorrections.length > 0) {
    const byType = new Map<string, string[]>()
    for (const c of pastCorrections) {
      const s = c.spectral
      if (!s) continue
      const desc = `lowMid=${fmt(s.lowMid)} mid=${fmt(s.mid)} hiMid=${fmt(s.hiMid)} hi=${fmt(s.hi)} attack=${fmt(s.attackTime,4)}s`
      if (!byType.has(c.correctedTo)) byType.set(c.correctedTo, [])
      byType.get(c.correctedTo)!.push(desc)
    }
    if (byType.size > 0) {
      const lines: string[] = []
      for (const [type, examples] of byType.entries()) {
        lines.push(`  ${type}: ${examples.slice(0, 4).join(' | ')}`)
      }
      pastCorrectionsSection = `
THIS USER'S CONFIRMED SOUND SIGNATURES (from ${pastCorrections.length} past corrections):
${lines.join('\n')}

These are the actual spectral measurements of sounds THIS user confirmed as correct.
Weight these heavily — this user's mouth produces sounds that may not match textbook
beatbox norms. When current hits have similar band ratios, prefer the confirmed type.
`
    }
  }

  const prompt = `You are an expert at classifying beatbox drum sounds from spectral data.

A user beatboxed a drum pattern and the app detected ${hits.length} sound events.
Classify each hit as one of: ${enabledTypes.join(', ')}
Every hit must receive a label — do NOT delete any hits. The user has already reviewed
and removed false positives; assume every hit in this list is a real drum sound.
${groundTruthSection}${pastCorrectionsSection}
CRITICAL BEATBOX FACTS:
- Human mouths CANNOT produce real sub-bass (<100 Hz). Sub values will always be low.
- Beatbox KICKS peak in "lowMid" (150–600 Hz) — not sub. lowMid is the kick indicator.
- SNARES and CLAPS are mid-range dominant (mid band). Snares have some lowMid body; claps are brighter.
- HI-HATS are high frequency (hiMid + hi dominant). Closed hats are short; open hats sustain.
- TOM is like kick but with more "mid" body riding on top.

SPECTRAL BANDS (each is a fraction 0–1 of total energy at that hit):
- sub: 0–150 Hz
- lowMid: 150–600 Hz  ← beatbox kicks/toms peak here
- mid: 600–3000 Hz    ← snares/claps
- hiMid: 3–8 kHz      ← hi-hats, snare crack
- hi: 8+ kHz          ← hi-hats, sibilants

HIT DATA:
${table}

CLASSIFICATION RULES:
- lowMid is highest band → kick (or tom if mid also significant)
- hiMid+hi > 0.50 → hihat family (open-hihat if high and sustained)
- mid is highest, sub low → snare or clap (snare has more lowMid body)
- mid > 0.45 and sub < 0.12 → rim
- attackTime < 0.005s = sharp transient (kick, clap). attackTime > 0.02s = soft onset (tom, open-hat)
- roughness > 0.4 = buzzy/noisy (snare wire). harmonicRatio > 0.5 = pitched (tom, rim)
- mfcc[1] strongly separates kick (negative) from hihat (positive)

Respond with ONLY a valid JSON array of exactly ${hits.length} strings.
Use only these labels: ${enabledTypes.join(', ')}
Example: ["kick","hihat","snare","hihat","kick"]`

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

  // Parse JSON array — lenient: unknown labels and "delete" fall back to the original type
  const VALID_SET = new Set<string>([...VALID_TYPES, 'delete'])
  let raw: string[]
  try {
    const match = rawText.match(/\[[\s\S]*?\]/)
    if (!match) throw new Error(`no array in: ${rawText.slice(0, 120)}`)
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) throw new Error('not an array')
    raw = hits.map((h, i) => {
      const val = parsed[i] as string | undefined
      // "delete" is no longer offered in the prompt; treat it as the original type
      if (val == null || val === 'delete' || !VALID_SET.has(val)) return h.type
      return val
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[classify-beats] parse error:', msg, '| raw:', rawText.slice(0, 200))
    return Response.json({ error: `Failed to parse AI response: ${msg}` }, { status: 500 })
  }

  // Only reclassifications — deletions are disabled; user removes false hits manually
  const corrections: Record<string, BeatType> = {}
  const deletions: string[] = []
  hits.forEach((h, i) => {
    if (raw[i] !== h.type) {
      corrections[h.id] = raw[i] as BeatType
    }
  })

  return Response.json({ corrections, deletions, totalHits: hits.length })
}
