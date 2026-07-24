// Transactional email — DORMANT until a provider key is set. With no
// RESEND_API_KEY in the environment, every call is a silent no-op, so the app
// runs unchanged today; add the key (+ optional EMAIL_FROM) to turn it on.
//
// Uses Resend's HTTP API directly (no SDK dependency). Swap the provider by
// editing sendEmail() only.

export function emailEnabled(): boolean {
  return !!process.env.RESEND_API_KEY
}

const FROM = process.env.EMAIL_FROM ?? '100Lights <notifications@100lights.com>'

export async function sendEmail(opts: { to: string; subject: string; html: string; text?: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key || !opts.to) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Resolve a Clerk user's email and send them a "new comment" notification.
 *  Safe to call unconditionally — no-ops when email is disabled. Intended to run
 *  after the response via next/server `after()` so it never slows the request. */
export async function sendCommentEmail(ownerUserId: string, actorName: string, itemName: string, itemId: string): Promise<void> {
  if (!emailEnabled()) return
  try {
    const { clerkClient } = await import('@clerk/nextjs/server')
    const client = await clerkClient()
    const user = await client.users.getUser(ownerUserId)
    const to = user.emailAddresses?.[0]?.emailAddress
    if (!to) return
    const url = `https://100lights.com/community/${itemId}`
    const safeName = itemName.replace(/[<>&]/g, '')
    await sendEmail({
      to,
      subject: `${actorName} commented on “${safeName}”`,
      text: `${actorName} commented on your share “${safeName}”.\n\nRead it: ${url}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px">
        <p style="font-size:15px;color:#111"><strong>${actorName}</strong> commented on your share <strong>${safeName}</strong>.</p>
        <p><a href="${url}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#8b5cf6;color:#fff;text-decoration:none;font-weight:600">Read the comment →</a></p>
        <p style="font-size:12px;color:#888">100Lights Community</p>
      </div>`,
    })
  } catch { /* best-effort */ }
}
