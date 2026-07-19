'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'

// In-app confirmation card. Replaces window.confirm() so it works inside the
// desktop (Electron) app, where native dialogs aren't available.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel, onConfirm])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      onMouseDown={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16,
        background: 'rgba(0,0,0,0.5)',
      }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: 380, maxWidth: '100%', borderRadius: 14, overflow: 'hidden',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ padding: '18px 20px 16px' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h2>
          {message && (
            <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{message}</p>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              fontSize: 13, fontWeight: 700, padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
              border: 'none', color: '#fff', opacity: busy ? 0.7 : 1,
              background: danger ? '#ef4444' : 'var(--accent)',
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
