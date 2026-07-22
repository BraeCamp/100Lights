'use client'

import { useCallback, useEffect, useState } from 'react'

type CodeKind = 'promo' | 'starter'
interface RedemptionCode {
  code: string
  kind: CodeKind
  grantDays: number
  active: boolean
  expiresAt: string | null
  maxRedemptions: number | null
  redeemedCount: number
  note: string | null
  createdAt: string
  status: 'active' | 'disabled' | 'expired' | 'exhausted'
}

const STATUS_COLOR: Record<RedemptionCode['status'], string> = {
  active: 'var(--success)',
  disabled: 'var(--text-muted)',
  expired: '#f59e0b',
  exhausted: '#f59e0b',
}

export default function CodesPanel() {
  const [codes, setCodes] = useState<RedemptionCode[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Create form
  const [kind, setKind] = useState<CodeKind>('promo')
  const [code, setCode] = useState('')
  const [grantDays, setGrantDays] = useState('14')
  const [expiresAt, setExpiresAt] = useState('')
  const [maxRedemptions, setMaxRedemptions] = useState('')
  const [note, setNote] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/admin/codes')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { codes: RedemptionCode[] }
      setCodes(data.codes)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load codes')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const res = await fetch('/api/admin/codes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim() || undefined,
          kind,
          grantDays: Number(grantDays),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          maxRedemptions: maxRedemptions.trim() ? Number(maxRedemptions) : null,
          note: note.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      showToast(`Created ${data.code.code}`)
      setCode(''); setNote(''); setMaxRedemptions('')
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Create failed')
    } finally { setCreating(false) }
  }

  async function toggleActive(c: RedemptionCode) {
    try {
      const res = await fetch(`/api/admin/codes/${encodeURIComponent(c.code)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !c.active }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch { showToast('Action failed') }
  }

  async function remove(c: RedemptionCode) {
    if (!confirm(`Delete ${c.code}? Time already granted stays; the code just stops being redeemable.`)) return
    try {
      const res = await fetch(`/api/admin/codes/${encodeURIComponent(c.code)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      showToast(`Deleted ${c.code}`)
      await load()
    } catch { showToast('Delete failed') }
  }

  const copy = (c: string) => { void navigator.clipboard?.writeText(c); showToast(`Copied ${c}`) }
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const inputStyle: React.CSSProperties = {
    padding: '6px 9px', borderRadius: 7, fontSize: 12,
    border: '1px solid var(--border)', background: 'var(--bg-base)',
    color: 'var(--text-primary)', outline: 'none',
  }
  const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }

  return (
    <>
      {/* ── Create form ─────────────────────────────────────────────────── */}
      <form onSubmit={create} className="rounded-xl border p-4 mb-5" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={labelStyle}>Type</label>
            <select value={kind} onChange={e => setKind(e.target.value as CodeKind)} style={{ ...inputStyle, width: '100%' }}>
              <option value="promo">Promo — many per user</option>
              <option value="starter">Starter — one ever per user</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Code <span style={{ fontWeight: 400 }}>(blank = auto)</span></label>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. WELCOME2WK" style={{ ...inputStyle, width: '100%', textTransform: 'uppercase' }} />
          </div>
          <div>
            <label style={labelStyle}>Free days granted</label>
            <input type="number" min={1} value={grantDays} onChange={e => setGrantDays(e.target.value)} required style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div>
            <label style={labelStyle}>Expires <span style={{ fontWeight: 400 }}>(blank = never)</span></label>
            <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div>
            <label style={labelStyle}>Max uses <span style={{ fontWeight: 400 }}>(blank = ∞)</span></label>
            <input type="number" min={1} value={maxRedemptions} onChange={e => setMaxRedemptions(e.target.value)} placeholder="unlimited" style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div>
            <label style={labelStyle}>Note <span style={{ fontWeight: 400 }}>(optional)</span></label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. sponsoring Jane" style={{ ...inputStyle, width: '100%' }} />
          </div>
          <button type="submit" disabled={creating} style={{
            padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: creating ? 'default' : 'pointer',
            background: 'rgba(139,92,246,0.2)', color: 'var(--accent-light)', border: '1px solid rgba(139,92,246,0.35)',
            opacity: creating ? 0.6 : 1, whiteSpace: 'nowrap',
          }}>
            {creating ? 'Creating…' : '+ Create code'}
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
          A code grants <strong style={{ color: 'var(--text-secondary)' }}>free days</strong> of Pro when redeemed. Promo grants
          <strong style={{ color: 'var(--text-secondary)' }}> stack</strong>. Each user can use any one code once. Use <em>Expires</em> for a
          time-limited campaign and <em>Max uses</em> to cap total redemptions — great for sponsoring a set number of people.
        </p>
      </form>

      {/* ── Codes table ─────────────────────────────────────────────────── */}
      {loading ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading codes…</p>
      ) : err ? (
        <p style={{ fontSize: 12, color: 'var(--error)' }}>{err}</p>
      ) : codes.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No codes yet — create one above.</p>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                {['Code', 'Type', 'Grants', 'Used', 'Expires', 'Status', 'Note', ''].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.map((c, i) => (
                <tr key={c.code} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-surface)' }}>
                  <td className="px-3 py-2.5">
                    <button onClick={() => copy(c.code)} title="Click to copy" style={{
                      fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)',
                      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    }}>{c.code}</button>
                  </td>
                  <td className="px-3 py-2.5">
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
                      background: c.kind === 'starter' ? 'rgba(52,211,153,0.15)' : 'rgba(139,92,246,0.15)',
                      color: c.kind === 'starter' ? '#34d399' : 'var(--accent-light)',
                    }}>{c.kind}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{c.grantDays}d</td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {c.redeemedCount}{c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ''}
                  </td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{c.expiresAt ? fmtDate(c.expiresAt) : '—'}</td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: STATUS_COLOR[c.status], fontWeight: 600 }}>{c.status}</td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.note || '—'}</td>
                  <td className="px-3 py-2.5 text-xs" style={{ whiteSpace: 'nowrap' }}>
                    <button onClick={() => toggleActive(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 11, marginRight: 10 }}>
                      {c.active ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => remove(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11 }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9001,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '10px 16px', fontSize: 13, color: 'var(--text-primary)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}>{toast}</div>
      )}
    </>
  )
}
