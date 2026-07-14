'use client'

// Beta feedback inbox — everything testers send through the sidebar modal.

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface Entry {
  id: string
  email: string | null
  message: string
  page: string | null
  user_agent: string | null
  created_at: string
}

export default function FeedbackPanel() {
  const [items, setItems] = useState<Entry[] | null>(null)

  async function load() {
    try {
      const r = await fetch('/api/feedback')
      const d = await r.json()
      setItems(d.items ?? [])
    } catch { setItems([]) }
  }
  useEffect(() => {
    const t = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(t)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{items?.length ?? '…'} entries</span>
        <button onClick={() => void load()} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
      {items?.map(e => (
        <div key={e.id} style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 10, fontSize: 10, color: 'var(--text-muted)', marginBottom: 5, flexWrap: 'wrap' }}>
            <span>{new Date(e.created_at).toLocaleString()}</span>
            {e.email && <span>· {e.email}</span>}
            {e.page && <span>· on {e.page}</span>}
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-primary)', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{e.message}</p>
        </div>
      ))}
      {items?.length === 0 && <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No feedback yet.</p>}
    </div>
  )
}
