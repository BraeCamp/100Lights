import { auth } from '@clerk/nextjs/server'
import { CREDITS_ENABLED, meterAI, CREDIT_COSTS } from '@/lib/credits'

export const runtime = 'nodejs'
export const maxDuration = 300

// Stem separation: the client POSTs the generated song's raw audio bytes (as
// the request body, content-type audio/*). We repackage them as multipart
// form-data with a `file` field and forward to ElevenLabs, which returns a ZIP
// archive with one audio file per stem. We pass that ZIP straight back. The key
// stays server-side. Needs ELEVENLABS_API_KEY.

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Sign in to separate stems.' }, { status: 401 })
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return Response.json({ error: 'ELEVENLABS_API_KEY is not set.' }, { status: 501 })

  if (CREDITS_ENABLED) {
    const m = await meterAI(userId, CREDIT_COSTS.stems, 'stem separation')
    if (!m.ok) return Response.json({ error: 'Not enough credits.', needCredits: true, balance: m.balance }, { status: 402 })
  }

  const ab = await req.arrayBuffer().catch(() => null)
  if (!ab || ab.byteLength === 0) return Response.json({ error: 'No audio supplied.' }, { status: 400 })

  const contentType = req.headers.get('content-type') || 'audio/mpeg'
  const form = new FormData()
  // Do NOT set content-type on the fetch manually — let fetch set the multipart
  // boundary. The file's own type is carried by the Blob.
  form.append('file', new Blob([ab], { type: contentType }), 'song.mp3')

  const res = await fetch('https://api.elevenlabs.io/v1/music/stem-separation', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
    signal: AbortSignal.timeout(290_000),
  }).catch(() => null)

  if (!res) return Response.json({ error: 'Could not reach the stem-separation service.' }, { status: 502 })
  if (!res.ok) {
    const msg = (await res.text().catch(() => '')).slice(0, 300)
    return Response.json({ error: `Stem separation error ${res.status}: ${msg}` }, { status: 502 })
  }

  return new Response(res.body, { headers: { 'content-type': 'application/zip' } })
}
