'use client'

import { useEffect, useState } from 'react'
import type { DawProject } from '@/lib/daw-types'
import { songMetadata, sampleUsage, fmtDuration, type SampleUse } from '@/lib/project-admin'
import { getCommunityItem } from '@/lib/community'

// ── Song details + credits ───────────────────────────────────────────────────
// The two pieces worth keeping from the old /lab hub, folded into the app for
// every user: an auto-generated metadata sheet, and sample attribution — every
// sampled sound's origin, with community samples credited to their author (only
// possible because 100Lights owns both the project and the sample library).

const muted = 'var(--text-muted, #a3a2b5)'
const border = '1px solid var(--border, #26262b)'

export default function SongDetails({ project }: { project: DawProject }) {
  const meta = songMetadata(project)

  // Resolve community-sample authors (best-effort) from their libraryId item ids.
  const [authors, setAuthors] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    const ids = [...new Set(
      project.arrangementClips
        .map(c => ('libraryId' in c && typeof c.libraryId === 'string' && c.libraryId.startsWith('community:')) ? c.libraryId.split(':')[1] : null)
        .filter((x): x is string => !!x),
    )]
    if (!ids.length) return
    let live = true
    Promise.all(ids.map(async id => {
      try { const item = await getCommunityItem(id); return [id, item?.authorName ?? ''] as const } catch { return [id, ''] as const }
    })).then(pairs => { if (live) setAuthors(new Map(pairs.filter(([, a]) => a))) })
    return () => { live = false }
  }, [project.arrangementClips])

  const samples = sampleUsage(project, authors)

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))', gap: 12 }}>
        <Field k="Tempo" v={`${meta.bpm} BPM`} />
        <Field k="Key" v={meta.keyLabel} />
        <Field k="Time" v={meta.timeSignature} />
        <Field k="Length" v={fmtDuration(meta.durationSec)} />
        <Field k="Tracks" v={String(meta.trackCount)} />
      </div>
      {meta.instruments.length > 0 && (
        <div style={{ marginTop: 10, color: muted, fontSize: 12 }}>Instruments: {meta.instruments.join(', ')}</div>
      )}

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: border }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: muted, marginBottom: 8 }}>Sources &amp; credits</div>
        {samples.length === 0 ? (
          <div style={{ color: muted, fontSize: 12.5 }}>All synths &amp; MIDI — nothing sampled to credit.</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {samples.map(s => (
              <div key={s.clipId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.clipName}</span>
                <span style={{ flexShrink: 0, color: sourceColor(s), fontSize: 12 }}>{sourceLabel(s)}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: 11.5, color: muted }}>Made with 100Lights</div>
      </div>
    </div>
  )
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{v}</div>
    </div>
  )
}

function sourceLabel(s: SampleUse): string {
  if (s.source === 'community') return s.author ? `Community · by ${s.author}` : 'Community sample'
  if (s.source === 'recording') return 'Your recording'
  return 'Library sound'
}
function sourceColor(s: SampleUse): string {
  return s.source === 'community' ? 'var(--accent-light)' : muted
}
