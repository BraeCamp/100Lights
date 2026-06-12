import { auth } from '@clerk/nextjs/server'
import { presignDownload } from '@/lib/r2'

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const key = new URL(req.url).searchParams.get('key')
  if (!key) return Response.json({ error: 'Missing key' }, { status: 400 })

  // Enforce user can only get signed URLs for their own files
  if (!key.startsWith(`${userId}/`)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 24-hour expiry — generous enough for a long editing session
  const url = await presignDownload(key, 86400)
  return Response.json({ url })
}
