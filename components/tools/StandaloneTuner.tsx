'use client'

/**
 * Standalone tuner for /tools, with two modes:
 *  - Listen: detect the pitch coming from the mic (forked from the in-studio
 *    PadTuner, DAW coupling removed).
 *  - Reference tone: a pitch pipe — tap a note to hear it and tune by ear,
 *    which detection can't help singers or anyone tuning without a clear attack.
 *
 * The input source can be changed while listening: switching restarts the
 * detector on the new stream without making you stop first.
 */

import { useState, useEffect, useRef } from 'react'
import { LivePitchDetector, LivePitchResult } from '@/lib/pitch-detector'
import { captureAudioInput, listAudioInputDevices, type AudioDevice } from '@/lib/audio-capture'

const C = {
  border: 'var(--border)', text: 'var(--text-primary)', muted: 'var(--text-muted)',
  accent: 'var(--accent)', red: '#ef4444', green: '#22c55e', yellow: '#eab308',
}

const CX = 140, CY = 148, R = 118, SWEEP = 68
const toRad = (d: number) => d * Math.PI / 180
const pt = (deg: number, r: number): [number, number] => [CX + r * Math.cos(toRad(deg)), CY + r * Math.sin(toRad(deg))]
const centsDeg = (cents: number) => 270 + Math.max(-50, Math.min(50, cents)) * SWEEP / 50
function tunerColor(cents: number, conf: number) {
  if (conf < 0.55) return '#555'
  const a = Math.abs(cents)
  if (a <= 5) return C.green
  if (a <= 18) return C.yellow
  return C.red
}

// Reference-tone notes: two octaves centred on middle C, plus concert A.
const REF_NOTES = [
  { name: 'C3', midi: 48 }, { name: 'D3', midi: 50 }, { name: 'E3', midi: 52 }, { name: 'F3', midi: 53 },
  { name: 'G3', midi: 55 }, { name: 'A3', midi: 57 }, { name: 'B3', midi: 59 }, { name: 'C4', midi: 60 },
  { name: 'D4', midi: 62 }, { name: 'E4', midi: 64 }, { name: 'F4', midi: 65 }, { name: 'G4', midi: 67 },
  { name: 'A4', midi: 69 }, { name: 'B4', midi: 71 }, { name: 'C5', midi: 72 },
]
const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export default function StandaloneTuner() {
  const [mode, setMode] = useState<'listen' | 'reference'>('listen')

  // ── Listen mode ──────────────────────────────────────────────
  const [result, setResult] = useState<LivePitchResult | null>(null)
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [inputSource, setInputSource] = useState<string>('mic')
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [loadingDevs, setLoadingDevs] = useState(true)
  const detectorRef = useRef<LivePitchDetector | null>(null)

  useEffect(() => () => { detectorRef.current?.stop() }, [])
  useEffect(() => {
    listAudioInputDevices(true).then(d => { setDevices(d); setLoadingDevs(false) }).catch(() => setLoadingDevs(false))
  }, [])

  async function startListening(source = inputSource) {
    setMicError(null)
    try {
      detectorRef.current?.stop()
      const stream = await captureAudioInput(source)
      const d = new LivePitchDetector()
      detectorRef.current = d
      await d.start(r => setResult(r), false, stream)
      setListening(true)
    } catch (e) {
      setMicError(e instanceof Error ? e.message : String(e))
      setListening(false)
    }
  }

  function stopListening() {
    detectorRef.current?.stop(); detectorRef.current = null
    setListening(false); setResult(null)
  }

  // Switching input mid-session restarts the detector on the new stream.
  function chooseInput(source: string) {
    setInputSource(source)
    if (listening) void startListening(source)
  }

  // ── Reference tone ───────────────────────────────────────────
  const refCtx = useRef<AudioContext | null>(null)
  const refOsc = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null)
  const [refNote, setRefNote] = useState<number | null>(null)

  function stopRefTone() {
    const o = refOsc.current
    if (o) {
      const c = refCtx.current!
      o.gain.gain.setTargetAtTime(0, c.currentTime, 0.02)
      const osc = o.osc
      setTimeout(() => { try { osc.stop() } catch { /* already stopped */ } }, 120)
      refOsc.current = null
    }
    setRefNote(null)
  }

  function playRefTone(midi: number) {
    if (refNote === midi) { stopRefTone(); return }
    stopRefTone()
    if (!refCtx.current) refCtx.current = new AudioContext()
    const c = refCtx.current
    void c.resume()
    const osc = c.createOscillator()
    const gain = c.createGain()
    // A soft triangle rather than a pure sine — easier to pitch against by ear.
    osc.type = 'triangle'
    osc.frequency.value = midiToHz(midi)
    gain.gain.setValueAtTime(0, c.currentTime)
    gain.gain.linearRampToValueAtTime(0.18, c.currentTime + 0.02)
    osc.connect(gain); gain.connect(c.destination)
    osc.start()
    refOsc.current = { osc, gain }
    setRefNote(midi)
  }

  useEffect(() => () => { void refCtx.current?.close() }, [])

  // Leaving a mode cleans up the other's audio.
  useEffect(() => {
    if (mode !== 'listen') stopListening()
    if (mode !== 'reference') stopRefTone()
  }, [mode])

  // ── SVG derived values ───────────────────────────────────────
  const conf = result?.confidence ?? 0
  const col = result ? tunerColor(result.cents, conf) : '#555'
  const ndlDeg = result ? centsDeg(result.cents) : 270
  const [nx, ny] = pt(ndlDeg, 108)
  const [lx, ly] = pt(200, R)
  const [rx, ry] = pt(340, R)
  const locked = !!result && conf >= 0.75 && Math.abs(result.cents) <= 8
  function highlightArc() {
    if (!result || Math.abs(result.cents) < 1 || conf < 0.55) return null
    const c = result.cents
    const sDeg = c >= 0 ? 270 : centsDeg(c)
    const eDeg = c >= 0 ? centsDeg(c) : 270
    if (Math.abs(eDeg - sDeg) < 0.5) return null
    const [sx, sy] = pt(sDeg, R)
    const [ex, ey] = pt(eDeg, R)
    return `M ${sx.toFixed(1)} ${sy.toFixed(1)} A ${R} ${R} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`
  }
  const rmsArcEnd = result ? Math.min(340, 200 + (result.rms * 140)) : 200
  const [mx, my] = rmsArcEnd > 201 ? pt(rmsArcEnd, R + 14) : pt(200, R + 14)
  const [lmx, lmy] = pt(200, R + 14)
  const noteLetter = result?.noteName.replace(/(-?\d+)$/, '') ?? '—'
  const noteOctave = result?.noteName.match(/(-?\d+)$/)?.[1] ?? ''
  const centsLabel = !result ? '' : result.cents === 0 ? '0¢' : result.cents > 0 ? `+${result.cents}¢` : `${result.cents}¢`

  const allSources: Array<{ id: string; label: string }> = [...devices, { id: 'system', label: 'Computer Audio' }]

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: '16px 16px 20px', background: 'var(--bg-card)', maxWidth: 360, margin: '0 auto' }}>
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 10, background: 'var(--bg-base)', marginBottom: 14 }}>
        {(['listen', 'reference'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            flex: 1, padding: '7px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, border: 'none',
            background: mode === m ? 'var(--accent)' : 'transparent', color: mode === m ? '#fff' : 'var(--text-muted)',
          }}>{m === 'listen' ? 'Tune by ear' : 'Reference tone'}</button>
        ))}
      </div>

      {mode === 'listen' ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <svg viewBox="0 0 280 162" width="100%" style={{ maxWidth: 280, userSelect: 'none', overflow: 'visible' }}>
            <path d={`M ${lmx.toFixed(1)} ${lmy.toFixed(1)} A ${R + 14} ${R + 14} 0 0 1 ${pt(340, R + 14)[0].toFixed(1)} ${pt(340, R + 14)[1].toFixed(1)}`} fill="none" stroke="var(--text-muted)" strokeWidth="3" strokeLinecap="round" />
            {result && result.rms > 0.02 && rmsArcEnd > 201 && (
              <path d={`M ${lmx.toFixed(1)} ${lmy.toFixed(1)} A ${R + 14} ${R + 14} 0 0 1 ${mx.toFixed(1)} ${my.toFixed(1)}`} fill="none" stroke={col} strokeWidth="3" strokeLinecap="round" opacity={0.5} style={{ transition: 'stroke 0.1s' }} />
            )}
            <path d={`M ${lx.toFixed(1)} ${ly.toFixed(1)} A ${R} ${R} 0 0 1 ${rx.toFixed(1)} ${ry.toFixed(1)}`} fill="none" stroke="var(--text-muted)" strokeWidth="16" strokeLinecap="round" />
            {highlightArc() && <path d={highlightArc()!} fill="none" stroke={col} strokeWidth="16" strokeLinecap="round" opacity={0.7} style={{ transition: 'stroke 0.07s' }} />}
            {[-50, -25, 0, 25, 50].map(c => {
              const a = toRad(centsDeg(c)); const isMid = c === 0
              const r1 = isMid ? R - 18 : R - 10; const r2 = isMid ? R + 18 : R + 10
              return <line key={c} x1={CX + r1 * Math.cos(a)} y1={CY + r1 * Math.sin(a)} x2={CX + r2 * Math.cos(a)} y2={CY + r2 * Math.sin(a)} stroke={isMid ? (locked ? C.green : '#555') : '#353535'} strokeWidth={isMid ? 2 : 1.5} style={{ transition: 'stroke 0.15s' }} />
            })}
            <line x1={CX} y1={CY} x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke={col} strokeWidth={2} strokeLinecap="round" style={{ transition: 'x2 0.06s ease-out, y2 0.06s ease-out, stroke 0.08s' }} />
            <circle cx={CX} cy={CY} r={5} fill={col} style={{ transition: 'fill 0.08s' }} />
            <text x={CX} y={CY - 52} textAnchor="middle" fontSize="48" fontWeight="800" fill={locked ? col : result && conf > 0.5 ? C.text : '#383838'} style={{ transition: 'fill 0.12s' }}>{noteLetter}</text>
            {noteOctave && <text x={CX + (noteLetter.length > 1 ? 34 : 24)} y={CY - 66} textAnchor="start" fontSize="14" fontWeight="400" fill={locked ? col : result ? C.muted : '#383838'}>{noteOctave}</text>}
            <text x={CX} y={CY - 20} textAnchor="middle" fontSize="13" fill={result && conf > 0.5 ? col : '#383838'} style={{ transition: 'fill 0.08s' }}>{centsLabel}</text>
            {result && conf > 0.5 && <text x={CX} y={CY - 4} textAnchor="middle" fontSize="9" fill="var(--text-muted)">{result.hz.toFixed(1)} Hz</text>}
            {locked && <text x={CX} y={CY + 22} textAnchor="middle" fontSize="10" fontWeight="700" fill={C.green} letterSpacing="0.08em">IN TUNE</text>}
          </svg>

          {/* Input picker — always visible, so it can be changed mid-session */}
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 2 }}>Input {listening && '· switch anytime'}</div>
            {loadingDevs ? <div style={{ fontSize: 11, color: C.muted, opacity: 0.5 }}>Loading devices…</div> : (
              allSources.map(src => (
                <button key={src.id} onClick={() => chooseInput(src.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                  border: `1px solid ${inputSource === src.id ? 'rgb(var(--accent-rgb) / 0.5)' : 'var(--border)'}`,
                  background: inputSource === src.id ? 'rgb(var(--accent-rgb) / 0.10)' : 'transparent',
                  color: inputSource === src.id ? 'var(--accent-light)' : C.muted,
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, border: `1.5px solid ${inputSource === src.id ? 'var(--accent)' : '#555'}`, background: inputSource === src.id ? 'var(--accent)' : 'transparent' }} />
                  <span style={{ fontSize: 12, fontWeight: inputSource === src.id ? 600 : 400 }}>{src.label}</span>
                </button>
              ))
            )}
          </div>

          {micError && <div style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{micError}</div>}
          {!listening ? (
            <button onClick={() => startListening()} disabled={loadingDevs} style={{ marginTop: 2, padding: '8px 22px', fontSize: 13, borderRadius: 8, cursor: loadingDevs ? 'not-allowed' : 'pointer', fontWeight: 700, border: 'none', background: C.accent, color: '#fff' }}>▶ Start</button>
          ) : (
            <button onClick={stopListening} style={{ marginTop: 2, padding: '8px 22px', fontSize: 13, borderRadius: 8, cursor: 'pointer', fontWeight: 700, border: `1px solid ${C.red}`, background: `${C.red}22`, color: C.red }}>⏹ Stop</button>
          )}
          <p style={{ fontSize: 10.5, color: C.muted, opacity: 0.7, textAlign: 'center', margin: 0 }}>Sing or play a note and hold it — nothing is recorded or uploaded.</p>
        </div>
      ) : (
        <div>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', textAlign: 'center', margin: '0 0 14px', lineHeight: 1.5 }}>
            Tap a note to hear it, then tune your string or your voice to match. Tap again to stop.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: 6 }}>
            {REF_NOTES.map(n => {
              const on = refNote === n.midi
              const isA4 = n.midi === 69
              return (
                <button key={n.midi} onClick={() => playRefTone(n.midi)} style={{
                  padding: '12px 0', borderRadius: 9, cursor: 'pointer', fontSize: 14, fontWeight: 700,
                  border: `1px solid ${on ? 'var(--accent)' : isA4 ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`,
                  background: on ? 'var(--accent)' : isA4 ? 'rgba(124,58,237,0.08)' : 'var(--bg-base)',
                  color: on ? '#fff' : 'var(--text-primary)',
                }}>
                  {n.name}
                  {isA4 && <div style={{ fontSize: 8, fontWeight: 600, color: on ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)' }}>440 Hz</div>}
                </button>
              )
            })}
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12, marginBottom: 0 }}>
            A4 is concert pitch (440 Hz), the standard reference. Guitar strings low to high: E A D G B E.
          </p>
        </div>
      )}
    </div>
  )
}
