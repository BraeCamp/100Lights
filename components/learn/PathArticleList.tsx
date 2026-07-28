'use client'

import Link from 'next/link'
import { useReadArticles } from './usePathProgress'

export interface PathStep {
  slug: string
  title: string
  description: string
  minutes: number | null
  published: boolean
}

export default function PathArticleList({ steps, accent }: { steps: PathStep[]; accent: string }) {
  const { read, ready } = useReadArticles()
  const live = steps.filter(s => s.published)
  const doneCount = live.filter(s => read.has(s.slug)).length
  const total = live.length
  // Resume = first published step not yet read; falls back to the first.
  const resume = live.find(s => !read.has(s.slug)) ?? live[0]
  const allDone = ready && total > 0 && doneCount === total

  return (
    <div>
      {/* Progress + resume */}
      {total > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
              {ready ? (allDone ? '✓ Path complete — nice work' : `${doneCount} of ${total} read`) : `${total} guides`}
            </span>
            {resume && (
              <Link href={`/learn/${resume.slug}`} style={{
                fontSize: 13, fontWeight: 700, textDecoration: 'none', padding: '8px 16px', borderRadius: 9,
                background: accent, color: '#fff', whiteSpace: 'nowrap',
              }}>
                {!ready || doneCount === 0 ? 'Start path →' : allDone ? 'Revisit →' : 'Resume →'}
              </Link>
            )}
          </div>
          <div style={{ height: 6, borderRadius: 99, background: 'var(--bg-card)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${total ? (doneCount / total) * 100 : 0}%`, background: accent, transition: 'width .3s' }} />
          </div>
        </div>
      )}

      {/* Ordered steps */}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {steps.map((s, i) => {
          const isRead = ready && read.has(s.slug)
          const body = (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px', borderRadius: 12,
              border: '1px solid var(--border)', background: 'var(--bg-card)', opacity: s.published ? 1 : 0.6,
            }}>
              <div aria-hidden style={{
                width: 26, height: 26, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12.5, fontWeight: 800, marginTop: 1,
                background: isRead ? accent : 'var(--bg-surface)', color: isRead ? '#fff' : 'var(--text-muted)',
                border: isRead ? 'none' : '1px solid var(--border)',
              }}>{isRead ? '✓' : i + 1}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.35 }}>{s.title}</div>
                {s.description && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>{s.description}</div>}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>
                  {s.published ? `${s.minutes ?? 5} min read` : 'Coming soon'}
                </div>
              </div>
            </div>
          )
          return (
            <li key={s.slug}>
              {s.published
                ? <Link href={`/learn/${s.slug}`} style={{ textDecoration: 'none', display: 'block' }}>{body}</Link>
                : body}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
