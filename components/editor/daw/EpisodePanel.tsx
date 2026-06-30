'use client'

import type { PodcastMeta } from '@/lib/project-serializer'

interface Props {
  meta: PodcastMeta
  onChange: (m: PodcastMeta) => void
}

export default function EpisodePanel({ meta, onChange }: Props) {
  function set<K extends keyof PodcastMeta>(k: K, v: PodcastMeta[K]) {
    onChange({ ...meta, [k]: v })
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-base)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '6px 8px',
    fontSize: 12,
    color: 'var(--text-primary)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  }

  return (
    <div style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 11, overflowY: 'auto', flex: 1 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 2 }}>
        Episode Info
      </div>

      <Field label="Show Name">
        <input
          value={meta.showName}
          onChange={e => set('showName', e.target.value)}
          placeholder="My Podcast"
          style={inputStyle}
        />
      </Field>

      <Field label="Episode Title">
        <input
          value={meta.episodeTitle}
          onChange={e => set('episodeTitle', e.target.value)}
          placeholder="Episode title…"
          style={inputStyle}
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="Season">
          <input
            type="number"
            min={1}
            value={meta.season ?? ''}
            onChange={e => set('season', e.target.value ? parseInt(e.target.value) : null)}
            placeholder="1"
            style={inputStyle}
          />
        </Field>
        <Field label="Episode #">
          <input
            type="number"
            min={1}
            value={meta.episodeNumber ?? ''}
            onChange={e => set('episodeNumber', e.target.value ? parseInt(e.target.value) : null)}
            placeholder="1"
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Guests">
        <input
          value={meta.guests}
          onChange={e => set('guests', e.target.value)}
          placeholder="Guest names…"
          style={inputStyle}
        />
      </Field>

      <Field label="Show Notes">
        <textarea
          value={meta.description}
          onChange={e => set('description', e.target.value)}
          placeholder="Episode description and show notes…"
          rows={6}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
        />
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </label>
  )
}
