'use client'

// "Send to project" (cross-project PUSH). From the studio, link THIS project's
// full mix into another project: we stash this project as the source under the
// target (`cf_link_source_<targetId>`) and open the target, which resolves the
// link on load and renders it as a live clip. Self-contained (own picker modal)
// so it can drop into any toolbar/rail with just the source project id.

import { useState } from 'react'
import { Share2, X, Music } from 'lucide-react'

interface ProjRow { id: string; name: string }

export default function SendToProjectButton({
  sourceProjectId,
  className,
  style,
}: {
  sourceProjectId?: string
  className?: string
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<ProjRow[] | null>(null)

  async function openPicker() {
    if (!sourceProjectId) {
      window.alert('Save this project first — then you can send its audio into another project.')
      return
    }
    setOpen(true)
    if (projects) return
    try {
      const r = await fetch('/api/projects')
      const data = r.ok ? (await r.json() as ProjRow[]) : []
      setProjects(data.filter(p => p.id !== sourceProjectId))
    } catch { setProjects([]) }
  }

  function send(targetId: string) {
    setOpen(false)
    try { localStorage.setItem(`cf_link_source_${targetId}`, sourceProjectId!) } catch { /* storage unavailable */ }
    window.location.assign(`/projects/${targetId}`)
  }

  return (
    <>
      <button
        onClick={openPicker}
        title="Send this project's audio (full mix) into another project as a live clip"
        aria-label="Send audio to a project"
        className={className}
        style={style}
        onMouseEnter={e => { if (!style?.background || style.background === 'transparent') { (e.currentTarget as HTMLElement).style.background = 'rgba(var(--accent-rgb) / 0.12)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)' } }}
        onMouseLeave={e => { if (!style?.background || style.background === 'transparent') { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' } }}
      >
        <Share2 size={15} />
      </button>

      {open && (
        <div onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(8,8,12,0.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 'min(440px, 92vw)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
              <Share2 size={15} color="var(--accent-light)" />
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Send this audio to a project</span>
              <button onClick={() => setOpen(false)} style={{ marginLeft: 'auto', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <p style={{ padding: '10px 16px 4px', margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
              This project&rsquo;s full mix links into the project you pick — it live-updates there whenever you edit here.
            </p>
            <div style={{ overflowY: 'auto', padding: '6px 8px 12px' }}>
              {projects === null ? (
                <p style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>Loading your projects…</p>
              ) : projects.length === 0 ? (
                <p style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>No other projects to send to.</p>
              ) : projects.map(p => (
                <button key={p.id} onClick={() => send(p.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                  <Music size={13} color="var(--text-muted)" />
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
