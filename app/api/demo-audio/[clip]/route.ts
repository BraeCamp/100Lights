import { renderClip, toWav, CLIP_IDS } from '@/lib/demo-audio'
import { getDemoSettings } from '@/lib/demo-audio-store'

export const runtime = 'nodejs'

// Renders a demo clip to WAV from the current tuner settings. Public (the
// article players fetch it). Cached, and re-rendered only after the cache
// window — settings change rarely (only when Brae saves the tuner).
export async function GET(_req: Request, { params }: { params: Promise<{ clip: string }> }) {
  const { clip } = await params
  if (!(CLIP_IDS as readonly string[]).includes(clip)) return new Response('Not found', { status: 404 })
  const settings = await getDemoSettings()
  const wav = toWav(renderClip(clip, settings))
  return new Response(Buffer.from(wav), {
    headers: {
      'Content-Type': 'audio/wav',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
    },
  })
}
