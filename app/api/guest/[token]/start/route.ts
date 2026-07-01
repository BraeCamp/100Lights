import { auth } from '@clerk/nextjs/server'
import { getSession, startSession } from '@/lib/guest-sessions'

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { token } = await params
  const session = await getSession(token)
  if (!session) return Response.json({ error: 'Not found' }, { status: 404 })
  if (session.hostUserId !== userId) return Response.json({ error: 'Forbidden' }, { status: 403 })

  const sessionStartMs = await startSession(token)
  return Response.json({ sessionStartMs })
}
