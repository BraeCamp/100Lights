'use client'

import Link from 'next/link'
import type { SongMetadata, SampleUse } from '@/lib/project-admin'

// The lean /lab reference: the two pieces worth keeping from the old admin hub —
// an auto-generated metadata sheet and sample attribution. The heavy tabs
// (splits, release, money, provenance) were shelved when the product bet moved to
// editable AI generation + the content engine. The same two live in the main app
// for every user via <SongDetails> (the studio export modal); this is the
// server-rendered view for a saved project.

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const card: React.CSSProperties = { background: 'var(--bg-surface, #17171b)', border: '1px solid var(--border, #26262b)', borderRadius: 12, padding: '18px 20px' }
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted, #a3a2b5)' }
const muted = 'var(--text-muted, #a3a2b5)'
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary,#cfceda)', background: 'var(--bg-surface,#17171b)', border: '1px solid var(--border,#26262b)', borderRadius: 8, padding: '7px 13px', cursor: 'pointer', textDecoration: 'none' }

export function HubClient({ projectId, metadata, samples }: {
  projectId: string
  metadata: SongMetadata
  samples: SampleUse[]
}) {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '28px 20px 80px', color: 'var(--text-primary, #f1f0ff)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#a78bfa', marginBottom: 6 }}>Song details · Lab</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.01em', margin: 0 }}>{metadata.title}</h1>
          <div style={{ fontSize: 12.5, color: muted, marginTop: 5 }}>
            {metadata.bpm} BPM · {metadata.keyLabel} · {metadata.timeSignature} · {fmtDuration(metadata.durationSec)} · {metadata.trackCount} tracks
          </div>
        </div>
        <Link href={`/projects/${projectId}`} style={btn}>✎ Open in studio</Link>
      </div>

      <section style={{ display: 'grid', gap: 14, marginTop: 22 }}>
        <div style={card}>
          <div style={label}>Metadata sheet · auto-generated</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14, marginTop: 12 }}>
            <Field k="Title" v={metadata.title} />
            <Field k="Tempo" v={`${metadata.bpm} BPM`} />
            <Field k="Key" v={metadata.keyLabel} />
            <Field k="Time sig" v={metadata.timeSignature} />
            <Field k="Duration" v={fmtDuration(metadata.durationSec)} />
            <Field k="Tracks" v={String(metadata.trackCount)} />
          </div>
          {metadata.instruments.length > 0 && <div style={{ marginTop: 12, fontSize: 12.5, color: muted }}>Instruments: {metadata.instruments.join(', ')}</div>}
        </div>

        <div style={card}>
          <div style={label}>Sample usage &amp; credits · from the project&rsquo;s clips</div>
          <p style={{ fontSize: 11.5, color: muted, margin: '4px 0 12px' }}>Every sampled sound and where it came from — community samples credited to their author, only possible because the track was made here.</p>
          {samples.length === 0 ? <p style={{ fontSize: 13, color: muted }}>No sampled audio — all synths/MIDI. Nothing to credit.</p> : (
            <div style={{ display: 'grid', gap: 8 }}>
              {samples.map(s => (
                <div key={s.clipId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: 'var(--bg-base,#0f0f11)', borderRadius: 8, border: '1px solid var(--border,#26262b)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.clipName}</div>
                    <div style={{ fontSize: 11.5, color: muted }}>
                      {s.source === 'community' ? `Community sample${s.author ? ` · by ${s.author}` : ''}` : s.source === 'recording' ? 'Your recording / import' : 'Library sound'}
                    </div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '3px 10px', ...clearancePill(s.clearance) }}>{clearanceLabel(s.clearance)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

function Field({ k, v }: { k: string; v: string }) {
  return <div><div style={{ fontSize: 10.5, color: muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div><div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{v}</div></div>
}
function clearancePill(c: SampleUse['clearance']): React.CSSProperties {
  if (c === 'owned') return { color: '#4ade80', background: 'rgba(74,222,128,0.12)' }
  if (c === 'community') return { color: '#a78bfa', background: 'rgba(167,139,250,0.14)' }
  return { color: '#fb923c', background: 'rgba(251,146,60,0.14)' }
}
function clearanceLabel(c: SampleUse['clearance']): string {
  return c === 'owned' ? 'Yours' : c === 'community' ? 'Community · attribute' : 'Needs clearance'
}
