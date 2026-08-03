'use client'

import type { CommunityItem } from '@/lib/community'
import { AudioPreview } from '../../community/FeedCard'
import { LogoMark } from '@/components/Logo'

const SITE = 'https://100lights.com'
const KIND_LABEL: Record<string, string> = {
  song: 'Song', sample: 'Sample', preset: 'Preset', recipe: 'Chord recipe', pack: 'Sample pack', project: 'Project starter', theme: 'Theme', kit: 'Drum kit', pattern: 'Beat pattern', post: 'Post', clip: 'Clip',
}

// A compact card sized for an iframe. Audio kinds get the real waveform player
// (reused from the feed); everything else gets a "listen on 100Lights" card.
export function EmbedClient({ item }: { item: CommunityItem }) {
  const isAudio = item.kind === 'song' || item.kind === 'sample'
  const href = `${SITE}/community/${item.id}`
  return (
    <div style={{
      width: '100%', maxWidth: 480, boxSizing: 'border-box',
      background: 'var(--bg-surface, #17171b)', border: '1px solid var(--border, #2a2a30)',
      borderRadius: 12, padding: '14px 16px', color: 'var(--text-primary, #f1f0ff)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted, #a3a2b5)' }}>{KIND_LABEL[item.kind] ?? 'Share'} · {item.authorName}</div>
        </div>
        <a href={SITE} target="_blank" rel="noreferrer" title="100Lights" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
          <LogoMark size={20} />
        </a>
      </div>

      {isAudio ? (
        <AudioPreview item={item} color="#a78bfa" />
      ) : (
        <a href={href} target="_blank" rel="noreferrer" style={{
          display: 'block', textAlign: 'center', textDecoration: 'none',
          background: 'rgba(124,58,237,0.14)', border: '1px solid rgba(167,139,250,0.4)',
          borderRadius: 9, padding: '11px 0', fontSize: 13, fontWeight: 700, color: '#a78bfa',
        }}>Open on 100Lights ↗</a>
      )}

      <a href={href} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 10, fontSize: 11, color: 'var(--text-muted, #a3a2b5)', textDecoration: 'none', textAlign: 'center' }}>
        Listen &amp; remix free on 100Lights →
      </a>
    </div>
  )
}
