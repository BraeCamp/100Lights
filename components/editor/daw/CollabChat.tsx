'use client'

// In-session chat: ephemeral text over the Liveblocks room. Messages live in
// component state (nothing persisted) — the point is quick coordination
// ("listen from bar 17", "recording now") without leaving the editor.

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare, X } from 'lucide-react'
import { useBroadcastEvent, useEventListener, useOthers, useSelf } from '@/lib/liveblocks.config'
import { useUser } from '@clerk/nextjs'

interface ChatMsg { id: string; name: string; text: string; ts: number; self?: boolean }

export default function CollabChat() {
  const broadcast = useBroadcastEvent()
  const others = useOthers()
  const self = useSelf()
  const { user } = useUser()
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [draft, setDraft] = useState('')
  const [unread, setUnread] = useState(0)
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open }, [open])
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [msgs, open])

  const myName = user?.firstName || user?.username || (self ? `Guest ${self.connectionId}` : 'Guest')

  const push = useCallback((m: ChatMsg) => {
    setMsgs(prev => [...prev.slice(-99), m])
    if (!m.self && !openRef.current) setUnread(u => Math.min(9, u + 1))
  }, [])

  useEventListener(({ event }) => {
    const e = event as { type?: string; name?: string; text?: string; ts?: number }
    if (e.type !== 'CHAT' || !e.text) return
    push({ id: `${e.ts}-${e.name}`, name: e.name || 'Guest', text: e.text, ts: e.ts ?? Date.now() })
  })

  function send() {
    const text = draft.trim()
    if (!text) return
    const ts = Date.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    broadcast({ type: 'CHAT', name: myName, text, ts } as any)
    push({ id: `${ts}-self`, name: myName, text, ts, self: true })
    setDraft('')
  }

  // Chat only matters with someone to talk to
  if (others.length === 0 && msgs.length === 0) return null

  return createPortal(
    <>
      {!open && (
        <button
          onClick={() => { setOpen(true); setUnread(0) }}
          title="Session chat"
          style={{
            position: 'fixed', bottom: 64, right: 16, zIndex: 900,
            width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--border)',
            background: 'var(--bg-surface)', color: '#7ab4f5', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          }}
        >
          <MessageSquare size={16} />
          {unread > 0 && (
            <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, borderRadius: 99, background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{unread}</span>
          )}
        </button>
      )}
      {open && (
        <div style={{
          position: 'fixed', bottom: 64, right: 16, zIndex: 900, width: 280, height: 340,
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12,
          boxShadow: '0 12px 32px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)' }}>Session chat</span>
            <button onClick={() => setOpen(false)} aria-label="Close chat" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}><X size={13} /></button>
          </div>
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {msgs.length === 0 && (
              <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: 'auto', textAlign: 'center', lineHeight: 1.5 }}>
                Say hi — messages reach everyone in the session and vanish when it ends.
              </p>
            )}
            {msgs.map(m => (
              <div key={m.id} style={{ alignSelf: m.self ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                {!m.self && <div style={{ fontSize: 9, fontWeight: 700, color: '#7ab4f5', marginBottom: 1 }}>{m.name}</div>}
                <div style={{
                  fontSize: 11, lineHeight: 1.4, padding: '5px 9px', borderRadius: 10,
                  background: m.self ? 'rgb(var(--accent-rgb) / 0.25)' : 'rgba(255,255,255,0.06)',
                  color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>{m.text}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') send(); if (e.key === 'Escape') setOpen(false) }}
              placeholder="Message…"
              style={{ flex: 1, fontSize: 11, padding: '6px 9px', borderRadius: 7, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
            />
            <button onClick={send} disabled={!draft.trim()} style={{ fontSize: 10.5, fontWeight: 700, padding: '6px 12px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: 'var(--accent-contrast)', cursor: 'pointer', opacity: draft.trim() ? 1 : 0.5 }}>Send</button>
          </div>
        </div>
      )}
    </>,
    document.body,
  )
}
