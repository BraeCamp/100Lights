'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Film, PlusCircle, Clock, FolderOpen, Trash2 } from 'lucide-react'
import { openProjectFromFile } from '@/lib/project-serializer'

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

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.ok ? r.json() : [])
      .then((data: ProjectSummary[]) => setProjects(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault()
    if (!confirm('Delete this project? This cannot be undone.')) return
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  async function handleOpenFromFile() {
    const cfproj = await openProjectFromFile()
    if (!cfproj) return
    localStorage.setItem(`cf_pending_cfproj_${cfproj.id}`, JSON.stringify(cfproj))
    window.location.href = `/projects/${cfproj.id}`
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-8 max-w-4xl">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>All Projects</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {loading ? 'Loading…' : `${projects.length} project${projects.length !== 1 ? 's' : ''} saved`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenFromFile}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              <FolderOpen size={15} />
              Open from File
            </button>
            <Link
              href="/new"
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              <PlusCircle size={15} />
              New project
            </Link>
          </div>
        </div>

        {/* Demo always listed at top */}
        <div className="flex flex-col gap-2 mb-4">
          <Link
            href="/projects/demo"
            className="flex items-center gap-4 p-4 rounded-xl border transition-all"
            style={{ background: 'var(--bg-card)', borderColor: 'rgba(139, 92, 246, 0.3)' }}
          >
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--accent-subtle)' }}>
              <Film size={16} color="var(--accent-light)" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                The Creator Mindset — Demo
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Sample podcast · 22 captions · 5 outputs</div>
            </div>
            <span className="text-xs font-medium px-2 py-1 rounded-full shrink-0" style={{ background: 'var(--accent-subtle)', color: 'var(--accent-light)' }}>
              Demo
            </span>
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading projects…</div>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--border)' }}>
              <Clock size={20} color="var(--text-muted)" />
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No projects yet</p>
            <p className="text-xs mb-5" style={{ color: 'var(--text-muted)' }}>Upload a video or audio file to get started</p>
            <Link href="/new" className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg" style={{ background: 'var(--accent)', color: '#fff' }}>
              <PlusCircle size={14} /> New project
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="group flex items-center gap-4 p-4 rounded-xl border transition-all"
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
                <button
                  onClick={(e) => handleDelete(e, project.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg"
                  style={{ color: 'var(--text-muted)' }}
                  title="Delete project"
                >
                  <Trash2 size={14} />
                </button>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
