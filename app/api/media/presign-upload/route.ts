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
  // mediaId becomes part of the R2 key — keep it to a safe charset (no '/' or '..').
  if (!/^[A-Za-z0-9_-]+$/.test(mediaId)) {
    return Response.json({ error: 'Invalid media id' }, { status: 400 })
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
  // Clamp to a sane non-negative number — a NaN/negative `size` would make every
  // `size > cap` comparison false and silently bypass both the 500 MB and the
  // per-plan storage caps (and sign no ContentLength into the URL).
  const rawSize = Number(body.size)
  const size = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 0
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
      // Count one (latest) row per key, so historical duplicate rows from
      // re-uploading the same stable key don't inflate the usage total.
      const used = await sql`
        SELECT COALESCE(SUM(sz), 0)::bigint AS total FROM (
          SELECT DISTINCT ON (key) size AS sz
          FROM upload_log WHERE user_id = ${clerkId}
          ORDER BY key, at DESC
        ) t`
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
  // Sign the byte length into the URL so the client can't upload more (or fewer)
  // bytes than the `size` the cap check was computed from.
  const uploadUrl = await presignUpload(key, contentType, 900, size)
  if (clerkId && size > 0) {
    try {
      await ensureUploadLog()
      // The R2 key is STABLE per media id, so re-uploading a file (e.g. a linked
      // DAW mix that re-bounces on every edit/save) OVERWRITES the same object —
      // no real storage growth. Dedup the accounting by key so those overwrites
      // don't accumulate phantom rows and falsely trip the storage cap.
      await sql`DELETE FROM upload_log WHERE user_id = ${clerkId} AND key = ${key}`
      await sql`INSERT INTO upload_log (user_id, key, size) VALUES (${clerkId}, ${key}, ${size})`
    } catch { /* best-effort */ }
  }
  return Response.json({ uploadUrl, key })
}
