import { renderClip, toWav, CLIP_IDS } from '@/lib/demo-audio'
import { getOverride } from '@/lib/demo-audio-store'

export const runtime = 'nodejs'

// Serves a demo clip: the uploaded replacement if one exists, otherwise the
// generated version. Public (the article players fetch it). Short cache so an
// upload shows up quickly.
export async function GET(_req: Request, { params }: { params: Promise<{ clip: string }> }) {
  const { clip } = await params
  if (!(CLIP_IDS as readonly string[]).includes(clip)) return new Response('Not found', { status: 404 })

  const override = await getOverride(clip)
  if (override) {
    return new Response(new Uint8Array(override.buf), {
      headers: { 'Content-Type': override.contentType, 'Cache-Control': 'public, max-age=60, stale-while-revalidate=86400' },
    })
  }

  const wav = toWav(renderClip(clip))
  return new Response(Buffer.from(wav), {
    headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=86400' },
  })
}
