'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, X, ChevronRight, ExternalLink, AlertTriangle } from 'lucide-react'

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
  note: string
  tags: string[]
  risk: { atRisk: boolean; reasons: string[]; lastSaved: string | null; daysSinceSave: number | null }
  lifecycle: { stage: string; health: number }
  identity: { firstName: string; lastName: string; imageUrl: string; lastSignInAt: string | null; clerkCreatedAt: string | null; signupMethod: string } | null
  timeline: TimelineEvent[]
  noteEntries: NoteEntry[]
}
interface TimelineEvent { at: string; kind: string; label: string; detail?: string }
interface NoteEntry { id: number; body: string; author: string; createdAt: string }

const TL_COLOR: Record<string, string> = {
  signup: '#34d399', project: '#a78bfa', code: '#34d399', community: '#38bdf8',
  feedback: '#fbbf24', admin: '#f97316', gift: '#f97316',
}

// Lifecycle stage display metadata — mirrors lib/lifecycle.ts STAGES. Kept
// local so this client bundle never imports the server-only lifecycle module.
const STAGE_META = [
  { id: 'new',       label: 'New',       color: '#94a3b8', hint: 'Signed up, nothing built yet',            track: 'funnel' },
  { id: 'activated', label: 'Activated', color: '#38bdf8', hint: 'Saved at least one project',              track: 'funnel' },
  { id: 'engaged',   label: 'Engaged',   color: '#22d3ee', hint: 'Active recently, a few projects',         track: 'funnel' },
  { id: 'power',     label: 'Power',     color: '#a78bfa', hint: '5+ projects, active in the last 2 weeks',  track: 'funnel' },
  { id: 'paying',    label: 'Paying',    color: '#34d399', hint: 'Active Stripe subscriber, engaged',        track: 'funnel' },
  { id: 'at-risk',   label: 'At-risk',   color: '#f59e0b', hint: 'Has Pro but gone quiet / payment failing', track: 'off' },
  { id: 'churned',   label: 'Churned',   color: '#ef4444', hint: 'Went cold — no activity in 60+ days',      track: 'off' },
] as const
const stageMeta = (id: string) => STAGE_META.find(s => s.id === id)
const healthColor = (h: number) => h >= 70 ? '#34d399' : h >= 40 ? '#fbbf24' : '#f87171'
// Compact relative time, e.g. "3d ago", "2mo ago".
function rel(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
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
  const [segment, setSegment] = useState('all')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [stage, setStage] = useState('')
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({})
  const [bulkDays, setBulkDays] = useState('30')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const [customDays, setCustomDays] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [detailUser, setDetailUser] = useState<UserRow | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [tagsDraft, setTagsDraft] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [entryDraft, setEntryDraft] = useState('')
  const [entrySaving, setEntrySaving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const customInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (query: string, pg: number, seg = 'all', stg = '') => {
    setLoading(true); setFetchErr(null)
    try {
      const res = await fetch(`/api/admin/users?q=${encodeURIComponent(query)}&page=${pg}&segment=${seg}&stage=${stg}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { users: UserRow[]; hasMore: boolean; searched: boolean }
      setUsers(data.users); setHasMore(!!data.hasMore); setSearched(!!data.searched)
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : 'Failed to load users')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load('', 0, 'all') }, [load])

  // Live segment + lifecycle counts for the chips / pipeline.
  useEffect(() => {
    fetch('/api/admin/users/segments').then(r => r.ok ? r.json() : null).then(d => { if (d?.counts) setCounts(d.counts) }).catch(() => {})
    fetch('/api/admin/lifecycle').then(r => r.ok ? r.json() : null).then(d => { if (d?.counts) setStageCounts(d.counts) }).catch(() => {})
  }, [])

  function pickSegment(seg: string) {
    setSegment(seg); setStage(''); setQ(''); setPage(0); void load('', 0, seg, '')
  }

  function pickStage(stg: string) {
    const next = stage === stg ? '' : stg  // click active stage to clear
    setStage(next); setSegment('all'); setQ(''); setPage(0); void load('', 0, 'all', next)
  }

  async function bulkGift() {
    const n = counts[segment] ?? 0
    const days = parseInt(bulkDays, 10)
    if (!(days > 0)) { showToast('Enter a valid number of days'); return }
    if (n === 0) { showToast('No users in this segment'); return }
    if (!window.confirm(`Gift ${days} days of Pro to all ${n} “${segment}” user${n === 1 ? '' : 's'}? (capped at 200 per action)`)) return
    setBulkBusy(true)
    try {
      const r = await fetch('/api/admin/gift/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segment, days }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      showToast(`Gifted ${days}d to ${d.count} user${d.count === 1 ? '' : 's'}${d.capped ? ' (hit the 200 cap)' : ''} ✓`)
      // refresh counts + list — comped/at-risk membership just shifted
      fetch('/api/admin/users/segments').then(x => x.ok ? x.json() : null).then(dd => { if (dd?.counts) setCounts(dd.counts) }).catch(() => {})
      await load('', 0, segment, stage)
    } catch (e) { showToast(e instanceof Error ? e.message : 'Bulk gift failed') } finally { setBulkBusy(false) }
  }

  // The ⌘K command palette can hand us a user to open directly — via a live
  // event (panel already mounted) or a stashed global (panel mounts lazily
  // after the event fired on first tab open).
  useEffect(() => {
    const openUser = (u: UserRow | undefined) => { if (u?.userId) { setQ(u.email || ''); void openDetail(u) } }
    const onOpen = (e: Event) => openUser((e as CustomEvent<UserRow>).detail)
    window.addEventListener('admin:open-user', onOpen)
    const w = window as unknown as { __adminPendingUser?: UserRow }
    if (w.__adminPendingUser) { const u = w.__adminPendingUser; w.__adminPendingUser = undefined; openUser(u) }
    return () => window.removeEventListener('admin:open-user', onOpen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced search — only fires for a non-empty query (empty is owned by
  // segment selection / clear), and a search always resets to the All segment.
  useEffect(() => {
    const term = q.trim()
    if (!term) return
    const t = setTimeout(() => { setSegment('all'); setStage(''); setPage(0); void load(term, 0, 'all', '') }, 300)
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
    setDetailUser(u); setDetail(null); setNoteDraft(''); setTagsDraft('')
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(u.userId)}`)
      if (r.ok) { const d = await r.json() as Detail; setDetail(d); setNoteDraft(d.note ?? ''); setTagsDraft((d.tags ?? []).join(', ')) }
    } catch { /* modal shows the row basics regardless */ }
  }

  async function saveNote() {
    if (!detailUser) return
    setNoteSaving(true)
    try {
      const tags = tagsDraft.split(',').map(t => t.trim()).filter(Boolean)
      const r = await fetch(`/api/admin/users/${encodeURIComponent(detailUser.userId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: noteDraft, tags }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      showToast('Notes saved ✓')
      setDetail(d => d ? { ...d, note: noteDraft, tags } : d)
    } catch (e) { showToast(e instanceof Error ? e.message : 'Save failed') } finally { setNoteSaving(false) }
  }

  async function addEntry() {
    if (!detailUser || !entryDraft.trim()) return
    setEntrySaving(true)
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(detailUser.userId)}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: entryDraft.trim() }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setDetail(prev => prev ? { ...prev, noteEntries: [d.entry, ...prev.noteEntries] } : prev)
      setEntryDraft('')
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed') } finally { setEntrySaving(false) }
  }

  async function deleteEntry(id: number) {
    if (!detailUser) return
    setDetail(prev => prev ? { ...prev, noteEntries: prev.noteEntries.filter(e => e.id !== id) } : prev)
    try { await fetch(`/api/admin/users/${encodeURIComponent(detailUser.userId)}/notes?entryId=${id}`, { method: 'DELETE' }) } catch { /* optimistic */ }
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
          {q && <button onClick={() => { setQ(''); void load('', 0, segment, stage) }} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}><X size={14} /></button>}
        </div>
        {!searched && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            <button onClick={() => { const p = Math.max(0, page - 1); setPage(p); void load('', p, segment, stage) }} disabled={page === 0 || loading}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.5 : 1 }}>‹ Prev</button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 48, textAlign: 'center' }}>Page {page + 1}</span>
            <button onClick={() => { const p = page + 1; setPage(p); void load('', p, segment, stage) }} disabled={!hasMore || loading}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: hasMore ? 'pointer' : 'default', opacity: hasMore ? 1 : 0.5 }}>Next ›</button>
          </div>
        )}
      </div>

      {/* Lifecycle pipeline — the whole base at a glance, clickable to filter */}
      {!searched && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: 'var(--text-muted)' }}>LIFECYCLE PIPELINE</span>
            {stage && <button onClick={() => pickStage(stage)} style={{ fontSize: 10, color: 'var(--accent-light)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>clear ✕</button>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4, flex: '1 1 380px', minWidth: 0 }}>
              {STAGE_META.filter(s => s.track === 'funnel').map(s => {
                const active = stage === s.id
                const n = stageCounts[s.id] ?? 0
                return (
                  <button key={s.id} onClick={() => pickStage(s.id)} title={s.hint}
                    style={{ flex: '1 1 0', minWidth: 62, display: 'flex', flexDirection: 'column', gap: 1, padding: '7px 6px', borderRadius: 9, cursor: 'pointer', textAlign: 'left',
                      border: `1px solid ${active ? s.color : 'var(--border)'}`,
                      background: active ? `color-mix(in srgb, ${s.color} 16%, transparent)` : 'var(--bg-card)',
                      boxShadow: `inset 0 2px 0 ${s.color}` }}>
                    <span style={{ fontSize: 17, fontWeight: 800, color: active ? s.color : 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{n}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 5, alignItems: 'stretch' }}>
              {STAGE_META.filter(s => s.track === 'off').map(s => {
                const active = stage === s.id
                const n = stageCounts[s.id] ?? 0
                return (
                  <button key={s.id} onClick={() => pickStage(s.id)} title={s.hint}
                    style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '7px 12px', borderRadius: 9, cursor: 'pointer', textAlign: 'left',
                      border: `1px solid ${active ? s.color : `color-mix(in srgb, ${s.color} 40%, var(--border))`}`,
                      background: active ? `color-mix(in srgb, ${s.color} 16%, transparent)` : `color-mix(in srgb, ${s.color} 7%, transparent)` }}>
                    <span style={{ fontSize: 17, fontWeight: 800, color: s.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{n}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: s.color, opacity: 0.85 }}>{s.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Segment chips — quick plan filters */}
      {!searched && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {([
            ['all', 'All'], ['paying', 'Paying'], ['comped', 'Comped'], ['power', 'Power users'],
            ['upsell', 'Upsell (free, heavy)'], ['atrisk', 'At-risk'], ['free', 'Free'],
          ] as const).map(([id, label]) => {
            const active = segment === id && !stage
            const n = counts[id]
            const tone = id === 'atrisk' ? '#f59e0b' : id === 'upsell' ? '#38bdf8' : id === 'paying' ? '#34d399' : 'var(--accent)'
            return (
              <button key={id} onClick={() => pickSegment(id)}
                style={{ fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 99, cursor: 'pointer',
                  border: `1px solid ${active ? tone : 'var(--border)'}`,
                  background: active ? 'color-mix(in srgb, ' + tone + ' 15%, transparent)' : 'transparent',
                  color: active ? tone : 'var(--text-muted)' }}>
                {label}{n != null && <span style={{ opacity: 0.7 }}> {n}</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Bulk gift to the active segment */}
      {!searched && segment !== 'all' && (counts[segment] ?? 0) > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10, padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(124,58,237,0.35)', background: 'rgba(124,58,237,0.06)' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Gift Pro to all <b style={{ color: 'var(--text-primary)' }}>{counts[segment]}</b> “{segment}” users —</span>
          <input type="number" min={1} value={bulkDays} onChange={e => setBulkDays(e.target.value)}
            style={{ width: 62, fontSize: 12, padding: '4px 8px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>days</span>
          <button onClick={() => void bulkGift()} disabled={bulkBusy}
            style={{ fontSize: 12, fontWeight: 700, padding: '5px 13px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', opacity: bulkBusy ? 0.6 : 1 }}>
            {bulkBusy ? 'Gifting…' : `🎁 Gift ${counts[segment]}`}
          </button>
          <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>capped at 200 · logged</span>
        </div>
      )}

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
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              {detail?.identity?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={detail.identity.imageUrl} alt="" width={40} height={40} style={{ borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
              ) : (
                <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: 'var(--text-muted)' }}>
                  {(detail?.identity?.firstName?.[0] || detailUser.email?.[0] || '?').toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                {detail?.identity && (detail.identity.firstName || detail.identity.lastName) && (
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{`${detail.identity.firstName} ${detail.identity.lastName}`.trim()}</div>
                )}
                <div style={{ fontSize: detail?.identity && (detail.identity.firstName || detail.identity.lastName) ? 12 : 14, fontWeight: detail?.identity && (detail.identity.firstName || detail.identity.lastName) ? 500 : 700, color: detail?.identity && (detail.identity.firstName || detail.identity.lastName) ? 'var(--text-secondary)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detailUser.email || 'No email'}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {detail?.identity?.signupMethod && <span>via {detail.identity.signupMethod}</span>}
                  {detail?.identity?.lastSignInAt && <span>· last seen {rel(detail.identity.lastSignInAt)}</span>}
                </div>
              </div>
              <button onClick={() => { setDetailUser(null); setDetail(null) }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 4 }}><X size={16} /></button>
            </div>

            {!detail ? <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 14 }}>Loading…</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
                {/* Lifecycle stage + health score */}
                {detail.lifecycle && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {(() => { const m = stageMeta(detail.lifecycle.stage); return (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '4px 11px', borderRadius: 99, border: `1px solid ${m?.color ?? 'var(--border)'}`, background: `color-mix(in srgb, ${m?.color ?? '#888'} 14%, transparent)`, color: m?.color ?? 'var(--text-primary)' }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: m?.color ?? '#888' }} />
                        {m?.label ?? detail.lifecycle.stage}
                      </span>
                    ) })()}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>
                        <span>HEALTH</span><span style={{ fontWeight: 700, color: healthColor(detail.lifecycle.health) }}>{detail.lifecycle.health}/100</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-base)', overflow: 'hidden' }}>
                        <div style={{ width: `${detail.lifecycle.health}%`, height: '100%', background: healthColor(detail.lifecycle.health), borderRadius: 99 }} />
                      </div>
                    </div>
                  </div>
                )}
                {/* Why this account is At Risk — spelled out, not just a flag */}
                {detail.risk?.atRisk && (
                  <div style={{ borderRadius: 10, border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.08)', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <AlertTriangle size={13} style={{ color: '#f59e0b' }} />
                      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: '#f59e0b' }}>WHY THIS USER IS AT RISK</span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {detail.risk.reasons.map((r, i) => (
                        <li key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Field label="Effective plan" value={detailUser.effectivePlan} accent={detailUser.effectivePlan === 'pro'} />
                  <Field label="Stripe status" value={detail.subscription?.status ?? 'no record'} />
                  <Field label="Projects" value={String(detail.projectCount)} />
                  <Field label="Last saved" value={detail.risk?.lastSaved ? `${fmt(detail.risk.lastSaved)}${detail.risk.daysSinceSave != null ? ` · ${detail.risk.daysSinceSave}d ago` : ''}` : 'never'} warn={!!detail.risk?.atRisk && (detail.risk?.lastSaved === null || (detail.risk?.daysSinceSave ?? 0) >= 30)} />
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

                {/* Activity timeline — the account's story, merged from every source */}
                {detail.timeline?.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em', marginBottom: 8 }}>TIMELINE</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
                      {detail.timeline.map((e, i) => (
                        <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', paddingBottom: i === detail.timeline.length - 1 ? 0 : 10 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, alignSelf: 'stretch' }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: TL_COLOR[e.kind] ?? 'var(--text-muted)', marginTop: 4, flexShrink: 0 }} />
                            {i !== detail.timeline.length - 1 && <span style={{ width: 1, flex: 1, background: 'var(--border)', marginTop: 2 }} />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0, marginTop: -1 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{e.label}</span>
                              <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0, whiteSpace: 'nowrap' }} title={new Date(e.at).toLocaleString()}>{rel(e.at)}</span>
                            </div>
                            {e.detail && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.detail}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes & tags — a pinned summary that stays put */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>PINNED NOTE &amp; TAGS</span>
                    <button onClick={() => void saveNote()} disabled={noteSaving}
                      style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', opacity: noteSaving ? 0.6 : 1 }}>
                      {noteSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} placeholder="A pinned summary — why they're VIP, the one thing to remember…"
                    style={{ width: '100%', minHeight: 48, fontSize: 12.5, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
                  <input value={tagsDraft} onChange={e => setTagsDraft(e.target.value)} placeholder="tags, comma-separated (e.g. VIP, press, refund-risk)"
                    style={{ width: '100%', marginTop: 6, fontSize: 12, padding: '6px 10px', borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }} />
                  {detail.tags?.length ? (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                      {detail.tags.map(t => <span key={t} style={{ fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 99, background: 'rgba(124,58,237,0.14)', color: 'var(--accent-light)' }}>{t}</span>)}
                    </div>
                  ) : null}
                </div>

                {/* Dated notes log — CRM activity notes that accumulate over time */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em', marginBottom: 6 }}>NOTES LOG</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={entryDraft} onChange={e => setEntryDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void addEntry() } }}
                      placeholder="Log a note — a call, a promise, an observation…"
                      style={{ flex: 1, fontSize: 12.5, padding: '7px 10px', borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }} />
                    <button onClick={() => void addEntry()} disabled={entrySaving || !entryDraft.trim()}
                      style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', opacity: entrySaving || !entryDraft.trim() ? 0.5 : 1 }}>Add</button>
                  </div>
                  {detail.noteEntries?.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                      {detail.noteEntries.map(en => (
                        <div key={en.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px' }}>
                          <div style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{en.body}</div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 3 }}>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }} title={new Date(en.createdAt).toLocaleString()}>{rel(en.createdAt)}{en.author && en.author !== 'admin' ? ` · ${en.author.split('@')[0]}` : ''}</span>
                            <button onClick={() => void deleteEntry(en.id)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10, padding: 0 }}>delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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

function Field({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: `1px solid ${warn ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`, borderRadius: 8, padding: '7px 10px' }}>
      <div style={{ fontSize: 9.5, color: 'var(--text-muted)', letterSpacing: '0.03em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: warn ? '#f59e0b' : accent ? 'var(--accent-light)' : 'var(--text-primary)' }}>{value}</div>
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
