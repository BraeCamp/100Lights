'use client'

// Share popover: copy the link, switch the project between private and
// public, and manage the private member list (emails). Editing rights on a
// shared project come with a paid plan; free collaborators view and listen.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOthers } from '@/lib/liveblocks.config'
import { Link2, Globe2, Lock, X, Plus } from 'lucide-react'

interface Sharing {
  visibility: 'private' | 'public'
  members: Array<{ email: string }>
}

export function CollabInvite({ projectId }: { projectId: string }) {
  const others = useOthers()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState<Sharing | null>(null)
  const [notOwner, setNotOwner] = useState(false)
  const [emailDraft, setEmailDraft] = useState('')
  const [err, setErr] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  // A Share click on a not-yet-saved project saves first; once this real
  // button mounts, it finishes the gesture by opening the popover.
  useEffect(() => {
    const w = window as unknown as { __openShareWhenReady?: boolean }
    if (!w.__openShareWhenReady) return
    // Consume the flag inside the timer — StrictMode's throwaway first mount
    // cancels its timer on unmount, and the real mount must still see the flag
    const t = setTimeout(() => {
      if (!w.__openShareWhenReady) return
      w.__openShareWhenReady = false
      const r = btnRef.current?.getBoundingClientRect()
      if (!r) return
      setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
      setOpen(true)
      void loadSharing()
    }, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (popRef.current?.contains(e.target as Node)) return
      if (btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function loadSharing() {
    try {
      const r = await fetch(`/api/projects/${projectId}/sharing`)
      if (r.status === 404) { setNotOwner(true); return }
      setSharing(await r.json())
    } catch { setNotOwner(true) }
  }

  async function patch(body: Record<string, string>) {
    setErr('')
    try {
      const r = await fetch(`/api/projects/${projectId}/sharing`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d.error ?? 'Failed'); return }
      setSharing(d)
    } catch { setErr('Failed') }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/projects/${projectId}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const count = others.length

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          if (open) { setOpen(false); return }
          const r = btnRef.current!.getBoundingClientRect()
          setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
          setOpen(true)
          void loadSharing()
        }}
        title="Share this project"
        data-help-id="invite"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 10, height: 24, padding: '0 8px', borderRadius: 5,
          border: '1px solid var(--border)',
          background: open ? 'rgb(var(--accent-rgb) / 0.2)' : 'rgb(var(--accent-rgb) / 0.08)',
          color: '#7ab4f5',
          cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
          transition: 'all 0.15s',
        }}
      >
        <span style={{ fontSize: 11 }}>⊕</span>
        Share
        {count > 0 && (
          <span style={{
            marginLeft: 2, background: 'var(--accent)', color: '#fff',
            borderRadius: 8, padding: '0 5px', fontSize: 9, fontWeight: 700,
          }}>
            {count}
          </span>
        )}
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div ref={popRef} style={{
          position: 'fixed', top: pos.top, right: pos.right, width: 300, zIndex: 9999,
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '12px 14px', boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
        }}>
          <p style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px' }}>Share project</p>

          <button onClick={copyLink} style={{
            display: 'flex', alignItems: 'center', gap: 7, width: '100%', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, padding: '7px 0', borderRadius: 7, cursor: 'pointer',
            border: copied ? '1px solid #22c55e' : '1px solid #2e2e2e',
            background: copied ? 'rgba(34,197,94,0.12)' : 'rgb(var(--accent-rgb) / 0.1)',
            color: copied ? '#22c55e' : '#7ab4f5',
          }}>
            <Link2 size={12} /> {copied ? 'Link copied' : 'Copy link'}
          </button>

          {notOwner ? (
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.5 }}>
              You&apos;re a collaborator here — only the owner changes who can open this project.
            </p>
          ) : sharing ? (
            <>
              {/* Visibility */}
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                {([
                  { key: 'private' as const, icon: Lock, label: 'Private', desc: 'Only people you add' },
                  { key: 'public' as const, icon: Globe2, label: 'Public', desc: 'Anyone with the link' },
                ]).map(opt => {
                  const active = sharing.visibility === opt.key
                  const Icon = opt.icon
                  return (
                    <button key={opt.key} onClick={() => void patch({ visibility: opt.key })} style={{
                      flex: 1, textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                      background: active ? 'rgba(124,58,237,0.14)' : 'transparent',
                      border: active ? '1px solid rgba(167,139,250,0.55)' : '1px solid #2e2e2e',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: active ? '#a78bfa' : '#bbb' }}>
                        <Icon size={11} /> {opt.label}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
                    </button>
                  )
                })}
              </div>

              {/* Members (private mode) */}
              {sharing.visibility === 'private' && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.07em', color: 'var(--text-muted)', margin: '0 0 6px' }}>PEOPLE WITH ACCESS</p>
                  {sharing.members.length === 0 && (
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px' }}>Just you so far.</p>
                  )}
                  {sharing.members.map(m => (
                    <div key={m.email} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
                      <span style={{ flex: 1, fontSize: 11, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</span>
                      <button onClick={() => void patch({ removeEmail: m.email })} aria-label={`Remove ${m.email}`}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 2 }}>
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <input
                      value={emailDraft} onChange={e => setEmailDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && emailDraft.trim()) { void patch({ addEmail: emailDraft }); setEmailDraft('') } }}
                      placeholder="email@example.com"
                      style={{ flex: 1, minWidth: 0, fontSize: 11, padding: '6px 9px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
                    />
                    <button
                      onClick={() => { if (emailDraft.trim()) { void patch({ addEmail: emailDraft }); setEmailDraft('') } }}
                      aria-label="Add person"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(124,58,237,0.15)', color: '#a78bfa', cursor: 'pointer' }}
                    ><Plus size={13} /></button>
                  </div>
                </div>
              )}

              {err && <p style={{ fontSize: 10, color: '#ef4444', margin: '8px 0 0' }}>{err}</p>}
              <p style={{ fontSize: 9.5, color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.5 }}>
                People you share with can listen and follow along. Editing with you live needs a Pro plan; you always edit your own projects.
              </p>
            </>
          ) : (
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '10px 0 0' }}>Loading…</p>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
