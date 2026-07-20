import { ImageResponse } from 'next/og'
import { getArticle } from '@/lib/learn-articles'

// Per-article share card. Without this every guide shared as the same
// site-wide image, which wastes the `summary_large_image` card the metadata
// already asks for.
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = '100Lights guide'

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const a = await getArticle(slug)
  const title = a?.title ?? 'Learn — 100Lights'
  const tags = a?.tags?.slice(0, 3).join(' · ') ?? ''

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #0E0D12 0%, #1a1430 55%, #2a1b4d 100%)',
          padding: '72px 76px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, background: '#a78bfa' }} />
          <div style={{ fontSize: 26, fontWeight: 700, color: '#e9e4ff', letterSpacing: '-0.01em' }}>
            100Lights
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: title.length > 52 ? 62 : 76,
            fontWeight: 800,
            color: '#ffffff',
            lineHeight: 1.12,
            letterSpacing: '-0.03em',
            maxWidth: 1000,
          }}
        >
          {title}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 24, color: '#a78bfa', fontWeight: 600 }}>{tags}</div>
          <div style={{ fontSize: 22, color: '#8b84a8' }}>100lights.com/learn</div>
        </div>
      </div>
    ),
    size,
  )
}
