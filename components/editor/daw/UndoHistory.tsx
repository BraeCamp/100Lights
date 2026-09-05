'use client'
// The Undo History panel (lib/undo-history.ts): everything you have done, and a
// way back to any of it.
//
// ⌘Z is a door you can only walk through one step at a time, in the dark. This
// is the same stack with the lights on — you can see that the edit you want
// gone was four requests ago and go there in one click.
//
// One row per REQUEST, not per action: a spoken command that adds a filter,
// automates it and moves the playhead is one thing that happened.

import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'
import { X, Undo2, Redo2 } from 'lucide-react'
import type { HistoryRow } from '@/lib/undo-history'
import { undosToReach, redosToReach, countLabel } from '@/lib/undo-history'

export interface UndoHistoryProps {
  /** What can be undone, newest first. */
  rows: HistoryRow[]
  /** What can be redone, newest first (the top of the redo stack). */
  redoRows: HistoryRow[]
  onUndo: (times: number) => void
  onRedo: (times: number) => void
  onClose: () => void
}

export default function UndoHistory({ rows, redoRows, onUndo, onRedo, onClose }: UndoHistoryProps) {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  if (typeof document === 'undefined') return null

  const row = (r: HistoryRow, i: number, kind: 'undo' | 'redo') => (
    <button
      key={`${kind}-${r.key}`}
      data-help-id={kind === 'undo' ? 'history-row' : undefined}
      onClick={() => (kind === 'undo' ? onUndo(undosToReach(i)) : onRedo(redosToReach(i, redoRows.length)))}
      title={kind === 'undo'
        ? `Go back to just before this${i > 0 ? `, undoing the ${i} above it too` : ''}`
        : `Bring this back${i > 0 ? `, and the ${i} above it` : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '7px 12px', fontSize: 11.5, lineHeight: 1.35,
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: kind === 'redo' ? 'var(--text-muted)' : 'var(--text-secondary)',
        opacity: kind === 'redo' ? 0.75 : 1,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      {kind === 'undo' ? <Undo2 size={12} style={{ flexShrink: 0, opacity: 0.6 }} /> : <Redo2 size={12} style={{ flexShrink: 0, opacity: 0.6 }} />}
      <span style={{ flex: 1 }}>{r.label}</span>
      {r.count > 1 && (
        <span style={{ fontSize: 9.5, color: 'var(--text-muted)', flexShrink: 0 }}>{countLabel(r.count)}</span>
      )}
    </button>
  )

  return createPortal(
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div ref={boxRef} role="dialog" aria-label="Undo History" data-help-id="undo-history"
        style={{
          width: 420, maxHeight: '72vh', display: 'flex', flexDirection: 'column',
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12,
          boxShadow: '0 18px 60px rgba(0,0,0,0.55)', overflow: 'hidden',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Undo History</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex' }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '4px 0' }}>
          {/* What has been undone sits ABOVE the line, greyed — it is the future
              rather than the past, and clicking it walks forward. */}
          {redoRows.length > 0 && (
            <>
              {redoRows.map((r, i) => row(r, i, 'redo'))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px' }}>
                <div style={{ flex: 1, height: 1, background: 'rgb(var(--accent-rgb) / 0.6)' }} />
                <span style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--accent-light)', fontWeight: 800 }}>YOU ARE HERE</span>
                <div style={{ flex: 1, height: 1, background: 'rgb(var(--accent-rgb) / 0.6)' }} />
              </div>
            </>
          )}

          {rows.length === 0 && redoRows.length === 0 && (
            <div style={{ padding: '22px 14px', fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center' }}>
              Nothing to undo yet. Every edit you make lands here, one row per request.
            </div>
          )}
          {rows.map((r, i) => row(r, i, 'undo'))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
