'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { PlusCircle, Film, Clock, FileText, ArrowRight, AlertCircle, RefreshCw, CheckCircle2, X } from 'lucide-react'

interface ProjectSummary {
  id: string
  name: string
  savedAt: string
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

  const recentProjects = projects.slice(0, 5)

  return (
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

        <div className="grid grid-cols-3 gap-4 mb-10">
          <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Projects</span>
              <FileText size={14} color="var(--text-muted)" />
            </div>
            <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {loading ? '—' : projects.length}
            </div>
          </div>
          <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Total clips</span>
              <Film size={14} color="var(--text-muted)" />
            </div>
            <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {loading ? '—' : projects.reduce((n, p) => n + p.clips, 0)}
            </div>
          </div>
          <div className="p-5 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Media files</span>
              <Clock size={14} color="var(--text-muted)" />
            </div>
            <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {loading ? '—' : projects.reduce((n, p) => n + p.media, 0)}
            </div>
          </div>
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
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center gap-4 p-4 rounded-xl border transition-all"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
                >
                  <div className="w-14 h-9 rounded-lg flex items-center justify-center shrink-0 overflow-hidden" style={{ background: 'var(--border)' }}>
                    {project.thumbnail
                      ? <img src={project.thumbnail} className="w-full h-full object-cover" alt="" />
                      : <Film size={16} color="var(--text-secondary)" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{project.name}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {project.clips} clip{project.clips !== 1 ? 's' : ''} · {project.media} media file{project.media !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{formatDate(project.savedAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
