import { isAdmin } from '@/lib/admin-auth'
import { deleteObject } from '@/lib/r2'
import { logAdmin } from '@/lib/admin-audit'
import { deletePost, updatePost, PLATFORMS, type Platform } from '@/lib/content/store'

export const runtime = 'nodejs'

// PATCH — edit a draft's title / caption / platforms before approving.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const platforms = Array.isArray(body.platforms)
    ? (body.platforms.filter((p: string) => (PLATFORMS as readonly string[]).includes(p)) as Platform[])
    : undefined
  const post = await updatePost(id, {
    title: typeof body.title === 'string' ? body.title : undefined,
    caption: typeof body.caption === 'string' ? body.caption : undefined,
    platforms,
  })
  if (!post) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true, post })
}

// DELETE — remove a post and its stored video.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const key = await deletePost(id)
  if (key) { await deleteObject(key).catch(() => {}); await deleteObject(key.replace(/\.\w+$/, '.mp4')).catch(() => {}) }
  await logAdmin('content.delete', id)
  return Response.json({ ok: true })
}
