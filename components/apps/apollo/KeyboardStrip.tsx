'use client'
// Bottom keyboard: pitch + mod wheels, 3-octave on-screen keys with
// glissando, QWERTY input, octave shift, sustain, velocity.

import React, { useEffect, useRef, useState } from 'react'
import { useApollo, ToggleBtn, UI } from './ApolloContext'

const QWERTY: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ';': 16,
}
const WHITE_SEMIS = [0, 2, 4, 5, 7, 9, 11]
const BLACK_SEMIS: Record<number, number> = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 }

function Wheel({ label, value, onChange, spring }: { label: string; value: number; onChange: (v: number) => void; spring?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef(false)
  const apply = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const t = 1 - (e.clientY - r.top) / r.height
    onChange(spring ? Math.min(1, Math.max(-1, t * 2 - 1)) : Math.min(1, Math.max(0, t)))
  }
  const norm = spring ? (value + 1) / 2 : value
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div
        ref={ref}
        onPointerDown={e => { drag.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); apply(e) }}
        onPointerMove={e => { if (drag.current) apply(e) }}
        onPointerUp={() => { drag.current = false; if (spring) onChange(0) }}
        style={{ width: 22, height: 88, background: UI.inset, border: '1px solid var(--border)', borderRadius: 11, position: 'relative', cursor: 'ns-resize', touchAction: 'none' }}
      >
        <div style={{ position: 'absolute', left: 2, right: 2, height: 8, borderRadius: 4, background: 'var(--accent)', top: `${(1 - norm) * 78}px` }} />
      </div>
      <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

export default function KeyboardStrip() {
  const ctx = useApollo()
  const [octave, setOctave] = useState(4) // C4-based QWERTY origin
  const [velocity, setVelocity] = useState(0.9)
  const [sustain, setSustain] = useState(false)
  const [pitch, setPitch] = useState(0)
  const [mod, setMod] = useState(0)
  const [active, setActive] = useState<Set<number>>(new Set())
  const pointerNote = useRef(-1)
  const downKeys = useRef(new Set<string>())
  const velRef = useRef(velocity)
  velRef.current = velocity
  const octRef = useRef(octave)
  octRef.current = octave

  // highlight from engine (covers seq + arp notes too)
  useEffect(() => {
    const eng = ctx.engine
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { note: number }
      setActive(prev => { const n = new Set(prev); n.add(d.note); return n })
    }
    const off = (e: Event) => {
      const d = (e as CustomEvent).detail as { note: number }
      setActive(prev => { const n = new Set(prev); n.delete(d.note); return n })
    }
    eng.addEventListener('voiceOn', on)
    eng.addEventListener('voiceOff', off)
    return () => { eng.removeEventListener('voiceOn', on); eng.removeEventListener('voiceOff', off) }
  }, [ctx.engine])

  // QWERTY
  useEffect(() => {
    const noteFor = (key: string) => {
      const off = QWERTY[key]
      return off == null ? null : (octRef.current + 1) * 12 + off
    }
    const down = async (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (k === 'z') { setOctave(o => Math.max(0, o - 1)); return }
      if (k === 'x') { setOctave(o => Math.min(7, o + 1)); return }
      if (downKeys.current.has(k)) return
      const note = noteFor(k)
      if (note == null) return
      downKeys.current.add(k)
      e.preventDefault()
      await ctx.start()
      ctx.engine.noteOn(note, velRef.current)
    }
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (!downKeys.current.has(k)) return
      downKeys.current.delete(k)
      const note = noteFor(k)
      if (note != null) ctx.engine.noteOff(note)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [ctx])

  const baseNote = (octave - 1) * 12 + 12 // start display an octave below QWERTY origin
  const numWhite = 22
  const keyDown = async (note: number) => {
    await ctx.start()
    if (pointerNote.current === note) return
    if (pointerNote.current >= 0) ctx.engine.noteOff(pointerNote.current)
    pointerNote.current = note
    ctx.engine.noteOn(note, velRef.current)
  }
  const keyUp = () => {
    if (pointerNote.current >= 0) { ctx.engine.noteOff(pointerNote.current); pointerNote.current = -1 }
  }

  const whites: number[] = []
  for (let wI = 0; wI < numWhite; wI++) {
    const oct = Math.floor(wI / 7)
    whites.push(baseNote + oct * 12 + WHITE_SEMIS[wI % 7])
  }

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 8 }}>
      <Wheel label="PITCH" value={pitch} spring onChange={v => { setPitch(v); ctx.engine.setWheel(v, null) }} />
      <Wheel label="MOD" value={mod} onChange={v => { setMod(v); ctx.engine.setWheel(null, v) }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 3 }}>
          <button style={octBtn} onClick={() => setOctave(o => Math.max(0, o - 1))}>−</button>
          <span style={{ fontSize: 9, color: 'var(--text-secondary)', width: 24, textAlign: 'center' }}>C{octave}</span>
          <button style={octBtn} onClick={() => setOctave(o => Math.min(7, o + 1))}>+</button>
        </div>
        <ToggleBtn on={sustain} label="Sus" onClick={() => { setSustain(!sustain); ctx.engine.sustain(!sustain) }} />
        <input
          type="range" min={0.05} max={1} step={0.01} value={velocity} className="cf-slider" style={{ width: 56 }}
          title={`Velocity ${Math.round(velocity * 127)}`}
          onChange={e => setVelocity(Number(e.target.value))}
        />
      </div>
      {/* keys */}
      <div
        style={{ position: 'relative', flex: 1, height: 96, minWidth: 0, userSelect: 'none' }}
        onPointerUp={keyUp} onPointerLeave={keyUp}
      >
        <div style={{ display: 'flex', height: '100%' }}>
          {whites.map(note => (
            <div
              key={note}
              onPointerDown={e => { (e.currentTarget.parentElement?.parentElement as HTMLElement)?.setPointerCapture?.(e.pointerId); void keyDown(note) }}
              onPointerEnter={e => { if (e.buttons) void keyDown(note) }}
              style={{
                flex: 1, border: '1px solid #222', borderRadius: '0 0 4px 4px',
                background: active.has(note) ? 'var(--accent)' : '#e8e8e8',
                position: 'relative', cursor: 'pointer', touchAction: 'none',
              }}
            >
              {note % 12 === 0 && <span style={{ position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)', fontSize: 7, color: '#555' }}>C{note / 12 - 1}</span>}
            </div>
          ))}
        </div>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', pointerEvents: 'none' }}>
          {whites.map((note, wI) => {
            const semiOff = BLACK_SEMIS[wI % 7]
            const black = semiOff != null ? baseNote + Math.floor(wI / 7) * 12 + semiOff : null
            return (
              <div key={wI} style={{ flex: 1, position: 'relative' }}>
                {black != null && wI < numWhite - 1 && (
                  <div
                    onPointerDown={e => { e.stopPropagation(); void keyDown(black) }}
                    onPointerEnter={e => { if (e.buttons) { e.stopPropagation(); void keyDown(black) } }}
                    style={{
                      position: 'absolute', right: '-30%', top: 0, width: '60%', height: '58%',
                      background: active.has(black) ? 'var(--accent)' : '#16181c',
                      border: '1px solid #000', borderRadius: '0 0 3px 3px', zIndex: 2,
                      pointerEvents: 'auto', cursor: 'pointer', touchAction: 'none',
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
      <button
        title="All notes off"
        onClick={() => ctx.engine.panic()}
        style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 9, cursor: 'pointer' }}
      >PANIC</button>
    </div>
  )
}

const octBtn: React.CSSProperties = {
  background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)',
  borderRadius: 4, width: 18, height: 18, fontSize: 11, cursor: 'pointer', lineHeight: 1, padding: 0,
}
