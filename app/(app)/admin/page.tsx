import { sql } from '@/lib/db'
import AdminLogout from './AdminLogout'
import UsersPanel from './UsersPanel'
import SoundLibraryPanel from './SoundLibraryPanel'
import MidiPresetsPanel from './MidiPresetsPanel'
import PotentialSamplesPanel from './PotentialSamplesPanel'
import ClusterCorrectionsPanel from './ClusterCorrectionsPanel'
import PlatformFlagsPanel from './PlatformFlagsPanel'
import AdminTabs, { type AdminTab } from './AdminTabs'
import { getFlags } from '@/lib/platform-flags'

export const dynamic = 'force-dynamic'

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

function Stat({ label, value, sub, warn }: { label: string; value: number | string; sub?: string; warn?: boolean }) {
  return (
    <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: warn ? 'rgba(239,68,68,0.35)' : 'var(--border)' }}>
      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: warn ? '#ef4444' : 'var(--text-primary)' }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
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
  const [stats, flags] = await Promise.all([getStats(), getFlags()])
  const conversionRate = stats.totalUsers > 0
    ? ((stats.proUsers / stats.totalUsers) * 100).toFixed(1)
    : '0'

  const tabs: AdminTab[] = [
    {
      id: 'general',
      label: 'General',
      subtabs: [
        {
          id: 'overview',
          label: 'Overview',
          content: (
            <>
              <PanelIntro title="Platform Overview" description="Signups, subscriptions, and project activity. Refreshes on page load." />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <Stat label="Total users"      value={stats.totalUsers} />
                <Stat label="Pro subscribers"  value={stats.proUsers}  sub={`${conversionRate}% conversion`} />
                <Stat label="New this week"    value={stats.newThisWeek} />
                <Stat label="New this month"   value={stats.newThisMonth} />
              </div>
              <div className="grid grid-cols-2 gap-4" style={{ maxWidth: 480 }}>
                <Stat label="Total projects"      value={stats.totalProjects} />
                <Stat label="Projects this week"  value={stats.projectsThisWeek} />
              </div>
            </>
          ),
        },
        {
          id: 'users',
          label: 'Users',
          content: (
            <>
              <PanelIntro title="Users" description="Search users, manage plans, and gift Pro time." />
              <UsersPanel />
            </>
          ),
        },
        {
          id: 'visibility',
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
          id: 'links',
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
          id: 'sound-library',
          label: 'Sound Library',
          content: (
            <>
              <PanelIntro
                title="Sound Library"
                description="Upload samples, rename entries, change categories and folders, or delete anything. These are the same samples that appear in the editor's Sound Library panel. Stored in your browser's IndexedDB."
              />
              <SoundLibraryPanel />
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
      label: 'Video',
      color: '#3b82f6',
      subtabs: [
        { id: 'overview', label: 'Overview', content: <ComingSoon module="video" /> },
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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-8 max-w-5xl">

        {/* Page title */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Admin</h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(139,92,246,0.15)', color: 'var(--accent-light)', border: '1px solid rgba(139,92,246,0.3)' }}>
              Dev only
            </span>
            <AdminLogout />
          </div>
        </div>

        <AdminTabs tabs={tabs} />

      </div>
    </div>
  )
}
