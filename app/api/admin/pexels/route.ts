// Admin API for the tagged Pexels background catalog (curated in /admin/lightning-bug).
//   GET    ?q=&status=&category=&limit=&offset=   → list rows (+ total active count)
//   POST   { query?, category?, count?, page?, random? }  → fetch from Pexels, tag, insert
//   PATCH  { id, title?, category?, brightness?, speed?, tags?, status? }  → correct a row
//   DELETE ?id=<id>                                → remove a row
import { isAdmin } from '@/lib/admin-auth'
import { list, insertMany, patchRow, remove, countActive } from '@/lib/pexels-bg'
import { fetchAndTag, QUERY_POOL } from '@/lib/pexels-source'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const p = new URL(req.url).searchParams
  const rows = await list({
    q: p.get('q') ?? undefined,
    status: p.get('status') ?? 'any',
    category: p.get('category') ?? undefined,
    brightness: p.get('brightness') ?? undefined,
    speed: p.get('speed') ?? undefined,
    limit: p.get('limit') ? Number(p.get('limit')) : 80,
    offset: p.get('offset') ? Number(p.get('offset')) : 0,
  })
  return Response.json({ rows, total: await countActive() })
}

export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { query?: string; category?: string; count?: number; page?: number; random?: boolean }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  let query = body.query?.trim()
  let category = body.category
  if (body.random || !query) {
    const pick = QUERY_POOL[Math.floor(Math.random() * QUERY_POOL.length)]
    query = pick.q; category = category || pick.category
  }
  const page = body.page ?? (body.random ? 1 + Math.floor(Math.random() * 5) : 1)
  try {
    const rows = await fetchAndTag({ query: query!, category, count: body.count ?? 15, page })
    const added = await insertMany(rows)
    return Response.json({ ok: true, query, category, fetched: rows.length, added })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Fetch failed' }, { status: 502 })
  }
}

export async function PATCH(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { id?: string; title?: string; category?: string; brightness?: string; speed?: string; tags?: string[]; status?: string; blockEdits?: string[] }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.id) return Response.json({ error: 'Missing id' }, { status: 400 })
  await patchRow(body.id, {
    title: body.title, category: body.category,
    brightness: body.brightness as 'bright' | 'mid' | 'dark' | undefined,
    speed: body.speed as 'fast' | 'standard' | 'slow' | undefined,
    tags: body.tags, status: body.status as 'active' | 'hidden' | undefined,
    blockEdits: body.blockEdits,
  })
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })
  await remove(id)
  return Response.json({ ok: true })
}
