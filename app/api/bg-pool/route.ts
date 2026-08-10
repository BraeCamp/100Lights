import { auth } from '@clerk/nextjs/server'
import { listObjects, presignDownload } from '@/lib/r2'

// Pooled AI backgrounds for the song-video engine. Generated ONCE per genre by
// scripts/generate-bg-pool.mjs and stored under R2 `bg-pool/<genre>/…`, then reused across every
// song — so a "premium AI background" costs $0 of AI per video. Returns signed URLs the client loads
// as the engine's bgImage. Optional ?genre filters the pool.
export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const genre = new URL(req.url).searchParams.get('genre')?.replace(/[^a-z0-9-]/gi, '')
  const prefix = genre ? `bg-pool/${genre}/` : 'bg-pool/'
  const objs = await listObjects(prefix, 80).catch(() => [])
  const imgs = objs.filter(o => /\.(webp|png|jpe?g)$/i.test(o.key))
  const backgrounds = await Promise.all(imgs.map(async o => ({
    key: o.key,
    genre: o.key.split('/')[1] || 'any',
    url: await presignDownload(o.key, 6 * 3600),
  })))
  return Response.json({ backgrounds })
}
