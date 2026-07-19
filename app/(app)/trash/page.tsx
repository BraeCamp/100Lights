'use client'

import { useState, useEffect } from 'react'
import { Trash2, RotateCcw, X, Clock } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'

interface TrashedProject {
  id: string
  name: string
  deletedAt: string
  expiresAt: string
  mediaCount: number
}

function daysUntil(iso: string) {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

export default function TrashPage() {
  const [projects, setProjects] = useState<TrashedProject[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    fetch('/api/projects/trash')
      .then(r => r.ok ? r.json() : [])
      .then((d: TrashedProject[]) => setProjects(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function restore(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/projects/${id}/restore`, { method: 'POST' })
      if (res.ok) setProjects(p => p.filter(x => x.id !== id))
    } finally {
      setBusy(null)
    }
  }

  function deletePermanently(id: string) {
    const p = projects.find(x => x.id === id)
    setConfirmDel({ id, name: p?.name ?? 'this project' })
  }

  async function performPermanentDelete() {
    if (!confirmDel) return
    const id = confirmDel.id
    setConfirmDel(null)
    setBusy(id)
    try {
      const res = await fetch(`/api/projects/${id}?permanent=true`, { method: 'DELETE' })
      if (res.ok) setProjects(p => p.filter(x => x.id !== id))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-8 max-w-2xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Trash</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Projects are permanently deleted after 1 month.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <Trash2 size={28} color="var(--text-muted)" className="mb-3" />
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Trash is empty</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Deleted projects will appear here for 1 month</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map(p => {
              const days = daysUntil(p.expiresAt)
              const isBusy = busy === p.id
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-4 px-4 py-3.5 rounded-xl border"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Clock size={11} color="var(--text-muted)" />
                      <span className="text-xs" style={{ color: days <= 2 ? 'var(--error)' : 'var(--text-muted)' }}>
                        {days === 0 ? 'Deletes today' : `${days} day${days !== 1 ? 's' : ''} left`}
                      </span>
                      {p.mediaCount > 0 && (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          · {p.mediaCount} file{p.mediaCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => restore(p.id)}
                      disabled={isBusy}
                      title="Restore"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)', opacity: isBusy ? 0.5 : 1 }}
                    >
                      <RotateCcw size={12} />
                      Restore
                    </button>
                    <button
                      onClick={() => deletePermanently(p.id)}
                      disabled={isBusy}
                      title="Delete permanently"
                      className="flex items-center justify-center w-8 h-8 rounded-lg"
                      style={{ color: 'var(--error)', opacity: isBusy ? 0.5 : 1 }}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete permanently?"
        message={confirmDel ? `“${confirmDel.name}” and all its media files will be permanently deleted. This cannot be undone.` : ''}
        confirmLabel="Delete forever"
        onConfirm={performPermanentDelete}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  )
}
