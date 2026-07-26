import { isAdmin } from '@/lib/admin-auth'
import { buildDigest, digestHtml, digestText } from '@/lib/digest'
import { emailEnabled, sendEmail } from '@/lib/email'
import { currentUser } from '@clerk/nextjs/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/admin/digest — the founder brief on demand.
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  return Response.json({ digest: await buildDigest(), emailEnabled: emailEnabled() }, { headers: { 'Cache-Control': 'no-store' } })
}

// POST /api/admin/digest — email the current brief to the signed-in admin.
// No-ops with a clear message when no email provider is configured.
export async function POST() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  if (!emailEnabled()) return Response.json({ error: 'Email is not configured (set RESEND_API_KEY)' }, { status: 400 })
  const user = await currentUser().catch(() => null)
  const to = user?.emailAddresses?.[0]?.emailAddress
  if (!to) return Response.json({ error: 'No email on your account' }, { status: 400 })
  const d = await buildDigest()
  const ok = await sendEmail({ to, subject: `100Lights brief — ${new Date().toLocaleDateString()}`, html: digestHtml(d), text: digestText(d) })
  return Response.json({ ok, to })
}
