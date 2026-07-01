import { auth } from '@clerk/nextjs/server'
import { createSession, listSessions } from '@/lib/guest-sessions'

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const projectId = new URL(req.url).searchParams.get('projectId')
  if (!projectId) return Response.json({ error: 'projectId required' }, { status: 400 })
  const sessions = await listSessions(projectId, userId)
  return Response.json(sessions)
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId } = await req.json().catch(() => ({})) as { projectId?: string }
  if (!projectId) return Response.json({ error: 'projectId required' }, { status: 400 })

  const session = await createSession(projectId, userId)
  return Response.json({ token: session.token })
}
