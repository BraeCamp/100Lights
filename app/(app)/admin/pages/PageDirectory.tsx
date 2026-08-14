'use client'
import { useMemo, useState } from 'react'
import { FileText, Server, Search, ExternalLink } from 'lucide-react'

interface Entry { route: string; file: string; kind: 'page' | 'api'; dynamic: boolean; group: string | null; section: string }

const chip = (bg: string, fg: string, on: boolean): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? 'transparent' : 'var(--border)'}`, background: on ? bg : 'transparent', color: on ? fg : 'var(--text-secondary)' })

export default function PageDirectory({ entries, source }: { entries: Entry[]; source: 'live' | 'manifest' }) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'page' | 'api' | 'all'>('page')
  const [origin, setOrigin] = useState('')
  useState(() => { if (typeof window !== 'undefined') setOrigin(window.location.origin) })

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return entries
      .filter(e => kind === 'all' || e.kind === kind)
      .filter(e => !s || e.route.toLowerCase().includes(s) || e.file.toLowerCase().includes(s))
      .sort((a, b) => a.route.localeCompare(b.route))
  }, [entries, q, kind])

  const groups = useMemo(() => {
    const m = new Map<string, Entry[]>()
    for (const e of filtered) { const g = m.get(e.section) ?? []; g.push(e); m.set(e.section, g) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const nPage = entries.filter(e => e.kind === 'page').length
  const nApi = entries.filter(e => e.kind === 'api').length

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 18px 70px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 850, color: 'var(--text-primary)', margin: '0 0 4px' }}>Site directory</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 4px', maxWidth: 720 }}>
        Every routable page and API route in the app — indexable or not, including admin, dynamic, and unlisted pages. {nPage} pages · {nApi} API routes.
      </p>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 18px' }}>
        Source: <strong>{source === 'live' ? 'live filesystem (dev)' : 'build manifest'}</strong>{source === 'manifest' ? ' — regenerated on each deploy (npm run pages:gen to refresh locally).' : ' — always current.'}
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 200 }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-muted)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter routes or files…" style={{ width: '100%', padding: '8px 11px 8px 34px', borderRadius: 10, fontSize: 13.5, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)' }} />
        </div>
        <button type="button" onClick={() => setKind('page')} style={chip('var(--accent)', '#0e0d12', kind === 'page')}><FileText size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Pages</button>
        <button type="button" onClick={() => setKind('api')} style={chip('#22d3ee', '#04121a', kind === 'api')}><Server size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />API</button>
        <button type="button" onClick={() => setKind('all')} style={chip('var(--text-secondary)', 'var(--bg-base)', kind === 'all')}>All</button>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>{filtered.length} shown</p>

      <div style={{ display: 'grid', gap: 22 }}>
        {groups.map(([section, list]) => (
          <div key={section}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 8px' }}>/{section === 'home' ? '' : section} <span style={{ color: 'var(--faint,var(--text-muted))', opacity: 0.6 }}>· {list.length}</span></div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              {list.map((e, i) => (
                <div key={e.file} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderTop: i ? '1px solid var(--border)' : 'none', background: 'var(--bg-card)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 9, flexShrink: 0, background: e.kind === 'api' ? '#22d3ee' : 'var(--accent)' }} />
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {e.dynamic
                        ? <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{e.route}</span>
                        : <a href={(e.kind === 'api' ? '' : origin) + e.route} target="_blank" rel="noreferrer" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}>{e.route}<ExternalLink size={11} style={{ verticalAlign: '-1px', marginLeft: 4, opacity: 0.6 }} /></a>}
                      {e.dynamic && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>dynamic</span>}
                      {e.kind === 'api' && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, border: '1px solid #22d3ee55', color: '#22d3ee' }}>API</span>}
                      {e.group && <span style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)' }}>{e.group}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.file}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No routes match “{q}”.</p>}
      </div>
    </main>
  )
}
