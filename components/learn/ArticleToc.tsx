'use client'

// A table of contents that floats to the left of the article on wide screens
// and highlights the section you're currently reading. Hidden below 1300px so
// it never crowds the centered column; the article is fully readable without it.

import { useEffect, useState } from 'react'
import type { Heading } from '@/lib/article-personas'

export default function ArticleToc({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState('')

  useEffect(() => {
    const els = headings.map(h => document.getElementById(h.id)).filter((e): e is HTMLElement => !!e)
    if (!els.length) return
    const io = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-80px 0px -70% 0px' },
    )
    els.forEach(e => io.observe(e))
    return () => io.disconnect()
  }, [headings])

  // Not worth a floating panel for one or two sections.
  if (headings.length < 3) return null

  return (
    <nav className="article-toc" aria-label="On this page">
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>On this page</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2, borderLeft: '1px solid var(--border)' }}>
        {headings.map(h => (
          <li key={h.id}>
            <a href={`#${h.id}`} style={{
              display: 'block', textDecoration: 'none', lineHeight: 1.4,
              padding: `3px 0 3px ${h.level === 3 ? 22 : 12}px`,
              marginLeft: -1, borderLeft: `2px solid ${active === h.id ? 'var(--accent)' : 'transparent'}`,
              fontSize: h.level === 3 ? 11.5 : 12.5,
              color: active === h.id ? 'var(--accent-light)' : 'var(--text-muted)',
              fontWeight: active === h.id ? 700 : 400,
            }}>{h.text}</a>
          </li>
        ))}
      </ul>
      <style>{`
        .article-toc { display: none; }
        @media (min-width: 1300px) {
          .article-toc {
            display: block; position: fixed; top: 120px; left: calc(50% - 610px);
            width: 200px; max-height: 70vh; overflow-y: auto;
          }
        }
      `}</style>
    </nav>
  )
}
