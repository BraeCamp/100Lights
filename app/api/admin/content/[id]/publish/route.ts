import { isAdmin } from '@/lib/admin-auth'
import { logAdmin } from '@/lib/admin-audit'
import { publishPost } from '@/lib/content/publish'

export const runtime = 'nodejs'
export const maxDuration = 300 // resumable video upload can take a while

// POST — publish an approved post to its platforms (or a dry run that reports
// what would happen without touching any account). Body: { dryRun?, visibility? }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const dryRun = body.dryRun === true
  const visibility = ['public', 'unlisted', 'private'].includes(body.visibility) ? body.visibility : 'private'
  try {
    const post = await publishPost(id, { dryRun, visibility })
    if (!dryRun) await logAdmin('content.publish', id, { visibility, results: post.results })
    return Response.json({ ok: true, dryRun, post })
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 })
  }
}
