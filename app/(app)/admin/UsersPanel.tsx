'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UserRow {
  userId: string
  email: string
  stripePlan: string
  effectivePlan: string
  giftPlan: string | null
  giftUntil: string | null
  stripeCustomerId: string
  status: string
  updatedAt: string
}

interface CtxMenu {
  x: number
  y: number
  user: UserRow
}

export default function UsersPanel() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchErr, setFetchErr] = useState<string | null>(null)
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [customDays, setCustomDays] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const customInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFetchErr(null)
    try {
      const res = await fetch('/api/admin/users')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { users: UserRow[] }
      setUsers(data.users)
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Close context menu on outside click
  useEffect(() => {
    if (!ctx) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setCtx(null)
        setShowCustom(false)
        setCustomDays('')
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [ctx])

  // Focus custom input when it appears
  useEffect(() => {
    if (showCustom) customInputRef.current?.focus()
  }, [showCustom])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const applyGift = async (userId: string, plan: string | null, days: number | null) => {
    setCtx(null)
    setShowCustom(false)
    setCustomDays('')
    try {
      const res = await fetch('/api/admin/gift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, plan, days }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      showToast(plan ? 'Gift applied' : 'Gift removed')
      await load()
    } catch {
      showToast('Action failed — check console')
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const giftLabel = (u: UserRow) => {
    if (!u.giftPlan) return null
    if (!u.giftUntil) return 'Indefinite'
    return new Date(u.giftUntil) <= new Date() ? 'Expired' : `Until ${fmt(u.giftUntil)}`
  }

  if (loading) return <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading users…</p>
  if (fetchErr) return <p style={{ fontSize: 12, color: 'var(--error)' }}>{fetchErr}</p>

  return (
    <>
      <div className="rounded-xl border overflow-hidden mb-1" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
              {['Email / User', 'Plan', 'Gift', 'Status', 'Updated'].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold"
                  style={{ color: 'var(--text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => {
              const gift = giftLabel(u)
              const isGifted = u.effectivePlan !== u.stripePlan
              return (
                <tr key={u.userId}
                  onContextMenu={e => {
                    e.preventDefault()
                    // Clamp to viewport so menu never goes offscreen
                    const margin = 8
                    const mw = 228
                    const x = Math.min(e.clientX, window.innerWidth - mw - margin)
                    setCtx({ x, y: e.clientY, user: u })
                    setShowCustom(false)
                    setCustomDays('')
                  }}
                  title="Right-click to manage"
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-surface)',
                    cursor: 'context-menu',
                    userSelect: 'none',
                  }}>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-primary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.email || <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>{u.userId}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={u.effectivePlan === 'pro'
                        ? { background: 'rgba(139,92,246,0.15)', color: 'var(--accent-light)' }
                        : { background: 'var(--bg-base)', color: 'var(--text-muted)' }}>
                      {u.effectivePlan}
                    </span>
                    {isGifted && (
                      <span style={{ marginLeft: 4, fontSize: 10, color: '#f97316' }}>↑ gifted</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {gift
                      ? <span style={{ color: gift === 'Expired' ? 'var(--text-muted)' : '#f97316' }}>{gift}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs"
                    style={{ color: u.status === 'active' ? 'var(--success)' : 'var(--error)' }}>
                    {u.status}
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {u.updatedAt ? fmt(u.updatedAt) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
        {users.length} accounts · right-click any row to manage subscription
      </p>

      {/* ── Context menu ──────────────────────────────────────────────────── */}
      {ctx && (
        <div ref={menuRef} style={{
          position: 'fixed', left: ctx.x, top: ctx.y, zIndex: 9000,
          minWidth: 228, background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)', padding: '4px 0',
          fontSize: 13,
        }}>
          {/* Header */}
          <div style={{ padding: '6px 12px 6px', borderBottom: '1px solid var(--border)' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: 0.3, marginBottom: 1 }}>
              Manage subscription
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ctx.user.email || ctx.user.userId}
            </p>
          </div>

          {/* Gift options */}
          {([
            { label: 'Gift Pro — 7 days',    days: 7 },
            { label: 'Gift Pro — 30 days',   days: 30 },
            { label: 'Gift Pro — 90 days',   days: 90 },
            { label: 'Gift Pro indefinitely', days: null },
          ] as const).map(({ label, days }) => (
            <MenuItem key={label} onClick={() => applyGift(ctx.user.userId, 'pro', days)}>
              {label}
            </MenuItem>
          ))}

          {/* Custom days */}
          {showCustom ? (
            <div style={{ padding: '8px 12px', display: 'flex', gap: 6, alignItems: 'center' }}>
              <input ref={customInputRef}
                type="number" min={1} placeholder="days"
                value={customDays}
                onChange={e => setCustomDays(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const d = parseInt(customDays)
                    if (d > 0) applyGift(ctx.user.userId, 'pro', d)
                  }
                }}
                style={{
                  width: 72, padding: '4px 8px', borderRadius: 6, fontSize: 12,
                  border: '1px solid var(--border)', background: 'var(--bg-base)',
                  color: 'var(--text-primary)', outline: 'none',
                }}
              />
              <button
                onClick={() => { const d = parseInt(customDays); if (d > 0) applyGift(ctx.user.userId, 'pro', d) }}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                  background: 'rgba(139,92,246,0.2)', color: 'var(--accent-light)',
                  border: '1px solid rgba(139,92,246,0.3)', fontWeight: 500,
                }}>
                Apply
              </button>
            </div>
          ) : (
            <MenuItem onClick={() => setShowCustom(true)}>
              Extend by custom days…
            </MenuItem>
          )}

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

          {/* Remove gift */}
          {ctx.user.giftPlan ? (
            <MenuItem danger onClick={() => applyGift(ctx.user.userId, null, null)}>
              Remove gift
            </MenuItem>
          ) : (
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
              No active gift
            </div>
          )}
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9001,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '10px 16px', fontSize: 13,
          color: 'var(--text-primary)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          pointerEvents: 'none',
        }}>
          {toast}
        </div>
      )}
    </>
  )
}

function MenuItem({ onClick, children, danger }: {
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '8px 12px', background: hovered
          ? danger ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.05)'
          : 'none',
        border: 'none', cursor: 'pointer',
        color: danger ? '#ef4444' : 'var(--text-primary)',
        fontSize: 13,
      }}>
      {children}
    </button>
  )
}
