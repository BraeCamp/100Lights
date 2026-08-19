'use client'
// "Continue where you left off" — signed-in users see their recent projects at
// the top of the home page, making / a real launcher instead of pure marketing.
// Renders nothing signed-out (and nothing while loading), so the static page is
// untouched for crawlers and first paint.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'
import { Clock, ArrowRight } from 'lucide-react'

interface ProjectSummary {
  id: string
  name: string
  savedAt: string
  thumbnail: string | null
}

function ago(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ContinueRow() {
  const { isSignedIn } = useUser()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)

  useEffect(() => {
    if (!isSignedIn) return
    fetch('/api/projects')
      .then(r => (r.ok ? r.json() : []))
      .then((d: ProjectSummary[]) => setProjects(d.slice(0, 4)))
      .catch(() => setProjects([]))
  }, [isSignedIn])

  if (!isSignedIn || !projects || projects.length === 0) return null

  return (
    <section aria-label="Continue where you left off" className="max-w-6xl mx-auto px-6 pt-8">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>
          Continue
        </h2>
        <Link href="/projects" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent-light)', textDecoration: 'none' }}>
          All projects <ArrowRight size={11} />
        </Link>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {projects.map(p => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 10,
              border: '1px solid var(--border)', background: 'var(--bg-card)', textDecoration: 'none',
            }}
          >
            <span style={{ width: 38, height: 27, borderRadius: 6, flexShrink: 0, overflow: 'hidden', background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {p.thumbnail
                ? <img src={p.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span aria-hidden="true" style={{ fontSize: 13 }}>🎵</span>}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                <Clock size={9} /> {ago(p.savedAt)}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
