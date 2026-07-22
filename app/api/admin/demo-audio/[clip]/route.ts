import { isAdmin } from '@/lib/admin-auth'
import { saveOverride, deleteOverride } from '@/lib/demo-audio-store'
import { CLIP_IDS } from '@/lib/demo-audio'

export const runtime = 'nodejs'

const MAX_BYTES = 12 * 1024 * 1024 // 12 MB — plenty for a short demo clip

// Upload a replacement audio file for a clip (raw body = the file).
export async function POST(req: Request, { params }: { params: Promise<{ clip: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { clip } = await params
  if (!(CLIP_IDS as readonly string[]).includes(clip)) return Response.json({ error: 'Unknown clip' }, { status: 404 })

  const contentType = req.headers.get('content-type') || 'audio/mpeg'
  if (!/^audio\//.test(contentType)) return Response.json({ error: 'Expected an audio file' }, { status: 400 })

  const buf = Buffer.from(await req.arrayBuffer())
  if (buf.length === 0) return Response.json({ error: 'Empty file' }, { status: 400 })
  if (buf.length > MAX_BYTES) return Response.json({ error: 'File too large (max 12 MB)' }, { status: 400 })

  await saveOverride(clip, buf, contentType)
  return Response.json({ ok: true, clip, bytes: buf.length })
}

// Revert to the generated clip.
export async function DELETE(_req: Request, { params }: { params: Promise<{ clip: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { clip } = await params
  await deleteOverride(clip)
  return Response.json({ ok: true, clip })
}
