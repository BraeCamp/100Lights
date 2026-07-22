import { isAdmin } from '@/lib/admin-auth'
import { putObject } from '@/lib/r2'

export const runtime = 'nodejs'
export const maxDuration = 60

// Admin-only: upload an article image or video. Bytes are sent to THIS route
// and pushed to R2 server-side — no browser→R2 PUT, so no cross-origin
// CORS/CSP to fail on (same rationale as the article-audio route). Files live
// under learn-media/, the only prefix the public /api/learn-media route serves.
const IMAGE_MAX = 15 * 1024 * 1024   // 15 MB — screenshots, diagrams
const VIDEO_MAX = 64 * 1024 * 1024   // 64 MB — short screen recordings; longer clips belong on YouTube

// Extension per MIME so the stored key + downloaded file are sensible.
const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg',
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
