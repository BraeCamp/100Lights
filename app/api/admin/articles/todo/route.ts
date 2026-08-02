import { isAdmin } from '@/lib/admin-auth'
import { getTodoFlags, setTodoFlag } from '@/lib/article-todo'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// Author "needs work / to-do" flags for Learn articles. GET lists flagged
// slugs; POST toggles one. See lib/article-todo.ts.

export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  return Response.json({ flags: await getTodoFlags() })
}

export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  let body: { slug?: string; needsWork?: boolean; note?: string }
  try { body = await req.json() } catch { return new Response('Bad JSON', { status: 400 }) }
  const slug = body.slug?.trim()
  if (!slug) return new Response('Missing slug', { status: 400 })
  const needsWork = body.needsWork !== false
  await setTodoFlag(slug, needsWork, (body.note ?? '').slice(0, 500))
  await logAdmin(needsWork ? 'article.todo_set' : 'article.todo_clear', slug)
  return Response.json({ ok: true, slug, needsWork })
}
