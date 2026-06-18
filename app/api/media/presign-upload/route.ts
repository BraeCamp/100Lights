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

  const { filename, mediaId } = body
  if (!filename || !mediaId) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Resolve content type — browsers sometimes return empty string for formats
  // like .mkv or .avi, so we fall back to extension-based guessing.
  const EXT_TO_MIME: Record<string, string> = {
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
    '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.m4v': 'video/x-m4v',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
    '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
    '.opus': 'audio/opus', '.wma': 'audio/x-ms-wma',
  }
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : ''
  const resolvedType: string = (body.contentType && body.contentType.includes('/'))
    ? body.contentType
    : (EXT_TO_MIME[ext] ?? '')

  // Namespace by userId so users can only access their own files
  // 500 MB limit
  const MAX_BYTES = 500 * 1024 * 1024
  const size = Number(body.size ?? 0)
  if (size > MAX_BYTES) {
    return Response.json({ error: 'File too large. Maximum size is 500 MB.' }, { status: 413 })
  }

  const ALLOWED = ['video/', 'audio/']
  if (!ALLOWED.some(p => resolvedType.startsWith(p))) {
    return Response.json({ error: `Unsupported file type (${resolvedType || ext || 'unknown'}). Upload a video or audio file.` }, { status: 415 })
  }

  const key = `${userId}/${mediaId}${ext}`
  const contentType = resolvedType

  // Presign for 15 minutes — the browser uploads immediately after receiving this
  const uploadUrl = await presignUpload(key, contentType, 900)
  return Response.json({ uploadUrl, key })
}
