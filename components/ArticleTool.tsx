'use client'

// Embeds a standalone /tools component inside an article. It loads the tool from
// the shared registry (lib/article-tools.ts) — the same module the /tools route
// renders — so any change to the tool shows up here automatically. Wraps it in
// article chrome (border + caption) without the full-page ToolShell.

import { useEffect, useState, type ComponentType } from 'react'
import { toolById } from '@/lib/article-tools'

const ACCENT = '#a78bfa'

export default function ArticleTool({ toolId, caption }: { toolId: string; caption?: string }) {
  const def = toolById(toolId)
  const [Comp, setComp] = useState<ComponentType<Record<string, unknown>> | null>(null)

  useEffect(() => {
    if (!def) return
    let ok = true
    def.load().then(m => { if (ok) setComp(() => m.default) }).catch(() => { /* keep the fallback */ })
    return () => { ok = false }
  }, [def])

  if (!def) return null
  return (
    <figure style={{ margin: '24px 0' }}>
      <div style={{
        border: `1px solid ${ACCENT}55`, borderRadius: 14, padding: '16px 18px',
        background: 'rgba(167,139,250,0.05)', overflowX: def.wide ? 'auto' : 'visible',
      }}>
        {Comp
          ? <Comp />
          : <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '8px 2px' }}>{def.emoji} {def.label} — loading…</div>}
      </div>
      {caption && <figcaption style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>{caption}</figcaption>}
    </figure>
  )
}
