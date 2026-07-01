import { auth } from '@clerk/nextjs/server'
import { getSession, markPulled } from '@/lib/guest-sessions'
import { presignDownload } from '@/lib/r2'

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { token } = await params
  const session = await getSession(token)
  if (!session) return Response.json({ error: 'Not found' }, { status: 404 })
  if (session.hostUserId !== userId) return Response.json({ error: 'Forbidden' }, { status: 403 })
  if (!session.r2Key) return Response.json({ error: 'No recording yet' }, { status: 409 })

  const url = await presignDownload(session.r2Key, 3600)
  await markPulled(token)

  return Response.json({
    url,
    guestName:       session.guestName ?? 'Guest',
    timelineOffsetMs: session.timelineOffsetMs ?? 0,
    durationMs:       session.durationMs ?? 0,
  })
}
