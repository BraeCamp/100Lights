import { auth } from '@clerk/nextjs/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { presignDownload } from '@/lib/r2'
import { cacheKey, getCached, putCached } from '@/lib/ai-cache'
import { recordUsage } from '@/lib/api-usage'

export const maxDuration = 120

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { r2Key: string; contentType?: string; contentHash?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const { r2Key, contentType, contentHash } = body
  if (!r2Key) return Response.json({ error: 'Missing r2Key.' }, { status: 400 })

  // Enforce users can only transcribe their own files
  if (!r2Key.startsWith(`${userId}/`)) {
    return Response.json({ error: 'Forbidden.' }, { status: 403 })
  }

  // Deterministic-AI cache: a transcript is a pure function of the audio bytes. The client sends a
  // SHA-256 of the file (it already holds the bytes — no R2 egress here), so a repeat of the SAME audio
  // returns instantly, costs $0, and consumes neither the daily quota nor a Deepgram call. Checked
  // BEFORE the rate limit so a free cache hit never counts against the user's allowance.
  const cacheHash = contentHash ? cacheKey('transcribe', contentHash, 'deepgram-nova3') : null
  if (cacheHash) {
    const hit = await getCached<{ captions: unknown[]; duration?: number }>(cacheHash)
    if (hit) return Response.json({ ...hit, cached: true })
  }

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
    results?: { utterances?: Array<{
      start: number; end: number; transcript: string; speaker?: number
      words?: Array<{ word: string; punctuated_word?: string; start: number; end: number }>
    }> }
    metadata?: { duration?: number }
  }

  const utterances = data.results?.utterances ?? []
  const captions = utterances.map((u) => ({
    start:   u.start,
    end:     u.end,
    text:    u.transcript.trim(),
    speaker: u.speaker !== undefined ? `Speaker ${u.speaker + 1}` : undefined,
    // Word timings power karaoke-style caption highlighting in the video editor.
    words:   u.words?.map(w => ({ w: (w.punctuated_word ?? w.word).trim(), s: w.start, e: w.end })),
  }))

  const result = { captions, duration: data.metadata?.duration }
  recordUsage({ userId, provider: 'deepgram', operation: 'transcribe', units: data.metadata?.duration ?? 0, unitType: 'seconds', metadata: { model: 'nova-3' } })
  if (cacheHash) await putCached(cacheHash, 'transcribe', result)   // next identical audio is free
  return Response.json(result)
}
