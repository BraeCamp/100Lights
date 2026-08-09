import { isAdmin } from '@/lib/admin-auth'
import { deleteObject, presignDownload, putObject } from '@/lib/r2'
import {
  addCorrection, listCorrections, updateCorrection, deleteCorrection, getCorrection,
  exportCorrections, pcmBase64ToWav, type CorrectionRow,
} from '@/lib/voice-corrections-db'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'
export const maxDuration = 60

// GET                — list every correction (each with a presign-backed audioUrl)
// GET ?download=<id> — presigned R2 URL so the panel can play a take's WAV
// GET ?export=1      — full JSON dump incl. owner comments (the AI's read path)
export async function GET(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const p = new URL(req.url).searchParams

  const download = p.get('download')
  if (download) {
    const c = await getCorrection(download)
    if (!c || !c.r2Key) return Response.json({ error: 'No audio for this correction' }, { status: 404 })
    try {
      const url = await presignDownload(c.r2Key)
      return Response.json({ url })
    } catch (e) {
      return Response.json({ error: `Presign failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
    }
  }

  if (p.get('export')) {
    return Response.json(await exportCorrections())
  }

  const rows = await listCorrections()
  return Response.json({
    items: rows.map(r => ({
      ...r,
      audioUrl: r.r2Key ? `/api/admin/voice-corrections?download=${encodeURIComponent(r.id)}` : null,
    })),
  })
}

// PATCH — owner edits: { id, comment?, status? }. Comment = "what to fix in
// detection/rendering"; status ∈ new | reviewed | fixed.
export async function PATCH(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({})) as { id?: string; comment?: string; status?: string }
  if (!b.id) return Response.json({ error: 'id required' }, { status: 400 })
  if (b.comment === undefined && b.status === undefined) return Response.json({ error: 'nothing to update' }, { status: 400 })
  const status = b.status !== undefined
    ? (['new', 'reviewed', 'fixed'].includes(b.status) ? b.status : undefined)
    : undefined
  if (b.status !== undefined && status === undefined) return Response.json({ error: 'bad status' }, { status: 400 })
  const ok = await updateCorrection(b.id, {
    comment: b.comment !== undefined ? String(b.comment).slice(0, 4000) : undefined,
    status,
  })
  if (!ok) return Response.json({ error: 'Not found' }, { status: 404 })
  await logAdmin('correction.comment', b.id, { status, hasComment: b.comment !== undefined })
  return Response.json({ ok: true })
}

// DELETE ?id= — drop the take audio from R2 (if any) and the row.
export async function DELETE(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const { found, r2Key } = await deleteCorrection(id)
  if (!found) return Response.json({ error: 'Not found' }, { status: 404 })
  if (r2Key) { try { await deleteObject(r2Key) } catch { /* row already gone; storage reconciles */ } }
  await logAdmin('correction.delete', id)
  return Response.json({ ok: true })
}

// POST (admin) — IMPORT an exported corrections JSON file (bulk insert). Secondary
// path to the public submit route: lets the owner load a dataset a user exported
// locally (the client's Export button) straight into the reviewable store.
export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({})) as { corrections?: unknown }
  const list = Array.isArray(b.corrections) ? b.corrections : null
  if (!list) return Response.json({ error: 'Expected { corrections: [...] } (an exported dataset)' }, { status: 400 })

  let imported = 0
  for (const raw of list as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') continue
    const id = crypto.randomUUID()
    const audio = (raw.audio && typeof raw.audio === 'object') ? raw.audio as Record<string, unknown> : {}
    const pcmBase64 = typeof audio.pcmBase64 === 'string' ? audio.pcmBase64 : ''
    const sampleRate = typeof audio.sampleRate === 'number' ? audio.sampleRate : 0
    const audioDur = typeof audio.durSec === 'number' ? audio.durSec : null
    let r2Key: string | null = null
    if (pcmBase64 && sampleRate > 0) {
      try {
        const wav = pcmBase64ToWav(pcmBase64, sampleRate)
        const key = `voice-corrections/${id}.wav`
        await putObject(key, wav, 'audio/wav')
        r2Key = key
      } catch { /* keep the structured data without audio */ }
    }
    try {
      await addCorrection({
        id,
        ts: typeof raw.ts === 'number' ? raw.ts : Date.now(),
        appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : '',
        detected: raw.detected ?? [], corrected: raw.corrected ?? [],
        diff: raw.diff ?? {}, evidence: raw.evidence ?? {},
        r2Key, audioSr: sampleRate || null, audioDur,
        settings: raw.settings ?? {},
        comment: typeof raw.comment === 'string' ? raw.comment : '',
        status: 'new',
      })
      imported++
    } catch { /* skip a bad row, keep going */ }
  }
  await logAdmin('correction.import', null, { imported, submitted: list.length })
  return Response.json({ ok: true, imported })
}

export type { CorrectionRow }
