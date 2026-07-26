import { isAdmin } from '@/lib/admin-auth'
import { emailEnabled, sendEmail } from '@/lib/email'
import { logAdmin } from '@/lib/admin-audit'
import { addNoteEntry } from '@/lib/user-crm'
import { clerkClient, currentUser } from '@clerk/nextjs/server'

export const runtime = 'nodejs'

// Minimal branded wrapper so a plain-text body still looks intentional.
function wrap(bodyText: string): string {
  const safe = bodyText.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))
  const html = safe.split(/\n{2,}/).map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1a1a1a">${p.replace(/\n/g, '<br/>')}</p>`).join('')
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto">
    ${html}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
    <p style="font-size:12px;color:#999;margin:0">100Lights · <a href="https://100lights.com" style="color:#8b5cf6;text-decoration:none">100lights.com</a></p>
  </div>`
}

// POST /api/admin/users/[userId]/email — send a one-off email to a user from
// their CRM record. The send is logged (audit + a note-log entry) so outreach
// shows up on the account's timeline. No-ops with a clear message until a mail
// provider is configured.
export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { userId } = await params
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })

  const { subject, body } = await req.json().catch(() => ({})) as { subject?: string; body?: string }
  if (!subject?.trim() || !body?.trim()) return Response.json({ error: 'Subject and message are required' }, { status: 400 })
  if (!emailEnabled()) return Response.json({ error: 'Email is not configured (set RESEND_API_KEY)' }, { status: 400 })

  // Resolve the recipient from Clerk.
  let to = ''
  try { to = (await (await clerkClient()).users.getUser(userId)).emailAddresses?.[0]?.emailAddress ?? '' } catch { /* Clerk down */ }
  if (!to) return Response.json({ error: 'No email on this account' }, { status: 400 })

  const sent = await sendEmail({ to, subject: subject.trim(), html: wrap(body.trim()), text: body.trim() })
  if (!sent) return Response.json({ error: 'The mail provider rejected the send' }, { status: 502 })

  const author = (await currentUser().catch(() => null))?.emailAddresses?.[0]?.emailAddress ?? 'admin'
  await Promise.all([
    logAdmin('user.email', userId, { subject: subject.trim() }),
    addNoteEntry(userId, `📧 Emailed “${subject.trim()}”`, author).catch(() => {}),
  ])
  return Response.json({ ok: true, to })
}
