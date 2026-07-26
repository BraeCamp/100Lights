import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { buildClipProjectFile } from '@/lib/article-audio-project'
import { CLIP_IDS } from '@/lib/demo-audio'
import { logAdmin } from '@/lib/admin-audit'
import { currentUser } from '@clerk/nextjs/server'

export const runtime = 'nodejs'

// GET — every demo clip and whether a studio project has been generated for it.
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const existing = new Set<string>()
  try {
    const rows = await sql`SELECT id FROM projects WHERE id LIKE 'article-audio-%' AND deleted_at IS NULL`
    for (const r of rows) existing.add(String(r.id).replace('article-audio-', ''))
  } catch { /* projects table shape differs */ }
  return Response.json({ clips: CLIP_IDS.map(id => ({ id, projectId: existing.has(id) ? `article-audio-${id}` : null })) })
}

// POST /api/admin/articles/audio/project { clipId } — generate a multi-track
// DawProject for a demo clip and save it as a project the admin owns, so it
// opens in the real studio (/projects/<id>) as separated, editable tracks.
// Idempotent per clip: re-generating replaces the previous one for that clip.
export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const { clipId } = await req.json().catch(() => ({})) as { clipId?: string }
  if (!clipId || !(CLIP_IDS as readonly string[]).includes(clipId)) {
    return Response.json({ error: 'A valid clip id is required' }, { status: 400 })
  }

  const owner = (await currentUser().catch(() => null))?.id ?? 'admin'
  const file = buildClipProjectFile(clipId)
  const stableId = `article-audio-${clipId}`   // one project per clip, re-generatable
  file.id = stableId
  const name = file.name

  try {
    await sql`
      INSERT INTO projects (id, user_id, name, saved_at, data)
      VALUES (${stableId}, ${owner}, ${name}, NOW(), ${JSON.stringify(file) as unknown as object})
      ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, name = EXCLUDED.name, saved_at = NOW(), data = EXCLUDED.data, deleted_at = NULL`
  } catch (e) {
    return Response.json({ error: `Save failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 500 })
  }

  const trackNames = file.dawProject.tracks.map(t => t.name)
  await logAdmin('article.audio.project', clipId, { projectId: stableId, tracks: trackNames })
  return Response.json({ ok: true, clipId, projectId: stableId, url: `/projects/${stableId}`, tracks: trackNames })
}
