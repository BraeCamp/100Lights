import { isAdmin } from '@/lib/admin-auth'
import { putObject } from '@/lib/r2'
import { logAdmin } from '@/lib/admin-audit'
import { createDraft, listPosts, PLATFORMS, type Platform } from '@/lib/content/store'
import { templateCaption, type Musical } from '@/lib/content/caption'

export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_VIDEO = 200 * 1024 * 1024 // 200 MB

// GET — the admin content queue.
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  return Response.json({ posts: await listPosts(), platforms: PLATFORMS })
}

// POST — ingest a rendered song-video into the queue as a draft. Body is
// multipart: `capture` (the webm) + `meta` (JSON: musical, slug, format, projectId).
// The caption is drafted here from the musical metadata; the admin edits + approves.
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })

  let form: FormData
  try { form = await req.formData() } catch { return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 }) }

  const cap = form.get('capture')
  if (!cap || typeof cap === 'string') return Response.json({ error: 'Missing video' }, { status: 400 })
  if (cap.size > MAX_VIDEO) return Response.json({ error: 'Video too large' }, { status: 413 })

  const metaRaw = form.get('meta')
  let meta: { musical?: Musical; slug?: string; format?: string; projectId?: string; platforms?: Platform[] } = {}
  if (typeof metaRaw === 'string') { try { meta = JSON.parse(metaRaw) } catch { /* keep defaults */ } }

  const videoType = cap.type.includes('mp4') ? 'video/mp4' : 'video/webm'
  const bytes = new Uint8Array(await cap.arrayBuffer())
  const slug = (meta.slug || 'song-video').replace(/[^a-z0-9-]/gi, '-').slice(0, 60) || 'song-video'
  const key = `content/${Date.now()}-${slug}.${videoType === 'video/mp4' ? 'mp4' : 'webm'}`
  await putObject(key, bytes, videoType)

  const { title, caption } = templateCaption(meta.musical ?? {})
  const platforms = (Array.isArray(meta.platforms) ? meta.platforms.filter(p => (PLATFORMS as readonly string[]).includes(p)) : ['youtube']) as Platform[]

  const post = await createDraft({
    projectId: meta.projectId ?? null, slug, format: meta.format || 'falling-notes',
    title, caption, platforms: platforms.length ? platforms : ['youtube'],
    videoKey: key, videoType, musical: meta.musical ?? null,
  })
  await logAdmin('content.ingest', post.id, { slug, format: post.format })
  return Response.json({ ok: true, id: post.id })
}
