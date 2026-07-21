'use client'

/**
 * Chord identifier — the inverse of the Chord Teacher. Click notes on the
 * piano and it names the chord, using the same nameChord() the DAW uses.
 */

import { useEffect, useRef, useState } from 'react'
import { nameChord } from '@/lib/chord-analysis'
import { playMelodicNote } from '@/lib/instrument-synth'

const LO = 48 // C3
const HI = 72 // C5
const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12)
const PC = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const noteName = (m: number) => `${PC[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`

let _ctx: AudioContext | null = null
const ctx = () => (_ctx ??= new AudioContext())

export default function ChordIdentifier() {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [flash, setFlash] = useState<Set<number>>(new Set())

  useEffect(() => () => { void _ctx?.close(); _ctx = null }, [])

  function toggle(m: number) {
    playNote(m)
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(m)) n.delete(m); else n.add(m)
      return n
    })
  }

  function playNote(m: number) {
    const c = ctx()
    void c.resume()
    const g = c.createGain(); g.gain.value = 0.85; g.connect(c.destination)
    playMelodicNote(c, 'piano-grand', m, c.currentTime + 0.01, 0.9, g)
    setTimeout(() => g.disconnect(), 1500)
  }

  function playChord() {
    const notes = [...selected].sort((a, b) => a - b)
    if (!notes.length) return
    const c = ctx()
    void c.resume()
    const g = c.createGain(); g.gain.value = 0.7; g.connect(c.destination)
    for (const m of notes) playMelodicNote(c, 'piano-grand', m, c.currentTime + 0.02, 0.9, g)
    setTimeout(() => g.disconnect(), 1800)
    setFlash(new Set(notes))
    setTimeout(() => setFlash(new Set()), 240)
  }

  const notes = [...selected].sort((a, b) => a - b)
  const name = notes.length >= 2 ? nameChord(notes) : null

  const keys = Array.from({ length: HI - LO + 1 }, (_, i) => LO + i)
  const whites = keys.filter(m => !isBlack(m))
  const W = 34, H = 150, BW = 20, BH = 92
  const width = whites.length * W
  const whiteFill = (m: number) => flash.has(m) ? '#34d399' : selected.has(m) ? '#a78bfa' : '#f4f4f8'
  const blackFill = (m: number) => flash.has(m) ? '#10b981' : selected.has(m) ? '#7c3aed' : '#1a1a22'

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: '20px 18px', background: 'var(--bg-card)' }}>
      {/* Readout */}
      <div style={{ textAlign: 'center', minHeight: 64, marginBottom: 16 }}>
        {name ? (
          <>
            <div style={{ fontSize: 40, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>{notes.map(noteName).join(' · ')}</div>
          </>
        ) : (
          <div style={{ fontSize: 15, color: 'var(--text-muted)', paddingTop: 18 }}>
            {notes.length === 1 ? `${noteName(notes[0])} — add more notes to name a chord` : 'Click notes on the piano to build a chord'}
          </div>
        )}
      </div>

      {/* Piano */}
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-base)', padding: 8 }}>
        <svg viewBox={`0 0 ${width} ${H}`} width={width} height={H} style={{ display: 'block', maxWidth: '100%', minWidth: Math.min(width, 340), touchAction: 'manipulation' }} role="group" aria-label="Piano — click notes to identify a chord">
          {whites.map((m, i) => (
            <g key={m}>
              <rect x={i * W} y={0} width={W - 1} height={H} rx={4} fill={whiteFill(m)} stroke="#3a3a44" strokeWidth={0.5}
                style={{ cursor: 'pointer' }} onPointerDown={e => { e.preventDefault(); toggle(m) }}>
                <title>{noteName(m)}</title>
              </rect>
              {m % 12 === 0 && (
                <text x={i * W + (W - 1) / 2} y={H - 8} textAnchor="middle" fontSize={9} fill={selected.has(m) || flash.has(m) ? '#2a1a4a' : '#8a8a9a'} fontWeight={700} style={{ pointerEvents: 'none' }}>{noteName(m)}</text>
              )}
            </g>
          ))}
          {keys.filter(isBlack).map(m => {
            const whiteIndex = whites.filter(w => w < m).length
            return <rect key={m} x={whiteIndex * W - BW / 2} y={0} width={BW} height={BH} rx={3}
              fill={blackFill(m)} stroke="#000" strokeWidth={0.5}
              style={{ cursor: 'pointer' }} onPointerDown={e => { e.preventDefault(); toggle(m) }} />
          })}
        </svg>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
        <button onClick={playChord} disabled={notes.length < 2} style={{
          padding: '8px 18px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 700, cursor: notes.length >= 2 ? 'pointer' : 'not-allowed',
          background: 'var(--accent)', color: '#fff', opacity: notes.length >= 2 ? 1 : 0.4,
        }}>▶ Play chord</button>
        <button onClick={() => setSelected(new Set())} disabled={!notes.length} style={{
          padding: '8px 16px', borderRadius: 9, border: '1px solid var(--border)', fontSize: 13, fontWeight: 700, cursor: notes.length ? 'pointer' : 'default',
          background: 'transparent', color: 'var(--text-secondary)', opacity: notes.length ? 1 : 0.4,
        }}>Clear</button>
      </div>
    </div>
  )
}
