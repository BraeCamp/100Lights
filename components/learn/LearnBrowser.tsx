'use client'

/**
 * The Learn landing experience: a featured piece, topic filtering, and a card
 * grid. A client component so topics filter instantly — but it receives the
 * full article list as props and renders every card up front, so the content
 * is in the server HTML for crawlers and the filtering is pure enhancement.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Clock, ArrowRight, Search } from 'lucide-react'

export interface CardArticle {
  slug: string
  title: string
  description: string
  tags: string[]
  minutes: number
  date: string
}

/** Order topics by how many articles carry them, so the useful ones lead. */
function topicsByFrequency(articles: CardArticle[]): string[] {
  const count = new Map<string, number>()
  for (const a of articles) for (const t of a.tags) count.set(t, (count.get(t) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
}

export default function LearnBrowser({ articles }: { articles: CardArticle[] }) {
  const [topic, setTopic] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const topics = useMemo(() => topicsByFrequency(articles), [articles])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return articles.filter(a => {
      if (topic && !a.tags.includes(topic)) return false
      if (q && !(`${a.title} ${a.description} ${a.tags.join(' ')}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [articles, topic, query])

  // The newest piece leads as a featured card — but only in the unfiltered,
  // unsearched default view, where "the latest" is a meaningful thing to show.
  const showFeatured = !topic && !query && filtered.length > 0
  const featured = showFeatured ? filtered[0] : null
  const rest = showFeatured ? filtered.slice(1) : filtered

  return (
    <>
      {/* Topic nav + search */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
        <div style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search guides…"
            style={{
              width: '100%', fontSize: 14, padding: '10px 12px 10px 34px', borderRadius: 10,
              background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none',
            }}
          />
        </div>
        {topics.length > 0 && (
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <TopicPill label="All" active={topic === null} onClick={() => setTopic(null)} />
            {topics.map(t => (
              <TopicPill key={t} label={t} active={topic === t} onClick={() => setTopic(topic === t ? null : t)} />
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 && (
        <p style={{ fontSize: 14, color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0' }}>
          Nothing matches that yet. Try another topic.
        </p>
      )}

      {/* Featured */}
      {featured && (
        <Link href={`/learn/${featured.slug}`} className="feat-card" style={{
          display: 'block', textDecoration: 'none', marginBottom: 22, padding: '28px 28px', borderRadius: 20,
          background: 'linear-gradient(135deg, rgba(124,58,237,0.14), rgba(59,130,246,0.08))',
          border: '1px solid rgba(139,92,246,0.3)', position: 'relative', overflow: 'hidden',
        }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent-light)' }}>Latest</span>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', margin: '8px 0 8px', letterSpacing: '-0.02em', lineHeight: 1.15 }}>{featured.title}</h2>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px', maxWidth: 640 }}>{featured.description}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <TagRow tags={featured.tags} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}><Clock size={12} /> {featured.minutes} min</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 700, color: 'var(--accent-light)', marginLeft: 'auto' }}>Read it <ArrowRight size={14} /></span>
          </div>
        </Link>
      )}

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {rest.map(a => (
          <Link key={a.slug} href={`/learn/${a.slug}`} className="learn-card" style={{
            display: 'flex', flexDirection: 'column', textDecoration: 'none', padding: '18px 18px', borderRadius: 15,
            border: '1px solid var(--border)', background: 'var(--bg-card)',
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 750, color: 'var(--text-primary)', margin: '0 0 7px', letterSpacing: '-0.01em', lineHeight: 1.25 }}>{a.title}</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 14px', flex: 1 }}>{a.description}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <TagRow tags={a.tags.slice(0, 2)} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--text-muted)', marginLeft: 'auto' }}><Clock size={11} /> {a.minutes} min</span>
            </div>
          </Link>
        ))}
      </div>

      <style>{`
        .feat-card, .learn-card { transition: transform 0.15s ease, border-color 0.15s ease; }
        .feat-card:hover { transform: translateY(-2px); }
        .learn-card:hover { transform: translateY(-3px); border-color: var(--border-light); }
      `}</style>
    </>
  )
}

function TopicPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 12.5, fontWeight: 700, padding: '6px 13px', borderRadius: 99, cursor: 'pointer', textTransform: 'capitalize',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      background: active ? 'rgba(124,58,237,0.15)' : 'transparent',
      color: active ? 'var(--accent-light)' : 'var(--text-muted)',
    }}>{label}</button>
  )
}

function TagRow({ tags }: { tags: string[] }) {
  return (
    <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap' }}>
      {tags.map(t => (
        <span key={t} style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
          color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 99, padding: '2px 8px',
        }}>{t}</span>
      ))}
    </span>
  )
}
