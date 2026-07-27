'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Circle } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import { useIsMobile } from '@/lib/use-is-mobile'
import type { DawTrack, ReturnTrack } from '@/lib/daw-types'
import { TRACK_COLORS } from '@/lib/daw-types'
import LevelMeter from './LevelMeter'
import ReferenceAB from './ReferenceAB'
import Knob from './Knob'
import { ReturnDeviceChain } from './DeviceChain'

// ── Vertical fader ─────────────────────────────────────────────────────────

function VerticalFader({ value, onChange, onCommit, color = 'var(--accent)' }: {
  value: number
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  color?: string
}) {
  const isMobile = useIsMobile()
  const trackH = 110
  const thumbH = 16
  const trackW = isMobile ? 20 : 8   // wider bar = easier thumb grab on a phone
  const thumbW = isMobile ? 30 : 18
  const max    = 1.2
  const pos    = (1 - value / max) * (trackH - thumbH)
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null)

  // Pointer events cover mouse + touch + pen, so the fader drags on a phone too
  // (the old mouse-only handler is why the master/track volume "didn't work" on
  // mobile). touchAction:'none' keeps the page from scrolling while dragging.
  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, startVal: value }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    const delta = (dragRef.current.startY - e.clientY) / (trackH - thumbH) * max
    onChange(Math.max(0, Math.min(max, dragRef.current.startVal + delta)))
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return
    const delta = (dragRef.current.startY - e.clientY) / (trackH - thumbH) * max
    onCommit?.(Math.max(0, Math.min(max, dragRef.current.startVal + delta)))
    dragRef.current = null
  }

  const db = value > 0.0001 ? (20 * Math.log10(value)).toFixed(1) : '-∞'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <div
        style={{ width: trackW, height: trackH, background: 'var(--bg-surface)', borderRadius: 4, position: 'relative', cursor: 'ns-resize', userSelect: 'none', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Filled level — bright, colored by the track so the fader reads at a glance */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          top: Math.round(pos) + thumbH / 2,
          background: `linear-gradient(180deg, ${color}, color-mix(in srgb, ${color} 70%, #000))`,
          borderRadius: `0 0 ${trackW / 2}px ${trackW / 2}px`, pointerEvents: 'none',
          boxShadow: `0 0 8px color-mix(in srgb, ${color} 55%, transparent)`,
        }} />
        <div style={{
          position: 'absolute', left: -3, right: -3,
          top: (1 - 0.8 / max) * (trackH - thumbH) + thumbH / 2,
          height: 1, background: 'rgba(255,255,255,0.2)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', left: (trackW - thumbW) / 2, top: Math.round(pos),
          width: thumbW, height: thumbH,
          background: 'linear-gradient(180deg,#f2f2f6 0%,#c4c4ce 100%)',
          borderRadius: 3, border: '1px solid #ffffff', cursor: 'ns-resize', pointerEvents: 'none',
          boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
        }} />
      </div>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', letterSpacing: '0.04em' }}>
        {db}dB
      </span>
    </div>
  )
}

// ── Channel strip ──────────────────────────────────────────────────────────

function ChannelStrip({ track, isMaster, onOpenDetail }: { track?: DawTrack; isMaster?: boolean; onOpenDetail?: (id: string) => void }) {
  const { project, dispatch, engine, selectedTrackId, setSelectedTrackId } = useDaw()
  const isMobile = useIsMobile()
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
      onDoubleClick={isMobile && !isMaster && track ? () => onOpenDetail?.(track.id) : undefined}
      style={{
        width: isMobile ? (isMaster ? 104 : 156) : (isMaster ? 80 : 72), flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: isMobile ? 7 : 4, padding: isMobile ? `${isMobile ? 14 : 10}px 8px 10px` : '8px 4px 6px',
        // Mobile mixer is themed + tinted by each track's colour (the old strips
        // were flat grey, clashing with the rest of the new UI).
        background: isMobile
          ? (isMaster ? 'var(--bg-surface)'
            : isSelected ? `color-mix(in srgb, ${color} 26%, var(--bg-card))`
            : `color-mix(in srgb, ${color} 11%, var(--bg-card))`)
          : (isSelected ? 'rgb(var(--accent-rgb) / 0.12)' : isMaster ? '#202020' : '#2a2a2a'),
        borderRight: isMobile ? `1px solid color-mix(in srgb, ${color} 22%, var(--border))` : '1px solid var(--border-light)',
        outline: isSelected ? `1px solid ${isMobile ? `color-mix(in srgb, ${color} 60%, transparent)` : 'rgb(var(--accent-rgb) / 0.5)'}` : 'none',
        outlineOffset: '-1px',
        opacity: dimmed ? 0.4 : 1, transition: 'background 0.1s, opacity 0.15s',
        position: 'relative', cursor: isMaster ? 'default' : 'pointer',
      }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: isMobile ? 5 : 3, background: color, borderRadius: '2px 2px 0 0' }} />

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
          style={{ fontSize: isMobile ? 12 : 10, fontWeight: isMobile ? 700 : 400, color: isMobile && !isMaster ? color : 'var(--text-secondary)', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default', userSelect: 'none', marginTop: 4 }}
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

      {/* Tone EQ knobs (persisted on the track) */}
      {!isMaster && track && (() => {
        const tone = track.tone ?? {}
        const setBand = (band: 'sub' | 'bass' | 'mid' | 'treble', v: number) => {
          const next = { ...tone, [band]: v || undefined }
          dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { tone: next } })
          engine.setTrackTone(track.id, next)
        }
        const BANDS = [
          ['sub', 'SUB', '#8b5cf6'], ['bass', 'BASS', '#22c55e'],
          ['mid', 'MID', '#eab308'], ['treble', 'TREB', '#3b82f6'],
        ] as const
        // On a phone the 20px knobs are near-impossible to control, so the Tone
        // EQ becomes a stack of labelled horizontal sliders (±12 dB each).
        if (isMobile) return (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', userSelect: 'none' }}>Tone EQ</span>
            {BANDS.map(([band, label, c]) => {
              const val = tone[band] ?? 0
              return (
                <div key={band} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 32, fontSize: 9, fontWeight: 700, color: c, flexShrink: 0 }}>{label}</span>
                  <input type="range" min={-12} max={12} step={0.5} value={val}
                    onChange={e => setBand(band, parseFloat(e.target.value))}
                    onDoubleClick={() => setBand(band, 0)}
                    style={{ flex: 1, minWidth: 0, accentColor: c, height: 22 }} />
                  <span style={{ width: 30, fontSize: 9, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)', flexShrink: 0 }}>{val > 0 ? '+' : ''}{val}</span>
                </div>
              )
            })}
          </div>
        )
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 7, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', userSelect: 'none' }}>Tone EQ</span>
            <div style={{ display: 'flex', gap: 2 }}>
              {BANDS.map(([band, label, c]) => (
                <Knob key={band} value={tone[band] ?? 0} min={-12} max={12} defaultValue={0} size={20} color={c} label={label} onChange={v => setBand(band, v)} />
              ))}
            </div>
          </div>
        )
      })()}

      {/* Pan — horizontal slider on mobile (the knob is too fiddly to touch) */}
      {!isMaster && isMobile && track && (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex' }}>
            <span style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>Pan</span>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{panLabel}</span>
          </div>
          <input type="range" min={-1} max={1} step={0.02} value={pan}
            onChange={e => { const v = parseFloat(e.target.value); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { pan: v } }); engine.setTrackPan(track.id, v) }}
            onDoubleClick={() => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { pan: 0 } }); engine.setTrackPan(track.id, 0) }}
            style={{ width: '100%', accentColor: color, height: 22 }} />
        </div>
      )}
      {!isMaster && !isMobile && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Knob
            value={pan} min={-1} max={1} defaultValue={0} size={26} color={color}
            onChange={v => { dispatch({ type: 'UPDATE_TRACK', trackId: track!.id, patch: { pan: v } }); engine.setTrackPan(track!.id, v) }}
            format={v => v === 0 ? 'Center' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`}
          />
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{panLabel}</span>
        </div>
      )}

      {/* Mute / Solo — big touch targets on mobile */}
      {!isMaster && track && (() => {
        const ms: React.CSSProperties = isMobile
          ? { flex: 1, height: 38, fontSize: 14, borderRadius: 9 }
          : { width: 24, height: 18, fontSize: 9, borderRadius: 3 }
        return (
          <div style={{ display: 'flex', gap: isMobile ? 8 : 2, width: isMobile ? '100%' : undefined }}>
            <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !muted } })}
              style={{ ...ms, border: '1px solid var(--border)', background: muted ? '#d97706' : 'var(--bg-surface)', color: muted ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 700 }}
              title="Mute" data-help-id="mute">M</button>
            <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !soloed } })}
              style={{ ...ms, border: '1px solid var(--border)', background: soloed ? '#eab308' : 'var(--bg-surface)', color: soloed ? '#000' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: 700 }}
              title="Solo" data-help-id="solo">S</button>
          </div>
        )
      })()}

      {/* Fader + meter */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, flex: 1 }}>
        <VerticalFader
          value={volume}
          color={isMaster ? 'var(--accent)' : color}
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

      {/* Reference-track A/B (master only) */}
      {isMaster && <div style={{ marginTop: 3 }}><ReferenceAB /></div>}

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
          color={rt.color}
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

// Full-screen channel view — double-tapping a strip on mobile opens this so
// every control is large and thumb-friendly (EQ, pan, volume, sends, effects).
function ChannelDetail({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const { project, dispatch, engine } = useDaw()
  const track = project.tracks.find(t => t.id === trackId)
  if (!track) return null
  const tone = track.tone ?? {}
  const setBand = (band: 'sub' | 'bass' | 'mid' | 'treble', v: number) => {
    const next = { ...tone, [band]: v || undefined }
    dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { tone: next } }); engine.setTrackTone(track.id, next)
  }
  const db = track.volume > 0.0001 ? (20 * Math.log10(track.volume)).toFixed(1) : '-∞'
  const panLabel = track.pan === 0 ? 'Center' : track.pan < 0 ? `L${Math.round(-track.pan * 100)}` : `R${Math.round(track.pan * 100)}`
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 }
  const lab: React.CSSProperties = { width: 46, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0, letterSpacing: '0.04em' }
  const val: React.CSSProperties = { width: 52, fontSize: 11, textAlign: 'right', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }
  const BANDS = [['sub', 'SUB', '#8b5cf6'], ['bass', 'BASS', '#22c55e'], ['mid', 'MID', '#eab308'], ['treble', 'TREB', '#3b82f6']] as const
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 220, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '92vh', overflowY: 'auto', background: 'var(--bg-surface)', borderTop: `3px solid ${track.color ?? 'var(--accent)'}`, borderRadius: '18px 18px 0 0', padding: '16px 18px calc(20px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <strong style={{ fontSize: 17, flex: 1 }}>{track.name}</strong>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 24, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Volume */}
          <div style={row}>
            <span style={lab}>Volume</span>
            <input type="range" min={0} max={1.2} step={0.01} value={track.volume}
              onChange={e => { const v = parseFloat(e.target.value); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { volume: v } }); engine.setTrackVolume(track.id, v) }}
              style={{ flex: 1, minWidth: 0, accentColor: track.color ?? 'var(--accent)', height: 30 }} />
            <span style={val}>{db}dB</span>
          </div>
          {/* Pan */}
          <div style={row}>
            <span style={lab}>Pan</span>
            <input type="range" min={-1} max={1} step={0.02} value={track.pan ?? 0}
              onChange={e => { const v = parseFloat(e.target.value); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { pan: v } }); engine.setTrackPan(track.id, v) }}
              onDoubleClick={() => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { pan: 0 } }); engine.setTrackPan(track.id, 0) }}
              style={{ flex: 1, minWidth: 0, accentColor: track.color ?? 'var(--accent)', height: 30 }} />
            <span style={val}>{panLabel}</span>
          </div>

          {/* Tone EQ */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Tone EQ</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {BANDS.map(([band, label, c]) => {
                const v = tone[band] ?? 0
                return (
                  <div key={band} style={row}>
                    <span style={{ ...lab, color: c }}>{label}</span>
                    <input type="range" min={-12} max={12} step={0.5} value={v}
                      onChange={e => setBand(band, parseFloat(e.target.value))}
                      onDoubleClick={() => setBand(band, 0)}
                      style={{ flex: 1, minWidth: 0, accentColor: c, height: 30 }} />
                    <span style={val}>{v > 0 ? '+' : ''}{v}dB</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Sends */}
          {project.returnTracks.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Sends</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {project.returnTracks.map(rt => {
                  const sv = track.sendAmounts?.[rt.id] ?? 0
                  return (
                    <div key={rt.id} style={row}>
                      <span style={{ ...lab, color: rt.color }}>{rt.name}</span>
                      <input type="range" min={0} max={1} step={0.01} value={sv}
                        onChange={e => { const v = parseFloat(e.target.value); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { sendAmounts: { ...(track.sendAmounts ?? {}), [rt.id]: v } } }); engine.setSendAmount(track.id, rt.id, v) }}
                        style={{ flex: 1, minWidth: 0, accentColor: rt.color, height: 30 }} />
                      <span style={val}>{Math.round(sv * 100)}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Mute / Solo / Effects */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !track.mute } })}
              style={{ flex: 1, height: 46, borderRadius: 10, border: '1px solid var(--border)', background: track.mute ? '#d97706' : 'var(--bg-card)', color: track.mute ? '#fff' : 'var(--text-secondary)', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>Mute</button>
            <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !track.solo } })}
              style={{ flex: 1, height: 46, borderRadius: 10, border: '1px solid var(--border)', background: track.solo ? '#eab308' : 'var(--bg-card)', color: track.solo ? '#000' : 'var(--text-secondary)', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>Solo</button>
            <button onClick={() => { window.dispatchEvent(new CustomEvent('mobile-open-sounds', { detail: { trackId: track.id, sub: 'fx' } })); onClose() }}
              style={{ flex: 1, height: 46, borderRadius: 10, border: '1px solid #7c3aed', background: 'rgba(124,58,237,0.18)', color: '#a78bfa', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>🎚 Effects</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function Mixer() {
  const { project, dispatch } = useDaw()
  const isMobile = useIsMobile()
  const [detailId, setDetailId] = useState<string | null>(null)

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
      {/* On mobile the strips size to their content and the row scrolls both
          ways — so on a short/landscape screen you can scroll down to reach the
          fader / mute-solo instead of them being clipped. */}
      <div style={{ display: 'flex', overflowX: 'auto', overflowY: isMobile ? 'auto' : 'hidden', flex: 1, alignItems: isMobile ? 'flex-start' : 'stretch' }}>
        {project.tracks.map(track => (
          <ChannelStrip key={track.id} track={track} onOpenDetail={setDetailId} />
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
      <div style={{ flexShrink: 0, borderLeft: '2px solid var(--border-light)', overflowY: isMobile ? 'auto' : undefined, alignSelf: isMobile ? 'flex-start' : undefined, maxHeight: '100%' }}>
        <ChannelStrip isMaster />
      </div>
      {isMobile && detailId && <ChannelDetail trackId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
