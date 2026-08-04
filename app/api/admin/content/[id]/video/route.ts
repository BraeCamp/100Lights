import { isAdmin } from '@/lib/admin-auth'
import { presignDownload } from '@/lib/r2'
import { getPost } from '@/lib/content/store'

export const runtime = 'nodejs'

// GET — admin preview of a queued video. Redirects to a short-lived presigned
// URL so the stored object is never publicly addressable.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return new Response('Unauthorized', { status: 401 })
  const { id } = await params
  const post = await getPost(id)
  if (!post) return new Response('Not found', { status: 404 })
  const url = await presignDownload(post.videoKey, 600)
  return Response.redirect(url, 302)
}
