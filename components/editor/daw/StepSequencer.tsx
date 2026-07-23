'use client'

// Standalone step sequencer — a first-class beat-programming surface that opens
// inline under a track, exactly like the piano roll (its own
// expandedStepSeqClipId). It's a grid VIEW over a drum clip's MidiNotes (one row
// per drum lane, one column per 16th), so the roll and the sequencer are just
// two windows onto the same clip. Kits (a drum instrument config) and patterns
// (a starter groove) are picked from the header. Length extends bar-by-bar.

import { useEffect, useRef, useState } from 'react'
import { useDaw } from '@/lib/daw-state'
import { isMidiClip } from '@/lib/daw-types'
import type { MidiClip } from '@/lib/daw-types'
import { playInstrumentNote } from '@/lib/daw-instruments'
import {
  DRUM_LANES, STEP_BEATS, kitIdForInstrument, patternToNotes, notesToHits,
  getKits, getPatterns, addKit, addPattern, deleteKit, deletePattern,
  type DrumKit, type DrumPattern,
} from '@/lib/drum-presets'

// Alias pitch → its lane's primary pitch, so a note entered as 40 still lights
// the Snare row (mirrors the piano-roll drum grid).
const PITCH_TO_LANE = new Map<number, number>()
DRUM_LANES.forEach(l => {
  PITCH_TO_LANE.set(l.pitch, l.pitch)
  l.aliases?.forEach(a => PITCH_TO_LANE.set(a, l.pitch))
})

export default function StepSequencer({ clipId }: { clipId?: string }) {
  const { project, expandedStepSeqClipId } = useDaw()
  const id = clipId ?? expandedStepSeqClipId
  const clip = id ? (project.arrangementClips.find(c => c.id === id) ?? null) : null
  if (!clip || !isMidiClip(clip)) return null
  return <StepSeqInner clip={clip} />
}

function StepSeqInner({ clip }: { clip: MidiClip }) {
  const { project, dispatch, engine, playing, setExpandedStepSeqClipId, setExpandedPianoRollClipId } = useDaw()
  const track = project.tracks.find(t => t.id === clip.trackId)
  const beatsPerBar = project.timeSignatureNum || 4
  const stepsPerBar = Math.round(beatsPerBar / STEP_BEATS)
  const steps = Math.max(stepsPerBar, Math.round(clip.durationBeats / STEP_BEATS))
  const bars = Math.max(1, Math.round(steps / stepsPerBar))

  const isDrum = track?.instrument.type === 'drum'
  const currentKit = kitIdForInstrument(track?.instrument)

  // ── Live playhead: which step is sounding (highlights on step boundaries) ──
  const [playStep, setPlayStep] = useState(-1)
  useEffect(() => {
    let raf = 0, last = -1
    const frame = () => {
      const rel = engine.currentBeat - clip.startBeat
      const s = playing && rel >= 0 && rel < clip.durationBeats ? Math.floor(rel / STEP_BEATS) : -1
      if (s !== last) { last = s; setPlayStep(s) }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [engine, playing, clip.startBeat, clip.durationBeats])

  // ── Note helpers ──────────────────────────────────────────────────────────
  const noteAt = (pitch: number, step: number) =>
    clip.notes.find(n =>
      PITCH_TO_LANE.get(n.pitch) === pitch &&
      Math.abs(n.startBeat - step * STEP_BEATS) < STEP_BEATS / 2)

  function audition(pitch: number) {
    if (!engine.ctx || !track) return
    try { playInstrumentNote(engine.ctx, engine.masterGain, track.instrument, pitch, 110, engine.ctx.currentTime, 0.25) } catch { /* ctx not ready */ }
  }

  function toggle(pitch: number, step: number) {
    const hit = noteAt(pitch, step)
    if (hit) {
      dispatch({ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId: hit.id })
    } else {
      dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note: {
        id: crypto.randomUUID(), pitch, startBeat: step * STEP_BEATS, durationBeats: STEP_BEATS, velocity: 100,
      } })
      audition(pitch)
    }
  }

  // ── Kit & pattern libraries (built-in + user-saved) ──────────────────────────
  const [kits, setKits] = useState<DrumKit[]>(() => getKits())
  const [patterns, setPatterns] = useState<DrumPattern[]>(() => getPatterns())
  const [patternSel, setPatternSel] = useState('')
  const refreshLibs = () => { setKits(getKits()); setPatterns(getPatterns()) }

  function applyKit(kitId: string) {
    const kit = kits.find(k => k.id === kitId)
    if (!kit || !track) return
    dispatch({ type: 'SET_INSTRUMENT', trackId: track.id, instrument: structuredClone(kit.instrument) })
    audition(36)
  }
  function applyPattern(patternId: string) {
    const p = patterns.find(x => x.id === patternId)
    if (!p) return
    setPatternSel(p.builtIn ? '' : p.id)   // keep user patterns selected so they can be deleted
    const dur = Math.max(clip.durationBeats, p.bars * beatsPerBar)
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes: patternToNotes(p), durationBeats: dur } })
  }
  function saveKit() {
    if (!track || track.instrument.type !== 'drum') return
    const name = window.prompt('Name this kit')?.trim()
    if (!name) return
    addKit({ name, desc: 'Custom kit', instrument: structuredClone(track.instrument) }); refreshLibs()
  }
  function savePattern() {
    if (!clip.notes.length) { window.alert('Add some hits first, then save them as a pattern.'); return }
    const name = window.prompt('Name this beat pattern')?.trim()
    if (!name) return
    const p = addPattern({ name, desc: 'Custom pattern', bars, hits: notesToHits(clip.notes) })
    refreshLibs(); setPatternSel(p.id)
  }
  const userKitSelected = !!currentKit && !!kits.find(k => k.id === currentKit && !k.builtIn)
  const userPatternSelected = !!patterns.find(p => p.id === patternSel && !p.builtIn)
  const userKits = kits.filter(k => !k.builtIn)
  const userPatterns = patterns.filter(p => !p.builtIn)
  function delKit() { if (userKitSelected && currentKit) { deleteKit(currentKit); refreshLibs() } }
  function delPattern() { if (patternSel) { deletePattern(patternSel); setPatternSel(''); refreshLibs() } }

  function setBars(n: number) {
    const next = Math.max(1, Math.min(16, n))
    const dur = next * beatsPerBar
    // Shrinking drops notes that fall past the new end so they don't linger.
    const notes = dur < clip.durationBeats ? clip.notes.filter(nt => nt.startBeat < dur - 1e-6) : clip.notes
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { durationBeats: dur, notes } })
  }

  const [tall, setTall] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const selStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, padding: '3px 6px', borderRadius: 4, cursor: 'pointer',
    border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-primary)',
  }
  const miniBtn: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, width: 22, height: 22, borderRadius: 4, cursor: 'pointer',
    border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-secondary)',
  }

  return (
    <div style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--border)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '7px 12px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent-light)' }}>◼ STEP SEQUENCER</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.name}</span>

        <span style={{ flex: 1 }} />

        {/* Kit */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: 'var(--text-muted)' }}>
          KIT
          <select value={currentKit ?? ''} onChange={e => applyKit(e.target.value)} style={selStyle} title="Drum kit — the sounds this beat uses">
            {!currentKit && <option value="">{isDrum ? 'Custom' : 'Pick a kit…'}</option>}
            <optgroup label="Kits">
              {kits.filter(k => k.builtIn).map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </optgroup>
            {userKits.length > 0 && (
              <optgroup label="Yours">
                {userKits.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
              </optgroup>
            )}
          </select>
          <button onClick={saveKit} disabled={!isDrum} style={{ ...miniBtn, width: 'auto', padding: '0 6px', opacity: isDrum ? 1 : 0.4 }} title="Save the current sounds as a kit">＋</button>
          {userKitSelected && <button onClick={delKit} style={{ ...miniBtn, width: 'auto', padding: '0 6px' }} title="Delete this saved kit">🗑</button>}
        </label>

        {/* Pattern */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: 'var(--text-muted)' }}>
          PATTERN
          <select value={patternSel} onChange={e => { if (e.target.value) applyPattern(e.target.value); else setPatternSel('') }} style={selStyle} title="Drop in a groove (replaces the current hits)">
            <option value="">Choose…</option>
            <optgroup label="Patterns">
              {patterns.filter(p => p.builtIn).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
            {userPatterns.length > 0 && (
              <optgroup label="Yours">
                {userPatterns.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            )}
          </select>
          <button onClick={savePattern} style={{ ...miniBtn, width: 'auto', padding: '0 6px' }} title="Save the current hits as a pattern">＋</button>
          {userPatternSelected && <button onClick={delPattern} style={{ ...miniBtn, width: 'auto', padding: '0 6px' }} title="Delete this saved pattern">🗑</button>}
        </label>

        {/* Bars */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--text-muted)' }}>
          BARS
          <button onClick={() => setBars(bars - 1)} disabled={bars <= 1} style={{ ...miniBtn, opacity: bars <= 1 ? 0.4 : 1 }} title="Remove a bar">−</button>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', minWidth: 14, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{bars}</span>
          <button onClick={() => setBars(bars + 1)} disabled={bars >= 16} style={{ ...miniBtn, opacity: bars >= 16 ? 0.4 : 1 }} title="Add a bar">+</button>
        </div>

        <button onClick={() => { if (clip.notes.length) dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes: [] } }) }} style={{ ...selStyle, color: 'var(--text-secondary)' }} title="Clear all hits">Clear</button>
        <button onClick={() => { setExpandedStepSeqClipId(null); setExpandedPianoRollClipId(clip.id) }} style={{ ...miniBtn, width: 'auto', padding: '0 8px', fontSize: 9 }} title="Open this beat in the piano roll for velocity, note lengths, and ghost notes">⇢ Roll</button>
        <button onClick={() => setTall(t => !t)} style={{ ...miniBtn, width: 'auto', padding: '0 8px' }} title="Taller rows">{tall ? '▤' : '▥'}</button>
        <button onClick={() => setExpandedStepSeqClipId(null)} style={{ ...miniBtn, width: 'auto', padding: '0 8px' }} title="Close">✕</button>
      </div>

      {!isDrum && (
        <div style={{ padding: '6px 12px', fontSize: 10, color: '#f59e0b' }}>
          This track isn’t a drum kit yet — pick a KIT above so the hits sound like drums.
        </div>
      )}

      {/* Grid */}
      <div ref={scrollRef} style={{ overflowX: 'auto', overflowY: 'hidden', padding: '10px 12px', maxHeight: tall ? 420 : 300 }}>
        <div style={{ display: 'inline-block', minWidth: '100%' }}>
          {/* Step numbers */}
          <div style={{ display: 'grid', gridTemplateColumns: `92px repeat(${steps}, minmax(20px, 1fr))`, gap: 3, marginBottom: 3 }}>
            <span />
            {Array.from({ length: steps }, (_, s) => (
              <span key={`h${s}`} style={{ fontSize: 8, textAlign: 'center', color: s === playStep ? 'var(--accent-light)' : s % 4 === 0 ? 'var(--text-secondary)' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {s % stepsPerBar === 0 ? `${s / stepsPerBar + 1}` : s % 4 === 0 ? '·' : ''}
              </span>
            ))}
          </div>
          {DRUM_LANES.map(lane => (
            <div key={lane.key} style={{ display: 'grid', gridTemplateColumns: `92px repeat(${steps}, minmax(20px, 1fr))`, gap: 3, marginBottom: 3, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}
                onClick={() => audition(lane.pitch)} title={`Preview ${lane.label}`}>{lane.label}</span>
              {Array.from({ length: steps }, (_, s) => {
                const hit = noteAt(lane.pitch, s)
                const downbeat = s % 4 === 0
                const barStart = s % stepsPerBar === 0
                const now = s === playStep
                return (
                  <button
                    key={s}
                    onClick={() => toggle(lane.pitch, s)}
                    style={{
                      height: tall ? 30 : 22, borderRadius: 4, cursor: 'pointer', padding: 0,
                      borderLeft: barStart ? '2px solid var(--border-light)' : undefined,
                      border: hit ? '1px solid rgba(248,113,113,0.85)' : downbeat ? '1px solid #333' : '1px solid #262626',
                      background: hit
                        ? (now ? 'rgba(248,113,113,1)' : 'rgba(220,38,38,0.72)')
                        : now ? 'rgba(124,58,237,0.28)' : downbeat ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <p style={{ fontSize: 9.5, color: 'var(--text-muted)', margin: 0, padding: '0 12px 10px', lineHeight: 1.5 }}>
        Click a cell to place a hit — it plays through the current kit and loops with the clip. Open the Piano Roll for free placement, velocity, and note lengths on the same clip.
      </p>
    </div>
  )
}
