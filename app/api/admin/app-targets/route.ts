import { isAdmin } from '@/lib/admin-auth'
import { putObject, deleteObject, presignDownload } from '@/lib/r2'
import { addTarget, listTargets, updateTarget, deleteTarget, getTarget, exportTargets } from '@/lib/app-targets'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB — reference clips are short

const num = (v: string | null): number | undefined => {
  if (v == null || v === '') return undefined
  const n = Number(v); return Number.isFinite(n) ? n : undefined
}
const parseTags = (v: string | null): string[] =>
  (v || '').split(',').map(t => t.trim()).filter(Boolean)

// GET                — list all targets (each with a play URL for its clip)
// GET ?download=<id> — presigned R2 URL so the panel can play a reference clip
// GET ?export=1      — JSON dump for the Node pipeline bridge (compose/ML)
export async function GET(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const p = new URL(req.url).searchParams

  const download = p.get('download')
  if (download) {
    const t = await getTarget(download)
    if (!t || !t.r2Key) return Response.json({ error: 'No audio for this target' }, { status: 404 })
    try {
      const url = await presignDownload(t.r2Key)
      return Response.json({ url })
    } catch (e) {
      return Response.json({ error: `Presign failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
    }
  }

  if (p.get('export')) {
    return Response.json(await exportTargets())
  }

  const rows = await listTargets()
  return Response.json({
    items: rows.map(r => ({
      ...r,
      // A convenience play URL the panel can hit for the presigned clip.
      audioUrl: r.r2Key ? `/api/admin/app-targets?download=${encodeURIComponent(r.id)}` : null,
    })),
  })
}

// POST — add a target. Two shapes:
//   • audio/*        → body is the raw reference clip; metadata rides the query string
//   • application/json → descriptors only (no reference clip)
export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const type = req.headers.get('content-type') || ''

  // ── Descriptor-only target (JSON body) ─────────────────────────────
  if (/^application\/json/.test(type)) {
    const b = await req.json().catch(() => ({})) as {
      label?: string; category?: string; description?: string; tags?: string[]; appSlug?: string | null
    }
    const label = (b.label || '').trim()
    if (!label) return Response.json({ error: 'label required' }, { status: 400 })
    const id = crypto.randomUUID()
    await addTarget({
      id, label, category: (b.category || 'app').trim(), description: b.description || '',
      tags: Array.isArray(b.tags) ? b.tags.map(t => String(t).trim()).filter(Boolean) : [],
      appSlug: b.appSlug || null,
    })
    await logAdmin('target.add', id, { label, category: b.category || 'app', hasAudio: false })
    return Response.json({ ok: true, id })
  }

  // ── Reference-audio target (raw audio body + query-string metadata) ─
  if (!/^audio\//.test(type)) {
    return Response.json({ error: `Send audio/* bytes or application/json descriptors (got "${type || 'none'}")` }, { status: 400 })
  }
  const p = new URL(req.url).searchParams
  const label = (p.get('label') || '').trim()
  if (!label) return Response.json({ error: 'label required' }, { status: 400 })
  const buf = await req.arrayBuffer()
  if (buf.byteLength === 0) return Response.json({ error: 'Empty upload' }, { status: 400 })
  if (buf.byteLength > MAX_BYTES) return Response.json({ error: 'File too large (max 25 MB)' }, { status: 413 })

  const ext = type.includes('wav') ? 'wav' : type.includes('webm') ? 'webm' : type.includes('ogg') ? 'ogg' : type.includes('mp4') || type.includes('m4a') ? 'm4a' : 'mp3'
  const id = crypto.randomUUID()
  const safe = label.replace(/[^\w.-]+/g, '_').slice(0, 60)
  const r2Key = `targets/${id}-${safe}.${ext}`
  try {
    await putObject(r2Key, buf, type)
  } catch (e) {
    return Response.json({ error: `R2 upload failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }

  await addTarget({
    id, label, category: (p.get('category') || 'app').trim(), description: p.get('description') || '',
    r2Key, contentType: type, duration: num(p.get('duration')) ?? null,
    tags: parseTags(p.get('tags')), appSlug: p.get('appSlug') || null,
  })
  await logAdmin('target.add', id, { label, category: p.get('category') || 'app', hasAudio: true })
  return Response.json({ ok: true, id })
}

// PATCH / PUT — edit a target's descriptors. { id, label, category, description, tags?, appSlug? }
async function edit(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({})) as {
    id?: string; label?: string; category?: string; description?: string; tags?: string[] | null; appSlug?: string | null
  }
  if (!b.id || !b.label) return Response.json({ error: 'id, label required' }, { status: 400 })
  const ok = await updateTarget(b.id, {
    label: b.label, category: b.category || 'app', description: b.description || '',
    tags: b.tags ?? null, appSlug: b.appSlug ?? null,
  })
  if (!ok) return Response.json({ error: 'Not found' }, { status: 404 })
  await logAdmin('target.update', b.id, { label: b.label })
  return Response.json({ ok: true })
}
export const PATCH = edit
export const PUT = edit

// DELETE ?id= — remove the target and drop its R2 object (if it had one).
export async function DELETE(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { found, r2Key } = await deleteTarget(id)
  if (!found) return Response.json({ error: 'Not found' }, { status: 404 })
  if (r2Key) { try { await deleteObject(r2Key) } catch { /* row already gone; storage reconciles */ } }
  await logAdmin('target.delete', id)
  return Response.json({ ok: true })
}
