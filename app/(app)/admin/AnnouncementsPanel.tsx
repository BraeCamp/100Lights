'use client'

import { useEffect, useState } from 'react'
import { Megaphone, Trash2, Plus } from 'lucide-react'

interface Ann {
  id: number
  message: string
  level: 'info' | 'success' | 'warn'
  href: string | null
  href_label: string | null
  audience: 'all' | 'free' | 'pro'
  dismissible: boolean
  active: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
}

const LEVEL_COLOR: Record<string, string> = { info: '#a78bfa', success: '#34d399', warn: '#fbbf24' }
const blank = { message: '', level: 'info' as const, href: '', href_label: '', audience: 'all' as const, dismissible: true }

export default function AnnouncementsPanel() {
  const [items, setItems] = useState<Ann[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState({ ...blank })
  const [posting, setPosting] = useState(false)

  async function load() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/announcements', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setItems(d.announcements)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])

  async function publish() {
    if (!draft.message.trim()) return
    setPosting(true)
    try {
      const r = await fetch('/api/admin/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed')
      setDraft({ ...blank })
      await load()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setPosting(false) }
  }

  async function patch(id: number, body: Partial<Ann>) {
    await fetch(`/api/admin/announcements/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {})
    await load()
  }
  async function remove(id: number) {
    if (!window.confirm('Delete this announcement?')) return
    await fetch(`/api/admin/announcements/${id}`, { method: 'DELETE' }).catch(() => {})
    await load()
  }

  const inputStyle = { fontSize: 13, padding: '7px 10px', borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' } as const

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Composer */}
      <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
          <Megaphone size={15} /> New broadcast
        </div>
        <textarea value={draft.message} onChange={e => setDraft({ ...draft, message: e.target.value })}
          placeholder="What do you want everyone to see? (e.g. New: track groups are live — try them in the studio.)"
          rows={2} maxLength={400} style={{ ...inputStyle, resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Style</label>
          <select value={draft.level} onChange={e => setDraft({ ...draft, level: e.target.value as typeof draft.level })} style={inputStyle}>
            <option value="info">Info (purple)</option>
            <option value="success">Success (green)</option>
            <option value="warn">Warning (amber)</option>
          </select>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Audience</label>
          <select value={draft.audience} onChange={e => setDraft({ ...draft, audience: e.target.value as typeof draft.audience })} style={inputStyle}>
            <option value="all">Everyone</option>
            <option value="free">Free users</option>
            <option value="pro">Pro users</option>
          </select>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <input type="checkbox" checked={draft.dismissible} onChange={e => setDraft({ ...draft, dismissible: e.target.checked })} /> Dismissible
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={draft.href} onChange={e => setDraft({ ...draft, href: e.target.value })} placeholder="Optional link URL (/studio or https://…)" style={{ ...inputStyle, flex: 2, minWidth: 200 }} />
          <input value={draft.href_label} onChange={e => setDraft({ ...draft, href_label: e.target.value })} placeholder="Link label" maxLength={40} style={{ ...inputStyle, flex: 1, minWidth: 120 }} />
        </div>
        <div>
          <button onClick={() => void publish()} disabled={posting || !draft.message.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', opacity: posting || !draft.message.trim() ? 0.55 : 1 }}>
            <Plus size={14} /> {posting ? 'Publishing…' : 'Publish'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 10 }}>Live immediately for the chosen audience. Published as active.</span>
        </div>
      </div>

      {err && <p style={{ fontSize: 12, color: '#f87171' }}>{err}</p>}
      {busy && items.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</p>}

      {/* List */}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-surface)', opacity: a.active ? 1 : 0.55 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: LEVEL_COLOR[a.level] ?? '#a78bfa' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>{a.message}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span>{a.audience === 'all' ? 'Everyone' : a.audience + ' users'}</span>
                  <span>{a.level}</span>
                  {a.href && <span style={{ color: 'var(--accent)' }}>↗ {a.href_label || a.href}</span>}
                  {!a.dismissible && <span>non-dismissible</span>}
                  <span>{new Date(a.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <button onClick={() => void patch(a.id, { active: !a.active })}
                style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer', border: '1px solid ' + (a.active ? 'rgba(52,211,153,0.5)' : 'var(--border)'), background: a.active ? 'rgba(52,211,153,0.15)' : 'transparent', color: a.active ? '#34d399' : 'var(--text-muted)' }}>
                {a.active ? 'Live' : 'Off'}
              </button>
              <button onClick={() => void remove(a.id)} aria-label="Delete" style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Live announcements show as a dismissible banner across the app (desktop and mobile). Toggle &ldquo;Live&rdquo; to pause without deleting.</p>
    </div>
  )
}
