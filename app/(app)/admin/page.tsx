import { sql } from '@/lib/db'
import AdminLogout from './AdminLogout'
import UsersPanel from './UsersPanel'
import SoundLibraryPanel from './SoundLibraryPanel'
import MidiPresetsPanel from './MidiPresetsPanel'
import CommunityModerationPanel from './CommunityModerationPanel'
import FeedbackPanel from './FeedbackPanel'
import PotentialSamplesPanel from './PotentialSamplesPanel'
import ClusterCorrectionsPanel from './ClusterCorrectionsPanel'
import PlatformFlagsPanel from './PlatformFlagsPanel'
import ArticlesPanel from './ArticlesPanel'
import LearnPathsPanel from './LearnPathsPanel'
import DmcaPanel from './DmcaPanel'
import LicensesPanel from './LicensesPanel'
import CodesPanel from './CodesPanel'
import AffiliatesPanel from './AffiliatesPanel'
import AuditLogPanel from './AuditLogPanel'
import CatalogPanel from './CatalogPanel'
import StoragePanel from './StoragePanel'
import StatusPanel from './StatusPanel'
import WebhooksPanel from './WebhooksPanel'
import AnnouncementsPanel from './AnnouncementsPanel'
import DigestPanel from './DigestPanel'
import GrowthPanel from './GrowthPanel'
import ArticleProjectsPanel from './ArticleProjectsPanel'
import TasksInboxPanel from './TasksInboxPanel'
import ContentVideoPanel from './ContentVideoPanel'
import ContentQueuePanel from './ContentQueuePanel'
import AdminTabs, { type AdminTab } from './AdminTabs'
import { getFlags } from '@/lib/platform-flags'
import { ensureSubscriptionsSchema } from '@/lib/subscription'
import { getProPrice } from '@/lib/stripe'
import { listAudit, type AuditEntry } from '@/lib/admin-audit'
import { clerkClient } from '@clerk/nextjs/server'

export const dynamic = 'force-dynamic'

interface Snapshot { day: string; mrrCents: number; paying: number }
interface DunningRow { userId: string; email: string; plan: string; status: string; stripeCustomerId: string; updatedAt: string }

// Revenue intelligence — a self-populating MRR trend (a snapshot is stamped on
// every admin load, so a trend accumulates with zero infra), the comp-cost
// run-rate (free Pro you're giving away), and the failed-payment / at-risk
// subscription queue. All best-effort so a missing table never breaks the page.
async function getRevenue() {
  const one = async (q: Promise<Record<string, unknown>[]>): Promise<number> => {
    try { const r = await q; return Number(r[0]?.n ?? 0) } catch { return 0 }
  }
  const [paying, gifted, code, users] = await Promise.all([
    one(sql`SELECT COUNT(*)::int AS n FROM subscriptions WHERE plan = 'pro' AND status = 'active' AND stripe_sub_id IS NOT NULL`),
    one(sql`SELECT COUNT(*)::int AS n FROM subscriptions WHERE gift_plan = 'pro' AND (gift_until IS NULL OR gift_until > NOW())`),
    one(sql`SELECT COUNT(DISTINCT user_id)::int AS n FROM code_redemptions WHERE grant_until > NOW()`),
    one(sql`SELECT COUNT(*)::int AS n FROM subscriptions`),
  ])
  let priceCents = 0, currency = 'usd'
  try { const p = await getProPrice('monthly'); priceCents = p.amount; currency = p.currency } catch { /* Stripe down — no $ */ }
  const mrrCents = paying * priceCents

  // Stamp today's snapshot (idempotent — one row per day) and read the trend.
  let snapshots: Snapshot[] = []
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS mrr_snapshots (
        day DATE PRIMARY KEY, mrr_cents BIGINT NOT NULL DEFAULT 0,
        paying INT, gifted INT, code INT, total_users INT,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    await sql`
      INSERT INTO mrr_snapshots (day, mrr_cents, paying, gifted, code, total_users)
      VALUES (CURRENT_DATE, ${mrrCents}, ${paying}, ${gifted}, ${code}, ${users})
      ON CONFLICT (day) DO UPDATE SET mrr_cents = EXCLUDED.mrr_cents, paying = EXCLUDED.paying,
        gifted = EXCLUDED.gifted, code = EXCLUDED.code, total_users = EXCLUDED.total_users, captured_at = NOW()`
    const rows = await sql`SELECT day, mrr_cents, paying FROM mrr_snapshots ORDER BY day DESC LIMIT 30`
    snapshots = rows.map(r => ({ day: String(r.day), mrrCents: Number(r.mrr_cents), paying: Number(r.paying ?? 0) })).reverse()
  } catch { /* snapshot table unavailable */ }

  // Failed / at-risk payments: real Stripe subs whose status isn't healthy.
  let dunning: DunningRow[] = []
  try {
    const rows = await sql`
      SELECT user_id, plan, status, stripe_customer_id, updated_at FROM subscriptions
      WHERE stripe_sub_id IS NOT NULL AND status IS NOT NULL AND status NOT IN ('active','trialing')
      ORDER BY updated_at DESC LIMIT 50`
    const ids = rows.map(r => String(r.user_id))
    let emails = new Map<string, string>()
    if (ids.length) {
      try { const c = await clerkClient(); emails = new Map((await c.users.getUserList({ userId: ids, limit: 100 })).data.map(u => [u.id, u.emailAddresses[0]?.emailAddress ?? ''])) } catch { /* Clerk down */ }
    }
    dunning = rows.map(r => ({
      userId: String(r.user_id), email: emails.get(String(r.user_id)) ?? '',
      plan: String(r.plan), status: String(r.status),
      stripeCustomerId: String(r.stripe_customer_id ?? ''), updatedAt: r.updated_at ? String(r.updated_at) : '',
    }))
  } catch { /* subscriptions table shape differs */ }

  return { mrrCents, currency, paying, gifted, code, comped: gifted + code, compMonthlyCents: (gifted + code) * priceCents, snapshots, dunning }
}

// Operational signals for the Command Center — "what needs you today". Each
// group is best-effort so a table that doesn't exist yet never breaks the home.
async function getOps() {
  const one = async (q: Promise<Record<string, unknown>[]>): Promise<number> => {
    try { const r = await q; return Number(r[0]?.n ?? 0) } catch { return 0 }
  }
  const [newToday, openFeedback, reportedItems, reportedComments] = await Promise.all([
    one(sql`SELECT COUNT(*)::int AS n FROM subscriptions WHERE created_at >= date_trunc('day', NOW())`),
    one(sql`SELECT COUNT(*)::int AS n FROM feedback WHERE resolved_at IS NULL`),
    one(sql`SELECT COUNT(DISTINCT r.item_id)::int AS n FROM community_reports r JOIN community_items i ON i.id = r.item_id WHERE i.removed_at IS NULL`),
    one(sql`SELECT COUNT(DISTINCT comment_id)::int AS n FROM community_comment_reports`),
  ])
  let recent: AuditEntry[] = []
  try { recent = await listAudit(8) } catch { /* audit table may not exist yet */ }
  return { newToday, openFeedback, reportedItems, reportedComments, recent }
}

async function getStats() {
  // `created_at` is real signup time; count new users on it, not `updated_at`
  // (which any gift/plan-change/webhook bumps and would overcount).
  await ensureSubscriptionsSchema()
  const [users, proUsers, newThisWeek, newThisMonth, projects, projectsThisWeek] = await Promise.all([
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions`,
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE plan = 'pro' AND status = 'active'`,
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE created_at > NOW() - INTERVAL '7 days'`,
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE created_at > NOW() - INTERVAL '30 days'`,
    sql`SELECT COUNT(*)::int AS cnt FROM projects WHERE deleted_at IS NULL`,
    sql`SELECT COUNT(*)::int AS cnt FROM projects WHERE deleted_at IS NULL AND saved_at > NOW() - INTERVAL '7 days'`,
  ])

  // Revenue breakdown — best-effort so a missing code table or a Stripe hiccup
  // never breaks the dashboard. "Paying" = a real Stripe sub (not gift/code).
  let payingPro = 0, giftedPro = 0, codePro = 0
  let mrrCents: number | null = null, currency = 'usd'
  try {
    const [pay, gift, code] = await Promise.all([
      sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE plan = 'pro' AND status = 'active' AND stripe_sub_id IS NOT NULL`,
      sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE gift_plan = 'pro' AND (gift_until IS NULL OR gift_until > NOW())`,
      sql`SELECT COUNT(DISTINCT user_id)::int AS cnt FROM code_redemptions WHERE grant_until > NOW()`,
    ])
    payingPro = Number(pay[0]?.cnt ?? 0)
    giftedPro = Number(gift[0]?.cnt ?? 0)
    codePro   = Number(code[0]?.cnt ?? 0)
    try { const price = await getProPrice('monthly'); mrrCents = payingPro * price.amount; currency = price.currency } catch { /* Stripe unavailable — show counts, no $ */ }
  } catch { /* code_redemptions may not exist yet — leave breakdown at 0 */ }

  return {
    totalUsers:       Number(users[0]?.cnt ?? 0),
    proUsers:         Number(proUsers[0]?.cnt ?? 0),
    newThisWeek:      Number(newThisWeek[0]?.cnt ?? 0),
    newThisMonth:     Number(newThisMonth[0]?.cnt ?? 0),
    totalProjects:    Number(projects[0]?.cnt ?? 0),
    projectsThisWeek: Number(projectsThisWeek[0]?.cnt ?? 0),
    payingPro, giftedPro, codePro, mrrCents, currency,
  }
}

function Stat({ label, value, sub, warn }: { label: string; value: number | string; sub?: string; warn?: boolean }) {
  return (
    <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: warn ? 'rgba(239,68,68,0.35)' : 'var(--border)' }}>
      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: warn ? '#ef4444' : 'var(--text-primary)' }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  )
}

// An actionable "needs you" tile. When count > 0 it glows and links to the
// panel that clears it; at zero it reads calm (inbox-zero).
function NeedsTile({ label, count, href, clearLabel, cta }: { label: string; count: number; href: string; clearLabel: string; cta: string }) {
  const hot = count > 0
  return (
    <a href={href} className="p-4 rounded-xl border block" style={{
      background: hot ? 'rgba(245,158,11,0.06)' : 'var(--bg-card)',
      borderColor: hot ? 'rgba(245,158,11,0.4)' : 'var(--border)', textDecoration: 'none',
    }}>
      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: hot ? '#f59e0b' : '#34d399' }}>{hot ? count : '✓'}</p>
      <p className="text-xs mt-0.5" style={{ color: hot ? 'var(--accent-light)' : 'var(--text-muted)' }}>{hot ? cta : clearLabel}</p>
    </a>
  )
}

function ActivityFeed({ entries }: { entries: AuditEntry[] }) {
  const color = (a: string) => a.startsWith('gift') || a.startsWith('code') ? '#f97316'
    : a.startsWith('article') || a.startsWith('catalog') ? '#a78bfa'
    : a.startsWith('community') ? '#ef4444' : a.startsWith('flags') ? '#38bdf8' : 'var(--text-secondary)'
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  if (entries.length === 0) {
    return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No admin actions recorded yet.</p>
  }
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
      {entries.map((e, i) => (
        <div key={e.id} className="flex items-center gap-3 px-4 py-2 text-xs" style={{ borderTop: i ? '1px solid var(--border)' : 'none', background: i % 2 ? 'var(--bg-surface)' : 'var(--bg-card)' }}>
          <span style={{ color: 'var(--text-muted)', minWidth: 96, fontVariantNumeric: 'tabular-nums' }}>{when(e.created_at)}</span>
          <span style={{ color: color(e.action), fontWeight: 600, minWidth: 150 }}>{e.action}</span>
          <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.target ?? ''}</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>{e.actor}</span>
        </div>
      ))}
    </div>
  )
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(cents / 100)
}

// Tiny inline-SVG MRR trend. Renders once ≥2 daily snapshots exist.
function Sparkline({ snapshots, currency }: { snapshots: Snapshot[]; currency: string }) {
  const W = 460, H = 90, pad = 6
  const pts = snapshots.map(s => s.mrrCents)
  const hasTrend = pts.length >= 2
  const first = pts[0] ?? 0, last = pts[pts.length - 1] ?? 0
  const delta = last - first
  const max = Math.max(...pts, 1), min = Math.min(...pts, 0)
  const span = Math.max(1, max - min)
  const path = pts.map((v, i) => {
    const x = pad + (i / Math.max(1, pts.length - 1)) * (W - pad * 2)
    const y = H - pad - ((v - min) / span) * (H - pad * 2)
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{money(last, currency)}</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>current MRR</span>
        {hasTrend && delta !== 0 && (
          <span className="text-xs font-semibold" style={{ color: delta > 0 ? '#34d399' : '#ef4444', marginLeft: 'auto' }}>
            {delta > 0 ? '▲' : '▼'} {money(Math.abs(delta), currency)} over {snapshots.length} day{snapshots.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {hasTrend ? (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block' }} aria-hidden="true">
          <path d={`${path} L${W - pad},${H - pad} L${pad},${H - pad} Z`} fill="rgba(124,92,255,0.10)" stroke="none" />
          <path d={path} fill="none" stroke="var(--accent-light)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Trend builds as the days pass — a snapshot is recorded each time this page loads. Come back tomorrow to see the line.</p>
      )}
    </div>
  )
}

function PanelIntro({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      {description && <p className="text-xs mt-0.5 max-w-2xl" style={{ color: 'var(--text-muted)' }}>{description}</p>}
    </div>
  )
}

function ComingSoon({ module }: { module: string }) {
  return (
    <div className="rounded-xl border p-8 text-center" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
      <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No {module} tools yet</p>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Module-specific admin panels will land here as {module} grows. Visibility is controlled in General → Module Visibility.
      </p>
    </div>
  )
}

const QUICK_LINKS = [
  { label: 'Stripe dashboard',    url: 'https://dashboard.stripe.com' },
  { label: 'Neon database',       url: 'https://console.neon.tech' },
  { label: 'Clerk dashboard',     url: 'https://dashboard.clerk.com' },
  { label: 'Cloudflare R2',       url: 'https://dash.cloudflare.com' },
  { label: 'Vercel deployments',  url: 'https://vercel.com/dashboard' },
  { label: 'PostHog analytics',   url: 'https://app.posthog.com' },
  { label: 'Sentry errors',       url: 'https://sentry.io' },
]

export default async function AdminPage() {
  const [stats, flags, ops, revenue] = await Promise.all([getStats(), getFlags(), getOps(), getRevenue()])
  const needs = ops.openFeedback + ops.reportedItems + ops.reportedComments + revenue.dunning.length
  const conversionRate = stats.totalUsers > 0
    ? ((stats.proUsers / stats.totalUsers) * 100).toFixed(1)
    : '0'

  const tabs: AdminTab[] = [
    {
      id: 'general',
      label: 'General',
      subtabs: [
        {
          id: 'brief',
          group: 'Business',
          label: 'Daily Brief',
          content: (
            <>
              <PanelIntro
                title="Daily Brief"
                description="Your morning read on the whole business in one glance — growth, revenue, activity, and everything that needs you. Copy the headlines or email yourself a copy; a weekly digest can go out automatically."
              />
              <DigestPanel />
            </>
          ),
        },
        {
          id: 'overview',
          group: 'Business',
          label: 'Overview',
          content: (
            <>
              <PanelIntro title="Command Center" description={needs > 0 ? `${needs} thing${needs === 1 ? ' needs' : 's need'} your attention today.` : 'All clear — nothing needs you right now. Here are the numbers.'} />

              {/* Needs your attention */}
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Needs you today</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <NeedsTile label="Open feedback"     count={ops.openFeedback} href="#general/feedback" clearLabel="inbox zero" cta="triage them →" />
                <NeedsTile label="Reported content"  count={ops.reportedItems + ops.reportedComments} href="#general/community-moderation" clearLabel="queue clear" cta="review the queue →" />
                <NeedsTile label="Payments to fix"   count={revenue.dunning.length} href="#general/revenue" clearLabel="all paid" cta="chase them →" />
                <a href="#general/users" className="p-4 rounded-xl border block" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', textDecoration: 'none' }}>
                  <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>New signups today</p>
                  <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{ops.newToday}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>see who →</p>
                </a>
              </div>

              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Audience</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <Stat label="Total users"      value={stats.totalUsers} />
                <Stat label="Pro subscribers"  value={stats.proUsers}  sub={`${conversionRate}% conversion`} />
                <Stat label="New this week"    value={stats.newThisWeek} />
                <Stat label="New this month"   value={stats.newThisMonth} />
              </div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Revenue</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <Stat
                  label="Est. MRR"
                  value={stats.mrrCents != null
                    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: stats.currency.toUpperCase(), maximumFractionDigits: 0 }).format(stats.mrrCents / 100)
                    : '—'}
                  sub={stats.mrrCents != null ? `${stats.payingPro} paying × monthly` : 'Stripe price unavailable'}
                />
                <Stat label="Paying Pro"   value={stats.payingPro} sub="real Stripe subs" />
                <Stat label="Gifted Pro"   value={stats.giftedPro} sub="admin gifts, active" />
                <Stat label="Code Pro"     value={stats.codePro}   sub="redeemed codes, active" />
              </div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Projects</p>
              <div className="grid grid-cols-2 gap-4 mb-6" style={{ maxWidth: 480 }}>
                <Stat label="Total projects"      value={stats.totalProjects} />
                <Stat label="Projects this week"  value={stats.projectsThisWeek} />
              </div>

              <div className="flex items-baseline gap-3 mb-2">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Recent admin activity</p>
                <a href="#general/audit" className="text-xs" style={{ color: 'var(--accent-light)' }}>full log →</a>
              </div>
              <ActivityFeed entries={ops.recent} />
            </>
          ),
        },
        {
          id: 'users',
          group: 'People',
          label: 'Users',
          content: (
            <>
              <PanelIntro title="Users" description="Search users, manage plans, and gift Pro time." />
              <UsersPanel />
            </>
          ),
        },
        {
          id: 'revenue',
          group: 'Business',
          label: 'Revenue',
          content: (
            <>
              <PanelIntro title="Revenue Intelligence" description="MRR trend, the free Pro you're giving away, and the payments that need chasing." />

              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>MRR trend</p>
              <div className="mb-6"><Sparkline snapshots={revenue.snapshots} currency={revenue.currency} /></div>

              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Comped Pro — free access you're giving away</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <Stat label="Comp run-rate" value={revenue.compMonthlyCents ? `${money(revenue.compMonthlyCents, revenue.currency)}/mo` : '—'} sub={`${revenue.comped} active free seat${revenue.comped === 1 ? '' : 's'}`} warn={revenue.comped > 0} />
                <Stat label="Gifted Pro" value={revenue.gifted} sub="admin gifts, active" />
                <Stat label="Code Pro"   value={revenue.code}   sub="redeemed codes, active" />
                <Stat label="Paying Pro" value={revenue.paying} sub="real Stripe subs" />
              </div>

              <div className="flex items-baseline gap-3 mb-2">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Payments to fix</p>
                <span className="text-xs" style={{ color: revenue.dunning.length ? '#f59e0b' : 'var(--text-muted)' }}>{revenue.dunning.length} at-risk subscription{revenue.dunning.length === 1 ? '' : 's'}</span>
              </div>
              {revenue.dunning.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No failed or past-due subscriptions — every paying account is current. ✓</p>
              ) : (
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                        {['Email / User', 'Status', 'Plan', 'Since', ''].map((h, i) => (
                          <th key={i} className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {revenue.dunning.map((d, i) => (
                        <tr key={d.userId} style={{ borderBottom: '1px solid var(--border)', background: i % 2 ? 'var(--bg-surface)' : 'var(--bg-card)' }}>
                          <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-primary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.email || <span className="font-mono" style={{ color: 'var(--text-muted)' }}>{d.userId}</span>}</td>
                          <td className="px-4 py-2 text-xs" style={{ color: '#f59e0b', fontWeight: 600 }}>{d.status}</td>
                          <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{d.plan}</td>
                          <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{d.updatedAt ? new Date(d.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                          <td className="px-4 py-2 text-xs">{d.stripeCustomerId && <a href={`https://dashboard.stripe.com/customers/${d.stripeCustomerId}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-light)' }}>Stripe ↗</a>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ),
        },
        {
          id: 'growth',
          group: 'Business',
          label: 'Growth',
          content: (
            <>
              <PanelIntro
                title="Growth & Retention"
                description="The signup → paying funnel and monthly signup cohorts — where you're leaking and whether each month's cohort is sticking better than the last."
              />
              <GrowthPanel />
            </>
          ),
        },
        {
          id: 'announcements',
          group: 'Content & comms',
          label: 'Announcements',
          content: (
            <>
              <PanelIntro
                title="Announcements"
                description="Broadcast a message to everyone (or just free / Pro users) as a dismissible banner across the app — desktop and mobile. Launches, maintenance windows, offers. No deploy required; toggle a banner off to pause it."
              />
              <AnnouncementsPanel />
            </>
          ),
        },
        {
          id: 'articles',
          group: 'Content & comms',
          label: 'Articles',
          content: (
            <>
              <PanelIntro
                title="Learn Articles"
                description="The editorial desk for 100lights.com/learn. Edit anything, publish instantly with the toggle, or generate a new draft — repo-based drafts (written by Claude in dev sessions) appear here too and become editable database copies when saved."
              />
              <ArticlesPanel />
            </>
          ),
        },
        {
          id: 'learn-paths',
          group: 'Content & comms',
          label: 'Learning Paths',
          content: (
            <>
              <PanelIntro
                title="Learning Paths"
                description="Ordered courses that teach one skill across several articles. Built-in paths come from code; edit any of them or add your own here — reorder the reading list, set the goal, hide a path, or reset a built-in to its default. Articles that aren't published yet show as “coming soon” on the path."
              />
              <LearnPathsPanel />
            </>
          ),
        },
        {
          id: 'tasks',
          group: 'People',
          label: 'Follow-ups',
          content: (
            <>
              <PanelIntro
                title="Follow-ups"
                description="Every open follow-up across all accounts — your CRM work queue, grouped by overdue / today / upcoming. Add them from a user's record; check them off here."
              />
              <TasksInboxPanel />
            </>
          ),
        },
        {
          id: 'codes',
          group: 'People',
          label: 'Codes',
          content: (
            <>
              <PanelIntro
                title="Redemption Codes"
                description="Codes that grant free Pro time. Promo codes can be redeemed by any user (each once) and stack; starter codes are for signup and each user can only ever use one. Cap a code's lifetime with an expiry, or its total redemptions with a usage limit — handy for time-boxed campaigns and sponsoring a fixed number of people."
              />
              <CodesPanel />
            </>
          ),
        },
        {
          id: 'affiliates',
          group: 'Business',
          label: 'Affiliates',
          content: (
            <>
              <PanelIntro
                title="Affiliate Program"
                description="Creators who share a referral link. Each signup through it earns them a recurring % of that user's Pro payments, and the new user gets bonus free Pro. Add an affiliate to mint their link, then track referrals → paying conversions → estimated commission owed. Payouts are manual — reconcile the estimate against Stripe before paying."
              />
              <AffiliatesPanel />
            </>
          ),
        },
        {
          id: 'feedback',
          group: 'Content & comms',
          label: 'Feedback',
          content: (
            <>
              <PanelIntro
                title="Feedback Inbox"
                description="Everything users send through the sidebar's Send feedback button, newest first, with their email and the page they were on. Mark items resolved to work down to inbox zero; filter by state and page through the archive."
              />
              <FeedbackPanel />
            </>
          ),
        },
        {
          id: 'community-moderation',
          group: 'Content & comms',
          label: 'Community',
          content: (
            <>
              <PanelIntro
                title="Community Moderation"
                description="The latest community shares plus the reported queue. Removing an item hides it everywhere but keeps it restorable (with its votes and comments); dismiss a report to clear the flag on something you've reviewed and want to keep."
              />
              <CommunityModerationPanel />
            </>
          ),
        },
        {
          id: 'dmca',
          group: 'Content & comms',
          label: 'Copyright / DMCA',
          content: (
            <>
              <PanelIntro
                title="Copyright / DMCA Notices"
                description="Takedown notices filed by copyright holders through the public form at /legal/dmca. Review each, act on the reported content in Community moderation if valid, then mark it resolved. Acting on valid notices (and terminating repeat infringers) is what keeps your DMCA safe-harbor protection."
              />
              <DmcaPanel />
            </>
          ),
        },
        {
          id: 'visibility',
          group: 'System',
          label: 'Module Visibility',
          content: (
            <>
              <PanelIntro
                title="Module Visibility"
                description="Control which modules are live for all users. Hidden modules disappear from the launcher, dashboard sidebar, and the new-project page — use this to ship modules one at a time."
              />
              <PlatformFlagsPanel initial={flags} />
            </>
          ),
        },
        {
          id: 'status',
          group: 'System',
          label: 'Status',
          content: (
            <>
              <PanelIntro
                title="System Status"
                description="A live health probe of the services 100Lights runs on — database, storage, billing, auth — with round-trip latency. Answers &ldquo;is anything broken?&rdquo; at a glance."
              />
              <StatusPanel />
            </>
          ),
        },
        {
          id: 'webhooks',
          group: 'System',
          label: 'Webhooks',
          content: (
            <>
              <PanelIntro
                title="Webhooks"
                description="Every Stripe and Clerk event we receive, with its outcome — and one-click replay of the stored payload through the same idempotent handler. The fix for &ldquo;the webhook fired but the account didn&rsquo;t update.&rdquo;"
              />
              <WebhooksPanel />
            </>
          ),
        },
        {
          id: 'storage',
          group: 'System',
          label: 'Storage',
          content: (
            <>
              <PanelIntro
                title="Storage &amp; Cost"
                description="What's living in object storage, by category, plus the biggest files — so R2 cost is visible and orphans are findable. Scans on open."
              />
              <StoragePanel />
            </>
          ),
        },
        {
          id: 'audit',
          group: 'System',
          label: 'Audit Log',
          content: (
            <>
              <PanelIntro
                title="Audit Log"
                description="A record of consequential admin actions — gifts, code changes, module toggles, article publishes/deletes, and community takedowns — with who did it and when."
              />
              <AuditLogPanel />
            </>
          ),
        },
        {
          id: 'links',
          group: 'System',
          label: 'Quick Links',
          content: (
            <>
              <PanelIntro title="Quick Links" description="External dashboards for the services behind 100Lights." />
              <div className="flex flex-wrap gap-2">
                {QUICK_LINKS.map(({ label, url }) => (
                  <a key={label} href={url} target="_blank" rel="noopener noreferrer"
                    className="text-xs px-3 py-1.5 rounded-lg"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                    {label} ↗
                  </a>
                ))}
              </div>
            </>
          ),
        },
      ],
    },
    {
      id: 'audio',
      label: 'Audio',
      color: '#8b5cf6',
      subtabs: [
        {
          id: 'catalog',
          label: 'Catalog',
          content: (
            <>
              <PanelIntro
                title="Sound Catalog (ships to everyone)"
                description="The official sound library that appears in every user's editor. Upload samples here and they sync to all accounts within ~1 minute; edit metadata or remove a sound for everyone. This is the shared catalog — the panel next to it (Sound Library) only edits this device."
              />
              <CatalogPanel />
            </>
          ),
        },
        {
          id: 'article-projects',
          label: 'Article Audio Projects',
          content: (
            <>
              <PanelIntro
                title="Article Audio → Studio Projects"
                description="Turn the learn-article demo clips into editable multi-track studio projects — one track per part (drums / bass / pad / lead) instead of a single bounced waveform. Generate one, open it in the studio to edit, then export a WAV and upload it as the clip's override to ship the change."
              />
              <ArticleProjectsPanel />
            </>
          ),
        },
        {
          id: 'sound-library',
          label: 'Sound Library',
          content: (
            <>
              <PanelIntro
                title="Sound Library (this device)"
                description="Manage the sound library stored in THIS browser's IndexedDB — the samples the editor shows here. Upload, rename, re-folder, or delete your own additions; built-in catalog sounds (100L) are protected. Note: changes are local to this device and aren't pushed to users or your other machines."
              />
              <SoundLibraryPanel />
            </>
          ),
        },
        {
          id: 'licenses',
          label: 'Content Licenses',
          content: (
            <>
              <PanelIntro
                title="Content License Registry"
                description="A living record of where every bundled sound, sample, preset, and piece of article audio came from and under what license. Log each one so provenance is always on file — the flagged rows are missing a source or license. This is your defense on the biggest legal risk for a music app; keep it current as you add content."
              />
              <LicensesPanel />
            </>
          ),
        },
        {
          id: 'midi-presets',
          label: 'MIDI Presets',
          content: (
            <>
              <PanelIntro
                title="MIDI Instrument Presets"
                description="Presets map an instrument name to a sound library folder of per-note samples (e.g. “Violin — G3→E7”). When selected in Voice MIDI, each detected note plays the exact matching sample — no pitch shifting. Add custom presets by pointing to any library folder with note-named entries."
              />
              <MidiPresetsPanel />
            </>
          ),
        },
        {
          id: 'sample-packs',
          label: 'Sample Packs',
          content: (
            <>
              <PanelIntro
                title="Potential Samples and Packs"
                description="Preview and add new instrument sample packs from the FluidR3 GM soundfont. Every instrument covers the full 88-key range (A0–C8, MIDI 21–108) — all notes are individually sampled, no pitch-shifting."
              />
              <PotentialSamplesPanel />
            </>
          ),
        },
        {
          id: 'beat-corrections',
          label: 'Beat Corrections',
          content: (
            <>
              <PanelIntro
                title="Cluster Corrections"
                description="Corrections you've made to drum-hit classification, deduplicated by spectral distance. Bake them in to regenerate the built-in reference seeds."
              />
              <ClusterCorrectionsPanel />
            </>
          ),
        },
      ],
    },
    {
      id: 'video',
      label: 'Content',
      color: '#3b82f6',
      subtabs: [
        {
          id: 'content',
          label: 'Song Videos',
          content: (
            <>
              <PanelIntro
                title="Song → Video"
                description="Turn any saved project into a branded vertical video. Pick a song, choose a format (falling notes, stem builder, flow, and more), preview it locked to the beat, then send it to the content queue. This is the content engine."
              />
              <ContentVideoPanel />
            </>
          ),
        },
        {
          id: 'queue',
          label: 'Content Queue',
          content: (
            <>
              <PanelIntro
                title="Content Queue → Publish"
                description="The publishing pipeline, in-app and admin-only. Every video you send from the maker lands here as a draft with an auto-written caption. Review it, edit the copy, pick platforms, approve, then publish to YouTube (and Instagram / TikTok via Buffer). Dry-run first; nothing posts without your approval."
              />
              <ContentQueuePanel />
            </>
          ),
        },
      ],
    },
    {
      id: 'image',
      label: 'Image',
      color: '#10b981',
      subtabs: [
        { id: 'overview', label: 'Overview', content: <ComingSoon module="image" /> },
      ],
    },
  ]

  // Live attention counts surfaced directly in the sidebar nav, so what needs
  // you is visible without opening Overview first.
  const badges = {
    feedback: ops.openFeedback,
    'community-moderation': ops.reportedItems + ops.reportedComments,
    revenue: revenue.dunning.length,
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-8 max-w-6xl">

        {/* Page title */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Admin</h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--accent-light)', border: '1px solid rgba(139,92,246,0.3)' }}>
              Dev only
            </span>
            {needs > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.35)' }}>
                {needs} need{needs === 1 ? 's' : ''} you
              </span>
            )}
            <span className="text-xs" style={{ color: 'var(--text-muted)', marginLeft: 4 }}>Press <kbd style={{ border: '1px solid var(--border)', borderRadius: 5, padding: '1px 6px', fontSize: 11 }}>⌘K</kbd> to search</span>
            <AdminLogout />
          </div>
        </div>

        <AdminTabs tabs={tabs} badges={badges} />

      </div>
    </div>
  )
}
