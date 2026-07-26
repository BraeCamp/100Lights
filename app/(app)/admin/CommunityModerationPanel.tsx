'use client'

// Moderation: the latest community shares with one-click removal.
// The DELETE endpoint allows admins to remove any item.

import { useEffect, useState } from 'react'
import { Trash2, ExternalLink, RefreshCw, RotateCcw, Check } from 'lucide-react'

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

interface ReportedComment {
  id: string
  item_id: string
  author_name: string
  body: string
  report_count: number
  reasons: string[] | null
}

interface RemovedItem {
  id: string
  kind: string
  name: string
  author_name: string
  votes: number
  downloads: number
  removed_at: string
  removed_by: string | null
  removed_reason: string | null
}

export default function CommunityModerationPanel() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [reported, setReported] = useState<ReportedItem[]>([])
  const [reportedComments, setReportedComments] = useState<ReportedComment[]>([])
  const [removed, setRemoved] = useState<RemovedItem[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    try {
      const [r, rep, rem] = await Promise.all([
        fetch('/api/community?sort=new'),
        fetch('/api/community/reports'),
        fetch('/api/admin/community'),
      ])
      const d = await r.json()
      setItems(d.items)
      const dr = await rep.json().catch(() => ({ items: [], comments: [] }))
      setReported(dr.items ?? [])
      setReportedComments(dr.comments ?? [])
      const drem = await rem.json().catch(() => ({ items: [] }))
      setRemoved(drem.items ?? [])
    } catch {
      setItems([])
    }
  }

  async function dismissReports(scope: 'item' | 'comment', id: string, label: string) {
    if (!confirm(`Dismiss the report(s) on ${label}? It stays public — the flag is just cleared.`)) return
    setBusy(id); setErr(null)
    const q = scope === 'item' ? `itemId=${id}` : `commentId=${id}`
    const r = await fetch(`/api/community/reports?${q}`, { method: 'DELETE' }).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(`Couldn't dismiss reports${r ? ` (${r.status})` : ' — network error'}.`); return }
    void load()
  }

  async function restore(item: RemovedItem) {
    setBusy(item.id); setErr(null)
    const r = await fetch('/api/admin/community', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, action: 'restore' }) }).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(`Couldn't restore "${item.name}"${r ? ` (${r.status})` : ''}.`); return }
    void load()
  }

  async function purge(item: RemovedItem) {
    if (!confirm(`Permanently delete "${item.name}"? This can't be undone and erases its votes and comments.`)) return
    setBusy(item.id); setErr(null)
    const r = await fetch('/api/admin/community', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, action: 'purge' }) }).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(`Couldn't purge "${item.name}"${r ? ` (${r.status})` : ''}.`); return }
    void load()
  }

  async function removeComment(c: ReportedComment) {
    if (!confirm(`Delete this comment by ${c.author_name}?\n\n“${c.body.slice(0, 200)}”`)) return
    setBusy(c.id); setErr(null)
    const r = await fetch(`/api/community/${c.item_id}/comments?commentId=${c.id}`, { method: 'DELETE' }).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(`Couldn't delete that comment${r ? ` (${r.status})` : ' — network error'}. It's still live.`); return }
    void load()
  }
  useEffect(() => {
    const t = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(t)
  }, [])

  async function remove(item: Item) {
    if (!confirm(`Remove "${item.name}" by ${item.authorName} from the community?`)) return
    setBusy(item.id); setErr(null)
    const r = await fetch(`/api/community/${item.id}`, { method: 'DELETE' }).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(`Couldn't remove "${item.name}"${r ? ` (${r.status})` : ' — network error'}. It's still public.`); return }
    void load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {err && (
        <div style={{ border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.1)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#f87171' }}>{err}</div>
      )}
      {reported.length > 0 && (
        <div style={{ border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '10px 12px', marginBottom: 6 }}>
          <p style={{ fontSize: 11, fontWeight: 800, color: '#ef4444', margin: '0 0 8px' }}>⚑ REPORTED ({reported.length})</p>
          {reported.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{r.name} <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>({r.kind}, by {r.author_name})</span></div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {r.report_count} report{r.report_count !== 1 ? 's' : ''}{r.reasons?.length ? ` — ${r.reasons.map(x => `“${x.slice(0, 80)}”`).join(' · ')}` : ''}
                </div>
              </div>
              <a href={`/community/${r.id}`} target="_blank" rel="noreferrer" title="View" style={{ color: 'var(--text-muted)', display: 'flex' }}><ExternalLink size={13} /></a>
              <button onClick={() => void dismissReports('item', r.id, `"${r.name}"`)} disabled={busy === r.id} title="Dismiss reports — keep it public"
                style={{ background: 'none', border: 'none', color: '#34d399', cursor: 'pointer', display: 'flex', opacity: busy === r.id ? 0.4 : 1 }}>
                <Check size={14} />
              </button>
              <button onClick={() => remove({ id: r.id, name: r.name, authorName: r.author_name } as Item)} disabled={busy === r.id} title="Remove from community"
                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', opacity: busy === r.id ? 0.4 : 1 }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {reportedComments.length > 0 && (
        <div style={{ border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '10px 12px', marginBottom: 6 }}>
          <p style={{ fontSize: 11, fontWeight: 800, color: '#ef4444', margin: '0 0 8px' }}>⚑ REPORTED COMMENTS ({reportedComments.length})</p>
          {reportedComments.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.4 }}>“{c.body.slice(0, 200)}”</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  by {c.author_name} · {c.report_count} report{c.report_count !== 1 ? 's' : ''}{c.reasons?.length ? ` — ${c.reasons.map(x => `“${x.slice(0, 80)}”`).join(' · ')}` : ''}
                </div>
              </div>
              <a href={`/community/${c.item_id}`} target="_blank" rel="noreferrer" title="View thread" style={{ color: 'var(--text-muted)', display: 'flex' }}><ExternalLink size={13} /></a>
              <button onClick={() => void dismissReports('comment', c.id, 'this comment')} disabled={busy === c.id} title="Dismiss reports — keep the comment"
                style={{ background: 'none', border: 'none', color: '#34d399', cursor: 'pointer', display: 'flex', opacity: busy === c.id ? 0.4 : 1 }}>
                <Check size={14} />
              </button>
              <button onClick={() => removeComment(c)} disabled={busy === c.id} title="Delete comment"
                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', opacity: busy === c.id ? 0.4 : 1 }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {removed.length > 0 && (
        <div style={{ border: '1px solid rgba(148,163,184,0.35)', borderRadius: 10, padding: '10px 12px', marginBottom: 6, background: 'rgba(148,163,184,0.05)' }}>
          <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)', margin: '0 0 8px' }}>🗑 REMOVED — restorable ({removed.length})</p>
          {removed.map(rm => (
            <div key={rm.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'line-through' }}>{rm.name} <span style={{ fontSize: 10, color: 'var(--text-muted)', textDecoration: 'none' }}>({rm.kind}, by {rm.author_name})</span></div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  removed {new Date(rm.removed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{rm.removed_reason ? ` — “${rm.removed_reason.slice(0, 100)}”` : ''} · {rm.votes} votes kept
                </div>
              </div>
              <button onClick={() => void restore(rm)} disabled={busy === rm.id} title="Restore — make public again"
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(52,211,153,0.4)', background: 'transparent', color: '#34d399', cursor: 'pointer', opacity: busy === rm.id ? 0.4 : 1 }}>
                <RotateCcw size={12} /> Restore
              </button>
              <button onClick={() => void purge(rm)} disabled={busy === rm.id} title="Delete permanently"
                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', opacity: busy === rm.id ? 0.4 : 1 }}>
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
