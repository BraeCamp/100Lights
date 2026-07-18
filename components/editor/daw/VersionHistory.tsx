'use client'

// Named version checkpoints: snapshot the saved project under a name and
// restore any snapshot later. Restores go through PATCH_PROJECT (a normal
// broadcastable action) so a live collab room converges on the restored
// state instead of self-healing it away.

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { History, X } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import type { DawProject } from '@/lib/daw-types'
import { clampToViewport } from './menu-clamp'

interface VersionMeta { id: string; name: string; createdAt: string }

function projectIdFromUrl(): string | null {
  const m = window.location.pathname.match(/\/projects\/([0-9a-f-]{36})/)
  return m?.[1] ?? null
}

export default function VersionHistory() {
  const { dispatch, onSave, isSaving } = useDaw()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const [versions, setVersions] = useState<VersionMeta[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (popRef.current?.contains(e.target as Node)) return
      if (btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  useEffect(() => {
    if (open && popRef.current && anchor) clampToViewport(popRef.current, anchor)
  }, [open, anchor, versions])

  async function load() {
    const pid = projectIdFromUrl()
    if (!pid) { setVersions([]); return }
    try {
      const r = await fetch(`/api/projects/${pid}/versions`)
      setVersions(r.ok ? (await r.json()).versions : [])
    } catch { setVersions([]) }
  }

  async function saveVersion() {
    const name = draft.trim()
    const pid = projectIdFromUrl()
    if (!name || !pid) return
    setBusy('save'); setErr('')
    try {
      await onSave?.()  // checkpoint what's on screen, not the last save
      const r = await fetch(`/api/projects/${pid}/versions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      })
      if (!r.ok) throw new Error()
      setDraft('')
      await load()
    } catch { setErr('Couldn’t save the version') } finally { setBusy(null) }
  }

  async function restore(v: VersionMeta) {
    const pid = projectIdFromUrl()
    if (!pid) return
    setBusy(v.id); setErr('')
    try {
      const r = await fetch(`/api/projects/${pid}/versions/${v.id}`)
      if (!r.ok) throw new Error()
      const file = await r.json() as { dawProject?: DawProject }
      if (!file.dawProject) { setErr('This version has no arrangement data'); return }
      dispatch({ type: 'PATCH_PROJECT', patch: file.dawProject })
      setOpen(false)
    } catch { setErr('Couldn’t restore') } finally { setBusy(null) }
  }

  async function remove(v: VersionMeta) {
    const pid = projectIdFromUrl()
    if (!pid) return
    await fetch(`/api/projects/${pid}/versions/${v.id}`, { method: 'DELETE' }).catch(() => {})
    await load()
  }

  const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          if (open) { setOpen(false); return }
          const r = btnRef.current!.getBoundingClientRect()
          setAnchor({ x: r.right - 260, y: r.bottom + 6 })
          setOpen(true)
          setVersions(null)
          void load()
        }}
        title="Version history — checkpoint the project and restore earlier versions"
        data-help-id="versions"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 22,
          borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer',
          background: open ? 'rgb(var(--accent-rgb) / 0.15)' : 'transparent', color: open ? '#7ab4f5' : 'var(--text-muted)',
        }}
      >
        <History size={12} />
      </button>

      {open && anchor && createPortal(
        <div ref={popRef} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} style={{
          position: 'fixed', left: anchor.x, top: anchor.y, zIndex: 1600, width: 260,
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '10px 12px', boxShadow: '0 12px 32px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)' }}>Versions</span>
            <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}><X size={12} /></button>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') void saveVersion() }}
              placeholder="Name this version…"
              style={{ flex: 1, fontSize: 10.5, padding: '5px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
            />
            <button
              onClick={() => void saveVersion()}
              disabled={!draft.trim() || busy === 'save' || isSaving || !projectIdFromUrl()}
              style={{ fontSize: 10, fontWeight: 700, padding: '5px 10px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', opacity: draft.trim() && projectIdFromUrl() ? 1 : 0.5, whiteSpace: 'nowrap' }}
            >{busy === 'save' ? '…' : 'Save'}</button>
          </div>
          {!projectIdFromUrl() && <p style={{ fontSize: 9.5, color: 'var(--text-muted)', margin: 0 }}>Save the project first to start keeping versions.</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
            {versions === null && <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Loading…</p>}
            {versions?.length === 0 && projectIdFromUrl() && <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>No versions yet. Checkpoint before a big experiment — restoring brings the whole arrangement back.</p>}
            {versions?.map(v => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</div>
                  <div style={{ fontSize: 8.5, color: 'var(--text-muted)' }}>{when(v.createdAt)}</div>
                </div>
                <button onClick={() => void restore(v)} disabled={busy === v.id} title="Load this version into the editor (save to keep it)"
                  style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 99, border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.1)', color: '#34d399', cursor: 'pointer', flexShrink: 0 }}>
                  {busy === v.id ? '…' : 'Restore'}
                </button>
                <button onClick={() => void remove(v)} title="Delete version" aria-label={`Delete version ${v.name}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex', flexShrink: 0, opacity: 0.6 }}>
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
          {err && <p style={{ fontSize: 9.5, color: '#ef4444', margin: 0 }}>{err}</p>}
        </div>,
        document.body,
      )}
    </>
  )
}
