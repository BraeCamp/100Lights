'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Mail, Copy, Check } from 'lucide-react'

interface Digest {
  generatedAt: string
  users: { total: number; newToday: number; new7d: number; new30d: number }
  revenue: { payingPro: number; giftedPro: number; codePro: number; comped: number; mrrCents: number | null; currency: string; compMonthlyCents: number | null }
  activity: { projects: number; savedToday: number; saved7d: number; newCommunity24h: number }
  attention: { openFeedback: number; reportedItems: number; reportedComments: number; failedWebhooks24h: number; dunning: number }
  lifecycle: Record<string, number>
  tasks: { id: number; userId: string; email: string; body: string; dueAt: string; overdue: boolean }[]
  headlines: string[]
}

// Jump to a user's record from anywhere (mirrors the ⌘K palette).
function openUser(userId: string, email: string) {
  const u = { userId, email }
  ;(window as unknown as { __adminPendingUser?: unknown }).__adminPendingUser = u
  window.location.hash = '#general/users'
  window.dispatchEvent(new CustomEvent('admin:open-user', { detail: u }))
}
const dueLabel = (iso: string) => {
  const h = Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000)
  if (h < 0) { const a = Math.abs(h); return a < 24 ? `${a}h overdue` : `${Math.floor(a / 24)}d overdue` }
  return h < 24 ? `due in ${h}h` : `due in ${Math.floor(h / 24)}d`
}

const LIFECYCLE_STRIP = [
  { id: 'new', label: 'New', color: '#94a3b8' },
  { id: 'activated', label: 'Activated', color: '#38bdf8' },
  { id: 'engaged', label: 'Engaged', color: '#22d3ee' },
  { id: 'power', label: 'Power', color: '#a78bfa' },
  { id: 'paying', label: 'Paying', color: '#34d399' },
  { id: 'at-risk', label: 'At-risk', color: '#f59e0b' },
  { id: 'churned', label: 'Churned', color: '#ef4444' },
]

const money = (c: number | null) => c === null ? '—' : `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

function Metric({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: warn ? '#f87171' : 'var(--text-primary)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function DigestPanel() {
  const [d, setD] = useState<Digest | null>(null)
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [emailMsg, setEmailMsg] = useState<string | null>(null)

  async function load() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/digest', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setD(j.digest); setEmailEnabled(!!j.emailEnabled)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])

  async function emailMe() {
    setEmailMsg('Sending…')
    try {
      const r = await fetch('/api/admin/digest', { method: 'POST' })
      const j = await r.json()
      setEmailMsg(r.ok && j.ok ? `Sent to ${j.to}` : (j.error || 'Send failed'))
    } catch { setEmailMsg('Send failed') }
    setTimeout(() => setEmailMsg(null), 5000)
  }

  function copy() {
    if (!d) return
    const text = [`100Lights brief — ${new Date(d.generatedAt).toLocaleString()}`, '', ...d.headlines.map(h => '• ' + h)].join('\n')
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => void load()} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={12} /> {busy ? 'Loading…' : 'Refresh'}
        </button>
        <button onClick={copy} disabled={!d}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy headlines'}
        </button>
        <button onClick={() => void emailMe()} disabled={!d || !emailEnabled} title={emailEnabled ? 'Email this brief to your account' : 'Set RESEND_API_KEY to enable email'}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: emailEnabled ? 'pointer' : 'not-allowed', opacity: emailEnabled ? 1 : 0.5 }}>
          <Mail size={12} /> Email me
        </button>
        {emailMsg && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{emailMsg}</span>}
        {d && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>as of {new Date(d.generatedAt).toLocaleTimeString()}</span>}
        {err && <span style={{ fontSize: 12, color: '#f87171' }}>{err}</span>}
      </div>

      {!d && !err && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Composing brief…</p>}

      {d && (
        <>
          {/* Headlines */}
          <div style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(139,92,246,0.35)', background: 'rgba(139,92,246,0.06)' }}>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {d.headlines.map((h, i) => (
                <li key={i} style={{ fontSize: 14, color: h.includes('⚠️') ? '#fca5a5' : 'var(--text-primary)' }}>{h.replace('⚠️ ', '')}</li>
              ))}
            </ul>
          </div>

          {/* Follow-ups due — click to open that user's record */}
          {d.tasks?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Follow-ups due</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.tasks.map(t => (
                  <button key={t.id} onClick={() => openUser(t.userId, t.email)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '9px 12px', borderRadius: 9, cursor: 'pointer',
                      border: `1px solid ${t.overdue ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`, background: t.overdue ? 'rgba(239,68,68,0.06)' : 'var(--bg-surface)' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text-primary)' }}>{t.body}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.email || t.userId}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: t.overdue ? '#f87171' : 'var(--text-secondary)', flexShrink: 0, whiteSpace: 'nowrap' }}>{dueLabel(t.dueAt)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
            <Metric label="Users" value={String(d.users.total)} sub={`+${d.users.newToday} today · +${d.users.new7d}/wk`} />
            <Metric label="MRR" value={money(d.revenue.mrrCents)} sub={`${d.revenue.payingPro} paying`} />
            <Metric label="Comped" value={String(d.revenue.comped)} sub={`${money(d.revenue.compMonthlyCents)}/mo given`} />
            <Metric label="Saved today" value={String(d.activity.savedToday)} sub={`${d.activity.saved7d} this week`} />
            <Metric label="New shares 24h" value={String(d.activity.newCommunity24h)} />
            <Metric label="Open feedback" value={String(d.attention.openFeedback)} warn={d.attention.openFeedback > 0} />
            <Metric label="Reports" value={String(d.attention.reportedItems + d.attention.reportedComments)} warn={d.attention.reportedItems + d.attention.reportedComments > 0} />
            <Metric label="Webhook fails 24h" value={String(d.attention.failedWebhooks24h)} warn={d.attention.failedWebhooks24h > 0} />
            <Metric label="Dunning" value={String(d.attention.dunning)} warn={d.attention.dunning > 0} />
          </div>

          {/* Lifecycle distribution */}
          {d.lifecycle && Object.keys(d.lifecycle).length > 0 && (() => {
            const total = LIFECYCLE_STRIP.reduce((a, s) => a + (d.lifecycle[s.id] ?? 0), 0)
            return (
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Lifecycle</div>
                <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', background: 'var(--bg-base)' }}>
                  {LIFECYCLE_STRIP.map(s => { const n = d.lifecycle[s.id] ?? 0; return n > 0 ? <div key={s.id} title={`${s.label}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: s.color }} /> : null })}
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                  {LIFECYCLE_STRIP.map(s => (
                    <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
                      {s.label} <b style={{ color: 'var(--text-primary)' }}>{d.lifecycle[s.id] ?? 0}</b>
                    </span>
                  ))}
                </div>
              </div>
            )
          })()}
        </>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Everything you need each morning in one glance. A weekly copy can be emailed automatically — set RESEND_API_KEY + DIGEST_TO and the /api/cron/digest schedule is already wired in vercel.json.</p>
    </div>
  )
}
