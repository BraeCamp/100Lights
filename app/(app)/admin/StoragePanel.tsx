'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface Data {
  total: number
  count: number
  groups: Record<string, { count: number; bytes: number }>
  largest: { key: string; size: number }[]
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do { n /= 1024; i++ } while (n >= 1024 && i < u.length - 1)
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`
}

const CAT_COLOR: Record<string, string> = {
  'Article audio': '#38bdf8', 'Article images & video': '#a78bfa',
  'Sound catalog': '#34d399', 'User content': '#f59e0b',
}

export default function StoragePanel() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/storage')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setData(d)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load') } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])

  const groupList = data ? Object.entries(data.groups).filter(([, v]) => v.count > 0).sort((a, b) => b[1].bytes - a[1].bytes) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => void load()} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={12} /> {busy ? 'Scanning R2…' : 'Rescan'}
        </button>
        {data && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{bytes(data.total)} across {data.count.toLocaleString()} objects</span>}
        {err && <span style={{ fontSize: 12, color: '#f87171' }}>{err}</span>}
      </div>

      {!data && !err && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Scanning object storage…</p>}

      {data && (
        <>
          {/* Breakdown bar */}
          {data.total > 0 && (
            <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
              {groupList.map(([label, v]) => (
                <div key={label} title={`${label}: ${bytes(v.bytes)}`} style={{ width: `${(v.bytes / data.total) * 100}%`, background: CAT_COLOR[label] ?? 'var(--accent)' }} />
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {groupList.map(([label, v]) => (
              <div key={label} style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-card)', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: CAT_COLOR[label] ?? 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 750, marginTop: 4, color: 'var(--text-primary)' }}>{bytes(v.bytes)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{v.count.toLocaleString()} object{v.count === 1 ? '' : 's'}</div>
              </div>
            ))}
          </div>

          {/* Largest objects */}
          <p className="text-xs font-semibold mt-2 mb-1" style={{ color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Biggest objects</p>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm">
              <tbody>
                {data.largest.map((o, i) => (
                  <tr key={o.key} style={{ borderTop: i ? '1px solid var(--border)' : 'none', background: i % 2 ? 'var(--bg-surface)' : 'var(--bg-card)' }}>
                    <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-secondary)', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 480 }}>{o.key}</td>
                    <td className="px-4 py-2 text-xs text-right" style={{ color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{bytes(o.size)}</td>
                  </tr>
                ))}
                {data.largest.length === 0 && <tr><td className="px-4 py-4 text-xs" style={{ color: 'var(--text-muted)' }}>Bucket is empty.</td></tr>}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Article audio &amp; media orphans can be deleted from the Articles editor&rsquo;s file picker. User content is per-account uploads and recordings.</p>
        </>
      )}
    </div>
  )
}
