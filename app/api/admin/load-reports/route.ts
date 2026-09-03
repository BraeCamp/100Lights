import { isAdmin } from '@/lib/admin-auth'
import { listLoadReports } from '@/lib/load-reports-db'

export const runtime = 'nodejs'

// GET /api/admin/load-reports — how songs are actually loading, in the field.
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'Not allowed' }, { status: 403 })
  return Response.json(await listLoadReports(150))
}
