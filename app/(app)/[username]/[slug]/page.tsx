'use client'

// Canonical project URL: /@username/<readable-slug>-<code>. The slug is cosmetic;
// the project resolves by the trailing <code>.
//
// This is a CLIENT component that resolves code→id via /api/projects/by-code
// (a route handler) and then renders exactly what /projects/[id] does. The
// previous SERVER-component version did the DB lookup itself and — only in
// production — silently fell into notFound() (a 404), while route-handler DB
// queries work fine. Mirroring the /projects/{id} client flow makes this route
// as reliable as the id-based one, so opening a project goes straight to the
// pretty URL with no /projects/{id} bounce.

import { use, useEffect, useState } from 'react'
import ProjectEditor from '@/components/editor/ProjectEditor'
import MobileDawClient from '@/components/mobile/MobileDawClient'
import { codeFromSlug } from '@/lib/project-url'

export default function ProjectBySlugPage({ params }: { params: Promise<{ username: string; slug: string }> }) {
  const { slug } = use(params)
  const code = codeFromSlug(slug)

  const [id, setId] = useState<string | null | undefined>(undefined) // undefined = loading, null = not found
  const [isMobile, setIsMobile] = useState<boolean | null>(null)

  // Device-adaptive, matching /projects/[id].
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth, h = window.innerHeight
      const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
      setIsMobile(w < 760 || (coarse && Math.min(w, h) < 760))
    }
    check()
    window.addEventListener('resize', check)
    window.addEventListener('orientationchange', check)
    return () => {
      window.removeEventListener('resize', check)
      window.removeEventListener('orientationchange', check)
    }
  }, [])

  // Resolve the short code to the project id via the (working) route handler.
  useEffect(() => {
    let alive = true
    fetch(`/api/projects/by-code/${encodeURIComponent(code)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive) setId(d && d.id ? (d.id as string) : null) })
      .catch(() => { if (alive) setId(null) })
    return () => { alive = false }
  }, [code])

  const centered = (msg: string) => (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>{msg}</div>
  )

  if (id === undefined || isMobile === null) return centered('Loading project…')
  if (id === null) return centered('Project not found.')
  if (isMobile) return <MobileDawClient projectId={id} />

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ProjectEditor projectId={id} projectName="…" allowImport />
    </div>
  )
}
