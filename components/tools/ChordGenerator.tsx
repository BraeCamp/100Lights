'use client'

/**
 * Chord progression generator.
 *
 * Filters the built-in recipe library by genre, and hands the selected
 * progression's real notes to the same interactive piano the articles use —
 * play, transpose to any key, and download as MIDI. Nothing is invented here;
 * the progressions are the actual recipes from the studio's library.
 */

import { useMemo, useState } from 'react'
import ArticleProgression, { type ProgressionData } from '@/components/ArticleProgression'
import { getBuiltInChordRecipes, RECIPE_GENRE_ORDER } from '@/lib/practice-recipes'
import { groupIntoChords } from '@/lib/chord-analysis'

interface Item {
  id: string
  title: string
  tagline: string
  genre: string
  data: ProgressionData
}

export default function ChordGenerator() {
  const items: Item[] = useMemo(() => (
    getBuiltInChordRecipes()
      // Sound-design patches (snd-*) are authored as sounds, not progressions —
      // a chord tool shouldn't list them even when they happen to be chordal.
      .filter(r => !r.id.startsWith('snd-'))
      .map(r => {
        const chords = groupIntoChords(r.build().notes)
        return { id: r.id, title: r.title, tagline: r.tagline, genre: r.genre ?? 'Other',
                 data: { chords, originalKey: 0, caption: r.title } satisfies ProgressionData }
      })
      // Keep only genuinely harmonic recipes. The sound-design patches are
      // monophonic phrases, so each note groups into its own one-note "chord";
      // requiring at least two multi-note chords drops them without a hardcoded
      // exclude list.
      .filter(i => i.data.chords.filter(c => c.pitches.length >= 2).length >= 2)
  ), [])

  const genres = useMemo(() => {
    const present = new Set(items.map(i => i.genre))
    return ['All', ...RECIPE_GENRE_ORDER.filter(g => present.has(g))]
  }, [items])

  const [genre, setGenre] = useState('All')
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? '')

  const shown = genre === 'All' ? items : items.filter(i => i.genre === genre)
  const selected = items.find(i => i.id === selectedId) ?? shown[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Genre filter */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {genres.map(g => (
          <button key={g} onClick={() => setGenre(g)} style={{
            fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 99, cursor: 'pointer',
            border: `1px solid ${genre === g ? 'var(--accent)' : 'var(--border)'}`,
            background: genre === g ? 'rgba(124,58,237,0.15)' : 'transparent',
            color: genre === g ? 'var(--accent-light)' : 'var(--text-muted)',
          }}>{g}</button>
        ))}
      </div>

      {/* Recipe list */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
        {shown.map(i => (
          <button key={i.id} onClick={() => setSelectedId(i.id)} style={{
            textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
            border: `1px solid ${selected?.id === i.id ? 'var(--accent)' : 'var(--border)'}`,
            background: selected?.id === i.id ? 'rgba(124,58,237,0.10)' : 'var(--bg-card)',
          }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{i.title}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{i.tagline}</div>
          </button>
        ))}
      </div>

      {/* The interactive piano — same widget the articles use, open by default */}
      {selected && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '4px 16px 8px', background: 'var(--bg-card)' }}>
          <ArticleProgression key={selected.id} data={selected.data} defaultOpen />
        </div>
      )}
    </div>
  )
}
