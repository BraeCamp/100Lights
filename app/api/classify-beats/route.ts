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

  // Build a rich user-specific voice profile from all past corrections.
  // Strategy: compute the MEAN of every spectral feature across all corrections
  // for each confirmed type, then also surface confusion pairs (what the machine
  // keeps getting wrong for this specific user).
  let pastCorrectionsSection = ''
  if (pastCorrections.length > 0) {
    type SpectralAccum = { n: number; sub: number; lowMid: number; mid: number; hiMid: number; hi: number; attackTime: number; roughness: number; harmonicRatio: number; flatness: number; brightness: number; mfcc1: number }
    const confirmed = new Map<string, SpectralAccum>()   // keyed by correctedTo
    const confusion  = new Map<string, SpectralAccum>()  // keyed by `detectedAs→correctedTo`

    const acc0 = (): SpectralAccum => ({ n: 0, sub: 0, lowMid: 0, mid: 0, hiMid: 0, hi: 0, attackTime: 0, roughness: 0, harmonicRatio: 0, flatness: 0, brightness: 0, mfcc1: 0 })
    const accumulate = (map: Map<string, SpectralAccum>, key: string, s: PastCorrection['spectral']) => {
      if (!s) return
      if (!map.has(key)) map.set(key, acc0())
      const a = map.get(key)!
      a.n++
      a.sub            += s.sub      ?? 0
      a.lowMid         += s.lowMid   ?? 0
      a.mid            += s.mid      ?? 0
      a.hiMid          += s.hiMid    ?? 0
      a.hi             += s.hi       ?? 0
      a.attackTime     += s.attackTime    ?? 0
      a.roughness      += s.roughness     ?? 0
      a.harmonicRatio  += s.harmonicRatio ?? 0
      a.flatness       += s.flatness      ?? 0
      a.brightness     += s.brightness    ?? 0
      a.mfcc1          += (s.mfcc && s.mfcc[1] != null) ? s.mfcc[1] : 0
    }
    const mean = (a: SpectralAccum) => ({
      sub:           a.sub           / a.n,
      lowMid:        a.lowMid        / a.n,
      mid:           a.mid           / a.n,
      hiMid:         a.hiMid         / a.n,
      hi:            a.hi            / a.n,
      attackTime:    a.attackTime    / a.n,
      roughness:     a.roughness     / a.n,
      harmonicRatio: a.harmonicRatio / a.n,
      flatness:      a.flatness      / a.n,
      brightness:    a.brightness    / a.n,
      mfcc1:         a.mfcc1         / a.n,
    })

    for (const c of pastCorrections) {
      accumulate(confirmed, c.correctedTo, c.spectral)
      if (c.detectedAs !== c.correctedTo) {
        accumulate(confusion, `${c.detectedAs}→${c.correctedTo}`, c.spectral)
      }
    }

    const profileLines: string[] = []
    for (const [type, a] of confirmed.entries()) {
      const m = mean(a)
      profileLines.push(
        `  ${type.toUpperCase()} (${a.n} sample${a.n !== 1 ? 's' : ''})\n` +
        `    bands:  sub=${fmt(m.sub)} lowMid=${fmt(m.lowMid)} mid=${fmt(m.mid)} hiMid=${fmt(m.hiMid)} hi=${fmt(m.hi)}\n` +
        `    timbre: attack=${fmt(m.attackTime,4)}s  roughness=${fmt(m.roughness)}  harmRatio=${fmt(m.harmonicRatio)}  flatness=${fmt(m.flatness)}  brightness=${fmt(m.brightness)}  mfcc1=${fmt(m.mfcc1,1)}`
      )
    }

    const confusionLines: string[] = []
    for (const [pair, a] of confusion.entries()) {
      if (a.n < 2) continue  // only surface repeated mistakes
      const m = mean(a)
      const [from, to] = pair.split('→')
      confusionLines.push(
        `  Machine says "${from}" → user corrected to "${to}" (×${a.n}):\n` +
        `    avg bands: sub=${fmt(m.sub)} lowMid=${fmt(m.lowMid)} mid=${fmt(m.mid)} hiMid=${fmt(m.hiMid)} hi=${fmt(m.hi)}  attack=${fmt(m.attackTime,4)}s  roughness=${fmt(m.roughness)}`
      )
    }

    if (profileLines.length > 0) {
      pastCorrectionsSection = `
═══ THIS USER'S VOICE PROFILE (${pastCorrections.length} confirmed correction${pastCorrections.length !== 1 ? 's' : ''}) ═══
These are AVERAGED spectral measurements across everything this user confirmed.
Override your default heuristics with these — this user's mouth sounds different.

${profileLines.join('\n\n')}
${confusionLines.length > 0 ? `\nREPEATED MISTAKES TO FIX:\n${confusionLines.join('\n\n')}` : ''}

INSTRUCTION: For each hit, compute how close its spectral features are to the profiles
above. If a hit closely matches a confirmed profile, USE THAT TYPE — even if it contradicts
your general beatbox knowledge. The user's corrections are ground truth for their voice.
═══════════════════════════════════════════════════════════════════════════════
`
    }
  }

  const prompt = `You are an expert at classifying beatbox drum sounds from spectral data.

A user beatboxed a drum pattern and the app detected ${hits.length} sound events.
Classify each hit as one of: ${enabledTypes.join(', ')}, delete
Use "delete" ONLY for clear false positives: breath noise, mic bumps, or sounds with no
recognisable drum character (very low velocity AND no dominant spectral band). Be conservative
— if the hit could plausibly be a drum sound, classify it rather than delete it.
At least half of the hits must receive a drum label (not "delete").
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
Use only these labels: ${enabledTypes.join(', ')}, delete
Example: ["kick","hihat","delete","snare","hihat"]`

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

  // Parse JSON array — lenient: unknown labels fall back to the original type
  const VALID_SET = new Set<string>([...VALID_TYPES, 'delete'])
  let raw: string[]
  try {
    const match = rawText.match(/\[[\s\S]*?\]/)
    if (!match) throw new Error(`no array in: ${rawText.slice(0, 120)}`)
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) throw new Error('not an array')
    raw = hits.map((h, i) => {
      const val = parsed[i] as string | undefined
      return (val != null && VALID_SET.has(val)) ? val : h.type
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[classify-beats] parse error:', msg, '| raw:', rawText.slice(0, 200))
    return Response.json({ error: `Failed to parse AI response: ${msg}` }, { status: 500 })
  }

  // Safety net: if AI wants to delete more than half the hits, cancel all deletions
  // and only apply reclassifications — the recording is never left empty.
  const deleteCount = raw.filter(l => l === 'delete').length
  if (deleteCount >= Math.ceil(hits.length / 2)) {
    raw = raw.map((l, i) => l === 'delete' ? hits[i].type : l)
  }

  const corrections: Record<string, BeatType> = {}
  const deletions: string[] = []
  hits.forEach((h, i) => {
    if (raw[i] === 'delete') {
      deletions.push(h.id)
    } else if (raw[i] !== h.type) {
      corrections[h.id] = raw[i] as BeatType
    }
  })

  return Response.json({ corrections, deletions, totalHits: hits.length, deletionsSuppressed: deleteCount >= Math.ceil(hits.length / 2) })
}
