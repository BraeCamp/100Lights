'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface UserRow { user_id: string | null; email: string; provider: string; calls: number; units: number; in_tokens: number | null; out_tokens: number | null; cost_usd: number | null }
interface TotalRow { provider: string; calls: number; users: number; in_tokens: number | null; out_tokens: number | null; cost_usd: number | null }
interface UnitRow { provider: string; operation: string | null; unit_type: string | null; calls: number; units: number | null; cost_usd: number | null }
interface RecentRow { id: string; user_id: string | null; provider: string; operation: string | null; units: number | null; unit_type: string | null; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null; metadata: Record<string, unknown> | null; created_at: string }
interface Data { byUser: UserRow[]; totals: TotalRow[]; byUnit: UnitRow[]; recent: RecentRow[]; at: string }

const PROVIDER_COLOR: Record<string, string> = {
  elevenlabs: '#f59e0b', anthropic: '#8b5cf6', deepgram: '#10b981', replicate: '#3b82f6', openai: '#22d3ee',
}
const pc = (p: string) => PROVIDER_COLOR[p] ?? 'var(--text-secondary)'
const money = (n: number | null | undefined) => n == null ? '—' : `$${Number(n).toFixed(Number(n) < 1 ? 4 : 2)}`
const num = (n: number | null | undefined) => n == null ? '—' : Number(n).toLocaleString()

export default function UsagePanel() {
  const [data, setData] = useState<Data | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/usage')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setData(d)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])

  const grandCost = data?.totals.reduce((s, t) => s + (Number(t.cost_usd) || 0), 0) ?? 0
  const th: React.CSSProperties = { textAlign: 'left', padding: '7px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }
  const td: React.CSSProperties = { padding: '7px 12px', fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }

  // Pull the exact credits figure out of a recent row's metadata when present.
  const rowCredits = (m: Record<string, unknown> | null): string => {
    const c = m?.credits
    return typeof c === 'number' ? c.toLocaleString() : ''
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => void load()} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={12} /> {busy ? 'Loading…' : 'Refresh'}
        </button>
        {data && <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{money(grandCost)} total est. spend</span>}
        {data && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>as of {new Date(data.at).toLocaleTimeString()}</span>}
        {err && <span style={{ fontSize: 12, color: '#f87171' }}>{err}</span>}
      </div>

      {!data && !err && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading usage…</p>}
      {data && data.totals.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No usage recorded yet. Rows land here as paid APIs (ElevenLabs, Anthropic, Deepgram, Replicate) get called.</p>
      )}

      {data && data.totals.length > 0 && (
        <>
          {/* Per-provider totals */}
          <section>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>By provider</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {data.totals.map(t => (
                <div key={t.provider} className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', padding: '12px 16px', minWidth: 150 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: pc(t.provider), textTransform: 'capitalize' }}>{t.provider}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{money(t.cost_usd)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{num(t.calls)} calls · {num(t.users)} users</div>
                </div>
              ))}
            </div>
          </section>

          {/* Provider × operation × unit — exact credits distinct from proxies */}
          <section>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>By operation &amp; unit</div>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--bg-surface)' }}>
                  <th style={th}>Provider</th><th style={th}>Operation</th><th style={th}>Unit</th>
                  <th style={{ ...th, textAlign: 'right' }}>Calls</th><th style={{ ...th, textAlign: 'right' }}>Units</th><th style={{ ...th, textAlign: 'right' }}>Cost</th>
                </tr></thead>
                <tbody>
                  {data.byUnit.map((u, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? 'var(--bg-surface)' : 'var(--bg-card)' }}>
                      <td style={{ ...td, fontWeight: 700, color: pc(u.provider), textTransform: 'capitalize' }}>{u.provider}</td>
                      <td style={td}>{u.operation ?? '—'}</td>
                      <td style={td}>{u.unit_type === 'credits'
                        ? <span style={{ color: '#f59e0b', fontWeight: 700 }}>credits</span>
                        : (u.unit_type ?? '—')}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{num(u.calls)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{num(u.units)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{money(u.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 5 }}>ElevenLabs rows in <span style={{ color: '#f59e0b' }}>credits</span> are the exact per-request cost (from the subscription-balance delta). Rows in <em>seconds</em> are a fallback when the balance couldn&rsquo;t be read.</p>
          </section>

          {/* Per-user attribution */}
          <section>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>By user</div>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--bg-surface)' }}>
                  <th style={th}>User</th><th style={th}>Provider</th>
                  <th style={{ ...th, textAlign: 'right' }}>Calls</th><th style={{ ...th, textAlign: 'right' }}>Units</th>
                  <th style={{ ...th, textAlign: 'right' }}>Tokens</th><th style={{ ...th, textAlign: 'right' }}>Cost</th>
                </tr></thead>
                <tbody>
                  {data.byUser.map((u, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? 'var(--bg-surface)' : 'var(--bg-card)' }}>
                      <td style={{ ...td, color: 'var(--text-primary)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email || <span className="font-mono" style={{ color: 'var(--text-muted)' }}>{u.user_id}</span>}</td>
                      <td style={{ ...td, fontWeight: 700, color: pc(u.provider), textTransform: 'capitalize' }}>{u.provider}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{num(u.calls)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{num(u.units)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{u.in_tokens || u.out_tokens ? `${num(u.in_tokens)} / ${num(u.out_tokens)}` : '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>{money(u.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Recent feed */}
          <section>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Recent calls</div>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--bg-surface)' }}>
                  <th style={th}>When</th><th style={th}>Provider</th><th style={th}>Operation</th>
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={{ ...th, textAlign: 'right' }}>EL credits</th><th style={{ ...th, textAlign: 'right' }}>Cost</th>
                </tr></thead>
                <tbody>
                  {data.recent.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td style={{ ...td, fontWeight: 700, color: pc(r.provider), textTransform: 'capitalize' }}>{r.provider}</td>
                      <td style={td}>{r.operation ?? '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.units != null ? `${num(r.units)} ${r.unit_type ?? ''}`.trim() : '—'}</td>
                      <td style={{ ...td, textAlign: 'right', color: '#f59e0b', fontWeight: 700 }}>{rowCredits(r.metadata) || '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{money(r.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
