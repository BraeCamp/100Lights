import { auth } from '@clerk/nextjs/server'
import { getSession, markWaiting, deleteSession } from '@/lib/guest-sessions'

// GET — guest page polls this to know when host has started the session
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const session = await getSession(token)
  if (!session) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({
    status:         session.status,
    guestName:      session.guestName,
    sessionStartMs: session.sessionStartMs,
  })
}

// POST — guest announces themselves (sets status to waiting, saves name)
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const session = await getSession(token)
  if (!session) return Response.json({ error: 'Not found' }, { status: 404 })

  const { guestName } = await req.json().catch(() => ({})) as { guestName?: string }
  await markWaiting(token, guestName ?? 'Guest')
  return Response.json({ ok: true })
}

// DELETE — host removes a session
export async function DELETE(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { token } = await params
  const session = await getSession(token)
  if (!session) return Response.json({ error: 'Not found' }, { status: 404 })
  if (session.hostUserId !== userId) return Response.json({ error: 'Forbidden' }, { status: 403 })
  await deleteSession(token)
  return Response.json({ ok: true })
}
