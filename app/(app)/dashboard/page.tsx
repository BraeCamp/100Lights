'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { PlusCircle, Film, ArrowRight, AlertCircle, RefreshCw, CheckCircle2, X, Star, Pencil } from 'lucide-react'

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
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>You now have 30 transcriptions and 100 AI generations per month.</p>
        </div>
      </div>
      <button onClick={() => setVisible(false)} style={{ color: 'var(--text-muted)' }}><X size={16} /></button>
    </div>
  )
}

export default function DashboardPage() {
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

  useEffect(() => { loadProjects() }, [])

  useEffect(() => {
    if (!ctxMenu) return
    const close = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [ctxMenu])

  const recentProjects = projects.slice(0, 5)

  return (
    <>
    <div className="flex-1 overflow-y-auto">
      <div className="p-8 max-w-5xl">
        <Suspense fallback={null}><UpgradeBanner /></Suspense>
        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Dashboard</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Your recent content and processing activity</p>
          </div>
          <Link
            href="/new"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            <PlusCircle size={15} />
            New project
          </Link>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recent projects</h2>
            <Link href="/projects" className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent-light)' }}>
              View all <ArrowRight size={12} />
            </Link>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-14 rounded-xl border gap-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <AlertCircle size={20} color="var(--text-muted)" />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Failed to load projects</p>
              <button
                onClick={loadProjects}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                style={{ background: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          ) : recentProjects.length === 0 ? (
            <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <div className="px-6 pt-8 pb-6 text-center border-b" style={{ borderColor: 'var(--border)' }}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-subtle)', border: '1px solid rgba(139,92,246,0.25)' }}>
                  <Film size={24} color="var(--accent-light)" />
                </div>
                <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                  Turn your first recording into content
                </h3>
                <p className="text-sm max-w-xs mx-auto mb-5" style={{ color: 'var(--text-secondary)' }}>
                  Upload a video, podcast, or audio file and 100Lights will transcribe it and generate articles, blog posts, and show notes automatically.
                </p>
                <Link
                  href="/new"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  <PlusCircle size={15} />
                  Create your first project
                </Link>
              </div>
              <div className="grid grid-cols-3 divide-x" style={{ borderColor: 'var(--border)' }}>
                {[
                  { step: '01', label: 'Upload any video or audio', sub: 'MP4, MOV, MP3, WAV — up to 4 GB' },
                  { step: '02', label: 'AI transcribes in minutes', sub: 'Word-for-word with timestamps' },
                  { step: '03', label: 'Generate content instantly', sub: 'Articles, blog posts, show notes' },
                ].map(({ step, label, sub }) => (
                  <div key={step} className="px-5 py-4" style={{ borderColor: 'var(--border)' }}>
                    <div className="text-lg font-bold mb-1.5" style={{ color: 'var(--border-light)' }}>{step}</div>
                    <div className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>{label}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{sub}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {recentProjects.map((project) => (
                <div
                  key={project.id}
                  className="group flex items-center gap-4 p-4 rounded-xl border transition-all"
                  style={{ background: 'var(--bg-card)', borderColor: project.starred ? 'rgba(139,92,246,0.4)' : 'var(--border)' }}
                  onContextMenu={e => { e.preventDefault(); setCtxMenu({ id: project.id, name: project.name, x: e.clientX, y: e.clientY }) }}
                >
                  <Link href={`/projects/${project.id}`} className="w-14 h-9 rounded-lg flex items-center justify-center shrink-0 overflow-hidden" style={{ background: 'var(--border)' }}>
                    {project.thumbnail
                      ? <img src={project.thumbnail} className="w-full h-full object-cover" alt="" />
                      : <Film size={16} color="var(--text-secondary)" />
                    }
                  </Link>
                  <div className="flex-1 min-w-0">
                    {renamingId === project.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(project.id)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(project.id); if (e.key === 'Escape') setRenamingId(null) }}
                        className="text-sm font-medium bg-transparent outline-none border-b w-full"
                        style={{ color: 'var(--text-primary)', borderColor: 'var(--accent)' }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-sm font-medium truncate block w-full hover:underline"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {project.name}
                      </Link>
                    )}
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {project.clips} clip{project.clips !== 1 ? 's' : ''} · {project.media} media file{project.media !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <Link href={`/projects/${project.id}`} className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{formatDate(project.savedAt)}</Link>
                  <button
                    onClick={() => startRename(project.id, project.name)}
                    title="Rename project"
                    className="p-1.5 rounded-lg shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => {
                      setProjects(prev => prev.map(p => p.id === project.id ? { ...p, starred: !p.starred } : p))
                      fetch(`/api/projects/${project.id}`, { method: 'PATCH' }).catch(() => {
                        setProjects(prev => prev.map(p => p.id === project.id ? { ...p, starred: !p.starred } : p))
                      })
                    }}
                    title={project.starred ? 'Unstar' : 'Star'}
                    className="p-1.5 rounded-lg shrink-0"
                    style={{ color: project.starred ? '#f59e0b' : 'var(--text-muted)' }}
                  >
                    <Star size={14} fill={project.starred ? '#f59e0b' : 'none'} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>

    {/* Right-click context menu */}
    {ctxMenu && (
      <div
        ref={ctxRef}
        className="fixed z-50 rounded-lg py-1 shadow-lg"
        style={{ top: ctxMenu.y, left: ctxMenu.x, background: 'var(--bg-card)', border: '1px solid var(--border)', minWidth: 140 }}
      >
        <button
          className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2"
          style={{ color: 'var(--text-primary)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
          onMouseLeave={e => (e.currentTarget.style.background = '')}
          onClick={() => { startRename(ctxMenu.id, ctxMenu.name); setCtxMenu(null) }}
        >
          <Pencil size={13} /> Rename
        </button>
      </div>
    )}
    </>
  )
}
