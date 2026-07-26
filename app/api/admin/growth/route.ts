import { isAdmin } from '@/lib/admin-auth'
import { buildFunnel, buildCohorts } from '@/lib/growth'

export const runtime = 'nodejs'

// GET /api/admin/growth — the signup→paying funnel and monthly retention cohorts.
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const [funnel, cohorts] = await Promise.all([buildFunnel(), buildCohorts()])
  return Response.json({ funnel, cohorts })
}
