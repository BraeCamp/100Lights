'use client'

import { useRef } from 'react'
import type { PodcastMeta } from '@/lib/project-serializer'

interface Props {
  meta: PodcastMeta
  onChange: (m: PodcastMeta) => void
}

export default function EpisodePanel({ meta, onChange }: Props) {
  const artworkInputRef = useRef<HTMLInputElement>(null)

  function set<K extends keyof PodcastMeta>(k: K, v: PodcastMeta[K]) {
    onChange({ ...meta, [k]: v })
  }

  function handleArtworkChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      set('artwork', reader.result as string)
    }
    reader.readAsDataURL(file)
    // Reset so the same file can be re-selected
    e.target.value = ''
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-base)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '5px 8px',
    fontSize: 12,
    color: 'var(--text-primary)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  }

  const sectionLabel: React.CSSProperties = {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    paddingBottom: 6,
    borderBottom: '1px solid var(--border)',
    marginBottom: 2,
  }

  const smallBtn: React.CSSProperties = {
    fontSize: 10,
    padding: '3px 9px',
    borderRadius: 3,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  }

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>

      {/* Artwork */}
      <div>
        <div style={sectionLabel}>Artwork</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingTop: 8 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg-base)',
            flexShrink: 0, overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {meta.artwork ? (
              <img src={meta.artwork} alt="Episode artwork" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.4 }}>No{'\n'}cover</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <button style={smallBtn} onClick={() => artworkInputRef.current?.click()}>
              {meta.artwork ? 'Change' : 'Upload'}
            </button>
            {meta.artwork && (
              <button style={smallBtn} onClick={() => set('artwork', undefined)}>Remove</button>
            )}
            <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.4 }}>JPEG, PNG<br/>or WebP</span>
          </div>
        </div>
        <input
          ref={artworkInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={handleArtworkChange}
        />
      </div>

      {/* Show metadata */}
      <div>
        <div style={sectionLabel}>Show</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
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
              placeholder="Episode title..."
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
        </div>
      </div>

      {/* People */}
      <div>
        <div style={sectionLabel}>People</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
          <Field label="Host">
            <input
              value={meta.host ?? ''}
              onChange={e => set('host', e.target.value || undefined)}
              placeholder="Your name..."
              style={inputStyle}
            />
          </Field>
          <Field label="Guests">
            <input
              value={meta.guests}
              onChange={e => set('guests', e.target.value)}
              placeholder="Guest names, comma separated..."
              style={inputStyle}
            />
          </Field>
        </div>
      </div>

      {/* Publication */}
      <div>
        <div style={sectionLabel}>Publication</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
          <Field label="Episode Type">
            <select
              value={meta.episodeType ?? 'full'}
              onChange={e => set('episodeType', e.target.value as 'full' | 'trailer' | 'bonus')}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="full">Full</option>
              <option value="trailer">Trailer</option>
              <option value="bonus">Bonus</option>
            </select>
          </Field>
          <Field label="Tags / Category">
            <input
              value={meta.tags ?? ''}
              onChange={e => set('tags', e.target.value || undefined)}
              placeholder="technology, business..."
              style={inputStyle}
            />
          </Field>
          <Field label="Website URL">
            <input
              type="url"
              value={meta.websiteUrl ?? ''}
              onChange={e => set('websiteUrl', e.target.value || undefined)}
              placeholder="https://mypodcast.com"
              style={inputStyle}
            />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={meta.explicit ?? false}
              onChange={e => set('explicit', e.target.checked || undefined)}
              style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Explicit content</span>
          </label>
        </div>
      </div>

      {/* Content */}
      <div>
        <div style={sectionLabel}>Content</div>
        <div style={{ paddingTop: 8 }}>
          <Field label="Show Notes">
            <textarea
              value={meta.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Episode description and show notes..."
              rows={6}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
            />
          </Field>
        </div>
      </div>

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
