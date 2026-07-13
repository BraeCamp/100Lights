import { ImageResponse } from 'next/og'
import { sql } from '@/lib/db'

// Waveform share card — what a pasted community link unfurls into.

export const runtime = 'nodejs'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const KIND_COLOR: Record<string, string> = {
  song: '#22d3ee', sample: '#3b82f6', preset: '#a78bfa', recipe: '#f59e0b', pack: '#34d399', project: '#fb7185',
}
const KIND_LABEL: Record<string, string> = {
  song: 'SONG', sample: 'SAMPLE', preset: 'PRESET', recipe: 'RECIPE', pack: 'SAMPLE PACK', project: 'PROJECT STARTER',
}

export default async function OgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  type OgItem = { name: string; author_name: string; kind: string; payload: { peaks?: number[]; bpm?: number; key?: string } | null }
  let item: OgItem | null = null
  try {
    const rows = await sql`SELECT name, author_name, kind, payload FROM community_items WHERE id = ${id}`
    item = (rows[0] as unknown as OgItem) ?? null
  } catch { /* fall through to branded card */ }

  const color = KIND_COLOR[item?.kind ?? ''] ?? '#8b5cf6'
  const peaks: number[] = item?.payload?.peaks?.length
    ? item.payload.peaks
    : Array.from({ length: 80 }, (_, i) => 0.25 + 0.55 * Math.abs(Math.sin(i * 0.55)) * Math.abs(Math.sin(i * 0.13)))
  const bars = peaks.filter((_, i) => i % Math.ceil(peaks.length / 80) === 0).slice(0, 80)

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(135deg, #0f0f11 0%, #17151f 100%)', padding: 64, justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: '#f1f0ff', display: 'flex' }}>100Lights</div>
          <div style={{
            fontSize: 18, fontWeight: 700, color, border: `2px solid ${color}`, borderRadius: 999,
            padding: '4px 18px', letterSpacing: 2, display: 'flex',
          }}>{KIND_LABEL[item?.kind ?? ''] ?? 'COMMUNITY'}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 220 }}>
          {bars.map((p, i) => (
            <div key={i} style={{
              display: 'flex', width: 10, borderRadius: 3,
              height: Math.max(10, p * 220),
              background: color, opacity: 0.85,
            }} />
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 56, fontWeight: 800, color: '#f1f0ff', display: 'flex', letterSpacing: -1 }}>
            {(item?.name ?? 'Community').slice(0, 42)}
          </div>
          <div style={{ fontSize: 26, color: '#a3a2b5', display: 'flex', marginTop: 8, gap: 18 }}>
            <span>by {item?.author_name ?? 'a producer'}</span>
            {item?.payload?.bpm ? <span>· {item.payload.bpm} BPM</span> : null}
            {item?.payload?.key ? <span>· {item.payload.key}</span> : null}
            <span>· listen free, no account needed</span>
          </div>
        </div>
      </div>
    ),
    size,
  )
}
