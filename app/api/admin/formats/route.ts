import { isAdmin } from '@/lib/admin-auth'
import { CONTENT_FORMATS, HOOK_TYPES } from '@/lib/content-formats'
import { rankFormats, listPosts } from '@/lib/content-metrics'

export const runtime = 'nodejs'
export const maxDuration = 20

// GET /api/admin/formats — the social-content taxonomy + how each format is
// actually performing. Returns the CONTENT_FORMATS definitions (each format's
// focus: hook + what it's made with), the hook archetypes, the per-format
// performance ranking (content_perf), and the posted-Short corpus (with its
// per-post notes = the "corrections" for what worked/didn't). Read-only.
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })

  const [ranking, posts] = await Promise.all([rankFormats(), listPosts(500)])

  return Response.json({
    formats: CONTENT_FORMATS,
    hookTypes: HOOK_TYPES,
    ranking,
    posts,
    at: new Date().toISOString(),
  })
}
