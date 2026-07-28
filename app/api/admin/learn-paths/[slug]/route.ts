import { isAdmin } from '@/lib/admin-auth'
import { deleteLearnPath } from '@/lib/learn-paths-store'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// DELETE /api/admin/learn-paths/:slug — removes the DB row. A built-in path
// reverts to its code default; a custom path is deleted entirely.
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { slug } = await params
  await deleteLearnPath(slug)
  await logAdmin('learn_path.delete', slug, {})
  return Response.json({ ok: true })
}
