'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, X, ChevronRight, ExternalLink } from 'lucide-react'

interface UserRow {
  userId: string
  email: string
  stripePlan: string
  effectivePlan: string
  giftPlan: string | null
  giftUntil: string | null
  codeUntil: string | null
  stripeCustomerId: string
  status: string
  updatedAt: string
  hasRecord?: boolean
}

interface CtxMenu { x: number; y: number; user: UserRow }

interface Redemption { code: string; kind: string; grantDays: number; grantUntil: string; redeemedAt: string }
interface Detail {
  userId: string
  email: string
  hasRecord: boolean
  subscription: {
    plan: string; status: string; stripeCustomerId: string | null; stripeSubId: string | null
    currentPeriodEnd: string | null; giftPlan: string | null; giftUntil: string | null
    createdAt: string | null; updatedAt: string | null
  } | null
  codeUntil: string | null
  redemptions: Redemption[]
  projectCount: number
  communityCount: number
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function UsersPanel() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchErr, setFetchErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [searched, setSearched] = useState(false)
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [customDays, setCustomDays] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [detailUser, setDetailUser] = useState<UserRow | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const customInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (query: string, pg: number) => {
    setLoading(true); setFetchErr(null)
    try {
      const res = await fetch(`/api/admin/users?q=${encodeURIComponent(query)}&page=${pg}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { users: UserRow[]; hasMore: boolean; searched: boolean }
      setUsers(data.users); setHasMore(!!data.hasMore); setSearched(!!data.searched)
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : 'Failed to load users')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load('', 0) }, [load])

  // Debounced search — a new query resets to page 0.
  useEffect(() => {
    const t = setTimeout(() => { setPage(0); void load(q.trim(), 0) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  useEffect(() => {
    if (!ctx) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) { setCtx(null); setShowCustom(false); setCustomDays('') }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [ctx])

  useEffect(() => { if (showCustom) customInputRef.current?.focus() }, [showCustom])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const applyGift = async (userId: string, plan: string | null, days: number | null) => {
    setCtx(null); setShowCustom(false); setCustomDays('')
    try {
      const res = await fetch('/api/admin/gift', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, plan, days }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      showToast(plan ? 'Gift applied' : 'Gift removed')
      await load(q.trim(), page)
      if (detailUser?.userId === userId) void openDetail(detailUser)  // refresh open modal
    } catch (e) { showToast(e instanceof Error ? e.message : 'Action failed') }
  }

  async function openDetail(u: UserRow) {
    setDetailUser(u); setDetail(null)
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(u.userId)}`)
      if (r.ok) setDetail(await r.json())
    } catch { /* modal shows the row basics regardless */ }
  }

  const giftLabel = (u: UserRow) => {
    if (!u.giftPlan) return null
    if (!u.giftUntil) return 'Indefinite'
    return new Date(u.giftUntil) <= new Date() ? 'Expired' : `Until ${fmt(u.giftUntil)}`
  }

  return (
    <>
      {/* Search + pagination */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by email, name, or user ID…"
            style={{ width: '100%', fontSize: 13, padding: '8px 30px 8px 32px', borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
          />
          {q && <button onClick={() => setQ('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}><X size={14} /></button>}
        </div>
        {!searched && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <button onClick={() => { const p = Math.max(0, page - 1); setPage(p); void load('', p) }} disabled={page === 0 || loading}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.5 : 1 }}>‹ Prev</button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 48, textAlign: 'center' }}>Page {page + 1}</span>
            <button onClick={() => { const p = page + 1; setPage(p); void load('', p) }} disabled={!hasMore || loading}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: hasMore ? 'pointer' : 'default', opacity: hasMore ? 1 : 0.5 }}>Next ›</button>
          </div>
        )}
      </div>

      {loading ? <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading users…</p>
      : fetchErr ? <p style={{ fontSize: 12, color: 'var(--error)' }}>{fetchErr}</p>
      : (
        <>
          <div className="rounded-xl border overflow-hidden mb-1" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                  {['Email / User', 'Plan', 'Gift', 'Status', 'Updated', ''].map((h, i) => (
                    <th key={i} className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const gift = giftLabel(u)
                  const isGifted = !!u.giftPlan && (!u.giftUntil || new Date(u.giftUntil) > new Date())
                  const isCode = !isGifted && !!u.codeUntil && u.effectivePlan === 'pro'
                  return (
                    <tr key={u.userId}
                      onClick={() => void openDetail(u)}
                      onContextMenu={e => {
                        e.preventDefault()
                        const x = Math.min(e.clientX, window.innerWidth - 228 - 8)
                        setCtx({ x, y: e.clientY, user: u }); setShowCustom(false); setCustomDays('')
                      }}
                      title="Click for details · right-click to manage"
                      style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-surface)', cursor: 'pointer' }}>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-primary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {u.email || <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>{u.userId}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={u.effectivePlan === 'pro' ? { background: 'rgba(139,92,246,0.15)', color: 'var(--accent-light)' } : { background: 'var(--bg-base)', color: 'var(--text-muted)' }}>
                          {u.effectivePlan}
                        </span>
                        {isGifted && <span style={{ marginLeft: 4, fontSize: 10, color: '#f97316' }}>↑ gifted</span>}
                        {isCode && <span style={{ marginLeft: 4, fontSize: 10, color: '#34d399' }} title={u.codeUntil ? `Code Pro until ${fmt(u.codeUntil)}` : undefined}>↑ code</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {gift ? <span style={{ color: gift === 'Expired' ? 'var(--text-muted)' : '#f97316' }}>{gift}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: u.status === 'active' ? 'var(--success)' : 'var(--text-muted)' }}>{u.status}</td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{u.updatedAt ? fmt(u.updatedAt) : '—'}</td>
                      <td className="px-2 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}><ChevronRight size={14} /></td>
                    </tr>
                  )
                })}
                {users.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-xs text-center" style={{ color: 'var(--text-muted)' }}>{searched ? 'No matching users.' : 'No accounts.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
            {searched ? `${users.length} match${users.length === 1 ? '' : 'es'}` : `${users.length} on this page`} · click a row for details, or right-click to gift
          </p>
        </>
      )}

      {/* ── Detail modal ─────────────────────────────────────────────────── */}
      {detailUser && (
        <div onClick={() => { setDetailUser(null); setDetail(null) }}
          style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 460, maxWidth: '100%', maxHeight: '86vh', overflowY: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detailUser.email || 'No email'}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detailUser.userId}</div>
              </div>
              <button onClick={() => { setDetailUser(null); setDetail(null) }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 4 }}><X size={16} /></button>
            </div>

            {!detail ? <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 14 }}>Loading…</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Field label="Effective plan" value={detailUser.effectivePlan} accent={detailUser.effectivePlan === 'pro'} />
                  <Field label="Stripe status" value={detail.subscription?.status ?? 'no record'} />
                  <Field label="Projects" value={String(detail.projectCount)} />
                  <Field label="Community shares" value={String(detail.communityCount)} />
                  {detail.subscription?.currentPeriodEnd && <Field label="Renews / ends" value={fmt(detail.subscription.currentPeriodEnd)} />}
                  {detail.subscription?.createdAt && <Field label="Signed up" value={fmt(detail.subscription.createdAt)} />}
                </div>

                {detail.subscription?.stripeCustomerId && (
                  <a href={`https://dashboard.stripe.com/customers/${detail.subscription.stripeCustomerId}`} target="_blank" rel="noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#a78bfa', textDecoration: 'none' }}>
                    Open in Stripe <ExternalLink size={12} />
                  </a>
                )}

                {/* Access sources */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em', marginBottom: 6 }}>PRO ACCESS SOURCES</div>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <li style={{ fontSize: 12, color: detail.subscription?.stripeSubId ? '#34d399' : 'var(--text-muted)' }}>• Stripe subscription: {detail.subscription?.stripeSubId ? 'active (paying)' : 'none'}</li>
                    <li style={{ fontSize: 12, color: detailUser.giftPlan ? '#f97316' : 'var(--text-muted)' }}>• Admin gift: {giftLabel(detailUser) ?? 'none'}</li>
                    <li style={{ fontSize: 12, color: detail.codeUntil ? '#34d399' : 'var(--text-muted)' }}>• Redeemed code: {detail.codeUntil ? `Pro until ${fmt(detail.codeUntil)}` : 'none'}</li>
                  </ul>
                  {detail.redemptions.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                      {detail.redemptions.map((r, i) => (
                        <div key={i}>· <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{r.code}</span> ({r.kind}, {r.grantDays}d) → {fmt(r.grantUntil)}</div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Gift actions — visible + touch-friendly (no right-click needed) */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em', marginBottom: 6 }}>GIFT PRO</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {([['7 days', 7], ['30 days', 30], ['90 days', 90], ['Indefinite', null]] as const).map(([lbl, d]) => (
                      <button key={lbl} onClick={() => applyGift(detailUser.userId, 'pro', d)}
                        style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: 7, border: '1px solid rgba(139,92,246,0.4)', background: 'rgba(139,92,246,0.12)', color: 'var(--accent-light)', cursor: 'pointer' }}>{lbl}</button>
                    ))}
                    {detailUser.giftPlan && (
                      <button onClick={() => applyGift(detailUser.userId, null, null)}
                        style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: 7, border: '1px solid rgba(239,68,68,0.4)', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}>Remove gift</button>
                    )}
                  </div>
                  {!detailUser.hasRecord && <p style={{ fontSize: 10.5, color: '#f59e0b', margin: '6px 0 0' }}>No subscription record yet — gifting will 404 until they sign in once.</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Right-click menu (power users) ──────────────────────────────── */}
      {ctx && (
        <div ref={menuRef} style={{ position: 'fixed', left: ctx.x, top: ctx.y, zIndex: 9000, minWidth: 228, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.35)', padding: '4px 0', fontSize: 13 }}>
          <div style={{ padding: '6px 12px 6px', borderBottom: '1px solid var(--border)' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: 0.3, marginBottom: 1 }}>Manage subscription</p>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ctx.user.email || ctx.user.userId}</p>
          </div>
          {([{ label: 'Gift Pro — 7 days', days: 7 }, { label: 'Gift Pro — 30 days', days: 30 }, { label: 'Gift Pro — 90 days', days: 90 }, { label: 'Gift Pro indefinitely', days: null }] as const).map(({ label, days }) => (
            <MenuItem key={label} onClick={() => applyGift(ctx.user.userId, 'pro', days)}>{label}</MenuItem>
          ))}
          {showCustom ? (
            <div style={{ padding: '8px 12px', display: 'flex', gap: 6, alignItems: 'center' }}>
              <input ref={customInputRef} type="number" min={1} placeholder="days" value={customDays}
                onChange={e => setCustomDays(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { const d = parseInt(customDays); if (d > 0) applyGift(ctx.user.userId, 'pro', d) } }}
                style={{ width: 72, padding: '4px 8px', borderRadius: 6, fontSize: 12, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', outline: 'none' }} />
              <button onClick={() => { const d = parseInt(customDays); if (d > 0) applyGift(ctx.user.userId, 'pro', d) }}
                style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'rgba(139,92,246,0.2)', color: 'var(--accent-light)', border: '1px solid rgba(139,92,246,0.3)', fontWeight: 500 }}>Apply</button>
            </div>
          ) : (
            <MenuItem onClick={() => setShowCustom(true)}>Extend by custom days…</MenuItem>
          )}
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          {ctx.user.giftPlan ? (
            <MenuItem danger onClick={() => applyGift(ctx.user.userId, null, null)}>Remove gift</MenuItem>
          ) : (
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>No active gift</div>
          )}
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9600, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', fontSize: 13, color: 'var(--text-primary)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', pointerEvents: 'none' }}>{toast}</div>
      )}
    </>
  )
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px' }}>
      <div style={{ fontSize: 9.5, color: 'var(--text-muted)', letterSpacing: '0.03em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: accent ? 'var(--accent-light)' : 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

function MenuItem({ onClick, children, danger }: { onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: hovered ? (danger ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.05)') : 'none', border: 'none', cursor: 'pointer', color: danger ? '#ef4444' : 'var(--text-primary)', fontSize: 13 }}>
      {children}
    </button>
  )
}
