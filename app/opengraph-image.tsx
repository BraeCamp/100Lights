import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = '100Lights — AI Content Repurposing'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #0d0d14 0%, #0f0f1a 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Logo mark */}
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: 20,
            background: '#8b5cf6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 32,
          }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="white">
            <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
          </svg>
        </div>

        {/* Brand name */}
        <div style={{ fontSize: 56, fontWeight: 700, color: '#f4f4f5', marginBottom: 16, letterSpacing: '-1px' }}>
          100Lights
        </div>

        {/* Tagline */}
        <div style={{ fontSize: 28, color: '#a1a1aa', textAlign: 'center', maxWidth: 720 }}>
          Turn hours of video into minutes of content
        </div>

        {/* Pills */}
        <div style={{ display: 'flex', gap: 16, marginTop: 48 }}>
          {['Podcast Editor', 'AI Writing', 'Image Editor', 'RSS Export'].map((label) => (
            <div
              key={label}
              style={{
                padding: '10px 20px',
                borderRadius: 100,
                border: '1px solid rgba(139,92,246,0.4)',
                background: 'rgba(139,92,246,0.1)',
                color: '#c4b5fd',
                fontSize: 18,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  )
}
