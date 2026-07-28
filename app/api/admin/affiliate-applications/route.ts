import { isAdmin } from '@/lib/admin-auth'
import { listApplications } from '@/lib/affiliates'

export const runtime = 'nodejs'

// GET /api/admin/affiliate-applications — inbound applications, pending first.
export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  return Response.json({ applications: await listApplications() })
}
