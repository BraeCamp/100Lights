import { getSession, confirmUpload } from '@/lib/guest-sessions'

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const session = await getSession(token)
  if (!session) return Response.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as {
    r2Key?: string
    recordingStartMs?: number
    durationMs?: number
  }

  if (!body.r2Key || !body.recordingStartMs || !body.durationMs) {
    return Response.json({ error: 'Missing fields' }, { status: 400 })
  }

  const { timelineOffsetMs } = await confirmUpload(
    token,
    body.r2Key,
    body.recordingStartMs,
    body.durationMs,
  )

  return Response.json({ ok: true, timelineOffsetMs })
}
