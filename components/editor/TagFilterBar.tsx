'use client'
// The filter over patterns and recipes: a search box and the tags that are
// actually present, as chips. Click a chip to narrow; click it again to let
// go; every active chip must match. Counts say how many rows each would leave.

import { X } from 'lucide-react'

export default function TagFilterBar({
  tags, active, onToggle, onClear, query, onQuery, placeholder, max = 18,
}: {
  tags: { tag: string; count: number }[]
  active: Set<string>
  onToggle: (tag: string) => void
  onClear: () => void
  query: string
  onQuery: (q: string) => void
  placeholder?: string
  max?: number
}) {
  // The active ones always show, then the most common until the row is full.
  const shown = [
    ...tags.filter(t => active.has(t.tag)),
    ...tags.filter(t => !active.has(t.tag)).slice(0, Math.max(0, max - active.size)),
  ]
  return (
    <div data-tag-filter style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '0 2px 2px', flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={query}
          onChange={e => onQuery(e.target.value)}
          placeholder={placeholder ?? 'Search…'}
          data-tag-filter-query
          style={{ flex: 1, minWidth: 0, fontSize: 10.5, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
        />
        {(active.size > 0 || query) && (
          <button
            onClick={onClear}
            title="Clear the filter"
            data-tag-filter-clear
            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9.5, fontWeight: 700, padding: '4px 8px', borderRadius: 99, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
          ><X size={9} /> Clear</button>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {shown.map(({ tag, count }) => {
          const on = active.has(tag)
          return (
            <button
              key={tag}
              data-tag-filter-chip={tag}
              data-tag-filter-on={on || undefined}
              onClick={() => onToggle(tag)}
              title={on ? `Stop filtering by ${tag}` : `Only ${tag} (${count})`}
              style={{
                fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, cursor: 'pointer',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                background: on ? 'rgb(var(--accent-rgb) / 0.18)' : 'rgba(255,255,255,0.03)',
                color: on ? 'var(--accent-light)' : 'var(--text-muted)',
                display: 'inline-flex', alignItems: 'baseline', gap: 4,
              }}
            >
              {tag}<span style={{ fontSize: 8, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
