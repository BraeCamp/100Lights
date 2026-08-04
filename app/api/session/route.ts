import { auth } from '@clerk/nextjs/server'
import { isAdminEmail } from '@/lib/admin-auth'
import { ingestSession } from '@/lib/session-capture/session-recorder.mjs'
import { DEFAULT_ROOT } from '@/lib/session-capture/config.mjs'

export const runtime = 'nodejs'

// Size guards — a capture session can be large, but not unbounded.
const MAX_CAPTURE = 300 * 1024 * 1024   // 300 MB video
const MAX_AUDIO = 100 * 1024 * 1024     // 100 MB wav
const MAX_STEM = 50 * 1024 * 1024
const MAX_STEMS = 32

const sanitizeName = (s: string, fallback: string) =>
  (s || fallback).replace(/[/\\]+/g, '-').replace(/\.\.+/g, '.').replace(/[^\w.\- ]/g, '').slice(0, 80) || fallback

// POST /api/session — receive a completed browser capture session and write its
// artifact directory to disk atomically. The browser can't write the FS, so it
// POSTs the logs + media here. Admin/DEV_OPEN only (writes to server disk).
export async function POST(req: Request) {
  const allowed = process.env.DEV_OPEN === '1' || (await isAdminEmail())
  if (!allowed) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  await auth() // ensure the request is authenticated context

  let form: FormData
  try { form = await req.formData() } catch { return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 }) }

  const metaRaw = form.get('meta')
  if (typeof metaRaw !== 'string') return Response.json({ error: 'Missing meta' }, { status: 400 })
  let meta: { sessionId?: string; header?: Record<string, unknown>; events?: unknown[]; roi?: unknown[] }
  try { meta = JSON.parse(metaRaw) } catch { return Response.json({ error: 'Invalid meta JSON' }, { status: 400 }) }

  const header = { ...(meta.header ?? {}) } as Record<string, unknown>
  const files: Array<{ name: string; data: Buffer }> = []

  const toBuf = async (f: File) => Buffer.from(await f.arrayBuffer())

  // Video capture (optional).
  const cap = form.get('capture')
  if (cap && typeof cap !== 'string') {
    if (cap.size > MAX_CAPTURE) return Response.json({ error: 'capture too large' }, { status: 413 })
    const ext = cap.type.includes('mp4') ? 'mp4' : 'webm'
    files.push({ name: `capture.${ext}`, data: await toBuf(cap) })
    header.capture = { ...(header.capture as object), path: `capture.${ext}` }
  }

  // Master render (optional).
  const audio = form.get('audio')
  if (audio && typeof audio !== 'string') {
    if (audio.size > MAX_AUDIO) return Response.json({ error: 'audio too large' }, { status: 413 })
    files.push({ name: 'final_mix.wav', data: await toBuf(audio) })
    header.audio = { ...(header.audio as object), path: 'final_mix.wav' }
  }

  // Stems (optional, multiple).
  const stems = form.getAll('stems').filter((s): s is File => typeof s !== 'string').slice(0, MAX_STEMS)
  const stemPaths: string[] = []
  for (let i = 0; i < stems.length; i++) {
    const st = stems[i]
    if (st.size > MAX_STEM) continue
    const name = sanitizeName(st.name, `stem-${i}.wav`)
    const rel = `stems/${name}`
    files.push({ name: rel, data: await toBuf(st) })
    stemPaths.push(rel)
  }
  if (stemPaths.length) header.audio = { ...(header.audio as object), stems: stemPaths }

  const root = process.env.SESSION_CAPTURE_ROOT || DEFAULT_ROOT
  try {
    const dir = ingestSession({ root, sessionId: meta.sessionId, header, events: meta.events ?? [], roi: meta.roi ?? [], files })
    return Response.json({ ok: true, dir })
  } catch (err) {
    // A completed session whose manifest fails validation lands in .failed and
    // throws — surface that as a 422 so the client knows it wasn't accepted clean.
    return Response.json({ error: (err as Error).message }, { status: 422 })
  }
}
