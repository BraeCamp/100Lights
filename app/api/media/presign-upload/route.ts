import { auth } from '@clerk/nextjs/server'
import { presignUpload } from '@/lib/r2'
import { sql } from '@/lib/db'

let uploadLogReady = false
async function ensureUploadLog() {
  if (uploadLogReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS upload_log (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      size BIGINT NOT NULL DEFAULT 0,
      at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS upload_log_user_idx ON upload_log (user_id)`
  uploadLogReady = true
}

export async function POST(req: Request) {
  const { userId: clerkId } = await auth()
  // DEV_OPEN test collaborators (mirrors /api/liveblocks-auth) — dev builds only
  const testUser = process.env.DEV_OPEN === '1' && process.env.NODE_ENV !== 'production'
    ? req.headers.get('x-test-user')
    : null
  const userId = clerkId ?? (testUser ? `test-${testUser}` : null)
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

  // Cumulative storage against the plan limit (approximate: presigned sizes,
  // not reconciled against deletions — a guardrail, not a meter)
  if (clerkId) {
    try {
      await ensureUploadLog()
      const { getSubscription, getPlanLimits } = await import('@/lib/subscription')
      const sub = await getSubscription(clerkId)
      const limits = getPlanLimits(sub.plan)
      const used = await sql`SELECT COALESCE(SUM(size), 0)::bigint AS total FROM upload_log WHERE user_id = ${clerkId}`
      const totalAfter = Number(used[0]?.total ?? 0) + size
      if (totalAfter > limits.storageMb * 1024 * 1024) {
        return Response.json({ error: `Storage limit reached (${limits.storageMb >= 1024 ? `${limits.storageMb / 1024} GB` : `${limits.storageMb} MB`}). Upgrade for more space.` }, { status: 413 })
      }
    } catch { /* accounting is best-effort — never block uploads on its failure */ }
  }

  const ALLOWED = ['video/', 'audio/']
  if (!ALLOWED.some(p => resolvedType.startsWith(p))) {
    return Response.json({ error: `Unsupported file type (${resolvedType || ext || 'unknown'}). Upload a video or audio file.` }, { status: 415 })
  }

  const key = `${userId}/${mediaId}${ext}`
  const contentType = resolvedType

  // Presign for 15 minutes — the browser uploads immediately after receiving this
  const uploadUrl = await presignUpload(key, contentType, 900)
  if (clerkId && size > 0) {
    try {
      await ensureUploadLog()
      await sql`INSERT INTO upload_log (user_id, key, size) VALUES (${clerkId}, ${key}, ${size})`
    } catch { /* best-effort */ }
  }
  return Response.json({ uploadUrl, key })
}
