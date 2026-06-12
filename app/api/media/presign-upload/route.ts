import { auth } from '@clerk/nextjs/server'
import { presignUpload } from '@/lib/r2'

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { filename: string; contentType: string; mediaId: string; size?: number }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { filename, contentType, mediaId } = body
  if (!filename || !contentType || !mediaId) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Namespace by userId so users can only access their own files
  // 500 MB limit
  const MAX_BYTES = 500 * 1024 * 1024
  const size = Number(body.size ?? 0)
  if (size > MAX_BYTES) {
    return Response.json({ error: 'File too large. Maximum size is 500 MB.' }, { status: 413 })
  }

  const ALLOWED = ['video/', 'audio/']
  if (!ALLOWED.some(p => contentType.startsWith(p))) {
    return Response.json({ error: 'Only video and audio files are accepted.' }, { status: 415 })
  }

  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : ''
  const key = `${userId}/${mediaId}${ext}`

  // Presign for 15 minutes — the browser uploads immediately after receiving this
  const uploadUrl = await presignUpload(key, contentType, 900)
  return Response.json({ uploadUrl, key })
}
