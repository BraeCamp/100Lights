import { sql } from '@/lib/db'
import { presignDownload } from '@/lib/r2'

export const runtime = 'nodejs'

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

  const url = await presignDownload(key, 3600)
  return Response.redirect(url, 302)
}
