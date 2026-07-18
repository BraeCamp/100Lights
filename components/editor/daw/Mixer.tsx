'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Circle } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import type { DawTrack, ReturnTrack } from '@/lib/daw-types'
import { TRACK_COLORS } from '@/lib/daw-types'
import LevelMeter from './LevelMeter'
import Knob from './Knob'
import { ReturnDeviceChain } from './DeviceChain'

// ── Vertical fader ─────────────────────────────────────────────────────────

function VerticalFader({ value, onChange, onCommit }: {
  value: number
  onChange: (v: number) => void
  onCommit?: (v: number) => void
}) {
  const trackH = 110
  const thumbH = 16
  const max    = 1.2
  const pos    = (1 - value / max) * (trackH - thumbH)
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null)

  function onMouseDown(e: React.MouseEvent) {
    dragRef.current = { startY: e.clientY, startVal: value }
    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return
      const delta = (dragRef.current.startY - ev.clientY) / (trackH - thumbH) * max
      onChange(Math.max(0, Math.min(max, dragRef.current.startVal + delta)))
    }
    function onUp(ev: MouseEvent) {
      if (!dragRef.current) return
      const delta = (dragRef.current.startY - ev.clientY) / (trackH - thumbH) * max
      onCommit?.(Math.max(0, Math.min(max, dragRef.current.startVal + delta)))
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const db = value > 0.0001 ? (20 * Math.log10(value)).toFixed(1) : '-∞'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <div
        style={{ width: 8, height: trackH, background: 'var(--bg-surface)', borderRadius: 4, position: 'relative', cursor: 'ns-resize', userSelect: 'none' }}
        onMouseDown={onMouseDown}
      >
        <div style={{
          position: 'absolute', left: -3, right: -3,
          top: (1 - 0.8 / max) * (trackH - thumbH) + thumbH / 2,
          height: 1, background: 'rgba(255,255,255,0.15)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', left: -5, top: Math.round(pos),
          width: 18, height: thumbH,
          background: 'linear-gradient(180deg,#555 0%,#3a3a3a 100%)',
          borderRadius: 3, border: '1px solid var(--border-light)', cursor: 'ns-resize',
        }} />
      </div>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', letterSpacing: '0.04em' }}>
        {db}dB
      </span>
    </div>
  )
}

// ── Channel strip ──────────────────────────────────────────────────────────

function ChannelStrip({ track, isMaster }: { track?: DawTrack; isMaster?: boolean }) {
  const { project, dispatch, engine, selectedTrackId, setSelectedTrackId } = useDaw()
  const [eqLo, setEqLo]   = useState(0)
  const [eqMid, setEqMid] = useState(0)
  const [eqHi, setEqHi]   = useState(0)
  const [editing, setEditing]   = useState(false)
  const [nameDraft, setNameDraft] = useState(track?.name ?? 'MASTER')

  // LUFS metering (master only)
  const [lufsValue, setLufsValue] = useState<number | null>(null)
  const lufsBufferRef = useRef<number[]>([])
  const lufsRafRef    = useRef<number>(0)

  // Spectrum analyser canvas (track channels only)
  const specRef    = useRef<HTMLCanvasElement>(null)
  const specRafRef = useRef<number>(0)

  const volume  = isMaster ? project.masterVolume : (track?.volume ?? 0.8)
  const pan     = track?.pan ?? 0
  const muted   = track?.mute ?? false
  const soloed  = track?.solo ?? false
  const armed   = track?.armed ?? false
  const anySolo    = project.tracks.some(t => t.solo)
  const dimmed     = !isMaster && anySolo && !soloed
  const isSelected = !isMaster && track?.id === selectedTrackId
  const color      = track?.color ?? '#3d8fef'
  const typeLabel = track
    ? (track.instrument.type === 'drum' ? 'DR' : track.instrument.type === 'none' ? 'AU' : 'MI')
    : ''
  const panLabel = pan === 0 ? 'C' : pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`

  // Sync mixer EQ UI state from engine when switching to a different track
  useEffect(() => {
    if (!track) return
    const eq = engine.getMixerEq(track.id)
    setEqLo(eq.low)
    setEqMid(eq.mid)
    setEqHi(eq.hi)
  }, [track?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // LUFS metering loop for master strip
  useEffect(() => {
    if (!isMaster) return
    const fftSize = engine.masterAnalyser.fftSize
    const dataArray = new Float32Array(fftSize)

    function measure() {
      engine.masterAnalyser.getFloatTimeDomainData(dataArray)
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i]
      const rms = Math.sqrt(sum / dataArray.length)
      const dbfs = rms > 0.000001 ? 20 * Math.log10(rms) : -100
      const momentary = dbfs - 0.691  // approximate LUFS offset

      lufsBufferRef.current.push(momentary)
      if (lufsBufferRef.current.length > 30) lufsBufferRef.current.shift()

      if (lufsBufferRef.current.length > 0) {
        const avg = lufsBufferRef.current.reduce((a, b) => a + b, 0) / lufsBufferRef.current.length
        setLufsValue(Math.round(avg * 10) / 10)
      }

      lufsRafRef.current = requestAnimationFrame(measure)
    }

    lufsRafRef.current = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(lufsRafRef.current)
  }, [isMaster, engine])

  // Mini spectrum analyzer for regular track strips
  useEffect(() => {
    if (isMaster || !track || !specRef.current) return
    const canvas = specRef.current
    const ctx2 = canvas.getContext('2d')
    if (!ctx2) return
    const analyser = engine.getTrackAnalyser(track.id)
    if (!analyser) return

    const fftData = new Uint8Array(analyser.frequencyBinCount)

    function draw() {
      analyser!.getByteFrequencyData(fftData)
      ctx2!.clearRect(0, 0, canvas.width, canvas.height)
      ctx2!.fillStyle = '#111'
      ctx2!.fillRect(0, 0, canvas.width, canvas.height)

      const barW = canvas.width / 16
      for (let i = 0; i < 16; i++) {
        const idx = Math.floor(i * fftData.length / 32)
        const v = fftData[idx] / 255
        const h = v * canvas.height
        ctx2!.fillStyle = `hsl(${200 + i * 10}, 70%, 50%)`
        ctx2!.fillRect(i * barW, canvas.height - h, barW - 1, h)
      }

      specRafRef.current = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(specRafRef.current)
  }, [track?.id, engine, isMaster]) // eslint-disable-line react-hooks/exhaustive-deps

  // LUFS color coding: blue=quiet, green=good, yellow=hot, red=too loud
  const lufsColor = lufsValue === null ? '#555'
    : lufsValue > -8 ? '#ef4444'
    : lufsValue > -12 ? '#eab308'
    : lufsValue >= -18 ? '#22c55e'
    : '#3b82f6'

  const lufsDisplay = lufsValue === null
    ? '—'
    : lufsValue < -70
      ? '-∞'
      : lufsValue.toFixed(1)

  return (
    <div
      onClick={() => { if (!isMaster && track) setSelectedTrackId(track.id) }}
      style={{
        width: isMaster ? 80 : 72, flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 4, padding: '8px 4px 6px',
        background: isSelected ? 'rgb(var(--accent-rgb) / 0.12)' : isMaster ? '#202020' : '#2a2a2a',
        borderRight: '1px solid var(--border-light)',
        outline: isSelected ? '1px solid rgb(var(--accent-rgb) / 0.5)' : 'none',
        outlineOffset: '-1px',
        opacity: dimmed ? 0.4 : 1, transition: 'background 0.1s, opacity 0.15s',
        position: 'relative', cursor: isMaster ? 'default' : 'pointer',
      }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: '2px 2px 0 0' }} />

      {/* Name */}
      {editing && track ? (
        <input
          autoFocus value={nameDraft}
          onChange={e => setNameDraft(e.target.value)}
          onBlur={() => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: nameDraft } }); setEditing(false) }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Escape') { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: nameDraft } }); setEditing(false) }
            e.stopPropagation()
          }}
          style={{ width: '100%', fontSize: 10, background: 'var(--bg-base)', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, textAlign: 'center', padding: '1px 2px', outline: 'none' }}
        />
      ) : (
        <div
          onDoubleClick={() => { if (track) { setEditing(true); setNameDraft(track.name) } }}
          style={{ fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default', userSelect: 'none', marginTop: 4 }}
          title={track?.name ?? 'MASTER'}
        >
          {track?.name ?? 'MASTER'}
        </div>
      )}

      {/* Mini spectrum analyzer (track channels only, above EQ knobs) */}
      {!isMaster && track && (
        <canvas
          ref={specRef}
          width={64}
          height={28}
          style={{ width: 64, height: 28, borderRadius: 2, display: 'block' }}
        />
      )}

      {/* EQ knobs */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <span style={{ fontSize: 7, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', userSelect: 'none' }}>Mix EQ</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <Knob
            value={eqLo} min={-12} max={12} defaultValue={0} size={20} color="#22c55e" label="LO"
            onChange={v => {
              setEqLo(v)
              if (track) engine.setMixerEq(track.id, v, eqMid, eqHi)
            }}
          />
          <Knob
            value={eqMid} min={-12} max={12} defaultValue={0} size={20} color="#eab308" label="MID"
            onChange={v => {
              setEqMid(v)
              if (track) engine.setMixerEq(track.id, eqLo, v, eqHi)
            }}
          />
          <Knob
            value={eqHi} min={-12} max={12} defaultValue={0} size={20} color="#3b82f6" label="HI"
            onChange={v => {
              setEqHi(v)
              if (track) engine.setMixerEq(track.id, eqLo, eqMid, v)
            }}
          />
        </div>
      </div>

      {/* Pan */}
      {!isMaster && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Knob
            value={pan} min={-1} max={1} defaultValue={0} size={26} color={color}
            onChange={v => { dispatch({ type: 'UPDATE_TRACK', trackId: track!.id, patch: { pan: v } }); engine.setTrackPan(track!.id, v) }}
            format={v => v === 0 ? 'Center' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`}
          />
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{panLabel}</span>
        </div>
      )}

      {/* Mute / Solo */}
      {!isMaster && track && (
        <div style={{ display: 'flex', gap: 2 }}>
          <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !muted } })}
            style={{ width: 24, height: 18, fontSize: 9, borderRadius: 3, border: '1px solid var(--border)', background: muted ? '#d97706' : 'var(--bg-surface)', color: muted ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 700 }}
            title="Mute" data-help-id="mute">M</button>
          <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !soloed } })}
            style={{ width: 24, height: 18, fontSize: 9, borderRadius: 3, border: '1px solid var(--border)', background: soloed ? '#eab308' : 'var(--bg-surface)', color: soloed ? '#000' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 700 }}
            title="Solo" data-help-id="solo">S</button>
        </div>
      )}

      {/* Fader + meter */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, flex: 1 }}>
        <VerticalFader
          value={volume}
          onChange={v => {
            if (isMaster) { dispatch({ type: 'SET_MASTER_VOLUME', volume: v }); engine.setMasterVolume(v) }
            else if (track) { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { volume: v } }); engine.setTrackVolume(track.id, v) }
          }}
        />
        <LevelMeter trackId={isMaster ? undefined : track?.id} width={6} height={110} />
      </div>

      {/* LUFS display (master only) */}
      {isMaster && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, marginTop: 2 }}>
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: lufsColor, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {lufsDisplay}
          </span>
          <span style={{ fontSize: 7, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>LUFS</span>
        </div>
      )}

      {/* Arm */}
      {!isMaster && track && (
        <button
          onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { armed: !armed } })}
          style={{ width: 24, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3, border: '1px solid var(--border)', cursor: 'pointer', background: armed ? 'rgba(239,68,68,0.2)' : 'var(--bg-surface)', color: armed ? '#ef4444' : 'var(--text-muted)' }}
          title="Arm for recording"
        >
          <Circle size={8} fill={armed ? '#ef4444' : 'transparent'} />
        </button>
      )}

      {/* Send levels — one knob per return track */}
      {!isMaster && track && project.returnTracks.length > 0 && (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
          <div style={{ fontSize: 7, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center' }}>Sends</div>
          {project.returnTracks.map((rt, idx) => {
            const sendVal  = track.sendAmounts?.[rt.id] ?? 0
            const sendMode = (track.sendModes?.[rt.id] ?? 'post') as 'pre' | 'post'
            const rtLabel  = String.fromCharCode(65 + idx)
            return (
              <div key={rt.id} style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'center' }}>
                <span style={{ fontSize: 7, color: 'var(--text-muted)', width: 8, textAlign: 'right', flexShrink: 0 }}>{rtLabel}</span>
                <Knob
                  value={sendVal} min={0} max={1} defaultValue={0} size={18} color={rt.color}
                  label={rtLabel}
                  onChange={v => {
                    dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { sendAmounts: { ...(track.sendAmounts ?? {}), [rt.id]: v } } })
                    engine.setSendAmount(track.id, rt.id, v)
                  }}
                  format={v => `${Math.round(v * 100)}%`}
                />
                <button
                  title={`${sendMode === 'pre' ? 'Pre' : 'Post'}-fader send — click to toggle`}
                  onClick={() => {
                    const next = sendMode === 'pre' ? 'post' : 'pre'
                    dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { sendModes: { ...(track.sendModes ?? {}), [rt.id]: next } } })
                    engine.setSendAmount(track.id, rt.id, sendVal)
                  }}
                  style={{ fontSize: 6, padding: '1px 2px', borderRadius: 2, cursor: 'pointer', border: `1px solid ${sendMode === 'pre' ? 'var(--accent)' : 'var(--border)'}`, background: sendMode === 'pre' ? 'rgb(var(--accent-rgb) / 0.18)' : 'var(--bg-surface)', color: sendMode === 'pre' ? 'var(--accent)' : 'var(--text-muted)', lineHeight: 1, flexShrink: 0 }}
                >{sendMode === 'pre' ? 'PRE' : 'PST'}</button>
              </div>
            )
          })}
        </div>
      )}

      {typeLabel && <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', fontFamily: 'monospace' }}>{typeLabel}</span>}
    </div>
  )
}

// ── Return channel strip ────────────────────────────────────────────────────

function ReturnChannelStrip({ rt, idx }: { rt: ReturnTrack; idx: number }) {
  const { dispatch, engine } = useDaw()
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState(rt.name)
  const [showFx, setShowFx] = useState(false)
  const [fxPos, setFxPos] = useState({ bottom: 0, left: 0 })
  const fxBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!showFx) return
    function onMouseDown(e: MouseEvent) {
      const panel = document.getElementById(`return-fx-panel-${rt.id}`)
      if (panel?.contains(e.target as Node)) return
      if (fxBtnRef.current?.contains(e.target as Node)) return
      setShowFx(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [showFx, rt.id])
  const label = String.fromCharCode(65 + idx)
  const db = rt.volume > 0.0001 ? (20 * Math.log10(rt.volume)).toFixed(1) : '-∞'

  return (
    <div style={{
      width: 72, flexShrink: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 4, padding: '8px 4px 6px',
      background: 'rgba(80,40,120,0.25)',
      borderRight: '1px solid var(--border-light)',
      position: 'relative',
    }}>
      {/* Color bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: rt.color, borderRadius: '2px 2px 0 0' }} />

      {/* Return label */}
      <div style={{ fontSize: 8, color: '#a78bfa', fontWeight: 700, letterSpacing: '0.06em', marginTop: 4 }}>{label}</div>

      {/* Name */}
      {editing ? (
        <input
          autoFocus value={nameDraft}
          onChange={e => setNameDraft(e.target.value)}
          onBlur={() => { dispatch({ type: 'UPDATE_RETURN_TRACK', trackId: rt.id, patch: { name: nameDraft } }); setEditing(false) }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Escape') { dispatch({ type: 'UPDATE_RETURN_TRACK', trackId: rt.id, patch: { name: nameDraft } }); setEditing(false) }
            e.stopPropagation()
          }}
          style={{ width: '100%', fontSize: 9, background: 'var(--bg-base)', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, textAlign: 'center', padding: '1px 2px', outline: 'none' }}
        />
      ) : (
        <div
          onDoubleClick={() => { setEditing(true); setNameDraft(rt.name) }}
          style={{ fontSize: 9, color: '#c4b5fd', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default', userSelect: 'none' }}
          title={rt.name}
        >
          {rt.name}
        </div>
      )}

      {/* Volume fader */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: 1, justifyContent: 'flex-end' }}>
        <VerticalFader
          value={rt.volume}
          onChange={v => { dispatch({ type: 'UPDATE_RETURN_TRACK', trackId: rt.id, patch: { volume: v } }); engine.setReturnVolume(rt.id, v) }}
        />
        <span style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{db}dB</span>
      </div>

      {/* Mute / Solo-safe row */}
      <div style={{ display: 'flex', gap: 3 }}>
        <button
          onClick={() => {
            const next = !rt.mute
            dispatch({ type: 'UPDATE_RETURN_TRACK', trackId: rt.id, patch: { mute: next } })
            engine.setReturnVolume(rt.id, next ? 0 : rt.volume)
          }}
          style={{ width: 24, height: 18, fontSize: 9, borderRadius: 3, border: '1px solid var(--border)', background: rt.mute ? '#d97706' : 'var(--bg-surface)', color: rt.mute ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 700 }}
          title="Mute return"
        >M</button>
        <button
          onClick={() => dispatch({ type: 'UPDATE_RETURN_TRACK', trackId: rt.id, patch: { soloSafe: !rt.soloSafe } })}
          style={{ width: 24, height: 18, fontSize: 8, borderRadius: 3, border: `1px solid ${rt.soloSafe ? '#a78bfa' : 'var(--border)'}`, background: rt.soloSafe ? 'rgba(167,139,250,0.18)' : 'var(--bg-surface)', color: rt.soloSafe ? '#a78bfa' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 700 }}
          title="Solo-safe: keep this return audible during track solos"
        >SS</button>
      </div>

      {/* FX toggle */}
      <button
        ref={fxBtnRef}
        onClick={() => {
          if (!showFx && fxBtnRef.current) {
            const r = fxBtnRef.current.getBoundingClientRect()
            setFxPos({ bottom: window.innerHeight - r.top + 4, left: r.left })
          }
          setShowFx(v => !v)
        }}
        style={{
          fontSize: 8, padding: '2px 4px', borderRadius: 3, fontWeight: 700, cursor: 'pointer',
          border: `1px solid ${showFx ? '#a78bfa' : 'var(--border)'}`,
          background: showFx ? 'rgba(167,139,250,0.18)' : 'var(--bg-surface)',
          color: showFx ? '#a78bfa' : rt.effects.length > 0 ? '#a78bfa' : 'var(--text-muted)',
        }}
        title="Show FX chain"
      >{rt.effects.length > 0 ? `FX (${rt.effects.length})` : 'FX'}</button>

      {/* Remove button */}
      <button
        onClick={() => dispatch({ type: 'REMOVE_RETURN_TRACK', trackId: rt.id })}
        style={{ fontSize: 8, width: 20, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
        title="Remove return track"
      >×</button>

      {showFx && createPortal(
        <div
          id={`return-fx-panel-${rt.id}`}
          style={{
            position: 'fixed',
            bottom: fxPos.bottom,
            left: fxPos.left,
            zIndex: 200,
            background: 'var(--bg-surface)',
            border: '1px solid #a78bfa44',
            borderRadius: 6,
            boxShadow: '0 -4px 20px rgba(0,0,0,0.6)',
            minWidth: 220,
          }}
        >
          <div style={{ padding: '5px 8px 3px', fontSize: 9, color: '#a78bfa', fontWeight: 700, letterSpacing: '0.06em', borderBottom: '1px solid var(--border)' }}>
            {rt.name} — FX Chain
          </div>
          <ReturnDeviceChain returnId={rt.id} />
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Mixer ──────────────────────────────────────────────────────────────────

export default function Mixer() {
  const { project, dispatch } = useDaw()

  function addReturnTrack() {
    const idx = project.returnTracks.length
    const rt: ReturnTrack = {
      id: crypto.randomUUID(),
      name: `Return ${String.fromCharCode(65 + idx)}`,
      color: TRACK_COLORS[(idx + 6) % TRACK_COLORS.length],
      volume: 0.8,
      pan: 0,
      mute: false,
      effects: [],
    }
    dispatch({ type: 'ADD_RETURN_TRACK', track: rt })
  }

  return (
    <div data-testid="mixer" style={{ display: 'flex', flex: 1, minHeight: 0, background: 'var(--bg-base)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', overflowX: 'auto', overflowY: 'hidden', flex: 1, alignItems: 'stretch' }}>
        {project.tracks.map(track => (
          <ChannelStrip key={track.id} track={track} />
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 6px', justifyContent: 'flex-end' }}>
          <button
            onClick={() => dispatch({ type: 'ADD_TRACK' })}
            style={{ width: 60, padding: '4px 0', fontSize: 10, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', letterSpacing: '0.03em' }}
          >
            + Track
          </button>
        </div>

        {/* Returns section */}
        {project.returnTracks.length > 0 && (
          <>
            <div style={{ width: 1, background: 'var(--bg-card-hover)', alignSelf: 'stretch', flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: '6px 4px 0', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 7, color: '#7c5fa8', letterSpacing: '0.07em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>RETURNS</span>
            </div>
            {project.returnTracks.map((rt, idx) => (
              <ReturnChannelStrip key={rt.id} rt={rt} idx={idx} />
            ))}
          </>
        )}

        {/* Add return track button */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '8px 6px' }}>
          <button
            onClick={addReturnTrack}
            style={{ width: 60, padding: '4px 0', fontSize: 10, borderRadius: 4, border: '1px solid #7c5fa8', background: 'rgba(80,40,120,0.18)', color: '#a78bfa', cursor: 'pointer', letterSpacing: '0.03em' }}
          >
            + Return
          </button>
        </div>
      </div>
      <div style={{ flexShrink: 0, borderLeft: '2px solid var(--border-light)' }}>
        <ChannelStrip isMaster />
      </div>
    </div>
  )
}
