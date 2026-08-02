'use client'

// Embeds a standalone /tools component inside an article. It loads the tool from
// the shared registry (lib/article-tools.ts) — the same module the /tools route
// renders — so any change to the tool shows up here automatically. Wraps it in
// article chrome (border + caption) without the full-page ToolShell.

import { useEffect, useState, type ComponentType } from 'react'
import { toolById } from '@/lib/article-tools'
import { useArticleState } from './article/article-state'

const ACCENT = '#a78bfa'

export default function ArticleTool({ toolId, caption }: { toolId: string; caption?: string }) {
  const def = toolById(toolId)
  const { tempo, active } = useArticleState()
  const [Comp, setComp] = useState<ComponentType<Record<string, unknown>> | null>(null)

  useEffect(() => {
    if (!def) return
    let ok = true
    def.load().then(m => { if (ok) setComp(() => m.default) }).catch(() => { /* keep the fallback */ })
    return () => { ok = false }
  }, [def])

  if (!def) return null
  // Let a page-level @setup seed tool props (the metronome starts at the page tempo).
  const props: Record<string, unknown> = def.id === 'metronome' && active ? { initialBpm: tempo } : {}
  return (
    <figure style={{ margin: '24px 0' }}>
      <div style={{
        border: `1px solid ${ACCENT}55`, borderRadius: 14, padding: '16px 18px',
        background: 'rgba(167,139,250,0.05)', overflowX: def.wide ? 'auto' : 'visible',
      }}>
        {/* Header: names the tool and links out to its own page. The embed and
            the standalone page load the same component (lib/article-tools.ts),
            so the linked tool is always in sync with what's shown here. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.02em' }}>
            {def.emoji} {def.label}
          </span>
          <a href={def.href} title={`Open the ${def.label} tool on its own page`}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 700, textDecoration: 'none', padding: '4px 11px', borderRadius: 999, border: `1px solid ${ACCENT}66`, background: 'rgba(167,139,250,0.12)', color: ACCENT }}>
            Open the full tool →
          </a>
        </div>
        {Comp
          ? <Comp {...props} />
          : <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '8px 2px' }}>{def.emoji} {def.label} — loading…</div>}
      </div>
      {caption && <figcaption style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>{caption}</figcaption>}
    </figure>
  )
}
