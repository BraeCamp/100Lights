import { auth } from '@clerk/nextjs/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { presignDownload } from '@/lib/r2'

export const maxDuration = 120

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = await checkRateLimit(userId, 'transcribe', 10)
  if (!limit.allowed) {
    return Response.json(
      { error: `Daily transcription limit reached. Resets at ${limit.resetAt.toUTCString()}.` },
      { status: 429, headers: { 'X-RateLimit-Reset': limit.resetAt.toISOString() } },
    )
  }

  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'Transcription service not configured.' }, { status: 503 })
  }

  let body: { r2Key: string; contentType?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const { r2Key, contentType } = body
  if (!r2Key) return Response.json({ error: 'Missing r2Key.' }, { status: 400 })

  // Enforce users can only transcribe their own files
  if (!r2Key.startsWith(`${userId}/`)) {
    return Response.json({ error: 'Forbidden.' }, { status: 403 })
  }

  // Give Deepgram a short-lived signed URL — it fetches the file directly from R2
  const signedUrl = await presignDownload(r2Key, 900)

  const params = new URLSearchParams({
    model:        'nova-3',
    smart_format: 'true',
    utterances:   'true',
    diarize:      'true',
    punctuate:    'true',
    paragraphs:   'true',
  })

  let deepgramResponse: Response
  try {
    deepgramResponse = await fetch(
      `https://api.deepgram.com/v1/listen?${params}`,
      {
        method:  'POST',
        headers: {
          Authorization:  `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: signedUrl }),
      }
    )
  } catch {
    return Response.json({ error: 'Could not reach Deepgram. Check your internet connection.' }, { status: 502 })
  }

  if (!deepgramResponse.ok) {
    const err = await deepgramResponse.json().catch(() => ({}))
    const message = (err as { err_msg?: string })?.err_msg ?? `Deepgram returned ${deepgramResponse.status}`
    return Response.json({ error: message }, { status: deepgramResponse.status })
  }

  const data = await deepgramResponse.json() as {
    results?: { utterances?: Array<{ start: number; end: number; transcript: string; speaker?: number }> }
    metadata?: { duration?: number }
  }

  const utterances = data.results?.utterances ?? []
  const captions = utterances.map((u) => ({
    start:   u.start,
    end:     u.end,
    text:    u.transcript.trim(),
    speaker: u.speaker !== undefined ? `Speaker ${u.speaker + 1}` : undefined,
  }))

  return Response.json({ captions, duration: data.metadata?.duration })
}
