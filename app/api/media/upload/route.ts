import { auth } from '@clerk/nextjs/server'
import { putObject } from '@/lib/r2'
import { sql } from '@/lib/db'
import { schemaManaged } from '@/lib/schema-guard'

// Server-side upload proxy: the browser POSTs the file bytes here and WE PUT them
// to R2. This sidesteps browser CORS entirely (which blocks the direct
// presigned PUT when the bucket's CORS policy is missing/misconfigured). Used as
// a fallback by the client when the direct upload fails. Capped well under
// Vercel's request-body limit — big files must still go direct-to-R2 (+ CORS).
const MAX_PROXY_BYTES = 4 * 1024 * 1024

let uploadLogReady = false
async function ensureUploadLog() {
  if (uploadLogReady || schemaManaged) return
  await sql`
    CREATE TABLE IF NOT EXISTS upload_log (
      user_id TEXT NOT NULL, key TEXT NOT NULL,
      size BIGINT NOT NULL DEFAULT 0, at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`CREATE INDEX IF NOT EXISTS upload_log_user_idx ON upload_log (user_id)`
  uploadLogReady = true
}

const EXT_OK = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v', '.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.opus'])

export async function POST(req: Request) {
  const { userId: clerkId } = await auth()
  // DEV_OPEN test user (dev builds only) — headless tools upload via the x-test-user header. Inert in prod.
  const testUser = process.env.DEV_OPEN === '1' && process.env.NODE_ENV !== 'production' ? req.headers.get('x-test-user') : null
  const userId = clerkId ?? (testUser ? `test-${testUser}` : null)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const mediaId = (req.headers.get('x-media-id') || '').trim()
  const ext = (req.headers.get('x-ext') || '').trim().toLowerCase()
  const contentType = req.headers.get('content-type') || 'application/octet-stream'
  // The media id becomes part of the R2 key — keep it to a safe charset so it
  // can't inject '/' or '..' into the key path.
  if (!/^[A-Za-z0-9_-]+$/.test(mediaId)) return Response.json({ error: 'Invalid media id' }, { status: 400 })
  if (!contentType.startsWith('audio/') && !contentType.startsWith('video/'))
    return Response.json({ error: `Only audio/video uploads are allowed (got "${contentType}")` }, { status: 415 })
  if (!EXT_OK.has(ext)) return Response.json({ error: `Unsupported file type (${ext || 'unknown'})` }, { status: 415 })

  // Reject before buffering the whole body when the declared length is over cap.
  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > MAX_PROXY_BYTES)
    return Response.json({ error: 'File too large for server upload — needs direct-to-R2 (configure CORS).' }, { status: 413 })

  const buf = new Uint8Array(await req.arrayBuffer())
  if (buf.byteLength === 0) return Response.json({ error: 'Empty upload' }, { status: 400 })
  if (buf.byteLength > MAX_PROXY_BYTES)
    return Response.json({ error: 'File too large for server upload — needs direct-to-R2 (configure CORS).' }, { status: 413 })

  // Enforce the plan storage cap using the REAL byte length — this path is the
  // normal one when R2 CORS is unset, so without this the cap wouldn't apply.
  // (Uses the same per-key dedup as the presign route so overwrites don't count.)
  try {
    await ensureUploadLog()
    const { getSubscription, getPlanLimits } = await import('@/lib/subscription')
    const sub = await getSubscription(userId)
    const limits = getPlanLimits(sub.plan)
    const key0 = `${userId}/${mediaId}${ext}`
    const used = await sql`
      SELECT COALESCE(SUM(sz), 0)::bigint AS total FROM (
        SELECT DISTINCT ON (key) size AS sz FROM upload_log
        WHERE user_id = ${userId} AND key <> ${key0}
        ORDER BY key, at DESC
      ) t`
    const totalAfter = Number(used[0]?.total ?? 0) + buf.byteLength
    if (totalAfter > limits.storageMb * 1024 * 1024)
      return Response.json({ error: `Storage limit reached (${limits.storageMb >= 1024 ? `${limits.storageMb / 1024} GB` : `${limits.storageMb} MB`}). Upgrade for more space.` }, { status: 413 })
  } catch { /* accounting/limits are best-effort — never block a legit upload on their failure */ }

  // Key MUST match the presign route's scheme so signed-url / library lookups line up.
  const key = `${userId}/${mediaId}${ext}`
  try {
    await putObject(key, buf, contentType)
  } catch (e) {
    return Response.json({ error: `Storage write failed: ${String(e)}` }, { status: 502 })
  }

  // Account for it AFTER the write succeeds (unlike presign, which logs
  // optimistically), deduped by key so re-uploads don't accumulate.
  try {
    await ensureUploadLog()
    await sql`DELETE FROM upload_log WHERE user_id = ${userId} AND key = ${key}`
    await sql`INSERT INTO upload_log (user_id, key, size) VALUES (${userId}, ${key}, ${buf.byteLength})`
  } catch { /* accounting is best-effort */ }

  return Response.json({ key })
}
