import { sql } from './db'
import { getProPrice } from './stripe'
import { stageCounts } from './lifecycle'
import { dueTasks } from './user-crm'
import { clerkClient } from '@clerk/nextjs/server'

// The founder's morning brief: one call that answers "what happened, what's the
// business doing, and what needs me?" Every metric is best-effort — a missing
// table or a Stripe hiccup degrades that line to 0/null, never throws — so the
// brief always renders and can also be emailed from a cron with no extra infra.

export interface Digest {
  generatedAt: string
  users: { total: number; newToday: number; new7d: number; new30d: number }
  revenue: { payingPro: number; giftedPro: number; codePro: number; comped: number; mrrCents: number | null; currency: string; compMonthlyCents: number | null }
  activity: { projects: number; savedToday: number; saved7d: number; newCommunity24h: number }
  attention: { openFeedback: number; reportedItems: number; reportedComments: number; failedWebhooks24h: number; dunning: number }
  lifecycle: Record<string, number>
  tasks: { id: number; userId: string; email: string; body: string; dueAt: string; overdue: boolean }[]
  headlines: string[]
}

async function num(q: Promise<Record<string, unknown>[]>): Promise<number> {
  try { const r = await q; return Number(r[0]?.n ?? 0) } catch { return 0 }
}

export async function buildDigest(): Promise<Digest> {
  const [
    total, newToday, new7d, new30d,
    payingPro, giftedPro, codePro,
    projects, savedToday, saved7d, newCommunity24h,
    openFeedback, reportedItems, reportedComments, failedWebhooks24h, dunning,
  ] = await Promise.all([
    num(sql`SELECT COUNT(*)::int AS n FROM subscriptions`),
    num(sql`SELECT COUNT(*)::int AS n FROM subscriptions WHERE created_at >= date_trunc('day', NOW())`),
    num(sql`SELECT COUNT(*)::int AS n FROM subscriptions WHERE created_at > NOW() - INTERVAL '7 days'`),
    num(sql`SELECT COUNT(*)::int AS n FROM subscriptions WHERE created_at > NOW() - INTERVAL '30 days'`),
    num(sql`SELECT COUNT(*)::int AS n FROM subscriptions WHERE plan = 'pro' AND status = 'active' AND stripe_sub_id IS NOT NULL`),
    num(sql`SELECT COUNT(*)::int AS n FROM subscriptions WHERE gift_plan = 'pro' AND (gift_until IS NULL OR gift_until > NOW())`),
    num(sql`SELECT COUNT(DISTINCT user_id)::int AS n FROM code_redemptions WHERE grant_until > NOW()`),
    num(sql`SELECT COUNT(*)::int AS n FROM projects WHERE deleted_at IS NULL`),
    num(sql`SELECT COUNT(*)::int AS n FROM projects WHERE deleted_at IS NULL AND saved_at >= date_trunc('day', NOW())`),
    num(sql`SELECT COUNT(*)::int AS n FROM projects WHERE deleted_at IS NULL AND saved_at > NOW() - INTERVAL '7 days'`),
    num(sql`SELECT COUNT(*)::int AS n FROM community_items WHERE removed_at IS NULL AND created_at > NOW() - INTERVAL '24 hours'`),
    num(sql`SELECT COUNT(*)::int AS n FROM feedback WHERE resolved_at IS NULL`),
    num(sql`SELECT COUNT(DISTINCT r.item_id)::int AS n FROM community_reports r JOIN community_items i ON i.id = r.item_id WHERE i.removed_at IS NULL`),
    num(sql`SELECT COUNT(DISTINCT comment_id)::int AS n FROM community_comment_reports`),
    num(sql`SELECT COUNT(*)::int AS n FROM webhook_events WHERE status = 'failed' AND received_at > NOW() - INTERVAL '24 hours'`),
    num(sql`SELECT COUNT(*)::int AS n FROM subscriptions WHERE stripe_sub_id IS NOT NULL AND status IS NOT NULL AND status NOT IN ('active','trialing')`),
  ])

  let priceCents = 0, currency = 'usd', priceOk = false
  try { const p = await getProPrice('monthly'); priceCents = p.amount; currency = p.currency; priceOk = true } catch { /* Stripe down */ }
  const comped = giftedPro + codePro
  const lifecycle = await stageCounts()   // best-effort: {} on error
  const atRisk = lifecycle['at-risk'] ?? 0
  const churned = lifecycle['churned'] ?? 0

  // Follow-up tasks that are due, with the account's email resolved (bounded).
  const due = await dueTasks(25).catch(() => [])
  let taskEmails = new Map<string, string>()
  if (due.length) {
    try {
      const ids = [...new Set(due.map(t => t.userId))]
      const cu = (await (await clerkClient()).users.getUserList({ userId: ids, limit: 100 })).data
      taskEmails = new Map(cu.map(u => [u.id, u.emailAddresses?.[0]?.emailAddress ?? '']))
    } catch { /* Clerk down — show ids */ }
  }
  const tasks = due.map(t => ({ id: t.id, userId: t.userId, email: taskEmails.get(t.userId) ?? '', body: t.body, dueAt: t.dueAt, overdue: t.overdue }))
  const overdueCount = tasks.filter(t => t.overdue).length

  const headlines: string[] = []
  if (tasks.length > 0) headlines.push(`⚠️ ${tasks.length} follow-up${tasks.length === 1 ? '' : 's'} due${overdueCount ? ` (${overdueCount} overdue)` : ''}`)
  if (newToday > 0) headlines.push(`${newToday} new ${newToday === 1 ? 'signup' : 'signups'} today`)
  if (failedWebhooks24h > 0) headlines.push(`⚠️ ${failedWebhooks24h} webhook ${failedWebhooks24h === 1 ? 'failure' : 'failures'} in 24h — check Webhooks`)
  if (dunning > 0) headlines.push(`⚠️ ${dunning} subscription${dunning === 1 ? '' : 's'} in a failed/past-due state`)
  if (atRisk > 0) headlines.push(`${atRisk} Pro ${atRisk === 1 ? 'account is' : 'accounts are'} at risk — gone quiet or payment failing`)
  if (openFeedback > 0) headlines.push(`${openFeedback} unresolved feedback ${openFeedback === 1 ? 'item' : 'items'}`)
  if (reportedItems + reportedComments > 0) headlines.push(`${reportedItems + reportedComments} reported ${reportedItems + reportedComments === 1 ? 'item' : 'items'} awaiting moderation`)
  if (savedToday > 0) headlines.push(`${savedToday} ${savedToday === 1 ? 'project' : 'projects'} saved today`)
  if (headlines.length === 0) headlines.push('Quiet so far — nothing needs you right now.')

  return {
    generatedAt: new Date().toISOString(),
    users: { total, newToday, new7d, new30d },
    revenue: {
      payingPro, giftedPro, codePro, comped,
      mrrCents: priceOk ? payingPro * priceCents : null,
      currency,
      compMonthlyCents: priceOk ? comped * priceCents : null,
    },
    activity: { projects, savedToday, saved7d, newCommunity24h },
    attention: { openFeedback, reportedItems, reportedComments, failedWebhooks24h, dunning },
    lifecycle,
    tasks,
    headlines,
  }
}

// Plain-text + HTML rendering for the emailed digest. Kept here so the cron and
// any future channel share one source of truth.
export function digestText(d: Digest): string {
  const money = (c: number | null) => c === null ? '—' : `$${(c / 100).toFixed(0)}`
  return [
    `100Lights — founder brief (${new Date(d.generatedAt).toLocaleDateString()})`,
    '',
    ...d.headlines.map(h => `• ${h}`),
    '',
    `Users: ${d.users.total} total · +${d.users.newToday} today · +${d.users.new7d} this week`,
    `Revenue: MRR ${money(d.revenue.mrrCents)} · ${d.revenue.payingPro} paying · ${d.revenue.comped} comped (${money(d.revenue.compMonthlyCents)}/mo given away)`,
    `Activity: ${d.activity.savedToday} projects saved today · ${d.activity.newCommunity24h} new community shares (24h)`,
    `Lifecycle: ${d.lifecycle.paying ?? 0} paying · ${d.lifecycle.power ?? 0} power · ${d.lifecycle.engaged ?? 0} engaged · ${d.lifecycle['at-risk'] ?? 0} at-risk · ${d.lifecycle.churned ?? 0} churned`,
    `Needs you: ${d.attention.openFeedback} feedback · ${d.attention.reportedItems + d.attention.reportedComments} reports · ${d.attention.failedWebhooks24h} webhook fails · ${d.attention.dunning} dunning`,
    ...(d.tasks.length ? ['', 'Follow-ups due:', ...d.tasks.map(t => `  ${t.overdue ? '⚠ ' : ''}${t.body} — ${t.email || t.userId}`)] : []),
    '',
    'Open the cockpit: https://100lights.com/admin',
  ].join('\n')
}

export function digestHtml(d: Digest): string {
  const money = (c: number | null) => c === null ? '—' : `$${(c / 100).toFixed(0)}`
  const row = (label: string, val: string) => `<tr><td style="padding:6px 12px 6px 0;color:#888;font-size:13px">${label}</td><td style="padding:6px 0;color:#111;font-size:13px;font-weight:600">${val}</td></tr>`
  return `<div style="font-family:system-ui,sans-serif;max-width:520px">
    <h2 style="font-size:18px;color:#111;margin:0 0 4px">Founder brief</h2>
    <p style="font-size:12px;color:#999;margin:0 0 16px">${new Date(d.generatedAt).toLocaleDateString()}</p>
    <ul style="padding-left:18px;margin:0 0 18px">
      ${d.headlines.map(h => `<li style="font-size:14px;color:#222;margin-bottom:4px">${h.replace(/[<>&]/g, '')}</li>`).join('')}
    </ul>
    <table style="border-collapse:collapse;width:100%">
      ${row('Users', `${d.users.total} total · +${d.users.newToday} today · +${d.users.new7d} / wk`)}
      ${row('MRR', `${money(d.revenue.mrrCents)} · ${d.revenue.payingPro} paying`)}
      ${row('Comped', `${d.revenue.comped} · ${money(d.revenue.compMonthlyCents)}/mo`)}
      ${row('Saved today', String(d.activity.savedToday))}
      ${row('New shares (24h)', String(d.activity.newCommunity24h))}
      ${row('Lifecycle', `${d.lifecycle.paying ?? 0} paying · ${d.lifecycle.power ?? 0} power · ${d.lifecycle['at-risk'] ?? 0} at-risk · ${d.lifecycle.churned ?? 0} churned`)}
      ${row('Needs you', `${d.attention.openFeedback} feedback · ${d.attention.reportedItems + d.attention.reportedComments} reports · ${d.attention.failedWebhooks24h} webhook fails · ${d.attention.dunning} dunning`)}
    </table>
    ${d.tasks.length ? `<div style="margin-top:16px">
      <p style="font-size:12px;color:#888;margin:0 0 6px;text-transform:uppercase;letter-spacing:.4px">Follow-ups due</p>
      ${d.tasks.map(t => `<div style="font-size:13px;color:#222;margin-bottom:4px">${t.overdue ? '⚠ ' : ''}${t.body.replace(/[<>&]/g, '')} <span style="color:#888">— ${(t.email || t.userId).replace(/[<>&]/g, '')}</span></div>`).join('')}
    </div>` : ''}
    <p style="margin-top:20px"><a href="https://100lights.com/admin" style="display:inline-block;padding:9px 16px;border-radius:8px;background:#8b5cf6;color:#fff;text-decoration:none;font-weight:600;font-size:13px">Open the cockpit →</a></p>
  </div>`
}
