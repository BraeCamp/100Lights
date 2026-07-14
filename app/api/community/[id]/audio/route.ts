import { sql } from '@/lib/db'
import { presignDownload } from '@/lib/r2'

export const runtime = 'nodejs'

// Public audio can be hot-linked from anywhere, and every play is R2 egress.
// Two guards: edge-cache the redirect so repeat plays reuse it, and cap the
// daily streams per item so one viral link can't run up the bill unnoticed.
const DAILY_STREAM_CAP = 10_000

let streamLogReady = false
async function ensureStreamLog() {
  if (streamLogReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS community_stream_log (
      item_id UUID NOT NULL,
      day DATE NOT NULL,
      count INT NOT NULL DEFAULT 0,
      PRIMARY KEY (item_id, day)
    )
  `
  streamLogReady = true
}

// GET /api/community/:id/audio[?i=n] — public streaming for community audio.
// Community items are deliberately public, so no session is required: the
// route resolves the item's R2 key (or the n-th sample of a pack) and
// redirects to a short-lived signed URL.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const rows = await sql`SELECT kind, r2_key, payload FROM community_items WHERE id = ${id}`
  if (rows.length === 0) return Response.json({ error: 'Not found' }, { status: 404 })

  const { kind, r2_key, payload } = rows[0] as { kind: string; r2_key: string | null; payload: { samples?: Array<{ r2Key?: string }> } | null }
  let key = r2_key
  if (kind === 'pack') {
    const i = Math.max(0, parseInt(new URL(req.url).searchParams.get('i') ?? '0', 10) || 0)
    key = payload?.samples?.[i]?.r2Key ?? null
  }
  if (!key) return Response.json({ error: 'No audio' }, { status: 404 })

  try {
    await ensureStreamLog()
    const day = new Date().toISOString().slice(0, 10)
    const counted = await sql`
      INSERT INTO community_stream_log (item_id, day, count) VALUES (${id}, ${day}, 1)
      ON CONFLICT (item_id, day) DO UPDATE SET count = community_stream_log.count + 1
      RETURNING count
    `
    if ((counted[0]?.count as number ?? 0) > DAILY_STREAM_CAP) {
      return Response.json({ error: 'This item is very popular today — try again tomorrow' }, { status: 429 })
    }
  } catch { /* metering is best-effort */ }

  const url = await presignDownload(key, 3600)
  // Manual 302 — Response.redirect() headers are immutable. Repeat plays
  // within 10 minutes reuse the same signed URL from the edge (the URL
  // itself stays valid for an hour).
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=600',
    },
  })
}
