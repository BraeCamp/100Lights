import { auth, clerkClient } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/account/export — a JSON bundle of everything we hold on the signed-in
// user (CCPA/GDPR data-subject "right to access"). Self-serve, no manual work.

async function safe(p: Promise<unknown>): Promise<Record<string, unknown>[]> {
  try { return (await p) as Record<string, unknown>[] } catch { return [] }
}

// Projects carry large audio/arrangement blobs; keep the export lightweight by
// omitting object fields (full project files are downloadable in the studio).
function slim(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(r)) {
    out[k] = (v != null && typeof v === 'object') ? '[omitted — open/export this project in the studio]' : v
  }
  return out
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const user = await (await clerkClient()).users.getUser(userId).catch(() => null)
  const [subscription, projects, community, feedback, redemptions, library] = await Promise.all([
    safe(sql`SELECT * FROM subscriptions WHERE user_id = ${userId}`),
    safe(sql`SELECT * FROM projects WHERE user_id = ${userId}`),
    safe(sql`SELECT * FROM community_items WHERE user_id = ${userId}`),
    safe(sql`SELECT * FROM feedback WHERE user_id = ${userId}`),
    safe(sql`SELECT * FROM code_redemptions WHERE user_id = ${userId}`),
    safe(sql`SELECT * FROM user_sounds WHERE user_id = ${userId}`),
  ])

  const bundle = {
    exportedAt: new Date().toISOString(),
    profile: user ? {
      id: user.id,
      email: user.emailAddresses?.[0]?.emailAddress ?? null,
      username: user.username ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
    } : { id: userId },
    subscription: subscription[0] ?? null,
    projects: projects.map(slim),
    communityPosts: community,
    feedback,
    codeRedemptions: redemptions,
    soundLibrary: library,
  }

  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="100lights-my-data.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
