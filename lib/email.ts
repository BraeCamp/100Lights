// Transactional email — DORMANT until a provider key is set. With no
// RESEND_API_KEY in the environment, every call is a silent no-op, so the app
// runs unchanged today; add the key (+ optional EMAIL_FROM) to turn it on.
//
// Uses Resend's HTTP API directly (no SDK dependency). Swap the provider by
// editing sendEmail() only.

import { renderEmail, emailP, emailButton } from '@/lib/email-layout'
import { sql } from '@/lib/db'
import { schemaManaged } from './schema-guard'

export function emailEnabled(): boolean {
  return !!process.env.RESEND_API_KEY
}

// ── Suppression list ─────────────────────────────────────────────────────────
// Addresses that hard-bounced or filed a spam complaint (fed by the Resend
// webhook). We never send to them again — that's what keeps deliverability
// healthy. All best-effort: a DB hiccup never blocks a legitimate send.
let suppressReady = false
async function ensureSuppress(): Promise<void> {
  if (suppressReady || schemaManaged) return
  await sql`CREATE TABLE IF NOT EXISTS email_suppressions (email TEXT PRIMARY KEY, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  suppressReady = true
}
const normalizeEmail = (e: string) => (e || '').trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, '$1')

export async function suppressEmail(email: string, reason: string): Promise<void> {
  const e = normalizeEmail(email)
  if (!e) return
  try {
    await ensureSuppress()
    await sql`INSERT INTO email_suppressions (email, reason) VALUES (${e}, ${reason}) ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason`
  } catch { /* non-critical */ }
}

export async function isSuppressed(email: string): Promise<boolean> {
  try {
    await ensureSuppress()
    const r = await sql`SELECT 1 FROM email_suppressions WHERE email = ${normalizeEmail(email)}`
    return r.length > 0
  } catch { return false }
}

const FROM = process.env.EMAIL_FROM ?? '100Lights <notifications@100lights.com>'
// Where replies land. The from-address may be a send-only subdomain, so route
// replies to a real, monitored Workspace inbox.
const REPLY_TO = process.env.EMAIL_REPLY_TO ?? 'notifications@100lights.com'

// ── Sender identities ────────────────────────────────────────────────────────
// Different kinds of mail send from different aliases. Every alias lives on the
// same verified send-domain (parsed from EMAIL_FROM), and replies route to the
// matching real Workspace inbox on the reply-domain (parsed from EMAIL_REPLY_TO)
// — so the whole registry follows you automatically if you change domains.
function domainOf(addr: string, fallback: string): string {
  const m = addr.match(/@([^\s>]+)/)
  return m ? m[1] : fallback
}
const SEND_DOMAIN = domainOf(FROM, '100lights.com')       // e.g. send.100lights.com
const REPLY_DOMAIN = domainOf(REPLY_TO, '100lights.com')  // e.g. 100lights.com

export type SenderRole = 'default' | 'partnerships' | 'dmca' | 'support'

const SENDER_TABLE: Record<SenderRole, { name: string; local: string }> = {
  default:      { name: '100Lights',              local: 'notifications' },
  partnerships: { name: '100Lights Partnerships', local: 'partnerships' },
  dmca:         { name: '100Lights',              local: 'dmca' },
  support:      { name: '100Lights Support',      local: 'support' },
}

function sender(role: SenderRole): { from: string; replyTo: string } {
  const s = SENDER_TABLE[role] ?? SENDER_TABLE.default
  return { from: `${s.name} <${s.local}@${SEND_DOMAIN}>`, replyTo: `${s.local}@${REPLY_DOMAIN}` }
}

export async function sendEmail(opts: {
  to: string; subject: string; html: string; text?: string
  role?: SenderRole; from?: string; replyTo?: string
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key || !opts.to) return false
  if (await isSuppressed(opts.to)) return false // hard-bounced or complained
  const s = opts.role ? sender(opts.role) : null
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: opts.from ?? s?.from ?? FROM,
        to: opts.to, subject: opts.subject, html: opts.html, text: opts.text,
        reply_to: opts.replyTo ?? s?.replyTo ?? REPLY_TO,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Send a test email and return a detailed result (for the admin verifier). */
export async function sendTestEmail(to: string): Promise<{ ok: boolean; enabled: boolean; from: string; error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, enabled: false, from: FROM, error: 'RESEND_API_KEY not set.' }
  if (!to) return { ok: false, enabled: true, from: FROM, error: 'No recipient email on your account.' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to, reply_to: REPLY_TO,
        subject: '100Lights email test ✓',
        text: `This is a test from 100Lights, sent from ${FROM}. If you got this, transactional email is working.`,
        html: renderEmail({
          heading: '✓ Transactional email is working',
          preheader: 'Your 100Lights email setup is live',
          bodyHtml: emailP('If you’re reading this, sending is configured correctly and the branded layout renders.') + emailP(`<span style="font-size:13px;color:#7a7590">Sent from <strong>${FROM}</strong> · replies go to ${REPLY_TO}</span>`),
        }),
      }),
    })
    if (res.ok) return { ok: true, enabled: true, from: FROM }
    const body = await res.text().catch(() => '')
    return { ok: false, enabled: true, from: FROM, error: `Resend ${res.status}: ${body.slice(0, 300)}` }
  } catch (e) {
    return { ok: false, enabled: true, from: FROM, error: e instanceof Error ? e.message : 'Request failed' }
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
  taxToken?: string | null
}): Promise<boolean> {
  if (!emailEnabled() || !looksLikeEmail(input.to)) return false
  const link = `https://100lights.com/?ref=${input.code}`
  const taxLink = input.taxToken ? `https://100lights.com/creators/tax/${input.taxToken}` : null
  const name = input.name.replace(/[<>&]/g, '')
  const months = input.commissionMonths ? `for ${input.commissionMonths} months` : 'for life'
  const deal = `${input.commissionPct}% recurring ${months}`
  try {
    return await sendEmail({
      to: input.to,
      role: 'partnerships',
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
${taxLink ? `\nBefore your first payout, add your payout & tax details (2 minutes): ${taxLink}\n` : ''}
Make something great,
The 100Lights team`,
      html: renderEmail({
        heading: `You’re in, ${name} 🎛️`,
        preheader: 'Your referral link + how to start earning',
        bodyHtml:
          emailP('Welcome to the founding cohort. Here’s everything you need to start earning.') +
          `<p style="font-size:12px;font-weight:700;color:#7a7590;margin:0 0 6px">YOUR REFERRAL LINK</p>
  <div style="background:#f5f3fb;border:1px solid #e7e2f1;border-radius:10px;padding:14px 16px;margin:0 0 12px">
    <a href="${link}" style="font-family:ui-monospace,Menlo,monospace;font-size:15px;color:#6d28d9;word-break:break-all;text-decoration:none">${link}</a>
  </div>` +
          emailButton(link, 'Open your link →') +
          `<p style="font-size:14px;font-weight:700;margin:0 0 8px;color:#1b1922">Your deal</p>
  <ul style="font-size:14px;line-height:1.6;color:#3a3550;margin:0 0 20px;padding-left:20px">
    <li><strong>${deal}</strong> on every producer you refer who goes Pro</li>
    <li>Your audience gets <strong>${input.perkDays} days of free Pro</strong> when they use your link</li>
    <li>Your <strong>${input.commissionPct}% rate is grandfathered for life</strong></li>
  </ul>
  <p style="font-size:14px;font-weight:700;margin:0 0 8px;color:#1b1922">Best ways to share it</p>
  <ul style="font-size:14px;line-height:1.6;color:#3a3550;margin:0 0 20px;padding-left:20px">
    <li><strong>Show it on screen</strong> — make a beat in the browser while your audience follows along.</li>
    <li><strong>Pin your link</strong> in your description, bio, and a pinned comment.</li>
    <li><strong>Run a challenge:</strong> “make a beat in 60 seconds,” link in the caption.</li>
  </ul>
  <p style="font-size:13px;line-height:1.6;color:#7a7590;margin:0 0 0">Every signup and upgrade through your link is tracked — we reconcile and pay out monthly, so you never have to chase a number.</p>` +
          (taxLink ? `<div style="margin:18px 0 0;padding:14px 16px;border:1px solid #e7e2f1;border-radius:10px;background:#f5f3fb">
    <p style="font-size:13px;font-weight:700;margin:0 0 4px;color:#1b1922">One quick thing before your first payout</p>
    <p style="font-size:13px;line-height:1.5;color:#3a3550;margin:0 0 10px">Add your payout &amp; tax details (the W-9 basics) so we can pay you and handle your 1099 without chasing you.</p>
    <a href="${taxLink}" style="display:inline-block;padding:9px 16px;border-radius:8px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700;font-size:13px">Add my details →</a>
  </div>` : ''),
      }),
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
      html: renderEmail({
        heading: 'You have a new comment',
        preheader: `${actorName} commented on “${safeName}”`,
        bodyHtml: emailP(`<strong>${actorName}</strong> commented on your share <strong>${safeName}</strong>.`) + emailButton(url, 'Read the comment →'),
      }),
      role: 'default',
    })
  } catch { /* best-effort */ }
}

/** Acknowledge receipt of a DMCA takedown notice to the complainant (dmca@). */
export async function sendDmcaAckEmail(to: string, name: string): Promise<void> {
  if (!emailEnabled() || !looksLikeEmail(to)) return
  const safe = (name || 'there').replace(/[<>&]/g, '')
  try {
    await sendEmail({
      to,
      role: 'dmca',
      subject: 'We received your copyright notice — 100Lights',
      text: `Hi ${safe},\n\nWe've received your copyright takedown notice and will review it promptly. Valid notices are acted on quickly; if we need any more information, we'll reply to this email.\n\n— 100Lights, Copyright`,
      html: renderEmail({
        heading: 'We received your copyright notice',
        preheader: 'Your DMCA takedown notice has been received',
        bodyHtml: emailP(`Hi ${safe},`) + emailP('We’ve received your copyright takedown notice and will review it promptly. Valid notices are acted on quickly; if we need any more information, we’ll reply to this email.'),
      }),
    })
  } catch { /* best-effort */ }
}
