'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Globe2 } from 'lucide-react'
import { apiGet } from '@/lib/api-client'

/**
 * A glimpse of what other people are making, on the logged-in home page.
 *
 * The dashboard never showed the community at all — you had to navigate to
 * /community to find out the product had other users. BandLab's whole retention
 * model is that the feed IS the home screen; this is a much smaller version of
 * that idea, using the feed data that already exists.
 *
 * Deliberately quiet: it renders nothing at all if the fetch fails or the feed
 * is empty, so a new install with no community activity doesn't show a sad
 * placeholder on the dashboard.
 */

interface FeedItem {
  id: string
  name: string
  kind: string
  authorName: string
}

const KIND_LABEL: Record<string, string> = {
  sound: 'Sound',
  pack: 'Pack',
  preset: 'Preset',
  recipe: 'Chord recipe',
  song: 'Song',
  clip: 'Clip',
}

export default function CommunityStrip() {
  const [items, setItems] = useState<FeedItem[] | null>(null)

  useEffect(() => {
    let alive = true
    apiGet<{ items: FeedItem[] }>('/api/community?sort=new')
      .then(d => { if (alive) setItems((d.items ?? []).slice(0, 4)) })
      .catch(() => { if (alive) setItems([]) })   // stay silent rather than show an error here
    return () => { alive = false }
  }, [])

  if (!items || items.length === 0) return null

  return (
    <section style={{ marginTop: 52 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          From the community
        </h2>
        <Link href="/community" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--accent-light)', textDecoration: 'none' }}>
          Browse all <ArrowRight size={11} />
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
        {items.map(it => (
          <Link
            key={it.id}
            href={`/community/${it.id}`}
            style={{
              display: 'block', padding: '13px 15px', borderRadius: 12,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              textDecoration: 'none', minWidth: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
              <Globe2 size={10} color="var(--text-muted)" />
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                {KIND_LABEL[it.kind] ?? it.kind}
              </span>
            </div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.name}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              by {it.authorName}
            </p>
          </Link>
        ))}
      </div>
    </section>
  )
}
