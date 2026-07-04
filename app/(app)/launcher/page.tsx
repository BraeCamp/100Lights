'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { Film, AudioLines, Palette, Settings, Zap, Music, Mic } from 'lucide-react'
import Link from 'next/link'
import { MODULE_DEFS, type ModuleKey } from '@/lib/editor-types'
import { openModule } from '@/lib/electron'

// ── Types ────────────────────────────────────────────────────────────────────

interface LicenseInfo {
  owned: boolean
  licenseType: string | null
}

type LicenseMap = Record<ModuleKey, LicenseInfo>

interface ProjectSummary {
  id: string
  name: string
  savedAt: string
  thumbnail: string | null
  modules: string[] | null
}

// ── Constants ────────────────────────────────────────────────────────────────

const MODULE_ICONS: Record<ModuleKey, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  video: Film,
  audio: AudioLines,
  image: Palette,
}

const MODULE_PRICES: Record<string, string> = {
  video: '$79',
  image: '$39',
  audio: '',
}

// ── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--accent)',
        color: '#fff',
        padding: '10px 20px',
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 500,
        zIndex: 9999,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {message}
    </div>
  )
}

// ── Module card (owned) ───────────────────────────────────────────────────────

function OwnedModuleCard({ mod }: { mod: (typeof MODULE_DEFS)[number] }) {
  const router = useRouter()
  const Icon = MODULE_ICONS[mod.key]

  return (
    <div
      style={{
        width: 220,
        background: 'var(--bg-card)',
        borderRadius: 12,
        border: '1px solid var(--border)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        ;(e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card-hover)'
        ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-light)'
      }}
      onMouseLeave={e => {
        ;(e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card)'
        ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'
      }}
    >
      {/* Color strip */}
      <div style={{ height: 4, background: mod.color, flexShrink: 0 }} />

      <div style={{ padding: '16px 16px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: `${mod.color}22`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={20} strokeWidth={1.75} />
        </div>

        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {mod.label}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
            {mod.tagline}
          </div>
        </div>

        <button
          onClick={() => openModule(mod.key, router)}
          style={{
            marginTop: 'auto',
            width: '100%',
            padding: '7px 0',
            borderRadius: 7,
            border: 'none',
            background: mod.color,
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          Open →
        </button>
      </div>
    </div>
  )
}

// ── Audio sub-cards ───────────────────────────────────────────────────────────

function AudioSubCard({
  label,
  icon: Icon,
  mode,
  color,
}: {
  label: string
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>
  mode: string
  color: string
}) {
  const router = useRouter()

  function handleOpen() {
    if (typeof window !== 'undefined' && window.electronAPI) {
      void window.electronAPI.openModule(`audio?mode=${mode}`)
    } else {
      router.push(`/apps/audio?mode=${mode}`)
    }
  }

  return (
    <div
      onClick={handleOpen}
      style={{
        width: 160,
        background: 'var(--bg-card)',
        borderRadius: 10,
        border: '1px solid var(--border)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        ;(e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card-hover)'
        ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-light)'
      }}
      onMouseLeave={e => {
        ;(e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card)'
        ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'
      }}
    >
      <div style={{ height: 3, background: color }} />
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: `${color}22`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon size={16} strokeWidth={1.75} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
      </div>
    </div>
  )
}

// ── Unowned module card ────────────────────────────────────────────────────────

function UnownedModuleCard({ mod }: { mod: (typeof MODULE_DEFS)[number] }) {
  const [loading, setLoading] = useState(false)
  const Icon = MODULE_ICONS[mod.key]
  const price = MODULE_PRICES[mod.key]

  async function handleBuy() {
    setLoading(true)
    try {
      const res = await fetch('/api/modules/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleKey: mod.key }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        width: 220,
        background: 'var(--bg-card)',
        borderRadius: 12,
        border: '1px solid var(--border)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        opacity: 0.65,
      }}
    >
      <div style={{ height: 4, background: mod.color, flexShrink: 0, filter: 'grayscale(0.5)' }} />

      <div style={{ padding: '16px 16px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: `${mod.color}18`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={20} strokeWidth={1.75} />
        </div>

        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {mod.label}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
            {mod.tagline}
          </div>
        </div>

        <button
          onClick={handleBuy}
          disabled={loading}
          style={{
            marginTop: 'auto',
            width: '100%',
            padding: '7px 0',
            borderRadius: 7,
            border: '1px solid var(--border-light)',
            background: 'transparent',
            color: 'var(--text-primary)',
            fontSize: 13,
            fontWeight: 600,
            cursor: loading ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            opacity: loading ? 0.5 : 1,
          }}
        >
          {price && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{price}</span>}
          {loading ? 'Loading…' : 'Buy'}
        </button>
      </div>
    </div>
  )
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      style={{
        width: 220,
        height: 160,
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        overflow: 'hidden',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    >
      <div style={{ height: 4, background: 'var(--border-light)' }} />
    </div>
  )
}

// ── Recent project row ────────────────────────────────────────────────────────

function ProjectRow({ project }: { project: ProjectSummary }) {
  function formatDate(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const modIcons = (project.modules ?? []).slice(0, 3).map(k => {
    const Icon = MODULE_ICONS[k as ModuleKey]
    const mod = MODULE_DEFS.find(m => m.key === k)
    return Icon ? (
      <span
        key={k}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          borderRadius: 4,
          background: mod ? `${mod.color}22` : 'var(--border)',
        }}
      >
        <Icon size={12} strokeWidth={1.75} />
      </span>
    ) : null
  })

  return (
    <Link
      href={`/projects/${project.id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        borderRadius: 8,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        textDecoration: 'none',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => {
        ;(e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-card-hover)'
        ;(e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border-light)'
      }}
      onMouseLeave={e => {
        ;(e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-card)'
        ;(e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border)'
      }}
    >
      {project.thumbnail ? (
        <img
          src={project.thumbnail}
          alt=""
          style={{ width: 44, height: 30, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            width: 44,
            height: 30,
            borderRadius: 4,
            background: 'var(--border)',
            flexShrink: 0,
          }}
        />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {project.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
          {formatDate(project.savedAt)}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>{modIcons}</div>
    </Link>
  )
}

// ── Inner launcher (needs Suspense boundary for useSearchParams) ──────────────

function LauncherInner() {
  const { user } = useUser()
  const searchParams = useSearchParams()
  const [licenses, setLicenses] = useState<LicenseMap | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [isElectronMac, setIsElectronMac] = useState(false)

  useEffect(() => {
    setIsElectronMac(
      typeof window !== 'undefined' &&
      !!window.electronAPI &&
      navigator.platform.startsWith('Mac')
    )
  }, [])

  // Show activation toast from URL param
  useEffect(() => {
    const activated = searchParams.get('activated')
    if (activated) {
      const mod = MODULE_DEFS.find(m => m.key === activated)
      if (mod) setToast(`${mod.label} activated!`)
    }
  }, [searchParams])

  // Fetch licenses
  useEffect(() => {
    fetch('/api/modules/licenses')
      .then(r => r.json())
      .then((data: { licenses: LicenseMap }) => setLicenses(data.licenses))
      .catch(() => {})
  }, [])

  // Fetch recent projects
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then((data: ProjectSummary[]) => setProjects(data.slice(0, 6)))
      .catch(() => setProjects([]))
  }, [])

  const ownedMods = licenses
    ? MODULE_DEFS.filter(m => licenses[m.key]?.owned)
    : []
  const unownedMods = licenses
    ? MODULE_DEFS.filter(m => !licenses[m.key]?.owned)
    : []
  const audioOwned = licenses?.audio?.owned ?? false

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--bg-base)',
        color: 'var(--text-primary)',
        fontFamily: 'inherit',
        overflow: 'auto',
      }}
    >
      {/* Header */}
      {isElectronMac && (
        <style>{`.launcher-header{-webkit-app-region:drag}.launcher-nodrag{-webkit-app-region:no-drag}`}</style>
      )}
      <header
        className={isElectronMac ? 'launcher-header' : undefined}
        style={{
          height: 52,
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: isElectronMac ? 84 : 20,
          paddingRight: 20,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={18} color="var(--accent-light)" strokeWidth={2} />
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>100Lights</span>
        </div>

        <div className={isElectronMac ? 'launcher-nodrag' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user && (
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {user.username ?? user.fullName ?? user.primaryEmailAddress?.emailAddress?.split('@')[0]}
            </span>
          )}
          <Link
            href="/settings"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 13,
              color: 'var(--text-secondary)',
              textDecoration: 'none',
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'transparent',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => {
              ;(e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-card)'
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLAnchorElement).style.background = 'transparent'
            }}
          >
            <Settings size={13} strokeWidth={1.75} />
            Settings
          </Link>
        </div>
      </header>

      {/* Body */}
      <div style={{ flex: 1, padding: '28px 28px 40px', maxWidth: 960, width: '100%' }}>
        {/* YOUR APPS */}
        <section style={{ marginBottom: 36 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              marginBottom: 14,
            }}
          >
            Your Apps
          </div>

          {!licenses ? (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : ownedMods.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No apps yet. Get one below.</p>
          ) : (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {ownedMods.map(mod => (
                <OwnedModuleCard key={mod.key} mod={mod} />
              ))}
            </div>
          )}
        </section>

        {/* Audio sub-cards */}
        {audioOwned && (
          <section style={{ marginBottom: 36 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                marginBottom: 14,
              }}
            >
              Audio Modes
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <AudioSubCard label="Music" icon={Music} mode="music" color="#3b82f6" />
              <AudioSubCard label="Podcast" icon={Mic} mode="podcast" color="#6366f1" />
            </div>
          </section>
        )}

        {/* GET MORE APPS */}
        {unownedMods.length > 0 && (
          <section style={{ marginBottom: 36 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                marginBottom: 14,
              }}
            >
              Get More Apps
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {unownedMods.map(mod => (
                <UnownedModuleCard key={mod.key} mod={mod} />
              ))}
            </div>
          </section>
        )}

        {/* RECENT PROJECTS */}
        <section>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              marginBottom: 14,
            }}
          >
            Recent Projects
          </div>

          {projects === null ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  style={{
                    height: 52,
                    borderRadius: 8,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              No projects yet.{' '}
              <Link href="/new" style={{ color: 'var(--accent-light)', textDecoration: 'none' }}>
                Create one →
              </Link>
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 600 }}>
              {projects.map(p => (
                <ProjectRow key={p.id} project={p} />
              ))}
            </div>
          )}
        </section>
      </div>

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}

// ── Page export ───────────────────────────────────────────────────────────────

export default function LauncherPage() {
  return (
    <Suspense fallback={null}>
      <LauncherInner />
    </Suspense>
  )
}
