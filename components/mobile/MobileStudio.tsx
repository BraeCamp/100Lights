'use client'

// Condensed mobile studio — multi-track production, simplified for a phone.
// The main view is a stack of looping tracks (layer them into a song); tapping a
// track opens a contextual editor (Beat / Sounds / Mix). All tracks play
// together and save as one project that opens on desktop. (Firefly owns the
// dedicated MIDI/beat niche; this is the full-production surface.)
// Phase-1 track type is drums; loop / instrument tracks + a note editor are next.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'
import { DRUM_LANES, DRUM_KITS, STEPS_PER_BAR } from '@/lib/drum-presets'
import { playInstrumentNote, preloadDrumInstrument } from '@/lib/daw-instruments'
import type { TrackInstrument } from '@/lib/daw-types'
import { buildMultiTrackProject, beatToCfProj, type MobileTrack } from '@/lib/mobile-beat'

const LANES = ['kick', 'snare', 'clap', 'closedHat', 'openHat', 'rim', 'tomLo', 'crash']
  .map(k => DRUM_LANES.find(l => l.key === k)!).filter(Boolean)
const STEPS = STEPS_PER_BAR
const PITCHES = LANES.map(l => l.pitch)
const ADD_KITS = ['studio', 'trap808', 'house', 'disco', 'techno', 'lofi']
const uid = () => crypto.randomUUID()
const emptyGrid = () => LANES.map(() => Array<boolean>(STEPS).fill(false))
function seededGrid() {
  const g = emptyGrid()
  const put = (key: string, steps: number[]) => { const li = LANES.findIndex(l => l.key === key); if (li >= 0) steps.forEach(s => (g[li][s] = true)) }
  put('kick', [0, 4, 8, 12]); put('snare', [4, 12]); put('closedHat', [0, 2, 4, 6, 8, 10, 12, 14])
  return g
}

export default function MobileStudio() {
  const { isSignedIn } = useUser()
  const [tracks, setTracks] = useState<MobileTrack[]>(() => [{ id: uid(), name: 'Drums', kind: 'drum', kitId: 'boombap', grid: seededGrid(), volume: 0.85, muted: false }])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'beat' | 'sounds' | 'mix'>('beat')
  const [bpm, setBpm] = useState(90)
  const [playing, setPlaying] = useState(false)
  const [step, setStep] = useState(-1)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)

  const ctxRef = useRef<AudioContext | null>(null)
  const instCache = useRef<Map<string, TrackInstrument>>(new Map())
  const tracksRef = useRef(tracks); tracksRef.current = tracks
  const bpmRef = useRef(bpm); bpmRef.current = bpm
  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const nextTimeRef = useRef(0)
  const stepRef = useRef(0)
  const drawQueue = useRef<{ step: number; time: number }[]>([])

  const ensureAudio = useCallback(async () => {
    if (!ctxRef.current) {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctxRef.current = new C()
    }
    if (ctxRef.current.state !== 'running') { try { await ctxRef.current.resume() } catch { /* ok */ } }
    return ctxRef.current
  }, [])

  const getInst = useCallback((kitId: string) => {
    let inst = instCache.current.get(kitId)
    if (!inst) {
      const kit = DRUM_KITS.find(k => k.id === kitId) ?? DRUM_KITS[0]
      inst = structuredClone(kit.instrument) as TrackInstrument
      if (ctxRef.current) preloadDrumInstrument(ctxRef.current, inst)
      instCache.current.set(kitId, inst)
    }
    return inst
  }, [])

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    drawQueue.current = []; setPlaying(false); setStep(-1)
  }, [])

  const start = useCallback(async () => {
    const ctx = await ensureAudio()
    tracksRef.current.forEach(t => getInst(t.kitId))
    stepRef.current = 0; nextTimeRef.current = ctx.currentTime + 0.06
    timerRef.current = window.setInterval(() => {
      const c = ctxRef.current!
      while (nextTimeRef.current < c.currentTime + 0.1) {
        const s = stepRef.current, when = nextTimeRef.current
        tracksRef.current.forEach(t => {
          if (t.muted) return
          t.grid.forEach((row, l) => { if (row[s]) { try { playInstrumentNote(c, c.destination, getInst(t.kitId), PITCHES[l], Math.round(112 * t.volume), when, 0.25) } catch { /* ok */ } } })
        })
        drawQueue.current.push({ step: s, time: when })
        nextTimeRef.current += (60 / bpmRef.current) / 4
        stepRef.current = (s + 1) % STEPS
      }
    }, 25)
    const tick = () => {
      const c = ctxRef.current
      if (c) { while (drawQueue.current.length && drawQueue.current[0].time <= c.currentTime) setStep(drawQueue.current.shift()!.step) }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick); setPlaying(true)
  }, [ensureAudio, getInst])

  useEffect(() => () => stop(), [stop])

  const patch = (id: string, p: Partial<MobileTrack>) => setTracks(ts => ts.map(t => t.id === id ? { ...t, ...p } : t))
  const toggleCell = (id: string, lane: number, s: number) => { void ensureAudio(); setTracks(ts => ts.map(t => t.id !== id ? t : { ...t, grid: t.grid.map((row, l) => l === lane ? row.map((v, i) => i === s ? !v : v) : row) })) }
  const addTrack = () => {
    const t: MobileTrack = { id: uid(), name: `Track ${tracks.length + 1}`, kind: 'drum', kitId: ADD_KITS[(tracks.length) % ADD_KITS.length], grid: emptyGrid(), volume: 0.85, muted: false }
    setTracks(ts => [...ts, t]); setSelectedId(t.id); setTab('beat')
  }
  const deleteTrack = (id: string) => { setTracks(ts => ts.filter(t => t.id !== id)); setSelectedId(null) }

  const postProject = useCallback(async (cf: unknown) => {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cf) })
    if (!res.ok) { let m = 'Could not save.'; try { const b = await res.json(); if (b?.error) m = b.error } catch { /* ignore */ } throw new Error(m) }
    return (cf as { id: string }).id
  }, [])
  const saveProject = useCallback(async () => {
    const cf = beatToCfProj(buildMultiTrackProject(tracksRef.current, PITCHES, bpmRef.current))
    if (!isSignedIn) {
      try { localStorage.setItem('100lights-mobile-beat', JSON.stringify(cf)) } catch { /* ok */ }
      window.location.assign('/sign-up?redirect_url=' + encodeURIComponent('/m')); return
    }
    setSaveState('saving')
    try { setSavedId(await postProject(cf)); setSaveState('saved') } catch (e) { setSaveMsg((e as Error).message); setSaveState('error') }
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

  const selected = tracks.find(t => t.id === selectedId) ?? null
  const cell = 'min(5.4vw, 28px)'

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 16px', paddingTop: 'calc(11px + env(safe-area-inset-top))', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--accent)', flexShrink: 0 }} />
        <strong style={{ fontSize: 14 }}>100Lights</strong>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>· Studio</span>
        <Link href="/" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>Full studio ↗</Link>
      </header>

      {/* Transport */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button onClick={() => (playing ? stop() : void start())} aria-label={playing ? 'Stop' : 'Play'} style={{ width: 46, height: 46, borderRadius: 23, border: 'none', flexShrink: 0, cursor: 'pointer', background: playing ? '#ef4444' : 'var(--accent)', color: '#fff', fontSize: 19 }}>{playing ? '■' : '▶'}</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <button onClick={() => setBpm(b => Math.max(40, b - 5))} style={sBtn}>−</button>
          <div style={{ textAlign: 'center', minWidth: 52 }}><div style={{ fontSize: 19, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{bpm}</div><div style={{ fontSize: 9, color: 'var(--text-muted)' }}>BPM</div></div>
          <button onClick={() => setBpm(b => Math.min(200, b + 5))} style={sBtn}>+</button>
        </div>
        <button onClick={() => void saveProject()} disabled={saveState === 'saving'} style={{ ...sBtn, marginLeft: 'auto', width: 'auto', padding: '0 16px', fontSize: 13, fontWeight: 800, background: 'var(--accent)', color: '#fff', border: 'none' }}>{saveState === 'saving' ? 'Saving…' : 'Save'}</button>
      </div>

      {/* Track list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tracks.map(t => {
            const hits = Array.from({ length: STEPS }, (_, s) => t.grid.some(row => row[s]))
            return (
              <button key={t.id} onClick={() => { setSelectedId(t.id); setTab('beat') }} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 12, textAlign: 'left', cursor: 'pointer',
                border: '1px solid var(--border)', background: 'var(--bg-card)', width: '100%',
              }}>
                <span onClick={e => { e.stopPropagation(); patch(t.id, { muted: !t.muted }) }} style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, border: '1px solid var(--border)', background: t.muted ? 'transparent' : 'rgba(139,92,246,0.16)', color: t.muted ? 'var(--text-muted)' : 'var(--accent-light)' }}>{t.muted ? 'M' : 'M'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: t.muted ? 'var(--text-muted)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                  <div style={{ display: 'flex', gap: 1.5, marginTop: 5 }}>
                    {hits.map((on, s) => (
                      <span key={s} style={{ flex: 1, height: 8, borderRadius: 2, marginLeft: s % 4 === 0 && s !== 0 ? 2.5 : 0, background: on ? (playing && step === s ? 'var(--accent-light)' : 'var(--accent)') : (playing && step === s ? 'rgba(139,92,246,0.25)' : 'var(--bg-base)'), opacity: t.muted ? 0.4 : 1 }} />
                    ))}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{DRUM_KITS.find(k => k.id === t.kitId)?.name ?? ''} ›</span>
              </button>
            )
          })}
          <button onClick={addTrack} style={{ padding: '13px', borderRadius: 12, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--accent-light)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>+ Add a track</button>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>Layer looping tracks · tap a track to edit it · press ▶. Save to finish on a computer.</p>
      </div>

      {/* Track editor sheet */}
      {selected && (
        <div onClick={() => setSelectedId(null)} style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '82vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 10px' }}>
              <strong style={{ fontSize: 15, flex: 1 }}>{selected.name}</strong>
              <button onClick={() => setSelectedId(null)} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: 'flex', gap: 6, padding: '0 16px 10px', borderBottom: '1px solid var(--border)' }}>
              {(['beat', 'sounds', 'mix'] as const).map(tb => (
                <button key={tb} onClick={() => setTab(tb)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize', border: `1px solid ${tab === tb ? 'var(--accent)' : 'var(--border)'}`, background: tab === tb ? 'rgba(139,92,246,0.14)' : 'transparent', color: tab === tb ? 'var(--accent-light)' : 'var(--text-secondary)' }}>{tb}</button>
              ))}
            </div>
            <div style={{ overflowY: 'auto', padding: '14px 14px 20px' }}>
              {tab === 'beat' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {LANES.map((lane, l) => (
                    <div key={lane.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 50, flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'right' }}>{lane.label}</div>
                      <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                        {Array.from({ length: STEPS }, (_, s) => {
                          const on = selected.grid[l][s], beat = s % 4 === 0, now = playing && step === s
                          return <button key={s} onClick={() => toggleCell(selected.id, l, s)} aria-label={`${lane.label} step ${s + 1}`} style={{ flex: 1, height: cell, borderRadius: 5, padding: 0, cursor: 'pointer', marginLeft: beat && s !== 0 ? 3 : 0, border: `1px solid ${now ? 'var(--accent-light)' : 'var(--border)'}`, background: on ? (now ? 'var(--accent-light)' : 'var(--accent)') : (now ? 'rgba(139,92,246,0.22)' : beat ? 'var(--bg-card)' : 'var(--bg-base)') }} />
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {tab === 'sounds' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {DRUM_KITS.map(k => (
                    <button key={k.id} onClick={() => patch(selected.id, { kitId: k.id })} style={{ padding: '9px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: `1px solid ${selected.kitId === k.id ? 'var(--accent)' : 'var(--border)'}`, background: selected.kitId === k.id ? 'rgba(139,92,246,0.16)' : 'var(--bg-card)', color: selected.kitId === k.id ? 'var(--accent-light)' : 'var(--text-secondary)' }}>{k.name}</button>
                  ))}
                  <p style={{ width: '100%', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>Loop, recorded-audio, and instrument tracks are coming next.</p>
                </div>
              )}
              {tab === 'mix' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '6px 4px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)' }}>Volume {Math.round(selected.volume * 100)}%</span>
                    <input type="range" min={0} max={100} value={Math.round(selected.volume * 100)} onChange={e => patch(selected.id, { volume: Number(e.target.value) / 100 })} style={{ width: '100%', accentColor: '#8b5cf6' }} />
                  </label>
                  <button onClick={() => patch(selected.id, { muted: !selected.muted })} style={{ padding: '11px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: selected.muted ? 'rgba(139,92,246,0.14)' : 'var(--bg-card)', color: selected.muted ? 'var(--accent-light)' : 'var(--text-secondary)' }}>{selected.muted ? 'Muted — tap to unmute' : 'Mute this track'}</button>
                  {tracks.length > 1 && <button onClick={() => deleteTrack(selected.id)} style={{ padding: '11px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(239,68,68,0.4)', background: 'transparent', color: '#ef4444' }}>Delete track</button>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Save result sheet */}
      {(saveState === 'saved' || saveState === 'error') && (
        <div onClick={() => setSaveState('idle')} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', padding: '24px 22px calc(20px + env(safe-area-inset-bottom))', textAlign: 'center' }}>
            {saveState === 'saved' ? (
              <>
                <div style={{ fontSize: 30, marginBottom: 4 }}>🎉</div>
                <h3 style={{ margin: '0 0 6px', fontSize: 16.5, fontWeight: 800 }}>Saved to your account</h3>
                <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>Open it on a computer to finish the track — it&apos;s in your projects.</p>
                <button onClick={() => { navigator.clipboard?.writeText('https://100lights.com/projects/' + savedId).catch(() => {}); setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 2200) }} style={{ ...bigBtn, background: 'var(--accent)', color: '#fff' }}>{linkCopied ? 'Desktop link copied ✓' : 'Copy the desktop link'}</button>
                <button onClick={() => setSaveState('idle')} style={{ ...bigBtn, background: 'transparent', color: 'var(--text-muted)' }}>Keep going</button>
              </>
            ) : (
              <>
                <h3 style={{ margin: '0 0 6px', fontSize: 16.5, fontWeight: 800 }}>Couldn&apos;t save</h3>
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

const sBtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 17, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const bigBtn: React.CSSProperties = { display: 'block', width: '100%', padding: 13, borderRadius: 12, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: 'pointer', marginTop: 8 }
