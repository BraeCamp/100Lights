'use client'
/**
 * PadTuner — real-time pitch display + MIDI note capture.
 * Supports microphone and computer audio (system capture) as input sources.
 */
import { useState, useEffect, useRef } from 'react'
import { LivePitchDetector, LivePitchResult } from '../../../lib/pitch-detector'
import { captureAudioInput, listAudioInputDevices } from '../../../lib/audio-capture'
import type { AudioDevice } from '../../../lib/audio-capture'
import { useDaw } from '../../../lib/daw-state'
import { isMidiClip, MidiNote } from '../../../lib/daw-types'

const C = {
  border: 'var(--border)',
  text:   'var(--text)',
  muted:  'var(--text-muted)',
  accent: 'var(--accent)',
  red:    '#ef4444',
  green:  '#22c55e',
  yellow: '#eab308',
}

// ── Arc geometry ─────────────────────────────────────────────────────────────
const CX = 140, CY = 148, R = 118, SWEEP = 68

function toRad(d: number) { return d * Math.PI / 180 }
function pt(deg: number, r: number): [number, number] {
  return [CX + r * Math.cos(toRad(deg)), CY + r * Math.sin(toRad(deg))]
}
function centsDeg(cents: number) {
  return 270 + Math.max(-50, Math.min(50, cents)) * SWEEP / 50
}
function tunerColor(cents: number, conf: number) {
  if (conf < 0.55) return '#555'
  const a = Math.abs(cents)
  if (a <= 5)  return C.green
  if (a <= 18) return C.yellow
  return C.red
}

const NOTE_DUR_LABELS: Record<number, string> = { 0.25: '1/16', 0.5: '1/8', 1: '♩', 2: '𝅗𝅥' }

export default function PadTuner() {
  const { project, dispatch, engine, selectedClipId } = useDaw()

  const [result,      setResult]      = useState<LivePitchResult | null>(null)
  const [listening,   setListening]   = useState(false)
  const [micError,    setMicError]    = useState<string | null>(null)
  const [captured,    setCaptured]    = useState(false)
  const [capError,    setCapError]    = useState<string | null>(null)
  const [noteDur,     setNoteDur]     = useState(1)
  const [inputSource, setInputSource] = useState<string>('mic')
  const [devices,     setDevices]     = useState<AudioDevice[]>([])
  const [loadingDevs, setLoadingDevs] = useState(true)

  const detectorRef  = useRef<LivePitchDetector | null>(null)
  const latestResult = useRef<LivePitchResult | null>(null)
  latestResult.current = result

  useEffect(() => () => { detectorRef.current?.stop() }, [])

  useEffect(() => {
    listAudioInputDevices(true).then(devs => {
      setDevices(devs)
      setLoadingDevs(false)
    }).catch(() => setLoadingDevs(false))
  }, [])

  async function startListening() {
    setMicError(null)
    try {
      const stream = await captureAudioInput(inputSource)
      const d = new LivePitchDetector()
      detectorRef.current = d
      await d.start(r => setResult(r), false, stream)
      setListening(true)
    } catch (e) {
      setMicError(e instanceof Error ? e.message : String(e))
    }
  }

  function stopListening() {
    detectorRef.current?.stop(); detectorRef.current = null
    setListening(false); setResult(null)
  }

  function captureNote() {
    const r = latestResult.current
    if (!r) return
    if (!selectedClipId) { setCapError('Select a MIDI clip in the timeline first'); return }
    const clip = project.arrangementClips.find(c => c.id === selectedClipId)
    if (!clip || !isMidiClip(clip)) { setCapError('Selected clip must be a MIDI clip'); return }
    const note: MidiNote = {
      id: crypto.randomUUID(),
      pitch: Math.round(r.midi),
      startBeat: Math.max(0, engine.currentBeat - clip.startBeat),
      durationBeats: noteDur,
      velocity: 100,
    }
    dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note })
    setCapError(null); setCaptured(true); setTimeout(() => setCaptured(false), 1000)
  }

  // ── SVG derived values ────────────────────────────────────────────────────
  const conf    = result?.confidence ?? 0
  const col     = result ? tunerColor(result.cents, conf) : '#555'
  const ndlDeg  = result ? centsDeg(result.cents) : 270
  const [nx,ny] = pt(ndlDeg, 108)
  const [lx,ly] = pt(200, R)
  const [rx,ry] = pt(340, R)
  const locked  = !!result && conf >= 0.75 && Math.abs(result.cents) <= 8

  function highlightArc() {
    if (!result || Math.abs(result.cents) < 1 || conf < 0.55) return null
    const c   = result.cents
    const sDeg = c >= 0 ? 270 : centsDeg(c)
    const eDeg = c >= 0 ? centsDeg(c) : 270
    if (Math.abs(eDeg - sDeg) < 0.5) return null
    const [sx, sy] = pt(sDeg, R)
    const [ex, ey] = pt(eDeg, R)
    return `M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${R} ${R} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`
  }

  const rmsArcEnd = result ? Math.min(340, 200 + (result.rms * 140)) : 200
  const [mx, my]  = rmsArcEnd > 201 ? pt(rmsArcEnd, R + 14) : pt(200, R + 14)
  const [lmx,lmy] = pt(200, R + 14)

  const noteLetter = result?.noteName.replace(/(-?\d+)$/, '') ?? '—'
  const noteOctave = result?.noteName.match(/(-?\d+)$/)?.[1] ?? ''
  const centsLabel = !result ? '' : result.cents === 0 ? '0¢' : result.cents > 0 ? `+${result.cents}¢` : `${result.cents}¢`

  return (
    <div style={{ padding: '10px 10px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>

      {/* ── SVG tuner ── */}
      <svg viewBox="0 0 280 162" width="100%" style={{ maxWidth: 260, userSelect: 'none', overflow: 'visible' }}>

        {/* Level ring */}
        <path d={`M ${lmx.toFixed(1)} ${lmy.toFixed(1)} A ${R+14} ${R+14} 0 0 1 ${pt(340, R+14)[0].toFixed(1)} ${pt(340, R+14)[1].toFixed(1)}`}
          fill="none" stroke="#222" strokeWidth="3" strokeLinecap="round" />
        {result && result.rms > 0.02 && rmsArcEnd > 201 && (
          <path d={`M ${lmx.toFixed(1)} ${lmy.toFixed(1)} A ${R+14} ${R+14} 0 0 1 ${mx.toFixed(1)} ${my.toFixed(1)}`}
            fill="none" stroke={col} strokeWidth="3" strokeLinecap="round" opacity={0.5}
            style={{ transition: 'stroke 0.1s' }} />
        )}

        {/* Main track arc */}
        <path d={`M ${lx.toFixed(1)} ${ly.toFixed(1)} A ${R} ${R} 0 0 1 ${rx.toFixed(1)} ${ry.toFixed(1)}`}
          fill="none" stroke="#282828" strokeWidth="16" strokeLinecap="round" />

        {/* Highlight arc */}
        {highlightArc() && (
          <path d={highlightArc()!} fill="none" stroke={col} strokeWidth="16" strokeLinecap="round" opacity={0.7}
            style={{ transition: 'stroke 0.07s' }} />
        )}

        {/* Tick marks */}
        {[-50, -25, 0, 25, 50].map(c => {
          const a     = toRad(centsDeg(c))
          const isMid = c === 0
          const r1    = isMid ? R - 18 : R - 10
          const r2    = isMid ? R + 18 : R + 10
          return (
            <line key={c}
              x1={CX + r1 * Math.cos(a)} y1={CY + r1 * Math.sin(a)}
              x2={CX + r2 * Math.cos(a)} y2={CY + r2 * Math.sin(a)}
              stroke={isMid ? (locked ? C.green : '#555') : '#353535'} strokeWidth={isMid ? 2 : 1.5}
              style={{ transition: 'stroke 0.15s' }}
            />
          )
        })}

        {/* Needle */}
        <line x1={CX} y1={CY} x2={nx.toFixed(1)} y2={ny.toFixed(1)}
          stroke={col} strokeWidth={2} strokeLinecap="round"
          style={{ transition: 'x2 0.06s ease-out, y2 0.06s ease-out, stroke 0.08s' }} />
        <circle cx={CX} cy={CY} r={5} fill={col} style={{ transition: 'fill 0.08s' }} />

        {/* Note letter */}
        <text x={CX} y={CY - 52} textAnchor="middle" fontSize="48" fontWeight="800"
          fill={locked ? col : result && conf > 0.5 ? C.text : '#383838'}
          style={{ transition: 'fill 0.12s' }}>
          {noteLetter}
        </text>
        {noteOctave && (
          <text x={CX + (noteLetter.length > 1 ? 34 : 24)} y={CY - 66}
            textAnchor="start" fontSize="14" fontWeight="400"
            fill={locked ? col : result ? C.muted : '#383838'}>
            {noteOctave}
          </text>
        )}

        {/* Cents */}
        <text x={CX} y={CY - 20} textAnchor="middle" fontSize="13"
          fill={result && conf > 0.5 ? col : '#383838'} style={{ transition: 'fill 0.08s' }}>
          {centsLabel}
        </text>

        {result && conf > 0.5 && (
          <text x={CX} y={CY - 4} textAnchor="middle" fontSize="9" fill="#444">
            {result.hz.toFixed(1)} Hz
          </text>
        )}

        {locked && (
          <text x={CX} y={CY + 22} textAnchor="middle" fontSize="10" fontWeight="700"
            fill={C.green} letterSpacing="0.08em">IN TUNE</text>
        )}
      </svg>

      {/* ── Input source selector ── */}
      {!listening && (() => {
        // Build full list: real mic devices + Computer Audio
        const allSources: Array<{ id: string; label: string }> = [
          ...devices,
          { id: 'system', label: 'Computer Audio' },
        ]
        const selectedLabel = allSources.find(s => s.id === inputSource)?.label ?? 'Microphone'
        return (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3, alignSelf: 'stretch' }}>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 2 }}>Input</div>
            {loadingDevs ? (
              <div style={{ fontSize: 11, color: C.muted, opacity: 0.5 }}>Loading devices…</div>
            ) : (
              allSources.map(src => (
                <button key={src.id} onClick={() => setInputSource(src.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 10px', borderRadius: 5, cursor: 'pointer', textAlign: 'left',
                  border: `1px solid ${inputSource === src.id ? 'rgb(var(--accent-rgb) / 0.5)' : 'var(--border)'}`,
                  background: inputSource === src.id ? 'rgb(var(--accent-rgb) / 0.10)' : 'transparent',
                  color: inputSource === src.id ? '#a8d4ff' : C.muted,
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    border: `1.5px solid ${inputSource === src.id ? 'var(--accent)' : '#555'}`,
                    background: inputSource === src.id ? 'var(--accent)' : 'transparent',
                  }} />
                  <span style={{ fontSize: 11, fontWeight: inputSource === src.id ? 600 : 400 }}>{src.label}</span>
                </button>
              ))
            )}

            {/* Start/stop */}
            {micError && <div style={{ fontSize: 11, color: C.red, textAlign: 'center', marginTop: 2 }}>{micError}</div>}
            <button onClick={startListening} disabled={loadingDevs} style={{
              marginTop: 4, padding: '5px 18px', fontSize: 12, borderRadius: 6, cursor: loadingDevs ? 'not-allowed' : 'pointer', fontWeight: 600,
              border: `1px solid ${C.accent}`, background: `${C.accent}22`, color: C.accent,
            }}>▶ Start {selectedLabel}</button>
            <div style={{ fontSize: 10, color: C.muted, opacity: 0.6, textAlign: 'center' }}>
              {inputSource === 'system'
                ? 'Captures audio playing on this computer — works even with output muted'
                : 'Sing or play into your mic — detected note appears above'}
            </div>
          </div>
        )
      })()}

      {/* ── Stop button (when listening) ── */}
      {listening && (
        <>
          {micError && <div style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{micError}</div>}
          <button onClick={stopListening} style={{
            padding: '5px 18px', fontSize: 12, borderRadius: 6, cursor: 'pointer', fontWeight: 600,
            border: `1px solid ${C.red}`, background: `${C.red}22`, color: C.red,
          }}>⏹ Stop</button>
        </>
      )}

      {/* ── Controls (when listening) ── */}
      {listening && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 7, width: '100%' }}>

          {/* Capture */}
          <button onClick={captureNote} disabled={!result} style={{
            padding: '6px 0', fontSize: 12, borderRadius: 5, fontWeight: 600,
            cursor: result ? 'pointer' : 'not-allowed',
            border: `1px solid ${captured ? C.green : C.border}`,
            background: captured ? `${C.green}22` : 'transparent',
            color: captured ? C.green : C.text, opacity: result ? 1 : 0.35,
          }}>{captured ? '✓ Added' : '⊕ Capture note'}</button>

          {/* Duration */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 10, color: C.muted, marginRight: 3 }}>Length:</span>
            {[0.25, 0.5, 1, 2].map(d => (
              <button key={d} onClick={() => setNoteDur(d)} style={{
                fontSize: 11, padding: '2px 9px', borderRadius: 3, cursor: 'pointer',
                border: `1px solid ${noteDur === d ? C.accent : C.border}`,
                background: noteDur === d ? `${C.accent}22` : 'transparent',
                color: noteDur === d ? C.accent : C.muted,
              }}>{NOTE_DUR_LABELS[d]}</button>
            ))}
          </div>

          {capError && <div style={{ fontSize: 11, color: C.red }}>{capError}</div>}
          {!result && <div style={{ fontSize: 11, color: C.muted, textAlign: 'center' }}>Listening…</div>}
        </div>
      )}
    </div>
  )
}
