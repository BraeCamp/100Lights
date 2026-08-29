// Hearing a command when the browser cannot.
//
// Brae: "It says that it isn't reaching Google's speech service."
//
// Chrome's SpeechRecognition is not local. It streams audio to Google and gets
// words back, so on a machine, network or browser build that cannot reach that
// service, voice control simply does not exist — and nothing in this app can
// fix it, because the dependency is the browser's, not ours.
//
// So this is the way in that does not go through Google. The studio records a
// few seconds of audio and posts the bytes here; Deepgram returns the words.
// Everything downstream is unchanged — the same sentence, the same name repair,
// the same local resolver, the same assistant fallback.
//
// Deliberately NOT the existing /api/transcribe. That one is built for
// CAPTIONS: it takes an r2Key, mints a signed URL, and has Deepgram fetch the
// file — three round trips and an upload before a word is read. Correct for a
// finished recording, far too much for a three-second command. Deepgram accepts
// raw bytes directly, so this posts them straight through.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A spoken command is seconds long. Opus at this length is tens of kilobytes,
 *  so anything approaching a megabyte is not a command and is refused before it
 *  reaches a paid API. */
const MAX_BYTES = 2 * 1024 * 1024

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Sign in to use voice.' }, { status: 401 })

  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Voice transcription is not configured (DEEPGRAM_API_KEY).' }, { status: 501 })
  }

  const contentType = req.headers.get('content-type') || 'audio/webm'
  const audio = await req.arrayBuffer().catch(() => null)
  if (!audio || audio.byteLength < 512) {
    return NextResponse.json({ error: 'No audio.' }, { status: 400 })
  }
  if (audio.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'That recording is too long for a command.' }, { status: 413 })
  }

  // `alternatives` because the caller scores them against the project's own
  // track names — the same trick that turns "base two" into "Bass 2". Smart
  // formatting is left ON so numbers arrive as digits ("128" not "one twenty
  // eight"), which is what the command parser wants.
  const params = new URLSearchParams({
    model: 'nova-3',
    smart_format: 'true',
    punctuate: 'false',      // a command is not a sentence; trailing periods only confuse matching
    alternatives: '3',
  })

  let res: Response
  try {
    res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': contentType },
      body: audio,
      // A command is short. If this is slow, the feature is not usable anyway,
      // and failing quickly lets the studio say so instead of hanging.
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    return NextResponse.json({ error: 'Could not reach the transcription service.' }, { status: 502 })
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return NextResponse.json(
      { error: `Transcription failed (${res.status}).`, detail: detail.slice(0, 200) },
      { status: 502 },
    )
  }

  const data = await res.json().catch(() => null) as {
    results?: { channels?: { alternatives?: { transcript?: string; confidence?: number }[] }[] }
  } | null

  const alts = data?.results?.channels?.[0]?.alternatives ?? []
  const text = (alts[0]?.transcript ?? '').trim()
  if (!text) return NextResponse.json({ text: '', alternatives: [], confidence: 0 })

  return NextResponse.json({
    text,
    // Best first, matching what the browser's recogniser hands back, so the
    // caller's scoring code does not care which one produced them.
    alternatives: alts.map(a => (a.transcript ?? '').trim()).filter(Boolean),
    confidence: typeof alts[0]?.confidence === 'number' ? alts[0].confidence : 1,
  })
}
