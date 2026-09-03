'use client'

import { useCallback, useEffect, useState } from 'react'

interface Entry {
  id: string
  template: string
  calls: { name: string; input: Record<string, unknown> }[]
  contributors: number
  approved: boolean
  blocked: boolean
}

/**
 * What the studios have taught each other, waiting to be let out.
 *
 * ⚠️ AN APPROVED ENTRY ACTS ON OTHER PEOPLE'S SONGS. That is a different risk
 * in kind from a cache answering its own author, so nothing here reaches
 * anybody until it is approved by hand. The contributor count is the evidence
 * to read it by: "said by nine different people" is a very different row from
 * "said by one person once", and the same person saying it twice does not
 * count twice.
 */
export default function SharedCommandsPanel() {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/learned')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { entries?: Entry[] }
      setEntries(data.entries ?? [])
    } catch (e) {
      setError(String(e))
      setEntries([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const set = async (id: string, patch: { approved?: boolean; blocked?: boolean }) => {
    setBusy(id)
    try {
      await fetch('/api/admin/learned', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      })
      setEntries(list => (list ?? []).map(e => e.id === id ? { ...e, ...patch } : e))
    } finally { setBusy(null) }
  }

  if (entries === null) return <p style={{ opacity: 0.7 }}>Loading…</p>
  if (error) return <p style={{ color: '#f87171' }}>{error}</p>
  if (!entries.length) {
    return (
      <p style={{ opacity: 0.7 }}>
        Nothing offered yet. Templates arrive here when the assistant works out a
        sentence it had not seen — one per phrasing, not one per person.
      </p>
    )
  }

  const waiting = entries.filter(e => !e.approved && !e.blocked).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.75 }}>
        {entries.length} offered · <strong>{waiting} waiting</strong> ·{' '}
        {entries.filter(e => e.approved).length} live
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border, #333)', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.7 }}>
              <th style={{ padding: '6px 10px' }}>Template</th>
              <th style={{ padding: '6px 10px' }}>Means</th>
              <th style={{ padding: '6px 10px', textAlign: 'right' }}>People</th>
              <th style={{ padding: '6px 10px' }}>State</th>
              <th style={{ padding: '6px 10px' }} />
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} style={{ borderTop: '1px solid var(--border, #333)', opacity: e.blocked ? 0.45 : 1 }}>
                <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace' }}>{e.template}</td>
                <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace', opacity: 0.85 }}>
                  {e.calls.map(c => `${c.name}(${Object.entries(c.input ?? {})
                    .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')})`).join(' · ')}
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {e.contributors}
                </td>
                <td style={{ padding: '6px 10px' }}>
                  {e.blocked ? 'blocked' : e.approved ? 'live' : 'waiting'}
                </td>
                <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                  <button
                    disabled={busy === e.id}
                    onClick={() => void set(e.id, { approved: !e.approved, blocked: false })}
                    style={{ marginRight: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}
                  >{e.approved ? 'Withdraw' : 'Approve'}</button>
                  <button
                    disabled={busy === e.id}
                    onClick={() => void set(e.id, { blocked: !e.blocked })}
                    style={{ padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}
                  >{e.blocked ? 'Unblock' : 'Block'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
