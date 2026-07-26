'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface FunnelStep { key: string; label: string; count: number }
interface Cohort { cohort: string; size: number; activated: number; activeNow: number; paying: number }

const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 0
const retColor = (p: number) => p >= 50 ? '#34d399' : p >= 25 ? '#fbbf24' : p > 0 ? '#f87171' : 'var(--text-muted)'
const cohortLabel = (c: string) => { const [y, m] = c.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) }

export default function GrowthPanel() {
  const [funnel, setFunnel] = useState<FunnelStep[]>([])
  const [cohorts, setCohorts] = useState<Cohort[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/growth', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setFunnel(d.funnel); setCohorts(d.cohorts)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])

  const top = funnel[0]?.count ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => void load()} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={12} /> {busy ? 'Loading…' : 'Refresh'}
        </button>
        {err && <span style={{ fontSize: 12, color: '#f87171' }}>{err}</span>}
      </div>

      {/* Funnel */}
      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}>Conversion funnel</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {funnel.map((s, i) => {
            const width = top > 0 ? Math.max(6, (s.count / top) * 100) : 6
            const fromPrev = i > 0 ? pct(s.count, funnel[i - 1].count) : 100
            const overall = pct(s.count, top)
            return (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 200, flexShrink: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>{s.label}</div>
                <div style={{ flex: 1, minWidth: 0, height: 30, borderRadius: 7, background: 'var(--bg-base)', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ width: `${width}%`, height: '100%', background: 'linear-gradient(90deg, rgba(139,92,246,0.85), rgba(139,92,246,0.5))', borderRadius: 7, display: 'flex', alignItems: 'center', paddingLeft: 10 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{s.count.toLocaleString()}</span>
                  </div>
                </div>
                <div style={{ width: 118, flexShrink: 0, textAlign: 'right', fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {i === 0 ? 'top of funnel' : <><span style={{ color: fromPrev >= 50 ? '#34d399' : fromPrev >= 20 ? '#fbbf24' : '#f87171', fontWeight: 700 }}>{fromPrev}%</span> of prev · {overall}% overall</>}
                </div>
              </div>
            )
          })}
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8 }}>Starts at signup — raw visitor traffic lives in PostHog. Activated = saved a project; Habitual = 3+ projects or active in the last 30 days.</p>
      </div>

      {/* Cohort retention */}
      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 8 }}>Signup cohorts — retention by month</p>
        {cohorts.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No cohorts yet.</p>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, background: 'var(--bg-card)' }}>
                  <th style={{ padding: '8px 12px' }}>Cohort</th>
                  <th style={{ padding: '8px 12px' }}>Signups</th>
                  <th style={{ padding: '8px 12px' }}>Activated</th>
                  <th style={{ padding: '8px 12px' }}>Still active</th>
                  <th style={{ padding: '8px 12px' }}>Paying</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c, i) => {
                  const aP = pct(c.activated, c.size), rP = pct(c.activeNow, c.size), pP = pct(c.paying, c.size)
                  return (
                    <tr key={c.cohort} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? 'var(--bg-surface)' : 'var(--bg-card)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>{cohortLabel(c.cohort)}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{c.size}</td>
                      <td style={{ padding: '8px 12px' }}><span style={{ color: retColor(aP), fontWeight: 700 }}>{aP}%</span> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({c.activated})</span></td>
                      <td style={{ padding: '8px 12px' }}><span style={{ color: retColor(rP), fontWeight: 700 }}>{rP}%</span> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({c.activeNow})</span></td>
                      <td style={{ padding: '8px 12px' }}><span style={{ color: pP > 0 ? '#34d399' : 'var(--text-muted)', fontWeight: 700 }}>{pP}%</span> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({c.paying})</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8 }}>&ldquo;Still active&rdquo; = saved a project in the last 30 days. Rising activation/retention down the months means the product is getting stickier.</p>
      </div>
    </div>
  )
}
