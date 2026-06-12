'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { PlusCircle, Film, Clock, FileText, ArrowRight } from 'lucide-react'

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

export default function DashboardPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.ok ? r.json() : [])
      .then((data: ProjectSummary[]) => setProjects(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const recentProjects = projects.slice(0, 5)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-8 max-w-5xl">
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
          ) : recentProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No projects yet</p>
              <p className="text-xs mb-5" style={{ color: 'var(--text-muted)' }}>Create your first project to get started</p>
              <Link href="/new" className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg" style={{ background: 'var(--accent)', color: '#fff' }}>
                <PlusCircle size={14} /> New project
              </Link>
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

        <div
          className="mt-8 flex items-center justify-between p-5 rounded-xl border"
          style={{ background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.08), rgba(59, 130, 246, 0.06))', borderColor: 'rgba(139, 92, 246, 0.2)' }}
        >
          <div>
            <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Try a live demo</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>See the full pipeline run with a sample podcast episode</div>
          </div>
          <Link
            href="/projects/demo"
            className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Watch it run <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  )
}
