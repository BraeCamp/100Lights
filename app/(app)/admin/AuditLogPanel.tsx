'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface Entry {
  id: number
  actor: string
  action: string
  target: string | null
  detail: unknown
  created_at: string
}

// Colour actions by family so the log is scannable — money/access, content,
// moderation, config.
function actionColor(action: string): string {
  if (action.startsWith('gift') || action.startsWith('code')) return '#f97316'
  if (action.startsWith('article')) return '#a78bfa'
  if (action.startsWith('community')) return '#ef4444'
  if (action.startsWith('flags')) return '#38bdf8'
  return 'var(--text-secondary)'
}

export default function AuditLogPanel() {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/audit')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setEntries((await r.json()).entries as Entry[])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
      setEntries([])
    } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])

  const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => void load()} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={12} /> Refresh
        </button>
        {err && <span style={{ fontSize: 12, color: '#f87171' }}>{err}</span>}
      </div>

      {entries === null && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</p>}
      {entries?.length === 0 && !err && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          No admin actions recorded yet. Gifts, code changes, module toggles, article publishes/deletes, and community takedowns will appear here.
        </p>
      )}

      {entries && entries.length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                {['When', 'Who', 'Action', 'Target', 'Detail'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-surface)' }}>
                  <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmt(e.created_at)}</td>
                  <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-secondary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.actor}</td>
                  <td className="px-4 py-2 text-xs font-semibold" style={{ color: actionColor(e.action), whiteSpace: 'nowrap' }}>{e.action}</td>
                  <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-primary)', fontFamily: 'monospace', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.target ?? '—'}</td>
                  <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'monospace', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.detail ? JSON.stringify(e.detail) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
