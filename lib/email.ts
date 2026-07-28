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

/** Loosely validate that a contact string is an email (applicants may instead
 *  give a social handle, which we can't email). */
export function looksLikeEmail(s: string | null | undefined): boolean {
  return !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

/** Welcome + onboarding email for a freshly approved affiliate: their referral
 *  link, the deal, and how to share. Returns true only if it was actually sent
 *  (email enabled + a real email address). Best-effort — never throws. */
export async function sendAffiliateApprovalEmail(input: {
  to: string; name: string; code: string
  commissionPct: number; commissionMonths: number | null; perkDays: number
}): Promise<boolean> {
  if (!emailEnabled() || !looksLikeEmail(input.to)) return false
  const link = `https://100lights.com/?ref=${input.code}`
  const name = input.name.replace(/[<>&]/g, '')
  const months = input.commissionMonths ? `for ${input.commissionMonths} months` : 'for life'
  const deal = `${input.commissionPct}% recurring ${months}`
  try {
    return await sendEmail({
      to: input.to,
      subject: 'You’re in — welcome to the 100Lights Founding Affiliates 🎛️',
      text:
`Welcome to the 100Lights Founding Affiliates, ${name}!

Your referral link: ${link}

Your deal:
- ${deal} on every producer you refer who goes Pro
- Your audience gets ${input.perkDays} days of free Pro when they use your link
- Your ${input.commissionPct}% rate is grandfathered for life

Best ways to share it:
- Show it on screen — make a beat in the browser while your audience follows along
- Pin your link in your description, bio, and a pinned comment
- Run a "make a beat in 60 seconds" challenge with your link in the caption

Every signup and upgrade through your link is tracked; we reconcile and pay out monthly.

Make something great,
The 100Lights team`,
      html:
`<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;color:#1b1922">
  <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7c3aed;font-weight:700;margin:0 0 6px">100Lights · Founding Affiliates</p>
  <h1 style="font-size:22px;line-height:1.25;margin:0 0 12px">You’re in, ${name} 🎛️</h1>
  <p style="font-size:15px;line-height:1.6;color:#3a3550;margin:0 0 18px">Welcome to the founding cohort. Here’s everything you need to start earning.</p>

  <p style="font-size:12px;font-weight:700;color:#7a7590;margin:0 0 6px">YOUR REFERRAL LINK</p>
  <div style="background:#f5f3fb;border:1px solid #e7e2f1;border-radius:10px;padding:14px 16px;margin:0 0 8px">
    <a href="${link}" style="font-family:ui-monospace,Menlo,monospace;font-size:15px;color:#6d28d9;word-break:break-all;text-decoration:none">${link}</a>
  </div>
  <p style="margin:0 0 22px"><a href="${link}" style="display:inline-block;padding:11px 20px;border-radius:9px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700;font-size:14px">Open your link →</a></p>

  <p style="font-size:14px;font-weight:700;margin:0 0 8px">Your deal</p>
  <ul style="font-size:14px;line-height:1.6;color:#3a3550;margin:0 0 20px;padding-left:20px">
    <li><strong>${deal}</strong> on every producer you refer who goes Pro</li>
    <li>Your audience gets <strong>${input.perkDays} days of free Pro</strong> when they use your link</li>
    <li>Your <strong>${input.commissionPct}% rate is grandfathered for life</strong></li>
  </ul>

  <p style="font-size:14px;font-weight:700;margin:0 0 8px">Best ways to share it</p>
  <ul style="font-size:14px;line-height:1.6;color:#3a3550;margin:0 0 20px;padding-left:20px">
    <li><strong>Show it on screen</strong> — make a beat in the browser while your audience follows along.</li>
    <li><strong>Pin your link</strong> in your description, bio, and a pinned comment.</li>
    <li><strong>Run a challenge:</strong> “make a beat in 60 seconds,” link in the caption.</li>
  </ul>

  <p style="font-size:13px;line-height:1.6;color:#7a7590;margin:0 0 4px">Every signup and upgrade through your link is tracked — we reconcile and pay out monthly, so you never have to chase a number.</p>
  <p style="font-size:12px;color:#a5a1b5;margin:18px 0 0">100Lights — the music studio in your browser</p>
</div>`,
    })
  } catch { return false }
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
