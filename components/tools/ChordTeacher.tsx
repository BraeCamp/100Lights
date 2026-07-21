'use client'

/**
 * Chord Teacher.
 *
 * The interactive piano sits at the top and is the shared output. Two
 * collapsible sections feed it: the built-in progression library (what the
 * old generator was), and a full chord reference — every common chord on a
 * chosen root, laid out by row. Clicking anything loads it onto the piano and,
 * for a single chord, plays it immediately.
 */

import { useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import ArticleProgression, { type ProgressionData } from '@/components/ArticleProgression'
import { getBuiltInChordRecipes, RECIPE_GENRE_ORDER } from '@/lib/practice-recipes'
import { groupIntoChords, type Chord } from '@/lib/chord-analysis'

// ── Chord reference data ──────────────────────────────────────
const ROOTS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

// Semitone intervals above the root for each chord quality.
const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7],
  '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  'm7♭5': [0, 3, 6, 10], dim7: [0, 3, 6, 9], '9': [0, 4, 7, 10, 14], m9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14], '7sus4': [0, 5, 7, 10],
}

// Grouped into rows so a reader can scan to the family they want.
const ROWS: Array<{ label: string; types: string[] }> = [
  { label: 'Triads', types: ['', 'm', 'dim', 'aug', 'sus2', 'sus4'] },
  { label: 'Sevenths', types: ['7', 'maj7', 'm7', 'm7♭5', 'dim7'] },
  { label: 'Sixths & extensions', types: ['6', 'm6', '9', 'm9', 'add9', '7sus4'] },
]

function buildChord(rootPc: number, type: string): Chord {
  const base = 60 + rootPc // rooted around middle C
  return { name: ROOTS[rootPc] + type, pitches: QUALITIES[type].map(i => base + i), beat: 0, dur: 4 }
}

interface Selection { id: string; data: ProgressionData; autoPlay: boolean }

export default function ChordTeacher() {
  const progressions = useMemo(() => (
    getBuiltInChordRecipes()
      .filter(r => !r.id.startsWith('snd-'))
      .map(r => ({ id: r.id, title: r.title, tagline: r.tagline, genre: r.genre ?? 'Other', chords: groupIntoChords(r.build().notes) }))
      .filter(p => p.chords.filter(c => c.pitches.length >= 2).length >= 2)
  ), [])

  const genres = useMemo(() => {
    const present = new Set(progressions.map(p => p.genre))
    return ['All', ...RECIPE_GENRE_ORDER.filter(g => present.has(g))]
  }, [progressions])

  const [genre, setGenre] = useState('All')
  const [rootPc, setRootPc] = useState(0)
  const [progOpen, setProgOpen] = useState(false)
  const [chordsOpen, setChordsOpen] = useState(false)
  const nonce = useRef(0)

  const first = progressions[0]
  const [sel, setSel] = useState<Selection>(() => ({
    id: 'init', autoPlay: false,
    data: { chords: first?.chords ?? [], originalKey: 0, caption: first?.title ?? 'Chords' },
  }))

  const shownProgs = genre === 'All' ? progressions : progressions.filter(p => p.genre === genre)

  function loadProgression(p: typeof progressions[number]) {
    nonce.current++
    setSel({ id: `prog-${p.id}-${nonce.current}`, autoPlay: false, data: { chords: p.chords, originalKey: 0, caption: p.title } })
  }

  function playChord(type: string) {
    nonce.current++
    const chord = buildChord(rootPc, type)
    setSel({ id: `chord-${chord.name}-${nonce.current}`, autoPlay: true, data: { chords: [chord], originalKey: rootPc, caption: chord.name } })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Piano on top — the shared output for both sections */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '4px 16px 8px', background: 'var(--bg-card)' }}>
        <ArticleProgression key={sel.id} data={sel.data} hideToggle autoPlay={sel.autoPlay} />
      </div>

      {/* Progressions */}
      <Section title="Chord progressions" subtitle="the moves behind a thousand songs" open={progOpen} onToggle={() => setProgOpen(o => !o)}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {genres.map(g => (
            <button key={g} onClick={() => setGenre(g)} style={pill(genre === g)}>{g}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {shownProgs.map(p => (
            <button key={p.id} onClick={() => loadProgression(p)} style={{
              textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
              border: `1px solid ${sel.data.caption === p.title ? 'var(--accent)' : 'var(--border)'}`,
              background: sel.data.caption === p.title ? 'rgba(124,58,237,0.10)' : 'var(--bg-base)',
            }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{p.title}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{p.tagline}</div>
            </button>
          ))}
        </div>
      </Section>

      {/* Chord reference */}
      <Section title="All chords" subtitle="every chord on a note you pick" open={chordsOpen} onToggle={() => setChordsOpen(o => !o)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginRight: 2 }}>ROOT</span>
          {ROOTS.map((r, pc) => (
            <button key={r} onClick={() => setRootPc(pc)} style={{
              minWidth: 30, padding: '5px 7px', borderRadius: 7, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
              border: `1px solid ${rootPc === pc ? 'var(--accent)' : 'var(--border)'}`,
              background: rootPc === pc ? 'rgba(124,58,237,0.15)' : 'transparent',
              color: rootPc === pc ? 'var(--accent-light)' : 'var(--text-secondary)',
            }}>{r}</button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ROWS.map(row => (
            <div key={row.label}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>{row.label}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {row.types.map(type => {
                  const name = ROOTS[rootPc] + type
                  const on = sel.data.caption === name
                  return (
                    <button key={type} onClick={() => playChord(type)} style={{
                      padding: '8px 13px', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 700,
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                      background: on ? 'var(--accent)' : 'var(--bg-base)',
                      color: on ? '#fff' : 'var(--text-primary)',
                    }}>{name}</button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
          Tap any chord to hear it on the piano above. Change the root to move the whole set to another note.
        </p>
      </Section>
    </div>
  )
}

function Section({ title, subtitle, open, onToggle, children }: {
  title: string; subtitle: string; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', background: 'var(--bg-card)' }}>
      <button onClick={onToggle} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', cursor: 'pointer',
        background: 'none', border: 'none', textAlign: 'left',
      }}>
        <span style={{ fontSize: 14.5, fontWeight: 750, color: 'var(--text-primary)' }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</span>
        <ChevronDown size={16} style={{ marginLeft: 'auto', color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && <div style={{ padding: '0 16px 16px' }}>{children}</div>}
    </div>
  )
}

function pill(on: boolean): React.CSSProperties {
  return {
    fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 99, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
    background: on ? 'rgba(124,58,237,0.15)' : 'transparent',
    color: on ? 'var(--accent-light)' : 'var(--text-muted)',
  }
}
