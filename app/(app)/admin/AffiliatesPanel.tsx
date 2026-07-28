'use client'

import React, { useCallback, useEffect, useState } from 'react'

interface Affiliate {
  code: string
  name: string
  contact: string | null
  commissionPct: number
  commissionMonths: number | null
  perkDays: number
  active: boolean
  createdAt: string
  referrals: number
  converted: number
  estMonthly: number
  accrued: number
  paid: number
  owed: number
}

interface Referral {
  userId: string
  redeemedAt: string
  paying: boolean
}

interface CommissionEntry { userId: string; invoice: number; commission: number; invoiceAt: string }
interface PayoutEntry { id: string; amount: number; method: string | null; note: string | null; paidAt: string }
interface Detail { referrals: Referral[]; ledger: CommissionEntry[]; payouts: PayoutEntry[] }

interface Application {
  id: string
  name: string
  contact: string
  platform: string | null
  audience: string | null
  links: string | null
  note: string | null
  status: 'pending' | 'approved' | 'declined'
  code: string | null
  createdAt: string
}

export default function AffiliatesPanel() {
  const [rows, setRows] = useState<Affiliate[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [origin, setOrigin] = useState('https://100lights.com')

  // Create form
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [contact, setContact] = useState('')
  // Beta defaults — the "Founding Affiliate" offer (30% / 12mo / +30d).
  const [perkDays, setPerkDays] = useState('30')
  const [commissionPct, setCommissionPct] = useState('30')
  const [commissionMonths, setCommissionMonths] = useState('12')
  const [creating, setCreating] = useState(false)

  // Detail expansion
  const [openCode, setOpenCode] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loadingRefs, setLoadingRefs] = useState(false)
  // Record-payment form
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('')
  const [payNote, setPayNote] = useState('')
  const [payingOut, setPayingOut] = useState(false)

  // Inbound applications from /creators
  const [apps, setApps] = useState<Application[]>([])
  const [appCode, setAppCode] = useState<Record<string, string>>({})
  const [busyApp, setBusyApp] = useState<string | null>(null)

  useEffect(() => { if (typeof window !== 'undefined') setOrigin(window.location.origin) }, [])

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/admin/affiliates')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { affiliates: Affiliate[] }
      setRows(data.affiliates)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load affiliates')
    } finally { setLoading(false) }
  }, [])

  const loadApps = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/affiliate-applications')
      if (!res.ok) return
      const data = await res.json() as { applications: Application[] }
      setApps(data.applications)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { void load(); void loadApps() }, [load, loadApps])

  async function actOnApp(a: Application, action: 'approve' | 'decline') {
    setBusyApp(a.id)
    try {
      const res = await fetch(`/api/admin/affiliate-applications/${encodeURIComponent(a.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, code: appCode[a.id]?.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      showToast(
        action === 'decline' ? 'Declined'
        : data.emailed ? `Approved → ${data.affiliate.code} · emailed`
        : `Approved → ${data.affiliate.code} · email them manually`,
      )
      await Promise.all([loadApps(), load()])
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed')
    } finally { setBusyApp(null) }
  }

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  const refLink = (c: string) => `${origin}/?ref=${c}`
  const copy = (text: string, label: string) => { void navigator.clipboard?.writeText(text); showToast(`Copied ${label}`) }
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const res = await fetch('/api/admin/affiliates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim(),
          contact: contact.trim() || null,
          perkDays: Number(perkDays),
          commissionPct: Number(commissionPct),
          commissionMonths: commissionMonths.trim() ? Number(commissionMonths) : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      showToast(`Created ${data.affiliate.code}`)
      setName(''); setCode(''); setContact('')
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Create failed')
    } finally { setCreating(false) }
  }

  async function toggleActive(a: Affiliate) {
    try {
      const res = await fetch(`/api/admin/affiliates/${encodeURIComponent(a.code)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !a.active }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch { showToast('Action failed') }
  }

  async function openReferrals(a: Affiliate) {
    if (openCode === a.code) { setOpenCode(null); return }
    setOpenCode(a.code); setLoadingRefs(true); setDetail(null)
    setPayAmount(''); setPayMethod(''); setPayNote('')
    try {
      const res = await fetch(`/api/admin/affiliates/${encodeURIComponent(a.code)}`)
      if (!res.ok) throw new Error()
      setDetail(await res.json() as Detail)
    } catch { showToast('Failed to load detail') }
    finally { setLoadingRefs(false) }
  }

  async function recordPayment(a: Affiliate) {
    const amount = Number(payAmount)
    if (!amount || amount <= 0) { showToast('Enter a positive amount'); return }
    setPayingOut(true)
    try {
      const res = await fetch(`/api/admin/affiliates/${encodeURIComponent(a.code)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, method: payMethod.trim() || null, note: payNote.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      showToast(`Recorded $${amount.toFixed(2)} to ${a.code}`)
      setPayAmount(''); setPayMethod(''); setPayNote('')
      // Refresh both the balances and the open detail.
      const [, dRes] = await Promise.all([load(), fetch(`/api/admin/affiliates/${encodeURIComponent(a.code)}`)])
      if (dRes.ok) setDetail(await dRes.json() as Detail)
    } catch (e) { showToast(e instanceof Error ? e.message : 'Failed') }
    finally { setPayingOut(false) }
  }

  const totalMonthly = rows.reduce((s, a) => s + a.estMonthly, 0)
  const totalOwed = rows.reduce((s, a) => s + a.owed, 0)

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
            <label style={labelStyle}>Creator name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jane's Beats" required style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div>
            <label style={labelStyle}>Referral code</label>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. JANE" required style={{ ...inputStyle, width: '100%', textTransform: 'uppercase' }} />
          </div>
          <div>
            <label style={labelStyle}>Contact <span style={{ fontWeight: 400 }}>(optional)</span></label>
            <input value={contact} onChange={e => setContact(e.target.value)} placeholder="email / @handle" style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div>
            <label style={labelStyle}>Referred-user perk (days)</label>
            <input type="number" min={0} value={perkDays} onChange={e => setPerkDays(e.target.value)} required style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div>
            <label style={labelStyle}>Commission %</label>
            <input type="number" min={0} max={100} value={commissionPct} onChange={e => setCommissionPct(e.target.value)} required style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div>
            <label style={labelStyle}>For how many months <span style={{ fontWeight: 400 }}>(blank = lifetime)</span></label>
            <input type="number" min={1} value={commissionMonths} onChange={e => setCommissionMonths(e.target.value)} placeholder="lifetime" style={{ ...inputStyle, width: '100%' }} />
          </div>
          <button type="submit" disabled={creating} style={{
            padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: creating ? 'default' : 'pointer',
            background: 'rgba(139,92,246,0.2)', color: 'var(--accent-light)', border: '1px solid rgba(139,92,246,0.35)',
            opacity: creating ? 0.6 : 1, whiteSpace: 'nowrap',
          }}>
            {creating ? 'Creating…' : '+ Add affiliate'}
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
          Each affiliate gets a shareable link. Anyone who signs up through it earns the creator a
          <strong style={{ color: 'var(--text-secondary)' }}> recurring {commissionPct || 0}% </strong>
          of their Pro payments{commissionMonths.trim() ? ` for ${commissionMonths} months` : ' for life'}, and the new user gets
          <strong style={{ color: 'var(--text-secondary)' }}> {perkDays || 0} free days </strong>
          of Pro. Commission below is an <em>estimate</em> based on referrals currently paying — reconcile against Stripe before you pay out.
        </p>
      </form>

      {/* ── Inbound applications (from /creators) ───────────────────────── */}
      {apps.filter(a => a.status === 'pending').length > 0 && (
        <div className="rounded-xl border p-4 mb-5" style={{ borderColor: 'color-mix(in srgb, #fbbf24 34%, var(--border))', background: 'rgba(251,191,36,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 }}>
            {apps.filter(a => a.status === 'pending').length} pending application{apps.filter(a => a.status === 'pending').length === 1 ? '' : 's'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {apps.filter(a => a.status === 'pending').map(a => (
              <div key={a.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>{a.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{a.contact}</span>
                  {a.platform && <span style={{ fontSize: 10, color: 'var(--accent-light)', fontFamily: 'monospace', textTransform: 'uppercase' }}>{a.platform}</span>}
                  {a.audience && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.audience} audience</span>}
                </div>
                {a.links && <div style={{ fontSize: 11, marginBottom: 4 }}><a href={/^https?:\/\//.test(a.links) ? a.links : undefined} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-light)', wordBreak: 'break-all' }}>{a.links}</a></div>}
                {a.note && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>{a.note}</div>}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    value={appCode[a.id] ?? ''} onChange={e => setAppCode(p => ({ ...p, [a.id]: e.target.value }))}
                    placeholder={`code (blank = ${a.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12) || 'auto'})`}
                    style={{ ...inputStyle, textTransform: 'uppercase', width: 190 }}
                  />
                  <button disabled={busyApp === a.id} onClick={() => actOnApp(a, 'approve')} style={{
                    padding: '6px 13px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    background: 'rgba(52,211,153,0.18)', color: '#34d399', border: '1px solid rgba(52,211,153,0.4)', opacity: busyApp === a.id ? 0.6 : 1,
                  }}>Approve → mint code</button>
                  <button disabled={busyApp === a.id} onClick={() => actOnApp(a, 'decline')} style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11,
                  }}>Decline</button>
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 10 }}>
            Approving mints their code on the beta terms ({`${30}% · 12mo · +30d`}), moves them into the table below, and emails them their link + how to share (when they gave an email and mail is configured — the toast confirms).
          </p>
        </div>
      )}

      {/* ── Summary ─────────────────────────────────────────────────────── */}
      {!loading && !err && rows.length > 0 && (
        <div style={{ display: 'flex', gap: 20, marginBottom: 14, flexWrap: 'wrap' }}>
          <Stat label="Affiliates" value={rows.filter(a => a.active).length} />
          <Stat label="Paying referrals" value={rows.reduce((s, a) => s + a.converted, 0)} />
          <Stat label="Accrued all-time" value={`$${rows.reduce((s, a) => s + a.accrued, 0).toFixed(2)}`} />
          <Stat label="Owed now" value={`$${totalOwed.toFixed(2)}`} accent />
          <Stat label="Est. / mo" value={`$${totalMonthly.toFixed(2)}`} />
        </div>
      )}

      {/* ── Affiliates table ────────────────────────────────────────────── */}
      {loading ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading affiliates…</p>
      ) : err ? (
        <p style={{ fontSize: 12, color: 'var(--error)' }}>{err}</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No affiliates yet — add a creator above to generate their referral link.</p>
      ) : (
        <div className="rounded-xl border" style={{ borderColor: 'var(--border)', overflowX: 'auto' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                {['Creator', 'Referral link', 'Terms', 'Paying', 'Owed', 'Est. / mo', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a, i) => (
                <React.Fragment key={a.code}>
                  <tr style={{ borderBottom: openCode === a.code ? 'none' : '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-surface)' }}>
                    <td className="px-3 py-2.5">
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 12 }}>{a.name}</div>
                      {a.contact && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{a.contact}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => copy(refLink(a.code), 'link')} title="Click to copy link" style={{
                        fontFamily: 'monospace', fontSize: 11, color: 'var(--accent-light)',
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
                      }}>/?ref={a.code}</button>
                    </td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {a.commissionPct}%{a.commissionMonths ? ` · ${a.commissionMonths}mo` : ' · life'} · +{a.perkDays}d
                    </td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{a.converted}<span style={{ color: 'var(--text-muted)' }}> / {a.referrals}</span></td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: a.owed > 0 ? '#f59e0b' : 'var(--text-muted)', fontWeight: 700, whiteSpace: 'nowrap' }} title={`Accrued $${a.accrued.toFixed(2)} − paid $${a.paid.toFixed(2)}`}>${a.owed.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: a.estMonthly > 0 ? 'var(--text-secondary)' : 'var(--text-muted)' }}>${a.estMonthly.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: a.active ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>{a.active ? 'active' : 'disabled'}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ whiteSpace: 'nowrap' }}>
                      <button onClick={() => openReferrals(a)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-light)', fontSize: 11, fontWeight: 600, marginRight: 10 }}>
                        {openCode === a.code ? 'Hide' : 'Details / pay'}
                      </button>
                      <button onClick={() => toggleActive(a)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 11 }}>
                        {a.active ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                  {openCode === a.code && (
                    <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-base)' }}>
                      <td colSpan={8} className="px-3 py-3">
                        {loadingRefs || !detail ? (
                          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</p>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>

                            {/* Balance + record payment */}
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', marginBottom: 8 }}>Balance</div>
                              <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                                <div><div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>${a.accrued.toFixed(2)}</div><div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>ACCRUED</div></div>
                                <div><div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>${a.paid.toFixed(2)}</div><div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>PAID</div></div>
                                <div><div style={{ fontSize: 15, fontWeight: 700, color: a.owed > 0 ? '#f59e0b' : 'var(--success)' }}>${a.owed.toFixed(2)}</div><div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>OWED</div></div>
                              </div>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                <input value={payAmount} onChange={e => setPayAmount(e.target.value)} type="number" min={0} step="0.01" placeholder="$ amount" style={{ ...inputStyle, width: 90 }} />
                                <input value={payMethod} onChange={e => setPayMethod(e.target.value)} placeholder="method" style={{ ...inputStyle, width: 90 }} />
                                <input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="note" style={{ ...inputStyle, width: 110 }} />
                                <button onClick={() => recordPayment(a)} disabled={payingOut} style={{
                                  padding: '6px 12px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                                  background: 'rgba(52,211,153,0.18)', color: '#34d399', border: '1px solid rgba(52,211,153,0.4)', opacity: payingOut ? 0.6 : 1,
                                }}>Record payment</button>
                              </div>
                            </div>

                            {/* Commission ledger */}
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', marginBottom: 8 }}>Commission (real invoices)</div>
                              {detail.ledger.length === 0 ? (
                                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No commission yet — accrues when a referred user pays.</p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 150, overflowY: 'auto' }}>
                                  {detail.ledger.map((l, idx) => (
                                    <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
                                      <span style={{ color: '#34d399', fontWeight: 700, width: 54 }}>+${l.commission.toFixed(2)}</span>
                                      <span style={{ color: 'var(--text-muted)' }}>of ${l.invoice.toFixed(2)}</span>
                                      <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{fmtDate(l.invoiceAt)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Payout history */}
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', marginBottom: 8 }}>Payments made</div>
                              {detail.payouts.length === 0 ? (
                                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No payments recorded yet.</p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 150, overflowY: 'auto' }}>
                                  {detail.payouts.map(p => (
                                    <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
                                      <span style={{ color: 'var(--text-primary)', fontWeight: 700, width: 54 }}>${p.amount.toFixed(2)}</span>
                                      <span style={{ color: 'var(--text-muted)' }}>{[p.method, p.note].filter(Boolean).join(' · ') || '—'}</span>
                                      <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{fmtDate(p.paidAt)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Referrals */}
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', marginBottom: 8 }}>Referrals ({detail.referrals.length})</div>
                              {detail.referrals.length === 0 ? (
                                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No signups yet. Share <span style={{ fontFamily: 'monospace', color: 'var(--accent-light)' }}>{refLink(a.code)}</span></p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 150, overflowY: 'auto' }}>
                                  {detail.referrals.map(r => (
                                    <div key={r.userId} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
                                      <span style={{ fontSize: 8.5, fontWeight: 700, padding: '1px 5px', borderRadius: 999, background: r.paying ? 'rgba(52,211,153,0.15)' : 'var(--bg-card)', color: r.paying ? '#34d399' : 'var(--text-muted)' }}>{r.paying ? 'PAYING' : 'signed up'}</span>
                                      <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{r.userId}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
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

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent ? 'var(--success)' : 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    </div>
  )
}
