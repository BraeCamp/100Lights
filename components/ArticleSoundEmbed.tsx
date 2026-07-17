'use client'

// Inline sound embeds for Learn articles: `@sound(communityItemId) caption`.
// Samples/songs stream through the public community audio route; recipes
// (note data, no audio file) render a note map and audition on a piano —
// the same treatment the community feed gives them.

import { useState, useEffect, useRef } from 'react'
import { Play, Square } from 'lucide-react'
import { playMelodicNote } from '@/lib/instrument-synth'

interface Item {
  id: string
  kind: string
  name: string
  authorName: string
  payload?: { spec?: { notes: Array<{ pitch: number; startBeat: number; durationBeats: number; velocity: number }>; durationBeats: number; isDrumClip?: boolean } } | null
}

let _ctx: AudioContext | null = null
const ctx = () => (_ctx ??= new AudioContext())

export default function ArticleSoundEmbed({ itemId, caption }: { itemId: string; caption: string }) {
  const [item, setItem] = useState<Item | null | 'error'>(null)
  const [playing, setPlaying] = useState(false)
  const stopRef = useRef<() => void>(() => {})

  useEffect(() => {
    let alive = true
    fetch(`/api/community/${itemId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setItem(d?.item ?? 'error') })
      .catch(() => { if (alive) setItem('error') })
    return () => { alive = false; stopRef.current() }
  }, [itemId])

  if (item === 'error') return null
  if (item === null) {
    return <div style={{ margin: '24px 0', height: 64, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', opacity: 0.5 }} />
  }

  const spec = item.payload?.spec
  const isRecipe = item.kind === 'recipe' && spec?.notes?.length

  function auditionRecipe() {
    if (playing) { stopRef.current(); return }
    if (!spec) return
    const c = ctx()
    void c.resume()
    const g = c.createGain()
    g.gain.value = 0.7
    g.connect(c.destination)
    const spb = 60 / 100
    const t0 = c.currentTime + 0.06
    let end = 0
    for (const n of spec.notes) {
      if (n.startBeat >= 16) continue
      playMelodicNote(c, 'piano-grand', n.pitch, t0 + n.startBeat * spb, (n.velocity ?? 100) / 127, g)
      end = Math.max(end, Math.min(n.startBeat + n.durationBeats, 16) * spb)
    }
    const timer = setTimeout(() => stopRef.current(), (end + 1.2) * 1000)
    stopRef.current = () => {
      clearTimeout(timer)
      g.gain.setTargetAtTime(0, c.currentTime, 0.04)
      setTimeout(() => g.disconnect(), 300)
      setPlaying(false)
      stopRef.current = () => {}
    }
    setPlaying(true)
  }

  return (
    <figure style={{ margin: '24px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
        {isRecipe ? (
          <>
            <button
              onClick={auditionRecipe}
              aria-label={playing ? 'Stop preview' : `Play ${item.name}`}
              style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0, border: 'none', cursor: 'pointer',
                background: playing ? 'var(--accent)' : 'rgba(167,139,250,0.18)', color: playing ? '#fff' : '#a78bfa',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {playing ? <Square size={14} fill="currentColor" /> : <Play size={15} style={{ marginLeft: 2 }} />}
            </button>
            <RecipeMap spec={spec!} />
          </>
        ) : (
          <audio controls preload="none" src={`/api/community/${item.id}/audio`} style={{ flex: 1, height: 40 }} aria-label={`Audio: ${item.name}`} />
        )}
      </div>
      <figcaption style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span>{caption || item.name} · by {item.authorName}</span>
        <a href={`/community/${item.id}`} style={{ color: '#a78bfa', textDecoration: 'none' }}>Open in Community →</a>
      </figcaption>
    </figure>
  )
}

function RecipeMap({ spec }: { spec: NonNullable<Item['payload']>['spec'] & object }) {
  const notes = spec!.notes
  const lo = Math.min(...notes.map(n => n.pitch)), hi = Math.max(...notes.map(n => n.pitch))
  const range = Math.max(hi - lo + 1, 8)
  const beats = Math.max(spec!.durationBeats, ...notes.map(n => n.startBeat + n.durationBeats))
  return (
    <svg viewBox={`0 0 ${beats} ${range}`} preserveAspectRatio="none" style={{ flex: 1, height: 48, display: 'block' }} aria-hidden>
      {Array.from({ length: Math.max(0, Math.ceil(beats / 4) - 1) }, (_, i) => (
        <line key={i} x1={(i + 1) * 4} y1={0} x2={(i + 1) * 4} y2={range} stroke="rgba(255,255,255,0.08)" strokeWidth={0.06} />
      ))}
      {notes.map((n, i) => (
        <rect key={i} x={n.startBeat} y={hi - n.pitch + (range - (hi - lo + 1)) / 2}
          width={Math.max(n.durationBeats - 0.08, 0.15)} height={0.82} rx={0.12}
          fill="#a78bfa" opacity={0.45 + 0.55 * ((n.velocity ?? 100) / 127)} />
      ))}
    </svg>
  )
}
