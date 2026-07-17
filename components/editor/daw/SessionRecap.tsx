'use client'

// "While you were away": on opening a project, summarize what changed since
// your last visit — clips others added (createdAt/createdBy stamps), new
// comments, and version checkpoints. Purely derived from persisted data; the
// only bookkeeping is a per-project last-seen timestamp in localStorage.

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import { useUser } from '@clerk/nextjs'

const seenKey = (projectId: string) => `100lights-last-seen-${projectId}`

export default function SessionRecap({ projectId }: { projectId: string }) {
  const { project } = useDaw()
  const { user, isLoaded } = useUser()
  const [lines, setLines] = useState<string[] | null>(null)
  const [keepFresh, setKeepFresh] = useState(false)
  const computedRef = useRef(false)

  useEffect(() => {
    if (computedRef.current || !isLoaded) return
    // Wait for the project to actually be loaded (tracks or clips present)
    if (project.tracks.length === 0 && project.arrangementClips.length === 0 && !(project.comments ?? []).length) return
    computedRef.current = true

    const me = user?.firstName || user?.username || ''
    const lastSeen = localStorage.getItem(seenKey(projectId))
    const touchSeen = () => localStorage.setItem(seenKey(projectId), new Date().toISOString())
    if (!lastSeen) { touchSeen(); setKeepFresh(true); return }  // first visit — nothing to recap

    const since = (iso?: string) => !!iso && iso > lastSeen
    const out: string[] = []

    // Clips added by others
    const newClips = project.arrangementClips.filter(c => since(c.createdAt) && c.createdBy && c.createdBy !== me)
    if (newClips.length) {
      const byAuthor = new Map<string, Set<string>>()
      for (const c of newClips) {
        const tracks = byAuthor.get(c.createdBy!) ?? new Set()
        tracks.add(project.tracks.find(t => t.id === c.trackId)?.name ?? 'a track')
        byAuthor.set(c.createdBy!, tracks)
      }
      for (const [author, tracks] of byAuthor) {
        const n = newClips.filter(c => c.createdBy === author).length
        out.push(`${author} added ${n} clip${n !== 1 ? 's' : ''} (${[...tracks].slice(0, 3).join(', ')})`)
      }
    }

    // New comments / replies from others
    const comments = project.comments ?? []
    const newComments = comments.filter(c => since(c.createdAt) && c.author !== me).length
      + comments.reduce((n, c) => n + (c.replies ?? []).filter(r => since(r.createdAt) && r.author !== me).length, 0)
    if (newComments) out.push(`${newComments} new comment${newComments !== 1 ? 's' : ''} on the timeline`)
    const unresolved = comments.filter(c => !c.resolved).length
    if (newComments && unresolved) out.push(`${unresolved} thread${unresolved !== 1 ? 's' : ''} still open`)

    // Version checkpoints (owner-only API — others just skip)
    fetch(`/api/projects/${projectId}/versions`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { versions?: Array<{ name: string; createdAt: string }> } | null) => {
        const vs = (d?.versions ?? []).filter(v => since(v.createdAt))
        const all = [...out]
        if (vs.length) all.push(`Version saved: ${vs.map(v => `“${v.name}”`).slice(0, 2).join(', ')}`)
        if (all.length) setLines(all)
        touchSeen()
        setKeepFresh(true)
      })
      .catch(() => { if (out.length) setLines(out); touchSeen(); setKeepFresh(true) })
  }, [project, projectId, user, isLoaded])

  // Keep last-seen fresh while the session runs (so a reload mid-session
  // doesn't recap your own visit)
  useEffect(() => {
    if (!keepFresh) return
    const iv = setInterval(() => localStorage.setItem(seenKey(projectId), new Date().toISOString()), 60_000)
    const onUnload = () => localStorage.setItem(seenKey(projectId), new Date().toISOString())
    window.addEventListener('beforeunload', onUnload)
    return () => { clearInterval(iv); window.removeEventListener('beforeunload', onUnload) }
  }, [keepFresh, projectId])

  useEffect(() => {
    if (!lines) return
    const t = setTimeout(() => setLines(null), 15_000)
    return () => clearTimeout(t)
  }, [lines])

  if (!lines) return null
  return createPortal(
    <div style={{
      position: 'fixed', top: 52, left: '50%', transform: 'translateX(-50%)', zIndex: 1200,
      background: 'var(--bg-surface)', border: '1px solid rgba(167,139,250,0.45)', borderRadius: 10,
      padding: '10px 14px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)', maxWidth: 380,
      display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#a78bfa', letterSpacing: '0.08em', marginBottom: 4 }}>WHILE YOU WERE AWAY</div>
        {lines.map((l, i) => (
          <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>· {l}</div>
        ))}
      </div>
      <button onClick={() => setLines(null)} aria-label="Dismiss recap" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex', flexShrink: 0 }}>
        <X size={12} />
      </button>
    </div>,
    document.body,
  )
}
