import { isAdmin } from '@/lib/admin-auth'
import { logAdmin } from '@/lib/admin-audit'
import { getPost, setStatus } from '@/lib/content/store'

export const runtime = 'nodejs'

// POST — the approval gate. Flips a draft to 'approved' so it becomes eligible
// for publishing. Reversible: pass { approved: false } to send it back to draft.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const post = await getPost(id)
  if (!post) return Response.json({ error: 'Not found' }, { status: 404 })
  if (post.status === 'published') return Response.json({ error: 'Already published' }, { status: 409 })
  const next = body.approved === false ? 'draft' : 'approved'
  const updated = await setStatus(id, next)
  await logAdmin(`content.${next === 'approved' ? 'approve' : 'unapprove'}`, id)
  return Response.json({ ok: true, post: updated })
}
