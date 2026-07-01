import { sql } from '@/lib/db'
import AdminLogout from './AdminLogout'
import SoundLibraryPanel from './SoundLibraryPanel'
import MidiPresetsPanel from './MidiPresetsPanel'
import PotentialSamplesPanel from './PotentialSamplesPanel'
import AdvisorPanel from './AdvisorPanel'
import CollapsibleSection from './CollapsibleSection'
import PlatformFlagsPanel from './PlatformFlagsPanel'
import { estimateCost } from '@/lib/ai-logger'
import { getFlags, getWeeklyReport } from '@/lib/platform-flags'

export const dynamic = 'force-dynamic'

// Per-plan limits mirrored from stripe.ts (avoids circular import)
const PLAN_LIMITS = {
  free: { aiGenerationsPerMonth: 10 },
  pro:  { aiGenerationsPerMonth: 100 },
} as const

async function getStats() {
  const [users, proUsers, newThisWeek, newThisMonth, projects, projectsThisWeek] = await Promise.all([
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions`,
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE plan = 'pro' AND status = 'active'`,
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE updated_at > NOW() - INTERVAL '7 days'`,
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE updated_at > NOW() - INTERVAL '30 days'`,
    sql`SELECT COUNT(*)::int AS cnt FROM projects WHERE deleted_at IS NULL`,
    sql`SELECT COUNT(*)::int AS cnt FROM projects WHERE deleted_at IS NULL AND saved_at > NOW() - INTERVAL '7 days'`,
  ])
  return {
    totalUsers:       Number(users[0]?.cnt ?? 0),
    proUsers:         Number(proUsers[0]?.cnt ?? 0),
    newThisWeek:      Number(newThisWeek[0]?.cnt ?? 0),
    newThisMonth:     Number(newThisMonth[0]?.cnt ?? 0),
    totalProjects:    Number(projects[0]?.cnt ?? 0),
    projectsThisWeek: Number(projectsThisWeek[0]?.cnt ?? 0),
  }
}

async function getAiStats() {
  // Per-route breakdown for the current month
  const routeRows = await sql`
    SELECT route, model, COUNT(*)::int AS calls, SUM(tokens_in)::bigint AS tokens_in, SUM(tokens_out)::bigint AS tokens_out
    FROM ai_calls
    WHERE called_at > DATE_TRUNC('month', NOW())
    GROUP BY route, model
    ORDER BY calls DESC
  `.catch(() => [] as { route: string; model: string; calls: number; tokens_in: number; tokens_out: number }[])

  // All-time totals
  const totals = await sql`
    SELECT SUM(tokens_in)::bigint AS tin, SUM(tokens_out)::bigint AS tout, COUNT(*)::int AS calls
    FROM ai_calls
    WHERE called_at > DATE_TRUNC('month', NOW())
  `.catch(() => [{ tin: 0, tout: 0, calls: 0 }])

  // Users who have hit their monthly AI limit
  const limitHitRows = await sql`
    SELECT COUNT(DISTINCT u.user_id)::int AS cnt
    FROM usage u
    JOIN subscriptions s ON s.user_id = u.user_id
    WHERE u.action = 'ai_generate'
      AND u.reset_at > NOW()
      AND (
        (s.plan = 'free' AND u.count >= ${PLAN_LIMITS.free.aiGenerationsPerMonth}) OR
        (s.plan = 'pro'  AND u.count >= ${PLAN_LIMITS.pro.aiGenerationsPerMonth})
      )
  `.catch(() => [{ cnt: 0 }])

  // Users near limit (>= 80% used)
  const nearLimitRows = await sql`
    SELECT COUNT(DISTINCT u.user_id)::int AS cnt
    FROM usage u
    JOIN subscriptions s ON s.user_id = u.user_id
    WHERE u.action = 'ai_generate'
      AND u.reset_at > NOW()
      AND (
        (s.plan = 'free' AND u.count >= ${Math.floor(PLAN_LIMITS.free.aiGenerationsPerMonth * 0.8)}) OR
        (s.plan = 'pro'  AND u.count >= ${Math.floor(PLAN_LIMITS.pro.aiGenerationsPerMonth * 0.8)})
      )
  `.catch(() => [{ cnt: 0 }])

  // Top users by AI calls this month
  const topUsers = await sql`
    SELECT user_id, COUNT(*)::int AS calls, SUM(tokens_in + tokens_out)::bigint AS tokens
    FROM ai_calls
    WHERE called_at > DATE_TRUNC('month', NOW())
    GROUP BY user_id
    ORDER BY calls DESC
    LIMIT 5
  `.catch(() => [] as { user_id: string; calls: number; tokens: number }[])

  const rows = routeRows as { route: string; model: string; calls: number; tokens_in: number; tokens_out: number }[]
  const totalRow = (totals as { tin: number; tout: number; calls: number }[])[0] ?? { tin: 0, tout: 0, calls: 0 }

  const totalCost = rows.reduce((sum, r) => sum + estimateCost(r.model, Number(r.tokens_in), Number(r.tokens_out)), 0)

  return {
    routes:       rows,
    totalCalls:   Number(totalRow.calls ?? 0),
    totalTokensIn: Number(totalRow.tin ?? 0),
    totalTokensOut: Number(totalRow.tout ?? 0),
    totalCost,
    usersAtLimit:  Number((limitHitRows as { cnt: number }[])[0]?.cnt ?? 0),
    usersNearLimit: Number((nearLimitRows as { cnt: number }[])[0]?.cnt ?? 0),
    topUsers:     (topUsers as { user_id: string; calls: number; tokens: number }[]),
  }
}

async function getRecentUsers() {
  return sql`
    SELECT stripe_customer_id, plan, status, updated_at
    FROM subscriptions
    ORDER BY updated_at DESC
    LIMIT 10
  `
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

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4 mt-10 first:mt-0 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
      <h2 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      {description && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{description}</p>}
    </div>
  )
}

const ROUTE_LABELS: Record<string, string> = {
  'ai/generate':    'AI Generate (general)',
  'beat/reflect':   'Beat Reflection',
  'beat/reflection':'Beat Reflection',
  'beat/classify':  'Beat Classifier',
  'beat/adjust':    'Beat Adjust',
  'synth/tune':     'Synth Tuner',
}

export default async function AdminPage() {
  const [stats, aiStats, recentUsers, flags, weeklyReport] = await Promise.all([
    getStats(), getAiStats(), getRecentUsers(), getFlags(), getWeeklyReport(),
  ])
  const conversionRate = stats.totalUsers > 0
    ? ((stats.proUsers / stats.totalUsers) * 100).toFixed(1)
    : '0'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-8 max-w-5xl">

        {/* Page title */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Admin</h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--accent-light)', border: '1px solid rgba(139,92,246,0.3)' }}>
              Dev only
            </span>
            <AdminLogout />
          </div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Live stats — refreshes on page load</p>
        </div>

        {/* ── Module Gates ──────────────────────────────────────────────────── */}
        <SectionHeader title="Module Gates" description="Control which modules and audio modes are live for all users." />
        <PlatformFlagsPanel initial={flags} />

        {/* ── User Analytics ────────────────────────────────────────────────── */}
        <SectionHeader title="Users" description="Signups, subscriptions, and project activity." />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Stat label="Total users"      value={stats.totalUsers} />
          <Stat label="Pro subscribers"  value={stats.proUsers}  sub={`${conversionRate}% conversion`} />
          <Stat label="New this week"    value={stats.newThisWeek} />
          <Stat label="New this month"   value={stats.newThisMonth} />
        </div>
        <div className="grid grid-cols-2 gap-4 mb-6">
          <Stat label="Total projects"      value={stats.totalProjects} />
          <Stat label="Projects this week"  value={stats.projectsThisWeek} />
        </div>

        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Recent accounts</p>
        <div className="rounded-xl border overflow-hidden mb-2" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                {['Stripe customer', 'Plan', 'Status', 'Last updated'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentUsers.map((u, i) => (
                <tr key={String(u.stripe_customer_id ?? i)}
                  style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-surface)' }}>
                  <td className="px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{String(u.stripe_customer_id ?? '—')}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={u.plan === 'pro'
                        ? { background: 'rgba(139,92,246,0.15)', color: 'var(--accent-light)' }
                        : { background: 'var(--bg-base)', color: 'var(--text-muted)' }}>
                      {String(u.plan)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: u.status === 'active' ? 'var(--success)' : 'var(--error)' }}>{String(u.status)}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {u.updated_at ? new Date(String(u.updated_at)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── AI Cost & Usage ───────────────────────────────────────────────── */}
        <SectionHeader title="AI Cost & Usage" description="This month's Anthropic spend, usage by feature, and users hitting limits." />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Stat label="AI spend this month"  value={`$${aiStats.totalCost.toFixed(4)}`} sub={`${aiStats.totalCalls.toLocaleString()} calls`} />
          <Stat label="Total tokens in"      value={aiStats.totalTokensIn.toLocaleString()} sub="input tokens" />
          <Stat label="Total tokens out"     value={aiStats.totalTokensOut.toLocaleString()} sub="output tokens" />
          <Stat label="Users at limit"       value={aiStats.usersAtLimit} sub={`${aiStats.usersNearLimit} near limit (≥80%)`} warn={aiStats.usersAtLimit > 0} />
        </div>

        {/* Per-route breakdown */}
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Spend by feature</p>
        {aiStats.routes.length === 0 ? (
          <p className="text-xs mb-6" style={{ color: 'var(--text-muted)' }}>No AI calls logged yet this month. Calls will appear here after users interact with AI features.</p>
        ) : (
          <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                  {['Feature', 'Model', 'Calls', 'Tokens in', 'Tokens out', 'Cost (est.)'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {aiStats.routes.map((r, i) => {
                  const cost = estimateCost(r.model, Number(r.tokens_in), Number(r.tokens_out))
                  const modelShort = r.model.includes('sonnet') ? 'Sonnet' : r.model.includes('opus') ? 'Opus' : 'Haiku'
                  return (
                    <tr key={r.route} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-surface)' }}>
                      <td className="px-4 py-2.5 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{ROUTE_LABELS[r.route] ?? r.route}</td>
                      <td className="px-4 py-2.5 text-xs">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                          style={r.model.includes('sonnet') || r.model.includes('opus')
                            ? { background: 'rgba(239,68,68,0.1)', color: '#ef4444' }
                            : { background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
                          {modelShort}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{Number(r.calls).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{Number(r.tokens_in).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{Number(r.tokens_out).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-xs font-mono" style={{ color: cost > 0.01 ? '#f97316' : 'var(--text-secondary)' }}>${cost.toFixed(4)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Top users by AI usage */}
        {aiStats.topUsers.length > 0 && (
          <>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Heaviest AI users this month</p>
            <div className="rounded-xl border overflow-hidden mb-2" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                    {['User ID', 'Calls', 'Total tokens'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {aiStats.topUsers.map((u, i) => (
                    <tr key={u.user_id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-surface)' }}>
                      <td className="px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{u.user_id}</td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-primary)' }}>{Number(u.calls).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{Number(u.tokens).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Weekly Report ─────────────────────────────────────────────────── */}
        <SectionHeader
          title="Weekly Growth Report"
          description="Auto-generated every Monday at 9am UTC by the AI advisor. Run /api/cron/weekly-report manually to trigger."
        />
        {weeklyReport ? (
          <div style={{
            padding: '16px 20px', borderRadius: 10,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
          }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 12 }}>
              Generated {new Date(weeklyReport.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
            <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {weeklyReport.content}
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            No report yet. It runs every Monday at 9am UTC, or you can trigger it manually via GET /api/cron/weekly-report with the correct Authorization header.
          </p>
        )}

        {/* ── AI Advisor ────────────────────────────────────────────────────── */}
        <SectionHeader
          title="AI Business Advisor"
          description="Claude Sonnet with live access to your platform metrics. Ask about marketing, growth, compliance, pricing, or user acquisition."
        />
        <AdvisorPanel />

        {/* ── Audio Editor ──────────────────────────────────────────────────── */}
        <SectionHeader
          title="Audio Editor"
          description="Sound library, MIDI presets, and per-note sample management. All stored in your browser's IndexedDB / localStorage."
        />

        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Sound Library</p>
        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
          Upload samples, rename entries, change categories and folders, or delete anything. These are the same samples that appear in the editor&apos;s Sound Library panel.
        </p>
        <SoundLibraryPanel />

        <p className="text-xs font-semibold uppercase tracking-wider mt-6 mb-2" style={{ color: 'var(--text-muted)' }}>MIDI Instrument Presets</p>
        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
          Presets map an instrument name to a sound library folder of per-note samples (e.g. &ldquo;Violin — G3→E7&rdquo;). When selected in Voice MIDI, each detected note plays the exact matching sample — no pitch shifting. Built-in presets cover all seeded keyboard note folders. Add custom presets by pointing to any library folder with note-named entries.
        </p>
        <MidiPresetsPanel />

        {/* ── Potential Samples ─────────────────────────────────────────────── */}
        <CollapsibleSection
          title="Potential Samples and Packs"
          description="Preview and add new instrument sample packs from the FluidR3 GM soundfont. Every instrument covers the full 88-key range (A0–C8, MIDI 21–108) — all notes are individually sampled, no pitch-shifting."
        >
          <PotentialSamplesPanel />
        </CollapsibleSection>

        {/* ── Quick links ───────────────────────────────────────────────────── */}
        <SectionHeader title="Quick Links" />
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Stripe dashboard',    url: 'https://dashboard.stripe.com' },
            { label: 'Neon database',       url: 'https://console.neon.tech' },
            { label: 'Clerk dashboard',     url: 'https://dashboard.clerk.com' },
            { label: 'Cloudflare R2',       url: 'https://dash.cloudflare.com' },
            { label: 'Vercel deployments',  url: 'https://vercel.com/dashboard' },
            { label: 'PostHog analytics',   url: 'https://app.posthog.com' },
            { label: 'Sentry errors',       url: 'https://sentry.io' },
          ].map(({ label, url }) => (
            <a key={label} href={url} target="_blank" rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              {label} ↗
            </a>
          ))}
        </div>

      </div>
    </div>
  )
}
