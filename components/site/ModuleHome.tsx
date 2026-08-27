'use client'
// The front door of a flagship module — Beacon (/beacon, audio), Prism
// (/prism, video), Aperture (/aperture, image). One shared component; each
// module page is a thin wrapper passing its editor key. Internal data keys
// stay 'audio'/'video'/'image'; only the public identity is the light name.

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Film, AudioLines, Music2, Mic2, Palette,
  Plus, ArrowRight, Clock, Star, Pencil, RefreshCw, AlertCircle, FolderOpen,
} from 'lucide-react'
import { MODULE_DEFS } from '@/lib/editor-types'
import type { ModuleKey } from '@/lib/editor-types'
import { moduleEntry } from '@/lib/lights-registry'
import { useIsMobile } from '@/lib/use-is-mobile'
import { useProjectImport } from '@/components/site/useProjectImport'

const ICONS: Record<ModuleKey, React.ComponentType<{ size?: number; color?: string }>> = {
  video: Film,
  audio: AudioLines,
  image: Palette,
}

/** "Add a project" — opens or imports an existing file. Deliberately the quiet
 *  sibling of the New Project call to action: starting something new is what
 *  most people came for, but bringing a project in has to be possible from
 *  here, not only from All Projects. */
function AddProjectButton({ onClick, importing, signedIn }: {
  onClick: () => void; importing: boolean; signedIn: boolean | undefined
}) {
  return (
    <button
      onClick={onClick}
      disabled={importing}
      title={signedIn
        ? 'Open one file to edit, or select several to import them all'
        : 'Open a project file'}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '10px 18px', borderRadius: 10,
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600,
        cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.6 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      <FolderOpen size={14} />
      {importing ? 'Adding…' : 'Add a project'}
    </button>
  )
}

// Per-module hero copy — distinct identity for each app
const HERO_COPY: Record<ModuleKey, { headline: string; sub: string }> = {
  audio: { headline: 'Your Sound Studio',  sub: 'Compose, arrange, mix, and master — from first beat to final export.' },
  video: { headline: 'Your Editing Suite', sub: 'Cut, color grade, and export. Professional tools without the bloat.' },
  image: { headline: 'Your Design Canvas', sub: 'Layer-based graphics editor. Design thumbnails, brand assets, and social graphics.' },
}

interface ProjectSummary {
  id: string
  name: string
  savedAt: string
  starred: boolean
  clips: number
  media: number
  thumbnail: string | null
  modules: ModuleKey[] | null
}

function formatDate(iso: string) {
  const d = new Date(iso)
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ModuleHome({ moduleKey }: { moduleKey: ModuleKey }) {
  const isMobile = useIsMobile()

  const mod = MODULE_DEFS.find(m => m.key === moduleKey)!
  const light = moduleEntry(moduleKey)

  const Icon = ICONS[mod.key]
  const copy = HERO_COPY[mod.key]

  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null)
  const ctxRef = useRef<HTMLDivElement>(null)

  function loadProjects() {
    setLoading(true)
    setError(false)
    fetch('/api/projects')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((data: ProjectSummary[]) => setProjects(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadProjects() }, [])

  // Bringing an EXISTING project in. Until now these pages could only start
  // something new — every way of opening a file lived on /projects, so from
  // Beacon or Prism there was no way to add one. Same hook the All Projects
  // page uses, so the two cannot drift.
  const { importing, importMsg, openFromFile, isSignedIn } = useProjectImport(loadProjects)

  // Platform flags — a hidden module's app page bounces to the dashboard
  const router = useRouter()
  useEffect(() => {
    fetch('/api/platform-flags')
      .then(r => r.ok ? r.json() : null)
      .then((d: { enabledModules?: string[] } | null) => {
        if (d?.enabledModules && !d.enabledModules.includes(moduleKey)) router.replace('/dashboard')
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey])

  useEffect(() => {
    if (!ctxMenu) return
    const close = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [ctxMenu])

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

  // Filter to this module — null modules = legacy project (show everywhere for backward compat)
  const moduleProjects = projects.filter(p => !p.modules || p.modules.includes(mod.key))
  const recent = moduleProjects.slice(0, 8)

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Hero ── */}
      <div style={{
        position: 'relative',
        padding: isMobile ? '26px 18px 22px' : '52px 48px 44px',
        background: `linear-gradient(135deg, color-mix(in srgb, ${mod.color} 18%, #0d0d0f) 0%, #0d0d0f 70%)`,
        borderBottom: `1px solid color-mix(in srgb, ${mod.color} 20%, var(--border))`,
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        {/* Subtle glow behind icon */}
        <div style={{
          position: 'absolute', top: -60, left: -60, width: 320, height: 320, borderRadius: '50%',
          background: mod.color, opacity: 0.06, filter: 'blur(60px)', pointerEvents: 'none',
        }} />

        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'flex-start', justifyContent: 'space-between', gap: isMobile ? 16 : 24, position: 'relative' }}>
          <div style={{ flex: 1 }}>
            {/* Module badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `color-mix(in srgb, ${mod.color} 18%, transparent)`,
                border: `1px solid color-mix(in srgb, ${mod.color} 35%, transparent)`,
              }}>
                <Icon size={24} color={mod.color} />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: mod.color, marginBottom: 2 }}>
                  {light.name} · {mod.label}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{mod.tagline}</div>
              </div>
            </div>

            <h1 style={{ fontSize: isMobile ? 24 : 32, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 10, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              {copy.headline}
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 520, lineHeight: 1.6, marginBottom: 28 }}>
              {copy.sub}
            </p>

            {/* Feature pills */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {mod.features.map(f => (
                <span key={f} style={{
                  fontSize: 10, padding: '4px 10px', borderRadius: 20,
                  background: `color-mix(in srgb, ${mod.color} 10%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${mod.color} 22%, transparent)`,
                  color: `color-mix(in srgb, ${mod.color} 80%, var(--text-secondary))`,
                }}>
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, alignItems: isMobile ? 'stretch' : 'flex-end' }}>
            {mod.key === 'audio' ? (
              <>
                <Link
                  href="/create?modules=audio&audioMode=music"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '11px 18px', borderRadius: 10,
                    background: mod.color, color: '#fff',
                    fontSize: 13, fontWeight: 700, textDecoration: 'none',
                    boxShadow: `0 4px 20px color-mix(in srgb, ${mod.color} 35%, transparent)`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Music2 size={14} />
                  New Music Project
                </Link>
                <Link
                  href="/create?modules=audio&audioMode=podcast"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '11px 18px', borderRadius: 10,
                    background: 'rgba(249,115,22,0.12)', color: '#f97316',
                    fontSize: 13, fontWeight: 700, textDecoration: 'none',
                    border: '1px solid rgba(249,115,22,0.3)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Mic2 size={14} />
                  New Podcast
                </Link>
                <AddProjectButton onClick={openFromFile} importing={importing} signedIn={isSignedIn} />
              </>
            ) : (
              <Link
                href={`/create?modules=${mod.key}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '12px 22px', borderRadius: 10,
                  background: mod.color, color: '#fff',
                  fontSize: 13, fontWeight: 700, textDecoration: 'none',
                  boxShadow: `0 4px 20px color-mix(in srgb, ${mod.color} 35%, transparent)`,
                  whiteSpace: 'nowrap',
                }}
              >
                <Plus size={15} />
                New {mod.label} Project
              </Link>
            )}
            {mod.key !== 'audio' && (
              <AddProjectButton onClick={openFromFile} importing={importing} signedIn={isSignedIn} />
            )}
          </div>
        </div>
      </div>

      {importMsg && (
        <div style={{
          margin: '0 0 14px', padding: '10px 14px', borderRadius: 10, fontSize: 12.5,
          background: 'var(--accent-subtle)', border: '1px solid var(--border)',
          color: 'var(--text-primary)',
        }}>
          {importMsg}
        </div>
      )}

      {/* ── Projects ── */}
      <div style={{ flex: 1, padding: isMobile ? '24px 16px 48px' : '36px 48px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Recent {mod.label} Projects
          </h2>
          <Link href="/projects" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent-light)', textDecoration: 'none' }}>
            All projects <ArrowRight size={11} />
          </Link>
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</span>
          </div>
        ) : error ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 0', gap: 12, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            <AlertCircle size={18} color="var(--text-muted)" />
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>Failed to load projects</p>
            <button onClick={loadProjects} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        ) : recent.length === 0 ? (
          <div style={{
            padding: '56px 0', textAlign: 'center', borderRadius: 12,
            border: `1px dashed color-mix(in srgb, ${mod.color} 30%, var(--border))`,
            background: `color-mix(in srgb, ${mod.color} 3%, var(--bg-card))`,
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14, margin: '0 auto 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `color-mix(in srgb, ${mod.color} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${mod.color} 25%, transparent)`,
            }}>
              <Icon size={22} color={mod.color} />
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
              No {mod.label} projects yet
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 24 }}>
              Start a new one, or add a project you already have.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link
                href={`/create?modules=${mod.key}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '10px 20px', borderRadius: 8,
                  background: mod.color, color: '#fff',
                  fontSize: 12, fontWeight: 600, textDecoration: 'none',
                }}
              >
                <Plus size={13} /> New {mod.label} Project
              </Link>
              {/* An empty dashboard is exactly where someone who ALREADY has a
                  project file goes looking, and telling them to create their
                  first one is the wrong answer for them. */}
              <AddProjectButton onClick={openFromFile} importing={importing} signedIn={isSignedIn} />
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {recent.map(project => (
              <div
                key={project.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', borderRadius: 10,
                  border: project.starred
                    ? `1px solid color-mix(in srgb, ${mod.color} 35%, transparent)`
                    : '1px solid var(--border)',
                  background: 'var(--bg-card)', cursor: 'default',
                }}
                onContextMenu={e => { e.preventDefault(); setCtxMenu({ id: project.id, name: project.name, x: e.clientX, y: e.clientY }) }}
              >
                <Link
                  href={`/projects/${project.id}`}
                  style={{
                    width: 40, height: 28, borderRadius: 6, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: `color-mix(in srgb, ${mod.color} 10%, var(--border))`,
                    overflow: 'hidden', textDecoration: 'none',
                  }}
                >
                  {project.thumbnail
                    ? <img src={project.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                    : <Icon size={14} color={mod.color} />
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
                      style={{ fontSize: 12, fontWeight: 500, background: 'transparent', outline: 'none', borderBottom: `1px solid ${mod.color}`, width: '100%', color: 'var(--text-primary)' }}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    <Clock size={9} color="var(--text-muted)" />
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{formatDate(project.savedAt)}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                  <button
                    onClick={() => { setRenamingId(project.id); setRenameValue(project.name) }}
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
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 50, borderRadius: 8, padding: '4px 0', background: 'var(--bg-card)', border: '1px solid var(--border)', minWidth: 140, boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}
        >
          <button
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12, color: 'var(--text-primary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
            onClick={() => { setRenamingId(ctxMenu.id); setRenameValue(ctxMenu.name); setCtxMenu(null) }}
          >
            <Pencil size={12} /> Rename
          </button>
        </div>
      )}
    </div>
  )
}
