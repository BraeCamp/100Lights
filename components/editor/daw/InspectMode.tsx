'use client'

// Inspect mode: press I (or the magnifying-glass button next to Help) and
// hover anything — toolbar controls show their name and what they do (from
// the help registry), clips/tracks/library entries show what's inside them.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import { helpInfoFor } from './HelpButton'
import { getPresets } from '@/lib/midi-presets'
import { libraryGetAll, type LibraryEntry } from '@/lib/sound-library'
import type { MidiClip, AudioClip } from '@/lib/daw-types'

interface Card {
  title: string
  kind: string
  color: string
  lines: string[]
}

const KIND_COLORS = { tool: '#60a5fa', clip: '#a78bfa', track: '#f59e0b', sound: '#34d399' }

function prettify(id: string): string {
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function InspectButton() {
  const { project } = useDaw()
  const [on, setOn] = useState(false)
  const [card, setCard] = useState<Card | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const projectRef = useRef(project)
  const entriesRef = useRef<Map<string, LibraryEntry> | null>(null)
  useEffect(() => { projectRef.current = project })

  // I toggles, Escape exits
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOn(false); return }
      if (e.key !== 'i' && e.key !== 'I') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      setOn(v => !v)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // library entries load once per activation, so sound cards are instant
  useEffect(() => {
    if (!on) return
    libraryGetAll().then(all => { entriesRef.current = new Map(all.map(e => [e.id, e])) }).catch(() => {})
  }, [on])

  useEffect(() => {
    if (!on) return  // cleanup below already cleared the card on deactivate
    document.body.style.cursor = 'help'
    let raf = 0

    function buildCard(el: HTMLElement): Card | null {
      const hit = el.closest?.('[data-clip-id], [data-track-id], [data-entry-id], [data-help-id]') as HTMLElement | null
      if (!hit) return null
      const project = projectRef.current

      const clipId = hit.dataset.clipId
      if (clipId) {
        const clip = project.arrangementClips.find(c => c.id === clipId)
        if (!clip) return null
        const at = `${clip.durationBeats} beats from beat ${clip.startBeat}`
        if (clip.kind === 'midi') {
          const m = clip as MidiClip
          const lines = [`${m.notes.length} note${m.notes.length !== 1 ? 's' : ''} · ${at}`]
          if (m.presetId) {
            const preset = getPresets().find(p => p.id === m.presetId)
            if (preset) lines.push(`Sound: ${preset.name}`)
          }
          if (m.rollFx?.sustain) lines.push(`Sustain ${m.rollFx.sustain.toFixed(1)}s`)
          if (m.loopEnabled) lines.push(`Loops every ${m.loopLengthBeats} beats`)
          if (m.stretchNotes) lines.push('Recipe clip — edge-resize stretches the pattern')
          if (m.voiceMap) lines.push('Has a voice-map trace')
          return { title: m.name, kind: m.isDrumClip ? 'Drum pattern' : 'MIDI pattern', color: KIND_COLORS.clip, lines }
        }
        const a = clip as AudioClip
        const lines = [at]
        if (a.gain !== 1) lines.push(`Gain ${Math.round(a.gain * 100)}%`)
        if (a.reverse) lines.push('Reversed')
        if (a.loopEnabled) lines.push('Looping')
        const entry = a.libraryId ? entriesRef.current?.get(a.libraryId) : null
        if (entry) lines.push(`Sample: ${entry.name} (${entry.category})`)
        else if (a.libraryId?.startsWith('community:')) lines.push('Sample: community link')
        else if (a.r2Key) lines.push('Recorded / imported audio (saved to the cloud)')
        return { title: a.name, kind: 'Audio clip', color: KIND_COLORS.clip, lines }
      }

      const trackId = hit.dataset.trackId
      if (trackId) {
        const track = project.tracks.find(t => t.id === trackId)
        if (!track) return null
        const clips = project.arrangementClips.filter(c => c.trackId === trackId)
        const lines = [
          `${clips.length} clip${clips.length !== 1 ? 's' : ''} · volume ${Math.round(track.volume * 100)}% · pan ${track.pan === 0 ? 'center' : track.pan < 0 ? `L${Math.round(-track.pan * 100)}` : `R${Math.round(track.pan * 100)}`}`,
        ]
        const flags = [track.mute && 'muted', track.solo && 'solo', track.armed && 'armed'].filter(Boolean)
        if (flags.length) lines.push(flags.join(' · '))
        if (track.instrument && track.instrument.type !== 'none') lines.push(`Instrument: ${track.instrument.type}`)
        if (track.effects?.length) lines.push(`${track.effects.length} track effect${track.effects.length !== 1 ? 's' : ''}`)
        return { title: track.name, kind: 'Track', color: KIND_COLORS.track, lines }
      }

      const entryId = hit.dataset.entryId
      if (entryId) {
        const entry = entriesRef.current?.get(entryId)
        if (!entry) return { title: 'Sound', kind: 'Library sound', color: KIND_COLORS.sound, lines: ['Loading details…'] }
        const lines = [`${entry.category} · ${entry.duration.toFixed(1)}s`]
        if (entry.id.startsWith('seed:') || entry.renderSpec) lines.push('100Lights built-in — renders on first use')
        else if (entry.communityRef || entry.id.startsWith('community:')) lines.push(`From the Community${entry.authorName ? ` — by ${entry.authorName}` : ''}${entry.audioBlob ? '' : ' · streams on first play, then cached'}`)
        else lines.push('Your sound')
        if (entry.folder) lines.push(`Folder: ${entry.folder}`)
        if (entry.tags?.length) lines.push(entry.tags.map(t => `#${t}`).join(' '))
        return { title: entry.name, kind: 'Library sound', color: KIND_COLORS.sound, lines }
      }

      const helpId = hit.dataset.helpId
      if (helpId) {
        const info = helpInfoFor(helpId)
        if (info) return { title: info.name, kind: 'Tool', color: KIND_COLORS.tool, lines: [info.description] }
        return { title: prettify(helpId), kind: 'Tool', color: KIND_COLORS.tool, lines: [hit.getAttribute('title') ?? ''].filter(Boolean) }
      }
      return null
    }

    function onMove(e: MouseEvent) {
      cancelAnimationFrame(raf)
      const target = e.target as HTMLElement
      const x = e.clientX, y = e.clientY
      raf = requestAnimationFrame(() => {
        setPos({ x, y })
        setCard(buildCard(target))
      })
    }
    document.addEventListener('mousemove', onMove, true)
    return () => {
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', onMove, true)
      cancelAnimationFrame(raf)
      setCard(null)
    }
  }, [on])

  const cardW = 270
  const left = Math.min(pos.x + 16, (typeof window !== 'undefined' ? window.innerWidth : 1200) - cardW - 12)
  const top = Math.min(pos.y + 18, (typeof window !== 'undefined' ? window.innerHeight : 800) - 160)

  return (
    <>
      <button
        onClick={() => setOn(v => !v)}
        title="Inspect mode — hover anything for its name and details (I)"
        data-help-id="inspect"
        aria-pressed={on}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
          background: on ? 'rgba(96,165,250,0.18)' : 'transparent',
          border: on ? '1px solid rgba(96,165,250,0.55)' : '1px solid var(--border)',
          color: on ? '#60a5fa' : 'var(--text-muted)',
        }}
      >
        <Search size={13} />
      </button>

      {on && typeof document !== 'undefined' && createPortal(
        <>
          {card && (
            <div style={{
              position: 'fixed', left, top, width: cardW, zIndex: 10002, pointerEvents: 'none',
              background: '#161620', border: `1px solid ${card.color}55`, borderRadius: 10,
              padding: '10px 12px', boxShadow: '0 10px 28px rgba(0,0,0,0.7)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: card.color, background: `${card.color}1c`, border: `1px solid ${card.color}44`, borderRadius: 4, padding: '1px 6px' }}>
                  {card.kind}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#f1f0ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.title}</span>
              </div>
              {card.lines.map((l, i) => (
                <p key={i} style={{ fontSize: 10.5, color: '#b9b8c9', margin: i ? '3px 0 0' : 0, lineHeight: 1.5 }}>{l}</p>
              ))}
            </div>
          )}
          <div style={{
            position: 'fixed', bottom: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 10002, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: 999,
            background: 'rgba(22,22,32,0.95)', border: '1px solid rgba(96,165,250,0.4)',
          }}>
            <Search size={11} color="#60a5fa" />
            <span style={{ fontSize: 10.5, color: '#cfd8ea', fontWeight: 600 }}>
              Inspect — hover anything for details · press I to exit
            </span>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
