import { isAdmin } from '@/lib/admin-auth'
import { presignUpload } from '@/lib/r2'

export const runtime = 'nodejs'

// Presigned direct-to-R2 upload for a rendered video. The browser PUTs the bytes
// straight to storage, so the (multi-MB) video never passes through a serverless
// function — this is what lets the whole flow work on the production deployment
// where request bodies are capped. Admin-only.
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const isMp4 = String(body.contentType || '').includes('mp4')
  const contentType = isMp4 ? 'video/mp4' : 'video/webm'
  const slug = String(body.slug || 'song-video').replace(/[^a-z0-9-]/gi, '-').slice(0, 60) || 'song-video'
  const key = `content/${Date.now()}-${slug}.${isMp4 ? 'mp4' : 'webm'}`
  const uploadUrl = await presignUpload(key, contentType, 900)
  return Response.json({ key, uploadUrl, contentType })
}
