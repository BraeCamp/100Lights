import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

export interface LibraryMediaItem {
  id: string
  name: string
  contentType: string
  duration: number
  r2Key: string
  thumbnail: string | null
  createdAt: string
}

// GET /api/media/library — list all media for the current user
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rows = await sql`
      SELECT id, name, content_type, duration, r2_key, thumbnail, created_at
      FROM user_media
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `
    return Response.json(rows.map(r => ({
      id:          r.id,
      name:        r.name,
      contentType: r.content_type,
      duration:    r.duration ?? 0,
      r2Key:       r.r2_key,
      thumbnail:   r.thumbnail ?? null,
      createdAt:   r.created_at,
    })))
  } catch {
    // Table may not exist yet — return empty list rather than crashing
    return Response.json([])
  }
}

// POST /api/media/library — register an uploaded media item
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { id: string; name: string; contentType: string; duration?: number; r2Key: string; thumbnail?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.id || !body.name || !body.r2Key) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Ensure the r2Key belongs to this user
  if (!body.r2Key.startsWith(`${userId}/`)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await sql`
      INSERT INTO user_media (id, user_id, name, content_type, duration, r2_key, thumbnail, created_at)
      VALUES (
        ${body.id}, ${userId}, ${body.name}, ${body.contentType ?? ''},
        ${body.duration ?? 0}, ${body.r2Key}, ${body.thumbnail ?? null}, NOW()
      )
      ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            duration = EXCLUDED.duration,
            thumbnail = EXCLUDED.thumbnail
    `
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to register media' }, { status: 500 })
  }
}
