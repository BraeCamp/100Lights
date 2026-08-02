import { ImageResponse } from 'next/og'
import { playBySlug } from '@/lib/play-experiences'

// Per-experience share card so a pasted /play link previews as itself.
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = '100Lights — play'

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const e = playBySlug(slug)
  const title = e?.title ?? 'Play — 100Lights'
  const tagline = e?.tagline ?? ''
  const emoji = e?.emoji ?? '🎛️'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          background: 'radial-gradient(120% 90% at 50% 0%, #241a3f 0%, #120e20 55%, #0a0812 100%)',
          padding: '68px 76px', fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, background: '#a78bfa' }} />
          <div style={{ fontSize: 26, fontWeight: 700, color: '#e9e4ff', letterSpacing: '-0.01em' }}>100Lights</div>
          <div style={{ fontSize: 20, color: '#8b84a8', marginLeft: 6 }}>· free, in your browser</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 84, lineHeight: 1 }}>{emoji}</div>
          <div style={{ display: 'flex', fontSize: title.length > 40 ? 62 : 74, fontWeight: 800, color: '#ffffff', lineHeight: 1.08, letterSpacing: '-0.03em', maxWidth: 1010 }}>
            {title}
          </div>
          <div style={{ display: 'flex', fontSize: 28, color: '#b8b3c6', lineHeight: 1.35, maxWidth: 940 }}>{tagline}</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ fontSize: 24, color: '#a78bfa', fontWeight: 700 }}>tap to play →</div>
        </div>
      </div>
    ),
    size,
  )
}
