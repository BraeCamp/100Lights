import { isAdmin } from '@/lib/admin-auth'
import { putObject, deleteObject } from '@/lib/r2'
import { addCatalog, listCatalog, updateCatalog, deleteCatalog } from '@/lib/catalog'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB — samples are short

const num = (v: string | null): number | undefined => {
  if (v == null || v === '') return undefined
  const n = Number(v); return Number.isFinite(n) ? n : undefined
}

// GET — admin view of the catalog (with R2 keys + preview URLs).
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const rows = await listCatalog()
  return Response.json({
    items: rows.map(r => ({ ...r, url: `/api/catalog/audio?key=${encodeURIComponent(r.r2Key)}` })),
  })
}

// POST — upload a sample's bytes to R2 and register it in the catalog. Metadata
// rides on the query string; the body is the raw audio.
export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const type = req.headers.get('content-type') || 'audio/mpeg'
  if (!/^audio\//.test(type)) return Response.json({ error: `Audio files only (got "${type}")` }, { status: 400 })

  const p = new URL(req.url).searchParams
  const rawName = (p.get('name') || 'sound').trim()
  if (!rawName) return Response.json({ error: 'name required' }, { status: 400 })
  const buf = await req.arrayBuffer()
  if (buf.byteLength === 0) return Response.json({ error: 'Empty upload' }, { status: 400 })
  if (buf.byteLength > MAX_BYTES) return Response.json({ error: 'File too large (max 25 MB)' }, { status: 413 })

  const ext = type.includes('wav') ? 'wav' : type.includes('webm') ? 'webm' : type.includes('ogg') ? 'ogg' : type.includes('mp4') || type.includes('m4a') ? 'm4a' : 'mp3'
  const id = crypto.randomUUID()
  const safe = rawName.replace(/[^\w.-]+/g, '_').slice(0, 60)
  const r2Key = `catalog/${id}-${safe}.${ext}`
  try {
    await putObject(r2Key, buf, type)
  } catch (e) {
    return Response.json({ error: `R2 upload failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }

  const tags = (p.get('tags') || '').split(',').map(t => t.trim()).filter(Boolean)
  await addCatalog({
    id, name: rawName, category: p.get('category') || 'custom', r2Key,
    duration: num(p.get('duration')) ?? 0, contentType: type,
    folder: p.get('folder') || undefined, parentFolder: p.get('parentFolder') || undefined,
    tags: tags.length ? tags : undefined, key: p.get('key') || undefined, bpm: num(p.get('bpm')),
  })
  await logAdmin('catalog.add', id, { name: rawName, category: p.get('category') || 'custom' })
  return Response.json({ ok: true, id })
}

// PATCH — edit a catalog entry's metadata. { id, name, category, folder?, tags?, key?, bpm? }
export async function PATCH(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const b = await req.json().catch(() => ({})) as { id?: string; name?: string; category?: string; folder?: string | null; tags?: string[] | null; key?: string | null; bpm?: number | null }
  if (!b.id || !b.name || !b.category) return Response.json({ error: 'id, name, category required' }, { status: 400 })
  const ok = await updateCatalog(b.id, { name: b.name, category: b.category, folder: b.folder ?? null, tags: b.tags ?? null, key: b.key ?? null, bpm: b.bpm ?? null })
  if (!ok) return Response.json({ error: 'Not found' }, { status: 404 })
  await logAdmin('catalog.update', b.id, { name: b.name })
  return Response.json({ ok: true })
}

// DELETE ?id= — remove from the catalog and drop its R2 object.
export async function DELETE(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const r2Key = await deleteCatalog(id)
  if (!r2Key) return Response.json({ error: 'Not found' }, { status: 404 })
  try { await deleteObject(r2Key) } catch { /* row already gone; storage reconciles */ }
  await logAdmin('catalog.delete', id)
  return Response.json({ ok: true })
}
