import { auth } from '@clerk/nextjs/server'

interface CorrectionInput {
  time:         number
  machineLabel: string
  finalLabel:   string
  spectral?: {
    sub: number; lowMid: number; mid: number; hiMid: number; hi: number
    attackTime?: number; releaseTime?: number; sustainLevel?: number
    harmonicRatio?: number; roughness?: number; brightness?: number
  }
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return Response.json({ error: 'AI not configured' }, { status: 503 })

  let corrections: CorrectionInput[], userNotes: string | undefined
  try {
    const body = await req.json()
    corrections = body.corrections ?? []
    userNotes = typeof body.userNotes === 'string' && body.userNotes.trim() ? body.userNotes.trim() : undefined
    if (!Array.isArray(corrections) && !userNotes) throw new Error()
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  const fmt = (n?: number, d = 3) => n != null ? n.toFixed(d) : '—'

  const lines = corrections.map((c, i) => {
    const s = c.spectral
    return [
      `  ${i + 1}. t=${c.time.toFixed(2)}s — classified as "${c.machineLabel}", user corrected to "${c.finalLabel}"`,
      s ? `     bands: sub=${fmt(s.sub)} lowMid=${fmt(s.lowMid)} mid=${fmt(s.mid)} hiMid=${fmt(s.hiMid)} hi=${fmt(s.hi)}` : '',
      s ? `     attack=${fmt(s.attackTime,4)}s  release=${fmt(s.releaseTime,3)}s  sustain=${fmt(s.sustainLevel)}  harmRatio=${fmt(s.harmonicRatio)}  roughness=${fmt(s.roughness)}` : '',
    ].filter(Boolean).join('\n')
  }).join('\n')

  const noteSection = userNotes ? `\nUSER NOTES:\n"${userNotes}"\n` : ''
  const correctionSection = corrections.length > 0
    ? `Here are the corrections with spectral data:\n${lines}\n`
    : 'No hit-level corrections were made.'

  const prompt = `You are a beatbox classifier learning from user feedback.
${noteSection}
${correctionSection}
In 2–4 sentences, reflect on:
- What the user's feedback tells you about where your analysis went wrong
- What specific spectral patterns or cues you should weight differently next time
- If there's a pattern across multiple corrections, call it out

Be concrete (reference actual numbers where available). Do not apologize. Just analyze what you missed and how to improve.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'content-type':      'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key':         apiKey,
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) return Response.json({ error: 'AI error' }, { status: res.status })

  const data = await res.json() as { content: Array<{ type: string; text: string }> }
  const reflection = (data.content.find(b => b.type === 'text')?.text ?? '').trim()

  return Response.json({ reflection })
}
