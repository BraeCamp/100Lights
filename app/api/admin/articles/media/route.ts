import { isAdmin } from '@/lib/admin-auth'
import { putObject, deleteObject, listAllObjects } from '@/lib/r2'

export const runtime = 'nodejs'
export const maxDuration = 60

// Admin-only: upload an article image or video. Bytes are sent to THIS route
// and pushed to R2 server-side — no browser→R2 PUT, so no cross-origin
// CORS/CSP to fail on (same rationale as the article-audio route). Files live
// under learn-media/, the only prefix the public /api/learn-media route serves.
const IMAGE_MAX = 15 * 1024 * 1024   // 15 MB — screenshots, diagrams
const VIDEO_MAX = 64 * 1024 * 1024   // 64 MB — short screen recordings; longer clips belong on YouTube

// Extension per MIME so the stored key + downloaded file are sensible. SVG is
// intentionally excluded — it can carry script and is served from R2, so it's
// dropped as cheap hardening; convert diagrams to PNG/WebP before uploading.
const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
}

export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })

  const type = req.headers.get('content-type') || ''
  const isImage = type.startsWith('image/')
  const isVideo = type.startsWith('video/')
  if (!isImage && !isVideo) {
    return Response.json({ error: `Images or video only (got "${type || 'no type'}")` }, { status: 400 })
  }
  if (type === 'image/svg+xml') {
    return Response.json({ error: 'SVG is not supported — export the diagram as PNG or WebP first.' }, { status: 415 })
  }

  const name = (new URL(req.url).searchParams.get('name') || (isVideo ? 'video' : 'image'))
    .replace(/[^\w.-]+/g, '_').slice(0, 80)
  const buf = await req.arrayBuffer()
  if (buf.byteLength === 0) return Response.json({ error: 'Empty upload' }, { status: 400 })

  const max = isVideo ? VIDEO_MAX : IMAGE_MAX
  if (buf.byteLength > max) {
    const mb = Math.round(max / 1024 / 1024)
    return Response.json({
      error: isVideo
        ? `Video too large (max ${mb} MB). For longer clips, upload to YouTube and use @video(link).`
        : `Image too large (max ${mb} MB).`,
    }, { status: 413 })
  }

  const ext = EXT[type] ?? (isVideo ? 'mp4' : 'png')
  const key = `learn-media/${crypto.randomUUID()}-${name}.${ext}`
  try {
    await putObject(key, buf, type)
  } catch (e) {
    return Response.json({ error: `R2 upload failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }
  return Response.json({ key, url: `/api/learn-media?key=${encodeURIComponent(key)}`, kind: isVideo ? 'video' : 'image' })
}

export interface MediaFile { name: string; url: string; bytes: number; kind: 'image' | 'video'; key: string }

// GET /api/admin/articles/media — every uploaded image/video (there was no list
// before, so orphaned learn-media objects were invisible and unbounded).
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  let files: MediaFile[] = []
  try {
    files = (await listAllObjects('learn-media/')).map(o => {
      const name = o.key.slice('learn-media/'.length)
      const isVideo = /\.(mp4|webm|mov)$/i.test(name)
      return { name, url: `/api/learn-media?key=${encodeURIComponent(o.key)}`, bytes: o.size, kind: isVideo ? 'video' : 'image', key: o.key }
    })
  } catch { /* R2 unreachable — return empty */ }
  files.sort((a, b) => a.name.localeCompare(b.name))
  return Response.json({ files })
}

// DELETE /api/admin/articles/media?key=learn-media/… — remove an orphaned asset.
export async function DELETE(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const key = new URL(req.url).searchParams.get('key')
  if (!key || !key.startsWith('learn-media/') || key.includes('..')) {
    return Response.json({ error: 'Invalid key' }, { status: 400 })
  }
  try {
    await deleteObject(key)
  } catch (e) {
    return Response.json({ error: `Delete failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }
  return Response.json({ ok: true })
}
