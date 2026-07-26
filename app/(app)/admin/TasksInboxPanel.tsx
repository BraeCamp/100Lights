'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, ExternalLink } from 'lucide-react'

interface Task { id: number; userId: string; email: string; body: string; dueAt: string | null; doneAt: string | null }

function openUser(userId: string, email: string) {
  const u = { userId, email }
  ;(window as unknown as { __adminPendingUser?: unknown }).__adminPendingUser = u
  window.location.hash = '#general/users'
  window.dispatchEvent(new CustomEvent('admin:open-user', { detail: u }))
}
function bucket(t: Task): 'overdue' | 'today' | 'upcoming' | 'undated' {
  if (!t.dueAt) return 'undated'
  const d = new Date(t.dueAt).getTime(), now = Date.now()
  if (d < now) return 'overdue'
  if (d < now + 24 * 3600_000) return 'today'
  return 'upcoming'
}
const dueLabel = (iso: string | null) => {
  if (!iso) return 'no date'
  const h = Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000)
  if (h < 0) { const a = Math.abs(h); return a < 24 ? `${a}h overdue` : `${Math.floor(a / 24)}d overdue` }
  return h < 24 ? `due in ${h}h` : `due in ${Math.floor(h / 24)}d`
}
const GROUPS: { key: ReturnType<typeof bucket>; label: string; color: string }[] = [
  { key: 'overdue', label: 'Overdue', color: '#f87171' },
  { key: 'today', label: 'Due today', color: '#fbbf24' },
  { key: 'upcoming', label: 'Upcoming', color: '#a78bfa' },
  { key: 'undated', label: 'No due date', color: 'var(--text-muted)' },
]

// Every open follow-up across all accounts — the CRM work queue.
export default function TasksInboxPanel() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/tasks', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setTasks(d.tasks)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])

  async function complete(t: Task) {
    setTasks(ts => ts.filter(x => x.id !== t.id))
    try { await fetch('/api/admin/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id, userId: t.userId, done: true }) }) } catch { /* optimistic */ }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => void load()} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={12} /> {busy ? 'Loading…' : 'Refresh'}
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{tasks.length} open</span>
        {err && <span style={{ fontSize: 12, color: '#f87171' }}>{err}</span>}
      </div>

      {tasks.length === 0 && !busy ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Inbox zero — no open follow-ups. Add them from a user&rsquo;s record (Notes &amp; tasks).</p>
      ) : GROUPS.map(g => {
        const items = tasks.filter(t => bucket(t) === g.key)
        if (!items.length) return null
        return (
          <div key={g.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color }} />
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{g.label}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9, border: `1px solid ${g.key === 'overdue' ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`, background: g.key === 'overdue' ? 'rgba(239,68,68,0.06)' : 'var(--bg-surface)' }}>
                  <button onClick={() => void complete(t)} title="Mark done" aria-label="Mark done"
                    style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 5, cursor: 'pointer', border: '1.5px solid var(--border-light)', background: 'transparent', color: 'var(--text-muted)' }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text-primary)' }}>{t.body}</span>
                  <button onClick={() => openUser(t.userId, t.email)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, fontSize: 11, color: 'var(--accent-light)', background: 'none', border: 'none', cursor: 'pointer', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.email || t.userId} <ExternalLink size={11} />
                  </button>
                  <span style={{ fontSize: 11, fontWeight: 700, color: g.color === 'var(--text-muted)' ? 'var(--text-muted)' : g.color, flexShrink: 0, whiteSpace: 'nowrap', minWidth: 78, textAlign: 'right' }}>{dueLabel(t.dueAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
