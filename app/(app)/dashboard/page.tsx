'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'
import {
  Film, AudioLines, Palette,
  ArrowRight, AlertCircle, RefreshCw, CheckCircle2, X,
  Star, Pencil, ExternalLink, Clock, LogIn,
} from 'lucide-react'
import type { ModuleKey } from '@/lib/editor-types'
import { MODULE_DEFS } from '@/lib/editor-types'

const ICONS: Record<ModuleKey, React.ComponentType<{ size?: number; color?: string }>> = {
  video: Film,
  audio: AudioLines,
  image: Palette,
}

interface ProjectSummary {
  id: string
  name: string
  savedAt: string
  starred: boolean
  clips: number
  media: number
  thumbnail: string | null
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function UpgradeBanner() {
  const searchParams = useSearchParams()
  const [visible, setVisible] = useState(searchParams.get('upgraded') === '1')
  if (!visible) return null
  return (
    <div
      className="mb-6 flex items-center justify-between gap-4 px-5 py-4 rounded-xl border"
      style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.1))', borderColor: 'rgba(139,92,246,0.4)' }}
    >
      <div className="flex items-center gap-3">
        <CheckCircle2 size={18} color="var(--accent-light)" />
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Welcome to Pro!</p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>You now have 100 AI generations and 20 GB of storage per month.</p>
        </div>
      </div>
      <button onClick={() => setVisible(false)} aria-label="Dismiss" style={{ color: 'var(--text-muted)' }}><X size={16} /></button>
    </div>
  )
}

function AppCard({ mod }: { mod: typeof MODULE_DEFS[number] }) {
  const Icon = ICONS[mod.key]
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 12,
        border: `1px solid ${hovered ? mod.color + '55' : 'var(--border)'}`,
        background: hovered
          ? `color-mix(in srgb, ${mod.color} 6%, var(--bg-card))`
          : 'var(--bg-card)',
        overflow: 'hidden',
        transition: 'border-color 0.15s, background 0.15s',
        cursor: 'default',
      }}
    >
      {/* Colored top strip */}
      <div style={{
        height: 3,
        background: mod.color,
        opacity: hovered ? 1 : 0.6,
        transition: 'opacity 0.15s',
      }} />

      {/* Body */}
      <div style={{ padding: '20px 20px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Icon + name row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `color-mix(in srgb, ${mod.color} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${mod.color} 25%, transparent)`,
          }}>
            <Icon size={20} color={mod.color} />
          </div>
        </div>

        <div style={{
          fontSize: 13, fontWeight: 700, letterSpacing: '0.04em',
          color: 'var(--text-primary)', marginBottom: 4,
        }}>
          {mod.label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.4 }}>
          {mod.tagline}
        </div>

        {/* Feature bullets */}
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          {mod.features.map(f => (
            <li key={f} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              <span style={{ color: mod.color, fontSize: 7, flexShrink: 0 }}>▸</span>
              {f}
            </li>
          ))}
        </ul>
      </div>

      {/* Footer CTA */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
        <Link
          href={`/apps/${mod.key}`}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '8px 0', borderRadius: 7, fontSize: 12, fontWeight: 600,
            background: hovered ? mod.color : 'transparent',
            color: hovered ? '#fff' : mod.color,
            border: `1px solid ${hovered ? mod.color : mod.color + '55'}`,
            textDecoration: 'none',
            transition: 'background 0.15s, color 0.15s, border-color 0.15s',
          }}
        >
          Open <ExternalLink size={11} />
        </Link>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { user, isSignedIn, isLoaded } = useUser()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null)
  const ctxRef = useRef<HTMLDivElement>(null)

  function startRename(id: string, currentName: string) {
    setRenamingId(id)
    setRenameValue(currentName)
  }

  function commitRename(id: string) {
    const trimmed = renameValue.trim()
    setRenamingId(null)
    if (!trimmed) return
    const prev = projects.find(p => p.id === id)?.name
    if (trimmed === prev) return
    setProjects(ps => ps.map(p => p.id === id ? { ...p, name: trimmed } : p))
    fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    }).catch(() => {
      if (prev !== undefined) setProjects(ps => ps.map(p => p.id === id ? { ...p, name: prev } : p))
    })
  }

  function loadProjects() {
    setLoading(true)
    setError(false)
    fetch('/api/projects')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((data: ProjectSummary[]) => setProjects(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (isLoaded && isSignedIn) loadProjects(); else if (isLoaded && !isSignedIn) setLoading(false) }, [isLoaded, isSignedIn])

  useEffect(() => {
    if (!ctxMenu) return
    const close = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [ctxMenu])

  const firstName = user?.firstName ?? user?.username ?? null
  const recentProjects = projects.slice(0, 6)

  return (
    <>
    <main className="flex-1 overflow-y-auto">
      <div style={{ padding: '40px 40px 60px', maxWidth: 1100 }}>
        <Suspense fallback={null}><UpgradeBanner /></Suspense>

        {/* Greeting */}
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            {firstName ? `Hey, ${firstName}.` : 'Welcome back.'}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            What are you building today?
          </p>
        </div>

        {/* ── App Launcher Grid ── */}
        <section style={{ marginBottom: 52 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Your Apps
            </h2>
            <Link
              href="/new"
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--accent-light)', textDecoration: 'none' }}
            >
              New project <ArrowRight size={11} />
            </Link>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 12,
          }}>
            {MODULE_DEFS.map(mod => (
              <AppCard key={mod.key} mod={mod} />
            ))}
          </div>
        </section>

        {/* ── Recent Projects ── */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Recent Projects
            </h2>
            <Link href="/projects" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent-light)', textDecoration: 'none' }}>
              View all <ArrowRight size={11} />
            </Link>
          </div>

          {!isSignedIn && isLoaded ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderRadius: 12, border: '1px solid rgba(139,92,246,0.25)', background: 'linear-gradient(135deg, rgba(139,92,246,0.07), rgba(59,130,246,0.05))' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 3px' }}>Sign in to sync projects to the cloud</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Projects you create now are saved locally. Sign in to access them anywhere.</p>
              </div>
              <Link href="/sign-in" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, textDecoration: 'none', flexShrink: 0, marginLeft: 16 }}>
                <LogIn size={13} /> Sign in
              </Link>
            </div>
          ) : loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '36px 0', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</span>
            </div>
          ) : error ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '36px 0', gap: 12, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
              <AlertCircle size={18} color="var(--text-muted)" />
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>Failed to load projects</p>
              <button
                onClick={loadProjects}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          ) : recentProjects.length === 0 ? (
            <div style={{ padding: '36px 0', textAlign: 'center', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No projects yet — pick an app above to get started.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {recentProjects.map(project => (
                <div
                  key={project.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px', borderRadius: 10,
                    border: project.starred ? '1px solid rgba(139,92,246,0.35)' : '1px solid var(--border)',
                    background: 'var(--bg-card)', cursor: 'default',
                  }}
                  onContextMenu={e => { e.preventDefault(); setCtxMenu({ id: project.id, name: project.name, x: e.clientX, y: e.clientY }) }}
                >
                  <Link
                    href={`/projects/${project.id}`}
                    style={{
                      width: 40, height: 28, borderRadius: 6, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--border)', overflow: 'hidden', textDecoration: 'none',
                    }}
                  >
                    {project.thumbnail
                      ? <img src={project.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                      : <Film size={14} color="var(--text-secondary)" />
                    }
                  </Link>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {renamingId === project.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(project.id)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(project.id); if (e.key === 'Escape') setRenamingId(null) }}
                        style={{ fontSize: 12, fontWeight: 500, background: 'transparent', outline: 'none', borderBottom: '1px solid var(--accent)', width: '100%', color: 'var(--text-primary)' }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <Link
                        href={`/projects/${project.id}`}
                        style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {project.name}
                      </Link>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <Clock size={9} color="var(--text-muted)" />
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{formatDate(project.savedAt)}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                    <button
                      onClick={() => startRename(project.id, project.name)}
                      title="Rename"
                      style={{ padding: 5, borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', opacity: 0.5 }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={() => {
                        setProjects(prev => prev.map(p => p.id === project.id ? { ...p, starred: !p.starred } : p))
                        fetch(`/api/projects/${project.id}`, { method: 'PATCH' }).catch(() => {
                          setProjects(prev => prev.map(p => p.id === project.id ? { ...p, starred: !p.starred } : p))
                        })
                      }}
                      title={project.starred ? 'Unstar' : 'Star'}
                      style={{ padding: 5, borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: project.starred ? '#f59e0b' : 'var(--text-muted)' }}
                    >
                      <Star size={12} fill={project.starred ? '#f59e0b' : 'none'} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>

    {ctxMenu && (
      <div
        ref={ctxRef}
        style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 50, borderRadius: 8, padding: '4px 0', background: 'var(--bg-card)', border: '1px solid var(--border)', minWidth: 140, boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}
      >
        <button
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12, color: 'var(--text-primary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
          onMouseLeave={e => (e.currentTarget.style.background = '')}
          onClick={() => { startRename(ctxMenu.id, ctxMenu.name); setCtxMenu(null) }}
        >
          <Pencil size={12} /> Rename
        </button>
      </div>
    )}
    </>
  )
}
