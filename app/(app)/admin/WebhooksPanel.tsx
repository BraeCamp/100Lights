'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, RotateCcw, X } from 'lucide-react'

interface Evt {
  id: number
  source: string
  event_type: string
  event_id: string | null
  status: string
  error: string | null
  replay_of: number | null
  received_at: string
  handled_at: string | null
}
interface Stats { total: number; failed: number; day: number }

const STATUS_COLOR: Record<string, string> = { handled: '#34d399', failed: '#ef4444', received: '#fbbf24' }

export default function WebhooksPanel() {
  const [events, setEvents] = useState<Evt[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [source, setSource] = useState('all')
  const [status, setStatus] = useState('all')
  const [replaying, setReplaying] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ id: number; payload: unknown } | null>(null)

  async function load() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/admin/webhooks?source=${source}&status=${status}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setEvents(d.events); setStats(d.stats)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [source, status]) // eslint-disable-line react-hooks/exhaustive-deps

  async function replay(id: number) {
    if (!window.confirm(`Replay webhook #${id}? The handler will re-run against live Stripe/Clerk data. Handlers are idempotent.`)) return
    setReplaying(id)
    try {
      const r = await fetch(`/api/admin/webhooks/${id}/replay`, { method: 'POST' })
      const d = await r.json()
      setToast(d.ok ? `Replayed #${id} ✓` : `Replay failed: ${d.error}`)
      await load()
    } catch (e) { setToast(`Replay failed: ${e instanceof Error ? e.message : 'error'}`) }
    finally { setReplaying(null); setTimeout(() => setToast(null), 4000) }
  }

  async function openDetail(id: number) {
    setDetail({ id, payload: null })
    try {
      const r = await fetch(`/api/admin/webhooks/${id}`, { cache: 'no-store' })
      const d = await r.json()
      setDetail({ id, payload: d.event?.payload ?? d.error ?? 'not found' })
    } catch { setDetail({ id, payload: 'Failed to load' }) }
  }

  const pill = (v: string, cur: string, set: (s: string) => void, opts: string[]) => (
    <div style={{ display: 'flex', gap: 4 }}>
      {opts.map(o => (
        <button key={o} onClick={() => set(o)}
          style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
            border: '1px solid ' + (cur === o ? 'var(--accent)' : 'var(--border)'),
            background: cur === o ? 'var(--accent)' : 'transparent', color: cur === o ? '#fff' : 'var(--text-secondary)' }}>
          {o}
        </button>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button onClick={() => void load()} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={12} /> {busy ? 'Loading…' : 'Refresh'}
        </button>
        {stats && (
          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Last 24h <b style={{ color: 'var(--text-primary)' }}>{stats.day}</b></span>
            <span style={{ color: 'var(--text-secondary)' }}>Total <b style={{ color: 'var(--text-primary)' }}>{stats.total}</b></span>
            <span style={{ color: stats.failed ? '#f87171' : 'var(--text-secondary)' }}>Failed <b>{stats.failed}</b></span>
          </div>
        )}
        {err && <span style={{ fontSize: 12, color: '#f87171' }}>{err}</span>}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {pill('source', source, setSource, ['all', 'stripe', 'clerk'])}
        {pill('status', status, setStatus, ['all', 'handled', 'failed', 'received'])}
      </div>

      {events.length === 0 && !busy ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No webhook events recorded yet. They appear here as Stripe and Clerk fire.</p>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11 }}>
                <th style={{ padding: '8px 10px' }}>When</th>
                <th style={{ padding: '8px 10px' }}>Source</th>
                <th style={{ padding: '8px 10px' }}>Event</th>
                <th style={{ padding: '8px 10px' }}>Status</th>
                <th style={{ padding: '8px 10px' }}></th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? 'var(--bg-surface)' : 'var(--bg-card)' }}>
                  <td style={{ padding: '8px 10px', fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(e.received_at).toLocaleString()}</td>
                  <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-secondary)' }}>{e.source}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <button onClick={() => void openDetail(e.id)} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                      {e.event_type}
                    </button>
                    {e.replay_of && <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--accent)' }}>↻ replay of #{e.replay_of}</span>}
                    {e.error && <div style={{ fontSize: 10.5, color: '#f87171', marginTop: 2, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.error}</div>}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: STATUS_COLOR[e.status] ?? 'var(--text-muted)' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[e.status] ?? 'var(--text-muted)' }} />
                      {e.status}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    <button onClick={() => void replay(e.id)} disabled={replaying === e.id}
                      title="Re-run this event's handler"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: 'pointer', opacity: replaying === e.id ? 0.5 : 1 }}>
                      <RotateCcw size={11} /> {replaying === e.id ? '…' : 'Replay'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Every Stripe and Clerk webhook is recorded with its outcome. Replay re-runs the stored payload through the same idempotent handler — the fix for &ldquo;the event fired but the account didn&rsquo;t update.&rdquo;</p>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 60, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', fontSize: 13, color: 'var(--text-primary)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>{toast}</div>
      )}

      {detail && (
        <div onClick={() => setDetail(null)} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, maxWidth: 720, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Webhook #{detail.id} payload</span>
              <button onClick={() => setDetail(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={16} /></button>
            </div>
            <pre style={{ margin: 0, padding: 16, overflow: 'auto', fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              {detail.payload === null ? 'Loading…' : JSON.stringify(detail.payload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
