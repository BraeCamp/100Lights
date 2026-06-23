import { auth } from '@clerk/nextjs/server'

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return Response.json({ error: 'AI not configured' }, { status: 503 })

  let feedback: string, strength: number, gapFill: number
  try {
    const body = await req.json()
    feedback = String(body.feedback ?? '').trim()
    strength = Number(body.strength)
    gapFill  = Number(body.gapFill)
    if (!feedback || isNaN(strength) || isNaN(gapFill)) throw new Error()
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  const prompt = `You are helping tune a beatbox-to-music transform. The user beatboxed a rhythm
and the app used it as the skeleton to reconstruct the reference track.

Two parameters control the output:
- strength (0–100): how much of the beatbox vocal is audible in the final mix.
  High = voice is prominent; Low = heavily transformed into a synth/instrument sound.
- gapFill (0–100): how much of the reference beat's audio (drums, bass, synths) is blended
  in wherever the beatbox doesn't match. High = pulls more from the reference track;
  Low = relies only on what the transformed beatbox provides.

Current values: strength=${strength}, gapFill=${gapFill}

The user says the result isn't right:
"${feedback}"

Suggest new values for strength and gapFill that address the feedback.
Keep values in range 0–100. Only adjust what the feedback actually calls for.
In 1–2 sentences, explain what you're changing and why.

Respond with valid JSON only, no commentary outside it:
{"strength": <number>, "gapFill": <number>, "explanation": "<string>"}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type':      'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key':         apiKey,
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) return Response.json({ error: 'AI error' }, { status: res.status })

  const data = await res.json() as { content: Array<{ type: string; text: string }> }
  const text = (data.content.find(b => b.type === 'text')?.text ?? '').trim()

  try {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('no json')
    const parsed = JSON.parse(match[0]) as { strength?: number; gapFill?: number; explanation?: string }
    const newStrength = Math.max(0, Math.min(100, Math.round(Number(parsed.strength ?? strength))))
    const newGapFill  = Math.max(0, Math.min(100, Math.round(Number(parsed.gapFill  ?? gapFill))))
    return Response.json({ strength: newStrength, gapFill: newGapFill, explanation: parsed.explanation ?? '' })
  } catch {
    return Response.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 })
  }
}
