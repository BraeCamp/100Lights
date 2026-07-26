import { buildDigest, digestHtml, digestText } from '@/lib/digest'
import { emailEnabled, sendEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/cron/digest — scheduled founder digest email. Wire it in vercel.json
// (e.g. weekly Mondays 13:00 UTC). Protected by CRON_SECRET: Vercel Cron sends
// `Authorization: Bearer <CRON_SECRET>`. Dormant until both RESEND_API_KEY and
// DIGEST_TO (recipient) are set — a no-op otherwise, never an error.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 })
  }
  const to = process.env.DIGEST_TO
  if (!emailEnabled() || !to) {
    return Response.json({ ok: false, skipped: true, reason: 'email or DIGEST_TO not configured' })
  }
  const d = await buildDigest()
  const ok = await sendEmail({ to, subject: `100Lights weekly brief — ${new Date().toLocaleDateString()}`, html: digestHtml(d), text: digestText(d) })
  return Response.json({ ok })
}
