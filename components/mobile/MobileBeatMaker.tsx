'use client'

// Mobile beat maker — the first surface of the condensed mobile studio.
// Self-contained and touch-first: it plays through the SAME drum kits and
// audio primitives as the desktop step sequencer (DRUM_KITS / playInstrumentNote),
// so a beat made here sounds identical. It keeps its own local grid for now;
// mapping the grid to a DawProject drum clip for save/sync is the next step.

import { useCallback, useEffect, useRef, useState } from 'react'
import { DRUM_LANES, DRUM_KITS, STEPS_PER_BAR } from '@/lib/drum-presets'
import { playInstrumentNote, preloadDrumInstrument } from '@/lib/daw-instruments'
import type { TrackInstrument } from '@/lib/daw-types'
import { useUser } from '@clerk/nextjs'
import { buildBeatProject, beatToCfProj } from '@/lib/mobile-beat'

// Kick at the bottom, like a drum machine. A compact, mobile-friendly lane set.
const LANES = ['kick', 'snare', 'clap', 'closedHat', 'openHat', 'rim', 'tomLo', 'crash']
  .map(k => DRUM_LANES.find(l => l.key === k)!)
  .filter(Boolean)
const STEPS = STEPS_PER_BAR // 16

// A starter groove so hitting Play immediately makes a beat.
const SEED: Record<string, number[]> = {
  kick: [0, 6, 8, 14], snare: [4, 12], closedHat: [0, 2, 4, 6, 8, 10, 12, 14], clap: [4, 12],
}

export default function MobileBeatMaker() {
  const [kitId, setKitId] = useState('boombap')
  const [bpm, setBpm] = useState(90)
  const [playing, setPlaying] = useState(false)
  const [step, setStep] = useState(-1)
  const [grid, setGrid] = useState<boolean[][]>(() =>
    LANES.map(l => Array.from({ length: STEPS }, (_, s) => (SEED[l.key] ?? []).includes(s))))

  const ctxRef = useRef<AudioContext | null>(null)
  const instRef = useRef<TrackInstrument | null>(null)
  const gridRef = useRef(grid); gridRef.current = grid
  const bpmRef = useRef(bpm); bpmRef.current = bpm
  const kitIdRef = useRef(kitId); kitIdRef.current = kitId
  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const nextTimeRef = useRef(0)
  const stepRef = useRef(0)
  const drawQueue = useRef<{ step: number; time: number }[]>([])

  const { isSignedIn } = useUser()
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)

  const postProject = useCallback(async (cf: unknown) => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cf) })
    if (!res.ok) { let m = 'Could not save.'; try { const b = await res.json(); if (b?.error) m = b.error } catch { /* ignore */ } throw new Error(m) }
    return (cf as { id: string }).id
  }, [])

  // Sign in to keep a beat. Guests stash it and sign up; on return it saves.
  const saveBeat = useCallback(async () => {
    const cf = beatToCfProj(buildBeatProject(gridRef.current, LANES.map(l => l.pitch), kitIdRef.current, bpmRef.current))
    if (!isSignedIn) {
      try { localStorage.setItem('100lights-mobile-beat', JSON.stringify(cf)) } catch { /* ok */ }
      window.location.assign('/sign-up?redirect_url=' + encodeURIComponent('/m'))
      return
    }
    setSaveState('saving')
    try { setSavedId(await postProject(cf)); setSaveState('saved') }
    catch (e) { setSaveMsg((e as Error).message); setSaveState('error') }
  }, [isSignedIn, postProject])

  useEffect(() => {
    if (!isSignedIn) return
    let raw: string | null = null
    try { raw = localStorage.getItem('100lights-mobile-beat') } catch { /* ok */ }
    if (!raw) return
    try { localStorage.removeItem('100lights-mobile-beat') } catch { /* ok */ }
    setSaveState('saving')
    postProject(JSON.parse(raw)).then(id => { setSavedId(id); setSaveState('saved') }).catch(e => { setSaveMsg(e.message); setSaveState('error') })
  }, [isSignedIn, postProject])

  // Lazily create the AudioContext + load the kit on first interaction (mobile
  // browsers require a user gesture before audio can start).
  const ensureAudio = useCallback(async () => {
    if (!ctxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctxRef.current = new Ctx()
    }
    if (ctxRef.current.state !== 'running') { try { await ctxRef.current.resume() } catch { /* ok */ } }
    if (!instRef.current) loadKit(kitId)
    return ctxRef.current
  }, [kitId])

  const loadKit = useCallback((id: string) => {
    const kit = DRUM_KITS.find(k => k.id === id) ?? DRUM_KITS[0]
    const inst = structuredClone(kit.instrument) as TrackInstrument
    instRef.current = inst
    if (ctxRef.current) preloadDrumInstrument(ctxRef.current, inst)
  }, [])

  useEffect(() => { loadKit(kitId) }, [kitId, loadKit])

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    drawQueue.current = []
    setPlaying(false)
    setStep(-1)
  }, [])

  const start = useCallback(async () => {
    const ctx = await ensureAudio()
    stepRef.current = 0
    nextTimeRef.current = ctx.currentTime + 0.06
    const lookahead = 0.1
    timerRef.current = window.setInterval(() => {
      const c = ctxRef.current!; const inst = instRef.current!
      while (nextTimeRef.current < c.currentTime + lookahead) {
        const s = stepRef.current, when = nextTimeRef.current
        gridRef.current.forEach((row, l) => {
          if (row[s]) { try { playInstrumentNote(c, c.destination, inst, LANES[l].pitch, 112, when, 0.25) } catch { /* ok */ } }
        })
        drawQueue.current.push({ step: s, time: when })
        nextTimeRef.current += (60 / bpmRef.current) / 4  // 16th note
        stepRef.current = (s + 1) % STEPS
      }
    }, 25)
    const tick = () => {
      const c = ctxRef.current
      if (c) { while (drawQueue.current.length && drawQueue.current[0].time <= c.currentTime) setStep(drawQueue.current.shift()!.step) }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    setPlaying(true)
  }, [ensureAudio])

  useEffect(() => () => stop(), [stop])  // cleanup on unmount

  const toggle = (lane: number, s: number) => {
    void ensureAudio()
    setGrid(g => g.map((row, l) => l === lane ? row.map((v, i) => i === s ? !v : v) : row))
  }
  const clear = () => setGrid(LANES.map(() => Array(STEPS).fill(false)))

  const cell = 'min(5.6vw, 30px)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', color: 'var(--text-primary)', overflow: 'hidden' }}>
      {/* Transport */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button onClick={() => (playing ? stop() : void start())} aria-label={playing ? 'Stop' : 'Play'} style={{
          width: 48, height: 48, borderRadius: 24, border: 'none', flexShrink: 0, cursor: 'pointer',
          background: playing ? '#ef4444' : 'var(--accent)', color: '#fff', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{playing ? '■' : '▶'}</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setBpm(b => Math.max(40, b - 5))} style={stepBtn}>−</button>
          <div style={{ textAlign: 'center', minWidth: 58 }}>
            <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{bpm}</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>BPM</div>
          </div>
          <button onClick={() => setBpm(b => Math.min(200, b + 5))} style={stepBtn}>+</button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => void saveBeat()} disabled={saveState === 'saving'} style={{ ...stepBtn, width: 'auto', padding: '0 15px', fontSize: 13, fontWeight: 800, background: 'var(--accent)', color: '#fff', border: 'none' }}>{saveState === 'saving' ? 'Saving…' : 'Save'}</button>
          <button onClick={clear} style={{ ...stepBtn, width: 'auto', padding: '0 11px', fontSize: 12 }}>Clear</button>
        </div>
      </div>

      {/* Kit picker */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 16px', overflowX: 'auto', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        {DRUM_KITS.map(k => (
          <button key={k.id} onClick={() => setKitId(k.id)} style={{
            flexShrink: 0, padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            border: `1px solid ${kitId === k.id ? 'var(--accent)' : 'var(--border)'}`,
            background: kitId === k.id ? 'rgba(139,92,246,0.16)' : 'var(--bg-card)',
            color: kitId === k.id ? 'var(--accent-light)' : 'var(--text-secondary)', whiteSpace: 'nowrap',
          }}>{k.name}</button>
        ))}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {LANES.map((lane, l) => (
            <div key={lane.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 52, flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'right', paddingRight: 2, lineHeight: 1.1 }}>{lane.label}</div>
              <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                {Array.from({ length: STEPS }, (_, s) => {
                  const on = grid[l][s], beat = s % 4 === 0, isNow = playing && step === s
                  return (
                    <button key={s} onClick={() => toggle(l, s)} aria-label={`${lane.label} step ${s + 1}`} style={{
                      flex: 1, height: cell, borderRadius: 5, cursor: 'pointer', padding: 0,
                      marginLeft: beat && s !== 0 ? 3 : 0,
                      border: isNow ? '1px solid var(--accent-light)' : '1px solid ' + (beat ? 'var(--border-light, var(--border))' : 'var(--border)'),
                      background: on
                        ? (isNow ? 'var(--accent-light)' : 'var(--accent)')
                        : (isNow ? 'rgba(139,92,246,0.22)' : beat ? 'var(--bg-card)' : 'var(--bg-base)'),
                      transition: 'background 60ms',
                    }} />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>
          Tap cells to build a beat · pick a kit above · press ▶. Sign in on desktop to keep it and finish the track.
        </p>
      </div>

      {(saveState === 'saved' || saveState === 'error') && (
        <div onClick={() => setSaveState('idle')} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', padding: '24px 22px calc(20px + env(safe-area-inset-bottom))', textAlign: 'center' }}>
            {saveState === 'saved' ? (
              <>
                <div style={{ fontSize: 30, marginBottom: 4 }}>🎉</div>
                <h3 style={{ margin: '0 0 6px', fontSize: 16.5, fontWeight: 800, color: 'var(--text-primary)' }}>Beat saved to your account</h3>
                <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>Open it on a computer to finish the track — it&apos;s waiting in your projects.</p>
                <button onClick={() => { navigator.clipboard?.writeText('https://100lights.com/projects/' + savedId).catch(() => {}); setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 2200) }} style={{ ...bigBtn, background: 'var(--accent)', color: '#fff' }}>{linkCopied ? 'Desktop link copied ✓' : 'Copy the desktop link'}</button>
                <button onClick={() => setSaveState('idle')} style={{ ...bigBtn, background: 'transparent', color: 'var(--text-muted)' }}>Keep making beats</button>
              </>
            ) : (
              <>
                <h3 style={{ margin: '0 0 6px', fontSize: 16.5, fontWeight: 800, color: 'var(--text-primary)' }}>Couldn&apos;t save</h3>
                <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-secondary)' }}>{saveMsg}</p>
                <button onClick={() => setSaveState('idle')} style={{ ...bigBtn, background: 'var(--accent)', color: '#fff' }}>OK</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const bigBtn: React.CSSProperties = {
  display: 'block', width: '100%', padding: 13, borderRadius: 12, fontSize: 14.5, fontWeight: 800,
  border: 'none', cursor: 'pointer', marginTop: 8,
}

const stepBtn: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-card)',
  color: 'var(--text-primary)', fontSize: 18, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}
