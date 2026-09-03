'use client'

import { useEffect, useState } from 'react'

// How songs are actually loading, on real machines.
//
// Brae: "Errors should go to the program and save in the admin so that you can
// use it to make edits when we make a pass. Keep the information of when the
// user hits play while it's loading and when loading resumes. This way we can
// see how playing can get in the way of loading."
//
// So the numbers at the top are chosen to answer that question directly: how
// many sessions were interrupted by play, and how long they spent parked. The
// rows below are for the pass — one line per troubled session, worst first,
// with the device it happened on, because "it is slow" needs something to
// compare against.

interface Row {
  id: string; ts: number; userId: string
  projectId: string; projectName: string
  wanted: number; done: number; elapsedMs: number
  errors: number; silent: number; setAside: number; givenUp: number
  playInterruptions: number; pausedMs: number
  outcome: string; device: string
  events: { t: number; kind: string; layer?: string; detail?: string; ms?: number }[]
}
interface Data {
  totalSessions: number; troubled: number; gaveUp: number
  medianElapsedMs: number; interrupted: number; avgPausedMs: number
  rows: Row[]
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`

export default function LoadReportsPanel() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/admin/load-reports')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`http ${r.status}`)))
      .then(setData)
      .catch(e => setErr(String(e.message ?? e)))
  }, [])

  if (err) return <div style={{ color: '#f87171', fontSize: 13 }}>Couldn&rsquo;t load reports: {err}</div>
  if (!data) return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Reading…</div>
  if (!data.rows.length) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
        Nothing reported yet. A session is only written down when it has trouble
        — an error, a silent render, a clip set aside, or a load over 20 seconds
        — so an empty list here means loading has been going well.
      </div>
    )
  }

  const fig = (n: string | number, label: string, tone?: string) => (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', minWidth: 130 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: tone ?? 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{n}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {fig(data.totalSessions, 'sessions reported')}
        {fig(data.troubled, 'had errors', data.troubled ? '#e0a458' : undefined)}
        {fig(data.gaveUp, 'gave up on a clip', data.gaveUp ? '#f87171' : undefined)}
        {fig(secs(data.medianElapsedMs), 'median load')}
        {fig(data.interrupted, 'interrupted by play')}
        {fig(secs(data.avgPausedMs), 'average time parked for playback')}
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, minWidth: 860 }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
              {['When', 'Song', 'Got to', 'Took', 'Errors', 'Silent', 'Aside', 'Play stops', 'Parked', 'Outcome', 'Device'].map(h => (
                <th key={h} style={{ padding: '7px 9px', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map(r => (
              <>
                <tr
                  key={r.id}
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                  style={{ cursor: 'pointer', background: open === r.id ? 'rgb(var(--accent-rgb) / .08)' : 'transparent' }}
                >
                  <td style={td}>{new Date(r.ts).toISOString().slice(5, 16).replace('T', ' ')}</td>
                  <td style={{ ...td, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.projectName || '(untitled)'}</td>
                  <td style={num}>{r.wanted ? `${r.done}/${r.wanted}` : '—'}</td>
                  <td style={num}>{secs(r.elapsedMs)}</td>
                  <td style={{ ...num, color: r.errors ? '#f87171' : 'inherit' }}>{r.errors || ''}</td>
                  <td style={{ ...num, color: r.silent ? '#e0a458' : 'inherit' }}>{r.silent || ''}</td>
                  <td style={num}>{r.setAside || ''}</td>
                  <td style={{ ...num, color: r.playInterruptions ? '#e0c07a' : 'inherit' }}>{r.playInterruptions || ''}</td>
                  <td style={num}>{r.pausedMs ? secs(r.pausedMs) : ''}</td>
                  <td style={td}>{r.outcome}</td>
                  <td style={{ ...td, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{r.device}</td>
                </tr>
                {open === r.id && (
                  <tr key={`${r.id}-d`}>
                    <td colSpan={11} style={{ padding: '6px 12px 12px', background: 'var(--bg-surface)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontFamily: 'ui-monospace, monospace', fontSize: 10.5 }}>
                        {(r.events ?? []).map((e, i) => (
                          <div key={i} style={{ display: 'flex', gap: 8, color: /error|silent|stall|gave-up|reset/.test(e.kind) ? '#f0a0a0' : e.kind === 'paused' || e.kind === 'resumed' ? '#e0c07a' : 'var(--text-muted)' }}>
                            <span style={{ minWidth: 52, textAlign: 'right', opacity: .7 }}>{(e.t / 1000).toFixed(1)}s</span>
                            <span style={{ minWidth: 96, fontWeight: 600 }}>{e.kind}</span>
                            <span>{e.layer ? `${e.layer} — ` : ''}{e.detail ?? ''}{typeof e.ms === 'number' ? ` ${e.ms}ms` : ''}</span>
                          </div>
                        ))}
                        {!(r.events ?? []).length && <span style={{ color: 'var(--text-muted)' }}>No events kept for this session.</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const td: React.CSSProperties = { padding: '6px 9px', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)' }
const num: React.CSSProperties = { ...td, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
