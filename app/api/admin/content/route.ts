import { isAdmin } from '@/lib/admin-auth'
import { logAdmin } from '@/lib/admin-audit'
import { createDraft, listPosts, PLATFORMS, type Platform } from '@/lib/content/store'
import { templateCaption, type Musical } from '@/lib/content/caption'

export const runtime = 'nodejs'

// GET — the admin content queue.
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  return Response.json({ posts: await listPosts(), platforms: PLATFORMS })
}

// POST — file a rendered video (already uploaded to R2 via the presign route) as a
// draft. Body is small JSON — the video bytes went straight to storage, so this
// works within the production request-body limit. The caption is drafted here
// from the musical metadata; the admin edits + approves before anything posts.
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })

  const body = await req.json().catch(() => null) as
    | { videoKey?: string; videoType?: string; slug?: string; format?: string; projectId?: string; musical?: Musical; platforms?: Platform[] }
    | null
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

  // Only accept keys this app minted (content/<ts>-<slug>.<ext>) — never an
  // arbitrary storage path from the client.
  const videoKey = String(body.videoKey || '')
  if (!/^content\/\d+-[\w-]+\.(mp4|webm)$/.test(videoKey)) {
    return Response.json({ error: 'Bad video key' }, { status: 400 })
  }
  const videoType = videoKey.endsWith('.mp4') ? 'video/mp4' : 'video/webm'
  const slug = (body.slug || 'song-video').replace(/[^a-z0-9-]/gi, '-').slice(0, 60) || 'song-video'

  const { title, caption } = templateCaption(body.musical ?? {})
  const platforms = (Array.isArray(body.platforms) ? body.platforms.filter(p => (PLATFORMS as readonly string[]).includes(p)) : ['youtube']) as Platform[]

  const post = await createDraft({
    projectId: body.projectId ?? null, slug, format: body.format || 'falling-notes',
    title, caption, platforms: platforms.length ? platforms : ['youtube'],
    videoKey, videoType, musical: body.musical ?? null,
  })
  await logAdmin('content.ingest', post.id, { slug, format: post.format })
  return Response.json({ ok: true, id: post.id })
}
