'use client'

// Reference-track A/B: load a commercial track and instantly flip between it
// and your mix at a matched level, to compare tone and loudness while you mix.
// The reference plays straight to the output (bypassing your master chain, so
// you hear it raw), and switching to REF mutes the mix. Session-only — the
// reference file is never saved with the project.

import { useEffect, useRef, useState } from 'react'
import Knob from './Knob'
import { createPortal } from 'react-dom'
import { Headphones, X, Upload } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'

export default function ReferenceAB() {
  const { engine, project } = useDaw()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [ab, setAb] = useState<'mix' | 'ref'>('mix')
  const [level, setLevel] = useState(0.85)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const bufferRef = useRef<AudioBuffer | null>(null)
  const srcRef = useRef<AudioBufferSourceNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Always stop the reference and restore the mix on unmount.
  useEffect(() => () => hardStop(), []) // eslint-disable-line react-hooks/exhaustive-deps

  function hardStop() {
    try { srcRef.current?.stop() } catch { /* already stopped */ }
    srcRef.current?.disconnect(); srcRef.current = null
    gainRef.current?.disconnect(); gainRef.current = null
    engine.setMasterVolume(project.masterVolume) // unmute the mix
  }

  async function loadFile(file: File | undefined) {
    if (!file) return
    setLoading(true); setErr('')
    try {
      const buf = await engine.ctx.decodeAudioData(await file.arrayBuffer())
      bufferRef.current = buf
      setName(file.name.replace(/\.[^.]+$/, ''))
      if (ab === 'ref') toRef() // reloading while comparing → play the new one
    } catch { setErr("Couldn't read that audio file") } finally { setLoading(false) }
  }

  function toRef() {
    if (!bufferRef.current) return
    try { srcRef.current?.stop() } catch { /* none */ }
    const g = engine.ctx.createGain(); g.gain.value = level
    const s = engine.ctx.createBufferSource(); s.buffer = bufferRef.current; s.loop = true
    s.connect(g); g.connect(engine.ctx.destination)
    void engine.ctx.resume(); s.start()
    srcRef.current = s; gainRef.current = g
    engine.setMasterVolume(0) // mute the mix while the reference plays
    setAb('ref')
  }

  function toMix() {
    try { srcRef.current?.stop() } catch { /* none */ }
    srcRef.current?.disconnect(); srcRef.current = null
    gainRef.current?.disconnect(); gainRef.current = null
    engine.setMasterVolume(project.masterVolume)
    setAb('mix')
  }

  function setRefLevel(v: number) {
    setLevel(v)
    if (gainRef.current) gainRef.current.gain.value = v
  }

  function close() { toMix(); setOpen(false) }

  const btn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
    fontSize: 8, fontWeight: 700, letterSpacing: '0.04em', padding: '2px 5px',
    borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)',
    background: ab === 'ref' ? 'rgba(245,158,11,0.2)' : 'var(--bg-surface)',
    color: ab === 'ref' ? '#f59e0b' : 'var(--text-muted)', whiteSpace: 'nowrap',
  }

  return (
    <>
      <button onClick={() => setOpen(true)} title="Reference A/B — compare your mix to a reference track" style={btn}>
        <Headphones size={9} /> REF
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div onClick={close} className="backdrop-in" style={{ position: 'fixed', inset: 0, zIndex: 9600, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} className="modal-in" style={{ width: 340, maxWidth: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Headphones size={15} color="#f59e0b" />
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>Reference A/B</span>
              <button onClick={close} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 4 }}><X size={16} /></button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
              Load a track you love and flip A/B against your mix. Match the level, then trust your ears — is your low end, brightness, and loudness in the same ballpark?
            </p>

            <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => void loadFile(e.target.files?.[0])} />
            <button onClick={() => fileRef.current?.click()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', fontSize: 12, fontWeight: 700, padding: '9px 0', borderRadius: 9, cursor: 'pointer', border: '1px dashed var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)' }}>
              <Upload size={13} /> {loading ? 'Reading…' : name ? `Reference: ${name}` : 'Load a reference track'}
            </button>
            {err && <p style={{ fontSize: 11, color: '#ef4444', margin: '8px 0 0' }}>{err}</p>}

            {/* A/B switch */}
            <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
              <button onClick={toMix} style={{ flex: 1, fontSize: 13, fontWeight: 800, padding: '10px 0', borderRadius: 9, cursor: 'pointer', border: `1px solid ${ab === 'mix' ? 'var(--accent)' : 'var(--border)'}`, background: ab === 'mix' ? 'rgb(var(--accent-rgb) / 0.18)' : 'var(--bg-base)', color: ab === 'mix' ? 'var(--accent)' : 'var(--text-muted)' }}>
                A · Your mix
              </button>
              <button onClick={toRef} disabled={!name} style={{ flex: 1, fontSize: 13, fontWeight: 800, padding: '10px 0', borderRadius: 9, cursor: name ? 'pointer' : 'default', border: `1px solid ${ab === 'ref' ? '#f59e0b' : 'var(--border)'}`, background: ab === 'ref' ? 'rgba(245,158,11,0.18)' : 'var(--bg-base)', color: !name ? 'var(--text-muted)' : ab === 'ref' ? '#f59e0b' : 'var(--text-secondary)', opacity: name ? 1 : 0.5 }}>
                B · Reference
              </button>
            </div>

            {/* Level match */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                <span>REFERENCE LEVEL</span><span>{Math.round(level * 100)}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <Knob value={level} min={0} max={1} defaultValue={0.8} size={34} color="#f59e0b"
                  onChange={setRefLevel} format={v => `${Math.round(v * 100)}%`} />
              </div>
            </div>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '12px 0 0', lineHeight: 1.5 }}>
              The reference plays raw (past your master FX). Closing this returns to your mix. It isn&rsquo;t saved with the project.
            </p>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
