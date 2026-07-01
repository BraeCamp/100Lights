'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface Props {
  title: string
  description?: string
  defaultOpen?: boolean
  children: React.ReactNode
}

export default function CollapsibleSection({ title, description, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mt-10 first:mt-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left pb-3 flex items-start gap-2 group"
        style={{ borderBottom: '1px solid var(--border)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 12px 0' }}
      >
        <span style={{ color: 'var(--text-muted)', marginTop: 1, flexShrink: 0 }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span>
          <span className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{title}</span>
          {description && <span className="block text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{description}</span>}
        </span>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  )
}
