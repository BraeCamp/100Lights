import { isAdmin } from '@/lib/admin-auth'
import { currentUser } from '@clerk/nextjs/server'
import { sendTestEmail } from '@/lib/email'

export const runtime = 'nodejs'

// POST /api/admin/email-test — send a transactional test to the admin's own
// email (or a supplied address) to verify Resend + the sending domain end-to-end.
export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const body = await req.json().catch(() => ({})) as { to?: string }
  const user = await currentUser()
  const to = (body.to?.trim()) || user?.emailAddresses?.[0]?.emailAddress || ''
  const result = await sendTestEmail(to)
  return Response.json({ ...result, to })
}
