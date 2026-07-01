import { getSession } from '@/lib/guest-sessions'
import { presignUpload } from '@/lib/r2'

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const session = await getSession(token)
  if (!session) return Response.json({ error: 'Not found' }, { status: 404 })
  if (session.status !== 'ready' && session.status !== 'waiting') {
    return Response.json({ error: 'Session not ready' }, { status: 409 })
  }

  const { mimeType } = await req.json().catch(() => ({})) as { mimeType?: string }
  const ext = mimeType?.includes('ogg') ? '.ogg' : '.webm'
  const key = `guest-recordings/${token}/recording${ext}`
  const uploadUrl = await presignUpload(key, mimeType ?? 'audio/webm', 3600)

  return Response.json({ uploadUrl, key })
}
