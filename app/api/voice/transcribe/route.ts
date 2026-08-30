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

  const url = new URL(req.url)
  const contentType = req.headers.get('content-type') || 'audio/webm'
  const audio = await req.arrayBuffer().catch(() => null)
  if (!audio || audio.byteLength < 512) {
    return NextResponse.json({ error: 'No audio.' }, { status: 400 })
  }
  if (audio.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'That recording is too long for a command.' }, { status: 413 })
  }

  // NO `alternatives`. Nova-3 refuses it outright — "Nova-3 models do not
  // support more than one alternative" — with a 400, which is what made every
  // recorded command fail. Asked directly with the shipped parameters and
  // without them; the only difference was that one.
  //
  // Worth stating what that costs, since it was there for a reason: the
  // browser's recogniser returns several guesses and hear-better.ts scores them
  // against the project's real track names, which is what turns "base two" into
  // "Bass 2". Nova-3 returns one. The name repair still runs on that one
  // sentence — a single guess can still be corrected — but the "pick the
  // alternative that mentions a real track" half has nothing to choose from
  // here. An older model would give alternatives back at a cost in accuracy;
  // better to have Nova-3's one good guess and repair it.
  //
  // smart_format stays ON so numbers arrive as digits — "128", not "one twenty
  // eight" — which is exactly what the command parser wants.
  const params = new URLSearchParams({
    model: 'nova-3',
    smart_format: 'true',
    // Digits, not words — the command parser wants "128", not "one twenty
    // eight", and a number spelled out is one more thing to get wrong.
    numerals: 'true',
    // "um", "uh" and friends carry no instruction and only get in the way of
    // matching a short command.
    filler_words: 'false',
  })

  // ── Tell it which words to expect ────────────────────────────────────────
  //
  // Brae: "it can't hear what I'm saying very well while there's conversations
  // in the background."
  //
  // Background speech is the hardest case for a recogniser, because the
  // interference is exactly the thing it is trained to find. It cannot be
  // filtered out the way a hum can — but the decision can be made easier. A
  // recogniser choosing between "mute" and "moot" in a noisy room is guessing
  // against a dictionary of every English word; told that "mute" and the names
  // of the tracks in the open project are likely here, it is choosing from a
  // few dozen.
  //
  // Nova-3 calls this keyterm prompting. Verified against the API, because the
  // obvious-looking `keywords` is REFUSED by Nova-3 — "Keywords are not
  // supported for Nova-3. Please use `keyterm` instead" — and guessing a
  // parameter from memory is what 400'd every command last time.
  const vocabulary = url.searchParams.getAll('kt')
    .map(t => t.trim())
    .filter(t => t && t.length <= 40)
    .slice(0, 40)          // a hint, not a dictionary
  for (const term of vocabulary) params.append('keyterm', term)

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
    // Deepgram says exactly what is wrong; the first version put that in a
    // `detail` field the client never displayed, so "Transcription failed
    // (400)" was all anyone saw of "Nova-3 models do not support more than one
    // alternative". Put the actual sentence in `error`.
    const raw = await res.text().catch(() => '')
    let why = ''
    try { why = (JSON.parse(raw) as { err_msg?: string }).err_msg ?? '' } catch { why = raw.slice(0, 160) }
    return NextResponse.json(
      { error: why ? `Transcription failed: ${why}` : `Transcription failed (${res.status}).` },
      { status: 502 },
    )
  }

  const data = await res.json().catch(() => null) as {
    results?: {
      channels?: {
        alternatives?: {
          transcript?: string
          confidence?: number
          words?: { word?: string; punctuated_word?: string; confidence?: number }[]
        }[]
      }[]
    }
  } | null

  const alts = data?.results?.channels?.[0]?.alternatives ?? []
  const text = (alts[0]?.transcript ?? '').trim()
  if (!text) return NextResponse.json({ text: '', alternatives: [], words: [], confidence: 0 })

  return NextResponse.json({
    text,
    // Best first, matching what the browser's recogniser hands back, so the
    // caller's scoring code does not care which one produced them.
    alternatives: alts.map(a => (a.transcript ?? '').trim()).filter(Boolean),
    // ── Which words it was unsure of ───────────────────────────────────────
    //
    // Deepgram scores every word and this used to throw all of it away, keeping
    // only the single number for the utterance. That discarded the most useful
    // thing in the response: WHICH word it struggled with.
    //
    // Brae: "it's okay to have the system recognize multiple possible words from
    // the audio instead of deciding on one." Per-word confidence is what makes
    // that affordable — without it every word in the sentence is equally
    // suspect and the search has to widen everywhere at once. With it, the one
    // word it flagged gets reconsidered and the rest are taken at face value.
    words: (alts[0]?.words ?? []).map(w => ({
      word: (w.punctuated_word ?? w.word ?? '').trim(),
      confidence: typeof w.confidence === 'number' ? w.confidence : 1,
    })).filter(w => w.word),
    confidence: typeof alts[0]?.confidence === 'number' ? alts[0].confidence : 1,
  })
}
