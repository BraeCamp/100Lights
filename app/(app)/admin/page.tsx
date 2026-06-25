import { sql } from '@/lib/db'
import AdminLogout from './AdminLogout'
import CorrectionsPanel from './CorrectionsPanel'
import ClusterCorrectionsPanel from './ClusterCorrectionsPanel'
import SoundLibraryPanel from './SoundLibraryPanel'
import MidiPresetsPanel from './MidiPresetsPanel'

export const dynamic = 'force-dynamic'

async function getStats() {
  const [users, proUsers, newThisWeek, projects, projectsThisWeek, usageRows] = await Promise.all([
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions`,
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE plan = 'pro' AND status = 'active'`,
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE updated_at > NOW() - INTERVAL '7 days'`,
    sql`SELECT COUNT(*)::int AS cnt FROM projects WHERE deleted_at IS NULL`,
    sql`SELECT COUNT(*)::int AS cnt FROM projects WHERE deleted_at IS NULL AND saved_at > NOW() - INTERVAL '7 days'`,
    sql`SELECT action, SUM(count)::int AS total FROM usage WHERE reset_at > NOW() GROUP BY action`,
  ])
  return {
    totalUsers:        Number(users[0]?.cnt ?? 0),
    proUsers:          Number(proUsers[0]?.cnt ?? 0),
    newThisWeek:       Number(newThisWeek[0]?.cnt ?? 0),
    totalProjects:     Number(projects[0]?.cnt ?? 0),
    projectsThisWeek:  Number(projects[0]?.cnt ?? 0),
    transcriptions:    Number(usageRows.find(r => r.action === 'transcribe')?.total ?? 0),
    aiGenerations:     Number(usageRows.find(r => r.action === 'ai_generate')?.total ?? 0),
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

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
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

export default async function AdminPage() {
  const [stats, recentUsers] = await Promise.all([getStats(), getRecentUsers()])
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

        {/* ── Analytics ─────────────────────────────────────────────────────── */}
        <SectionHeader title="Analytics" description="Live platform stats and usage." />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Stat label="Total users" value={stats.totalUsers} />
          <Stat label="Pro subscribers" value={stats.proUsers} sub={`${conversionRate}% conversion`} />
          <Stat label="New this week" value={stats.newThisWeek} />
          <Stat label="Total projects" value={stats.totalProjects} sub={`${stats.projectsThisWeek} this week`} />
        </div>

        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Usage this month</p>
        <div className="grid grid-cols-2 gap-4 mb-6">
          <Stat label="Transcriptions run" value={stats.transcriptions} />
          <Stat label="AI generations run" value={stats.aiGenerations} />
        </div>

        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Recent accounts</p>
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
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

        {/* ── Machine Learning ──────────────────────────────────────────────── */}
        <SectionHeader
          title="Machine Learning"
          description="Learned corrections used by the beat classifier and audio separator."
        />

        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Audio Separation — learned sounds</p>
        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
          Fingerprints saved when you click &ldquo;✓ This is distinct&rdquo; in the crop editor. Each unique fingerprint anchors a cluster on the next separation run.
        </p>
        <ClusterCorrectionsPanel />

        <p className="text-xs font-semibold uppercase tracking-wider mt-6 mb-2" style={{ color: 'var(--text-muted)' }}>Beat Lab AI corrections</p>
        <CorrectionsPanel />

        {/* ── Quick links ───────────────────────────────────────────────────── */}
        <SectionHeader title="Quick Links" />
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Stripe dashboard', url: 'https://dashboard.stripe.com' },
            { label: 'Neon database',    url: 'https://console.neon.tech' },
            { label: 'Clerk dashboard',  url: 'https://dashboard.clerk.com' },
            { label: 'Cloudflare R2',    url: 'https://dash.cloudflare.com' },
            { label: 'Vercel deployments', url: 'https://vercel.com/dashboard' },
            { label: 'PostHog analytics',  url: 'https://app.posthog.com' },
            { label: 'Sentry errors',      url: 'https://sentry.io' },
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
