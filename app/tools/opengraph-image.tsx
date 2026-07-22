import { ImageResponse } from 'next/og'

// Share card for the free tools — the pages most likely to get posted around.
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = '100Lights — Free Music Tools'

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: 'linear-gradient(135deg, #0E0D12 0%, #14132a 55%, #1e1b3f 100%)', padding: '72px 76px', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, background: '#a78bfa' }} />
          <div style={{ fontSize: 26, fontWeight: 700, color: '#e9e4ff' }}>100Lights</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 82, fontWeight: 800, color: '#ffffff', letterSpacing: '-0.03em', lineHeight: 1.05 }}>Free music tools</div>
          <div style={{ fontSize: 30, color: '#b7b0d8' }}>Tuner · Metronome · Chord teacher · Scales · Ear training</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 24, color: '#a78bfa', fontWeight: 600 }}>No downloads · no sign-up</div>
          <div style={{ fontSize: 22, color: '#8b84a8' }}>100lights.com/tools</div>
        </div>
      </div>
    ),
    size,
  )
}
