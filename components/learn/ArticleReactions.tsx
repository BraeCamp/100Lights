'use client'

// "Was this helpful?" — a yes/no the reader can answer once (guarded by
// localStorage), with live counts for light social proof. Counts load after
// paint so they never block or de-static the page.

import { useEffect, useState } from 'react'

type Counts = { yes: number; no: number }

export default function ArticleReactions({ slug }: { slug: string }) {
  const [counts, setCounts] = useState<Counts | null>(null)
  const [voted, setVoted] = useState<'yes' | 'no' | null>(null)

  useEffect(() => {
    const prior = localStorage.getItem(`react:${slug}`)
    if (prior === 'yes' || prior === 'no') setVoted(prior)
    fetch(`/api/learn/react?slug=${encodeURIComponent(slug)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && typeof d.yes === 'number') setCounts({ yes: d.yes, no: d.no }) })
      .catch(() => {})
  }, [slug])

  const vote = (v: 'yes' | 'no') => {
    if (voted) return
    setVoted(v)
    localStorage.setItem(`react:${slug}`, v)
    setCounts(c => (c ? { ...c, [v]: c[v] + 1 } : c))
    fetch('/api/learn/react', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, helpful: v === 'yes' }),
    }).catch(() => {})
  }

  const btn = (v: 'yes' | 'no'): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600,
    padding: '7px 14px', borderRadius: 9, cursor: voted ? 'default' : 'pointer',
    border: `1px solid ${voted === v ? 'var(--accent)' : 'var(--border)'}`,
    background: voted === v ? 'rgba(124,58,237,0.14)' : 'var(--bg-card)',
    color: voted === v ? 'var(--accent-light)' : 'var(--text-secondary)',
    opacity: voted && voted !== v ? 0.5 : 1,
  })

  return (
    <div style={{ marginTop: 40, paddingTop: 22, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
        {voted ? 'Thanks for the feedback.' : 'Was this helpful?'}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => vote('yes')} style={btn('yes')} disabled={!!voted}>👍 Yes{counts ? ` · ${counts.yes}` : ''}</button>
        <button onClick={() => vote('no')} style={btn('no')} disabled={!!voted}>👎 No{counts ? ` · ${counts.no}` : ''}</button>
      </div>
    </div>
  )
}
