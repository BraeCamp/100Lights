import { isAdmin } from '@/lib/admin-auth'
import { stageCounts } from '@/lib/lifecycle'

export const runtime = 'nodejs'

// GET /api/admin/lifecycle — how the whole user base splits across lifecycle
// stages, for the pipeline visualization in the Users panel.
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  return Response.json({ counts: await stageCounts() })
}
