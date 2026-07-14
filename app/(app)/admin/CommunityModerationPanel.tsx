'use client'

// Moderation: the latest community shares with one-click removal.
// The DELETE endpoint allows admins to remove any item.

import { useEffect, useState } from 'react'
import { Trash2, ExternalLink, RefreshCw } from 'lucide-react'

interface Item {
  id: string
  kind: string
  name: string
  description: string
  authorName: string
  votes: number
  downloads: number
  createdAt: string
}

interface ReportedItem {
  id: string
  kind: string
  name: string
  author_name: string
  report_count: number
  reasons: string[] | null
}

export default function CommunityModerationPanel() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [reported, setReported] = useState<ReportedItem[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    try {
      const [r, rep] = await Promise.all([
        fetch('/api/community?sort=new'),
        fetch('/api/community/reports'),
      ])
      const d = await r.json()
      setItems(d.items)
      const dr = await rep.json().catch(() => ({ items: [] }))
      setReported(dr.items ?? [])
    } catch {
      setItems([])
    }
  }
  useEffect(() => {
    const t = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(t)
  }, [])

  async function remove(item: Item) {
    if (!confirm(`Remove "${item.name}" by ${item.authorName} from the community?`)) return
    setBusy(item.id)
    await fetch(`/api/community/${item.id}`, { method: 'DELETE' }).catch(() => {})
    setBusy(null)
    void load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {reported.length > 0 && (
        <div style={{ border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '10px 12px', marginBottom: 6 }}>
          <p style={{ fontSize: 11, fontWeight: 800, color: '#ef4444', margin: '0 0 8px' }}>⚑ REPORTED ({reported.length})</p>
          {reported.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{r.name} <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>({r.kind}, by {r.author_name})</span></div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {r.report_count} report{r.report_count !== 1 ? 's' : ''}{r.reasons?.length ? ` — “${r.reasons[0].slice(0, 120)}”` : ''}
                </div>
              </div>
              <a href={`/community/${r.id}`} target="_blank" rel="noreferrer" title="View" style={{ color: 'var(--text-muted)', display: 'flex' }}><ExternalLink size={13} /></a>
              <button onClick={() => remove({ id: r.id, name: r.name, authorName: r.author_name } as Item)} title="Remove from community"
                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex' }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{items?.length ?? '…'} most recent shares</span>
        <button onClick={() => void load()} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
      {items?.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', width: 52, flexShrink: 0 }}>{item.kind}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>by {item.authorName} · {item.votes} votes · {item.downloads} imports</div>
          </div>
          <a href={`/community/${item.id}`} target="_blank" rel="noreferrer" title="View public page" style={{ color: 'var(--text-muted)', display: 'flex' }}><ExternalLink size={13} /></a>
          <button onClick={() => remove(item)} disabled={busy === item.id} title="Remove from community" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', opacity: busy === item.id ? 0.4 : 0.8 }}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      {items?.length === 0 && <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No community items.</p>}
    </div>
  )
}
