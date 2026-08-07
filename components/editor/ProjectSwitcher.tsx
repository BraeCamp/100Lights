'use client'

import { useRef, useState } from 'react'
import { ChevronDown, FolderOpen } from 'lucide-react'
import { projectPath } from '@/lib/project-url'

interface P { id: string; name: string; slug: string | null; username: string | null; shared?: boolean }

// A compact header control: an optional "unsaved changes" dot + a ▾ that opens a
// dropdown of the user's projects to jump straight to another one (hard-navs to
// the canonical URL). Shared by the audio + video editors. Pass `label` when
// there's no adjacent project name (e.g. the DAW toolbar) so it reads clearly.
export default function ProjectSwitcher({ currentId, dirty, label }: { currentId?: string; dirty?: boolean; label?: string }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<P[] | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, left: r.left })
    if (!list) {
      fetch('/api/projects')
        .then(x => (x.ok ? x.json() : []))
        .then((d: P[]) => setList(Array.isArray(d) ? d.filter(p => !p.shared) : []))
        .catch(() => setList([]))
    }
    setOpen(v => !v)
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {dirty && <span title="Unsaved changes" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-light)', flexShrink: 0 }} />}
      <button
        ref={btnRef}
        onClick={toggle}
        title="Switch project"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: label ? '2px 4px' : 2, fontSize: 11 }}
      >
        {label && <FolderOpen size={12} />}
        {label && <span>{label}</span>}
        <ChevronDown size={13} />
      </button>
      {open && pos && (<>
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }} onClick={() => setOpen(false)} />
        <div
          className="menu-pop"
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 1001, minWidth: 220, maxHeight: 340, overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', padding: 4 }}
        >
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '4px 8px' }}>Switch project</div>
          {list === null ? (
            <div style={{ padding: 8, fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
          ) : list.length === 0 ? (
            <div style={{ padding: 8, fontSize: 12, color: 'var(--text-muted)' }}>No projects.</div>
          ) : list.map(p => {
            const cur = p.id === currentId
            return (
              <a
                key={p.id}
                href={projectPath(p.username, p.slug, p.id)}
                style={{ display: 'block', padding: '6px 8px', fontSize: 12.5, borderRadius: 5, textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: cur ? 'var(--accent-light)' : 'var(--text-primary)', background: cur ? 'var(--accent-subtle)' : 'transparent' }}
                onMouseEnter={e => { if (!cur) e.currentTarget.style.background = 'var(--bg-surface)' }}
                onMouseLeave={e => { if (!cur) e.currentTarget.style.background = 'transparent' }}
              >
                {p.name || 'Untitled'}
              </a>
            )
          })}
        </div>
      </>)}
    </div>
  )
}
