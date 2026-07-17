'use client'

// Timeline comments: beat-anchored feedback threads. Pins render on the
// ruler (see Ruler in ArrangementView); these are the composer and thread
// popovers. Comments live on the project — they sync through the normal
// action broadcast and persist with saves.

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useUser } from '@clerk/nextjs'
import { useDaw } from '@/lib/daw-state'
import { clampToViewport } from './menu-clamp'

function useDismiss(ref: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [ref, onClose])
}

function useAuthorName(): string {
  const { user } = useUser()
  return user?.firstName || user?.username || 'Someone'
}

const popStyle: React.CSSProperties = {
  position: 'fixed', zIndex: 1600, width: 280,
  background: 'var(--bg-surface)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 10,
  padding: '10px 12px', boxShadow: '0 12px 32px rgba(0,0,0,0.7)',
  display: 'flex', flexDirection: 'column', gap: 8,
}

const inputStyle: React.CSSProperties = {
  fontSize: 11, padding: '7px 9px', borderRadius: 6, background: 'rgba(0,0,0,0.3)',
  border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none',
  resize: 'none', fontFamily: 'inherit', lineHeight: 1.4,
}

export function CommentComposer({ beat, anchor, onClose }: {
  beat: number
  anchor: { x: number; y: number }
  onClose: () => void
}) {
  const { dispatch } = useDaw()
  const author = useAuthorName()
  const [text, setText] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  useEffect(() => { if (ref.current) clampToViewport(ref.current, anchor) }, [anchor])

  function post() {
    const t = text.trim()
    if (!t) return
    dispatch({ type: 'ADD_COMMENT', comment: {
      id: crypto.randomUUID(), beat, author, text: t, createdAt: new Date().toISOString(),
    } })
    onClose()
  }

  return createPortal(
    <div ref={ref} style={{ ...popStyle, left: anchor.x, top: anchor.y }} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
      <span style={{ fontSize: 10, fontWeight: 800, color: '#f59e0b', letterSpacing: '0.06em' }}>💬 COMMENT AT BAR {Math.floor(beat / 4) + 1}</span>
      <textarea
        autoFocus rows={3} value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); if (e.key === 'Escape') onClose() }}
        placeholder="What should change here?"
        style={inputStyle}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{ fontSize: 10.5, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
        <button onClick={post} disabled={!text.trim()} style={{ fontSize: 10.5, fontWeight: 700, padding: '5px 14px', borderRadius: 6, border: 'none', background: '#f59e0b', color: '#1a1206', cursor: 'pointer', opacity: text.trim() ? 1 : 0.5 }}>Post</button>
      </div>
    </div>,
    document.body,
  )
}

export function CommentThread({ commentId, anchor, onClose }: {
  commentId: string
  anchor: { x: number; y: number }
  onClose: () => void
}) {
  const { project, dispatch } = useDaw()
  const author = useAuthorName()
  const [reply, setReply] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  useEffect(() => { if (ref.current) clampToViewport(ref.current, anchor) }, [anchor])

  const comment = (project.comments ?? []).find(c => c.id === commentId)
  if (!comment) return null

  function postReply() {
    const t = reply.trim()
    if (!t || !comment) return
    dispatch({ type: 'UPDATE_COMMENT', commentId: comment.id, patch: {
      replies: [...(comment.replies ?? []), { id: crypto.randomUUID(), author, text: t, createdAt: new Date().toISOString() }],
    } })
    setReply('')
  }

  const when = (iso: string) => {
    const d = new Date(iso)
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  }

  return createPortal(
    <div ref={ref} style={{ ...popStyle, left: anchor.x, top: anchor.y }} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: comment.resolved ? 'var(--text-muted)' : '#f59e0b', letterSpacing: '0.06em' }}>
          💬 BAR {Math.floor(comment.beat / 4) + 1}{comment.resolved ? ' · RESOLVED' : ''}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => dispatch({ type: 'UPDATE_COMMENT', commentId: comment.id, patch: { resolved: !comment.resolved } })}
            title={comment.resolved ? 'Reopen' : 'Mark resolved'}
            style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 8px', borderRadius: 99, border: '1px solid var(--border)', background: comment.resolved ? 'transparent' : 'rgba(52,211,153,0.12)', color: comment.resolved ? 'var(--text-muted)' : '#34d399', cursor: 'pointer' }}
          >{comment.resolved ? 'Reopen' : 'Resolve'}</button>
          <button
            onClick={() => { dispatch({ type: 'REMOVE_COMMENT', commentId: comment.id }); onClose() }}
            title="Delete comment"
            style={{ fontSize: 9.5, padding: '2px 8px', borderRadius: 99, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
          >Delete</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 220, overflowY: 'auto' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-primary)' }}>{comment.author} <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 9 }}>{when(comment.createdAt)}</span></div>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '2px 0 0', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{comment.text}</p>
        </div>
        {(comment.replies ?? []).map(r => (
          <div key={r.id} style={{ borderLeft: '2px solid var(--border)', paddingLeft: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-primary)' }}>{r.author} <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 9 }}>{when(r.createdAt)}</span></div>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '2px 0 0', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{r.text}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={reply} onChange={e => setReply(e.target.value)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') postReply(); if (e.key === 'Escape') onClose() }}
          placeholder="Reply…"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button onClick={postReply} disabled={!reply.trim()} style={{ fontSize: 10.5, fontWeight: 700, padding: '5px 12px', borderRadius: 6, border: 'none', background: '#f59e0b', color: '#1a1206', cursor: 'pointer', opacity: reply.trim() ? 1 : 0.5 }}>Send</button>
      </div>
    </div>,
    document.body,
  )
}
