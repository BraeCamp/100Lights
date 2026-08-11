'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface Format { id: string; name: string; hook: string; makesWith: string }
interface Rank { format_tag: string; posts: number; avg_completion_pct: number | null; avg_hook_pct: number | null; views: number; subs: number; subs_per_1k: number | null; likes_per_1k: number | null }
interface Post { id: string; platform: string; format_tag: string | null; hook_type: string | null; title: string | null; length_s: number | null; posted_at: string | null; views: number; avg_pct_viewed: number | null; first3s_retention: number | null; subs_gained: number; notes: string | null }
interface Data { formats: Format[]; hookTypes: string[]; ranking: Rank[]; posts: Post[]; at: string }

const num = (n: number | null | undefined) => n == null ? '—' : Number(n).toLocaleString()
const pct = (n: number | null | undefined) => n == null ? '—' : `${Number(n).toFixed(0)}%`

export default function FormatsPanel() {
  const [data, setData] = useState<Data | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/formats')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setData(d)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])

  const rankFor = (id: string) => data?.ranking.find(r => r.format_tag === id)
  // "Corrections" = the per-post notes (what worked / what to fix), newest first.
  const corrections = (data?.posts ?? []).filter(p => p.notes && p.notes.trim())

  const th: React.CSSProperties = { textAlign: 'left', padding: '7px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }
  const td: React.CSSProperties = { padding: '7px 12px', fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => void load()} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={12} /> {busy ? 'Loading…' : 'Refresh'}
        </button>
        {data && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{data.formats.length} formats · {data.posts.length} posts logged</span>}
        {data && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>as of {new Date(data.at).toLocaleTimeString()}</span>}
        {err && <span style={{ fontSize: 12, color: '#f87171' }}>{err}</span>}
      </div>

      {!data && !err && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading formats…</p>}

      {data && (
        <>
          {/* Format cards — focus (hook + makesWith) with performance folded in */}
          <section>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Formats &amp; their focus</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {data.formats.map(f => {
                const r = rankFor(f.id)
                return (
                  <div key={f.id} className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', padding: 14, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)' }}>{f.name}</span>
                      <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>{f.id}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--accent-light)', fontStyle: 'italic' }}>{f.hook}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>▸ made with {f.makesWith}</div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 4, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {r ? (
                        <>
                          <span title="posts logged"><b style={{ color: 'var(--text-secondary)' }}>{r.posts}</b> posts</span>
                          <span title="avg completion %"><b style={{ color: 'var(--text-secondary)' }}>{pct(r.avg_completion_pct)}</b> compl.</span>
                          <span title="subscribers gained per 1k views"><b style={{ color: '#34d399' }}>{r.subs_per_1k ?? '—'}</b> subs/1k</span>
                        </>
                      ) : (
                        <span style={{ fontStyle: 'italic' }}>no posts logged yet</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Hook archetypes */}
          <section>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Hook archetypes</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {data.hookTypes.map(h => (
                <span key={h} style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 99, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>{h}</span>
              ))}
            </div>
          </section>

          {/* Ranking table — what to scale */}
          {data.ranking.length > 0 && (
            <section>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Ranking — sorted by subs / 1k views</div>
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: 'var(--bg-surface)' }}>
                    <th style={th}>Format</th><th style={{ ...th, textAlign: 'right' }}>Posts</th>
                    <th style={{ ...th, textAlign: 'right' }}>Hook %</th><th style={{ ...th, textAlign: 'right' }}>Compl. %</th>
                    <th style={{ ...th, textAlign: 'right' }}>Views</th><th style={{ ...th, textAlign: 'right' }}>Subs/1k</th>
                  </tr></thead>
                  <tbody>
                    {data.ranking.map((r, i) => (
                      <tr key={r.format_tag} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? 'var(--bg-surface)' : 'var(--bg-card)' }}>
                        <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 600 }}>{data.formats.find(f => f.id === r.format_tag)?.name ?? r.format_tag}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{r.posts}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{pct(r.avg_hook_pct)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{pct(r.avg_completion_pct)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{num(r.views)}</td>
                        <td style={{ ...td, textAlign: 'right', color: '#34d399', fontWeight: 700 }}>{r.subs_per_1k ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Corrections — per-post notes on what worked / what to fix */}
          <section>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Corrections &amp; notes</div>
            {corrections.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No notes logged yet. Add a note to any post (<span className="font-mono">node scripts/social/content-log.mjs</span>) and the learnings — what to lean into, what to fix — surface here.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {corrections.map(p => (
                  <div key={p.id} className="rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{p.title || p.id}</span>
                      {p.format_tag && <span style={{ fontSize: 10, color: 'var(--accent-light)' }}>{data.formats.find(f => f.id === p.format_tag)?.name ?? p.format_tag}</span>}
                      <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{num(p.views)} views · {p.subs_gained} subs</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.notes}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
