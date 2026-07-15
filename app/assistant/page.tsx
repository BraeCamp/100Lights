'use client'

// The Assistant — a second-screen helper window. It renders the settings
// of whatever is selected in the editor and edits them remotely. All data
// arrives over a BroadcastChannel from the editor tab; this page owns no
// audio and no project state.

import { useEffect, useRef, useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { INSPECTOR_CHANNEL, type InspectorMsg, type InspectorSelection } from '@/lib/inspector-types'
import type { DawAction } from '@/lib/daw-state'
import { CLIP_EFFECT_PARAM_META } from '@/lib/clip-effect-utils'
import type { ClipEffectType } from '@/lib/daw-types'

const ACCENT = '#a78bfa'

// Filter slider mapping shared with the roll's Sound panel
function vToHz(v: number): number | undefined {
  if (v >= 0.995) return undefined
  return Math.round(200 * Math.pow(90, v))
}
function hzToV(hz: number | undefined): number {
  if (hz === undefined || hz >= 17500) return 1
  return Math.log(hz / 200) / Math.log(90)
}

const labelStyle: React.CSSProperties = { fontSize: 11, color: '#999', width: 78, flexShrink: 0 }
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }
const valueStyle: React.CSSProperties = { fontSize: 10.5, color: '#ccc', width: 52, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }
const sliderStyle: React.CSSProperties = { flex: 1, accentColor: ACCENT, minWidth: 0 }

function Slider({ name, val, min, max, step, fmt, onCommit, draggingRef }: {
  name: string; val: number; min: number; max: number; step: number
  fmt: (v: number) => string; onCommit: (v: number) => void
  draggingRef: React.RefObject<boolean>
}) {
  const [local, setLocal] = useState(val)
  useEffect(() => {
    if (!draggingRef.current) setLocal(val)
  }, [val]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{name}</span>
      <input
        type="range" min={min} max={max} step={step} value={local} style={sliderStyle}
        aria-label={name}
        onChange={e => setLocal(Number(e.target.value))}
        onPointerDown={() => { draggingRef.current = true }}
        onPointerUp={e => { draggingRef.current = false; onCommit(Number((e.target as HTMLInputElement).value)) }}
        onKeyUp={e => onCommit(Number((e.target as HTMLInputElement).value))}
      />
      <span style={valueStyle}>{fmt(local)}</span>
    </div>
  )
}

function ToggleRow({ name, on, onChange }: { name: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{name}</span>
      <button onClick={() => onChange(!on)} style={{
        fontSize: 11, fontWeight: 700, padding: '4px 16px', borderRadius: 999, cursor: 'pointer',
        background: on ? 'rgba(124,58,237,0.2)' : 'transparent',
        border: on ? `1px solid ${ACCENT}80` : '1px solid #333',
        color: on ? ACCENT : '#888',
      }}>{on ? 'On' : 'Off'}</button>
    </div>
  )
}

function EffectSection({ effect, draggingRef, send }: {
  effect: Extract<InspectorSelection, { kind: 'effect' }>['effect']
  draggingRef: React.RefObject<boolean>
  send: (a: DawAction) => void
}) {
  const meta = CLIP_EFFECT_PARAM_META[effect.type as ClipEffectType]
  if (!meta) return null
  const raw = effect.params[meta.key]
  const cur = typeof raw === 'number' ? raw : meta.min
  return (
    <>
      <Slider name={meta.label} val={cur} min={meta.min} max={meta.max} step={meta.log ? 1 : (meta.max - meta.min) / 100}
        fmt={v => meta.log ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`) : `${Math.round(v * 100) / 100}`}
        draggingRef={draggingRef} onCommit={v => send({ type: 'UPDATE_CLIP_EFFECT', effectId: effect.id, patch: { params: { ...effect.params, [meta.key]: v } as never } })} />
      <p style={{ fontSize: 10.5, color: '#666', marginTop: 12 }}>
        Beat {effect.startBeat} · {effect.durationBeats} beats long
      </p>
    </>
  )
}

export default function InspectorPage() {
  const [connected, setConnected] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [sel, setSel] = useState<InspectorSelection>({ kind: 'none' })
  const chanRef = useRef<BroadcastChannel | null>(null)
  const draggingRef = useRef(false)

  useEffect(() => {
    const chan = new BroadcastChannel(INSPECTOR_CHANNEL)
    chanRef.current = chan
    chan.onmessage = (e: MessageEvent<InspectorMsg>) => {
      const msg = e.data
      if (msg.type === 'state') {
        setConnected(true)
        setProjectName(msg.projectName)
        if (!draggingRef.current) setSel(msg.selection)
      }
    }
    chan.postMessage({ type: 'hello' })
    const retry = setInterval(() => { if (!connected) chan.postMessage({ type: 'hello' }) }, 1500)
    return () => { clearInterval(retry); chan.close() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function send(action: DawAction) {
    chanRef.current?.postMessage({ type: 'action', action })
  }

  const kindLabel: Record<string, string> = {
    none: '', track: 'TRACK', 'audio-clip': 'AUDIO CLIP', 'midi-clip': 'MIDI CLIP', effect: 'FX REGION',
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0f0f11', color: '#f1f0ff', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-geist-sans, sans-serif)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderBottom: '1px solid #26262b', flexShrink: 0 }}>
        <MonitorSmartphone size={15} color={ACCENT} />
        <span style={{ fontSize: 13, fontWeight: 800 }}>Assistant</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {connected ? projectName : 'Waiting for the editor…'}
        </span>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: connected ? '#4ade80' : '#666' }} />
      </header>

      <main style={{ flex: 1, padding: '16px 20px', overflowY: 'auto' }}>
        {!connected && (
          <p style={{ fontSize: 12, color: '#888', lineHeight: 1.6 }}>
            Open a project in the studio (same browser) and this window follows your selection.
            Drag it to a second screen and keep working.
          </p>
        )}

        {connected && sel.kind === 'none' && (
          <p style={{ fontSize: 12, color: '#888', lineHeight: 1.6 }}>
            Nothing selected. Click a track, clip, or FX region in the editor — its settings appear here.
          </p>
        )}

        {sel.kind !== 'none' && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: '#666' }}>{kindLabel[sel.kind]}</div>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', marginTop: 2 }}>
              {sel.kind === 'track' ? sel.track.name : sel.kind === 'effect' ? sel.effect.type : sel.clip.name}
            </div>
            {sel.kind !== 'track' && (
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>on {sel.trackName}</div>
            )}
          </div>
        )}

        {sel.kind === 'track' && (
          <>
            <Slider name="Volume" val={sel.track.volume} min={0} max={1} step={0.01}
              fmt={v => `${Math.round(v * 100)}%`} draggingRef={draggingRef}
              onCommit={v => send({ type: 'UPDATE_TRACK', trackId: sel.track.id, patch: { volume: v } })} />
            <Slider name="Pan" val={sel.track.pan} min={-1} max={1} step={0.01}
              fmt={v => v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`}
              draggingRef={draggingRef} onCommit={v => send({ type: 'UPDATE_TRACK', trackId: sel.track.id, patch: { pan: v } })} />
            <ToggleRow name="Mute" on={sel.track.mute} onChange={v => send({ type: 'UPDATE_TRACK', trackId: sel.track.id, patch: { mute: v } })} />
            <ToggleRow name="Solo" on={sel.track.solo} onChange={v => send({ type: 'UPDATE_TRACK', trackId: sel.track.id, patch: { solo: v } })} />
            <p style={{ fontSize: 10.5, color: '#666', marginTop: 12 }}>Instrument: {sel.track.instrumentType}</p>
          </>
        )}

        {sel.kind === 'audio-clip' && (
          <>
            <Slider name="Gain" val={sel.clip.gain} min={0} max={2} step={0.01}
              fmt={v => `${Math.round(v * 100)}%`} draggingRef={draggingRef}
              onCommit={v => send({ type: 'UPDATE_CLIP', clipId: sel.clip.id, patch: { gain: v } })} />
            <Slider name="Fade in" val={sel.clip.fadeIn} min={0} max={8} step={0.25}
              fmt={v => v > 0 ? `${v} beats` : 'Off'}
              draggingRef={draggingRef} onCommit={v => send({ type: 'UPDATE_CLIP', clipId: sel.clip.id, patch: { fadeIn: v } })} />
            <Slider name="Fade out" val={sel.clip.fadeOut} min={0} max={8} step={0.25}
              fmt={v => v > 0 ? `${v} beats` : 'Off'}
              draggingRef={draggingRef} onCommit={v => send({ type: 'UPDATE_CLIP', clipId: sel.clip.id, patch: { fadeOut: v } })} />
            <Slider name="Pitch" val={sel.clip.pitchSemitones} min={-24} max={24} step={1}
              fmt={v => v === 0 ? '±0 st' : `${v > 0 ? '+' : ''}${v} st`}
              draggingRef={draggingRef} onCommit={v => send({ type: 'UPDATE_CLIP', clipId: sel.clip.id, patch: { pitchSemitones: v } })} />
            <ToggleRow name="Reverse" on={sel.clip.reverse} onChange={v => send({ type: 'UPDATE_CLIP', clipId: sel.clip.id, patch: { reverse: v } })} />
            <p style={{ fontSize: 10.5, color: '#666', marginTop: 12 }}>
              Beat {sel.clip.startBeat} · {sel.clip.durationBeats} beats long
            </p>
          </>
        )}

        {sel.kind === 'midi-clip' && (
          <>
            {!sel.clip.isDrumClip && (
              <>
                <Slider name="Sustain" val={sel.clip.rollFx?.sustain ?? 0} min={0} max={4} step={0.05}
                  fmt={v => v > 0 ? `${v.toFixed(2)}s` : 'Off'}
                  draggingRef={draggingRef} onCommit={v => send({ type: 'UPDATE_CLIP', clipId: sel.clip.id, patch: { rollFx: { ...sel.clip.rollFx, sustain: v > 0 ? v : undefined } } })} />
                <Slider name="Reverb" val={sel.clip.rollFx?.reverbWet ?? 0} min={0} max={1} step={0.02}
                  fmt={v => v > 0 ? `${Math.round(v * 100)}%` : 'Off'}
                  draggingRef={draggingRef} onCommit={v => send({ type: 'UPDATE_CLIP', clipId: sel.clip.id, patch: { rollFx: { ...sel.clip.rollFx, reverbWet: v > 0 ? v : undefined } } })} />
                <Slider name="Distortion" val={sel.clip.rollFx?.distortion ?? 0} min={0} max={1} step={0.02}
                  fmt={v => v > 0 ? `${Math.round(v * 100)}%` : 'Off'}
                  draggingRef={draggingRef} onCommit={v => send({ type: 'UPDATE_CLIP', clipId: sel.clip.id, patch: { rollFx: { ...sel.clip.rollFx, distortion: v > 0 ? v : undefined } } })} />
                <Slider name="Filter" val={hzToV(sel.clip.rollFx?.filterHz)} min={0} max={1} step={0.005}
                  fmt={v => { const hz = vToHz(v); return hz === undefined ? 'Off' : hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${hz}Hz` }}
                  draggingRef={draggingRef} onCommit={v => send({ type: 'UPDATE_CLIP', clipId: sel.clip.id, patch: { rollFx: { ...sel.clip.rollFx, filterHz: vToHz(v) } } })} />
              </>
            )}
            <p style={{ fontSize: 10.5, color: '#666', marginTop: 12 }}>
              Sound: {sel.clip.presetName} · {sel.clip.noteCount} note{sel.clip.noteCount !== 1 ? 's' : ''}
              {sel.clip.isDrumClip ? ' · drum clip' : ''}
            </p>
          </>
        )}

        {sel.kind === 'effect' && <EffectSection effect={sel.effect} draggingRef={draggingRef} send={send} />}
      </main>

      <footer style={{ padding: '10px 20px', borderTop: '1px solid #26262b', fontSize: 10, color: '#666', flexShrink: 0 }}>
        Follows your selection in the studio window. Changes apply instantly — and sync to collaborators.
      </footer>
    </div>
  )
}
