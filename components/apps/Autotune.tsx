'use client'

/**
 * Autotune — record your voice, pitch-correct it to a chosen key/scale, hear
 * original vs corrected, download the result. All client-side.
 *
 * Audio plumbing (reused engines):
 *   • Mic → pitch + clean PCM:  lib/pitch-detector.ts  LivePitchDetector
 *       start(onPitch, captureAudio=true) → live YIN readout while recording;
 *       stopAndGetPcm() → raw uncompressed mono PCM (NOT the lossy Opus blob).
 *   • Offline correction:       lib/autotune.ts  correctPitch
 *       per-frame YIN → nearest in-scale note → per-segment WSOLA pitch-shift.
 *   • Scales / keys:            lib/scale-constants.ts
 *   • WAV export:               lib/wav-encoder.ts  audioBufferToWav
 *
 * v1 is RECORD → correct offline → play. Real-time monitoring (hearing the
 * correction live as you sing) is v2 — it needs a streaming phase-vocoder /
 * AudioWorklet, not this offline per-segment WSOLA pass.
 *
 * One shared AudioContext, created/resumed inside a user-gesture handler.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LivePitchDetector, type LivePitchResult, type LiveLevel } from '@/lib/pitch-detector'
import { correctPitch, detectPitchTrack, measureMedianPitch, shiftSamples, type AutotuneResult } from '@/lib/autotune'
import { SCALE_LABELS, ROOT_NOTES, type ScaleType } from '@/lib/scale-constants'
import { audioBufferToWav } from '@/lib/wav-encoder'

const KEY_STORE = 'autotune-key'
const SCALE_STORE = 'autotune-scale'
const STRENGTH_STORE = 'autotune-strength'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const midiToName = (m: number) => `${ROOT_NOTES[((Math.round(m) % 12) + 12) % 12]}${Math.floor(Math.round(m) / 12) - 1}`
const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)

type PlayWhich = 'original' | 'corrected' | null

export default function Autotune() {
  const [key, setKey] = useState(0)                 // 0..11 (C..B)
  const [scale, setScale] = useState<ScaleType>('major')
  const [strength, setStrength] = useState(100)     // 0..100

  const [recording, setRecording] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [live, setLive] = useState<{ name: string; cents: number } | null>(null)
  const [level, setLevel] = useState<LiveLevel | null>(null)

  const [original, setOriginal] = useState<AudioBuffer | null>(null)
  const [corrected, setCorrected] = useState<AudioBuffer | null>(null)
  const [result, setResult] = useState<AutotuneResult | null>(null)
  const [playWhich, setPlayWhich] = useState<PlayWhich>(null)

  const ctxRef = useRef<AudioContext | null>(null)
  const detectorRef = useRef<LivePitchDetector | null>(null)
  const rawRef = useRef<{ samples: Float32Array; sampleRate: number } | null>(null)
  const srcRef = useRef<AudioBufferSourceNode | null>(null)
  const recomputeTimer = useRef<number | null>(null)

  // ── Persisted settings ───────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const k = parseInt(localStorage.getItem(KEY_STORE) ?? '', 10)
      if (Number.isFinite(k) && k >= 0 && k < 12) setKey(k)
      const s = localStorage.getItem(SCALE_STORE)
      if (s && s in SCALE_LABELS) setScale(s as ScaleType)
      const st = parseInt(localStorage.getItem(STRENGTH_STORE) ?? '', 10)
      if (Number.isFinite(st)) setStrength(clamp(st, 0, 100))
    } catch { /* localStorage unavailable */ }
  }, [])
  useEffect(() => { try { localStorage.setItem(KEY_STORE, String(key)) } catch { /* ignore */ } }, [key])
  useEffect(() => { try { localStorage.setItem(SCALE_STORE, scale) } catch { /* ignore */ } }, [scale])
  useEffect(() => { try { localStorage.setItem(STRENGTH_STORE, String(strength)) } catch { /* ignore */ } }, [strength])

  // ── Headless test hooks (mirror voicemidi's __voice* convention) ─────────────
  useEffect(() => {
    const w = window as unknown as {
      __autotuneCorrect?: typeof correctPitch
      __autotuneDetectTrack?: typeof detectPitchTrack
      __autotuneMeasurePitch?: typeof measureMedianPitch
    }
    w.__autotuneCorrect = correctPitch
    w.__autotuneDetectTrack = detectPitchTrack
    w.__autotuneMeasurePitch = measureMedianPitch
    ;(w as unknown as { __autotuneShift?: typeof shiftSamples }).__autotuneShift = shiftSamples
    return () => {
      delete w.__autotuneCorrect; delete w.__autotuneDetectTrack; delete w.__autotuneMeasurePitch
      delete (w as unknown as { __autotuneShift?: typeof shiftSamples }).__autotuneShift
    }
  }, [])

  const ensureCtx = useCallback((): AudioContext => {
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    return ctxRef.current
  }, [])

  // ── Playback ─────────────────────────────────────────────────────────────────
  const stopPlayback = useCallback(() => {
    if (srcRef.current) {
      try { srcRef.current.onended = null; srcRef.current.stop() } catch { /* not started */ }
      try { srcRef.current.disconnect() } catch { /* ok */ }
      srcRef.current = null
    }
    setPlayWhich(null)
  }, [])

  const playBuffer = useCallback((buf: AudioBuffer, which: Exclude<PlayWhich, null>) => {
    stopPlayback()
    const c = ensureCtx()
    void c.resume()
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(c.destination)
    src.onended = () => { srcRef.current = null; setPlayWhich(null) }
    src.start()
    srcRef.current = src
    setPlayWhich(which)
  }, [ensureCtx, stopPlayback])

  // ── Offline correction (re-run when settings change after a take) ────────────
  const runCorrection = useCallback((raw: { samples: Float32Array; sampleRate: number }, k: number, sc: ScaleType, strengthPct: number) => {
    setProcessing(true)
    // Defer so the "Processing…" state paints before the synchronous YIN pass.
    window.setTimeout(() => {
      try {
        const res = correctPitch(raw.samples, raw.sampleRate, { key: k, scale: sc, strength: strengthPct / 100 })
        const orig = new AudioBuffer({ length: raw.samples.length, sampleRate: raw.sampleRate, numberOfChannels: 1 })
        orig.copyToChannel(raw.samples as Float32Array<ArrayBuffer>, 0)
        const corr = new AudioBuffer({ length: res.samples.length, sampleRate: raw.sampleRate, numberOfChannels: 1 })
        corr.copyToChannel(res.samples as Float32Array<ArrayBuffer>, 0)
        setOriginal(orig)
        setCorrected(corr)
        setResult(res)
      } catch (e) {
        setMicError(e instanceof Error ? e.message : String(e))
      } finally {
        setProcessing(false)
      }
    }, 0)
  }, [])

  // Debounced re-correction when key/scale/strength change and a take exists.
  useEffect(() => {
    if (!rawRef.current) return
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current)
    recomputeTimer.current = window.setTimeout(() => {
      if (rawRef.current) runCorrection(rawRef.current, key, scale, strength)
    }, 180)
    return () => { if (recomputeTimer.current) clearTimeout(recomputeTimer.current) }
  }, [key, scale, strength, runCorrection])

  // ── Record ───────────────────────────────────────────────────────────────────
  const onPitch = useCallback((r: LivePitchResult | null) => {
    setLive(r ? { name: r.noteName, cents: r.cents } : null)
  }, [])
  const onLevel = useCallback((lvl: LiveLevel) => setLevel(lvl), [])

  const startRecording = useCallback(async () => {
    setMicError(null)
    stopPlayback()
    ensureCtx()
    try {
      const d = new LivePitchDetector()
      detectorRef.current = d
      await d.start(onPitch, true, undefined, { onLevel })
      setRecording(true)
    } catch (e) {
      setMicError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow mic access in your browser to record.'
          : e instanceof Error ? e.message : String(e),
      )
      setRecording(false)
      detectorRef.current = null
    }
  }, [ensureCtx, onPitch, onLevel, stopPlayback])

  const stopRecording = useCallback(() => {
    const det = detectorRef.current
    detectorRef.current = null
    setRecording(false)
    setLive(null)
    setLevel(null)
    if (!det) return
    const pcm = det.stopAndGetPcm()
    det.stop()
    if (!pcm || pcm.samples.length < 2048) {
      setMicError('Recording too short — hold the button and sing for a moment.')
      return
    }
    rawRef.current = { samples: pcm.samples, sampleRate: pcm.sampleRate }
    runCorrection(rawRef.current, key, scale, strength)
  }, [key, scale, strength, runCorrection])

  const toggleRecord = useCallback(() => {
    if (recording) stopRecording()
    else void startRecording()
  }, [recording, startRecording, stopRecording])

  // ── Download ─────────────────────────────────────────────────────────────────
  const download = useCallback(() => {
    if (!corrected) return
    const blob = audioBufferToWav(corrected)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `autotune-${ROOT_NOTES[key].replace('#', 'sharp')}-${scale}.wav`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [corrected, key, scale])

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    detectorRef.current?.stop()
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current)
    try { srcRef.current?.stop() } catch { /* ok */ }
    void ctxRef.current?.close()
  }, [])

  const hasTake = original !== null && corrected !== null
  const levelPct = level ? Math.min(100, Math.round(level.rms * 100 * 6)) : 0
  const shiftedSegs = result?.segments.filter(s => Math.abs(s.appliedCents) >= 1).length ?? 0

  return (
    <div style={card}>
      {/* ── Key / Scale / Strength ─────────────────────────────────────────── */}
      <Row label="Key">
        <select
          value={key}
          aria-label="Key"
          data-testid="at-key"
          onChange={e => setKey(parseInt(e.target.value, 10))}
          style={select}
        >
          {ROOT_NOTES.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
      </Row>
      <Row label="Scale">
        <select
          value={scale}
          aria-label="Scale"
          data-testid="at-scale"
          onChange={e => setScale(e.target.value as ScaleType)}
          style={select}
        >
          {(Object.keys(SCALE_LABELS) as ScaleType[]).map(s => (
            <option key={s} value={s}>{SCALE_LABELS[s]}</option>
          ))}
        </select>
      </Row>
      <Row label="Strength">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="range"
            min={0}
            max={100}
            value={strength}
            aria-label="Correction strength"
            data-testid="at-strength"
            onChange={e => setStrength(parseInt(e.target.value, 10))}
            style={{ flex: 1, accentColor: 'var(--accent)' }}
          />
          <span style={{ width: 44, textAlign: 'right', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {strength}%
          </span>
        </div>
      </Row>

      {/* ── Record ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18 }}>
        <button
          onClick={toggleRecord}
          data-testid="at-record"
          disabled={processing && !recording}
          style={{
            padding: '12px 26px', borderRadius: 11, border: 'none', fontSize: 14.5, fontWeight: 800,
            cursor: processing && !recording ? 'default' : 'pointer',
            background: recording ? '#dc2626' : 'var(--accent)', color: '#fff',
            display: 'inline-flex', alignItems: 'center', gap: 9,
          }}
        >
          <span style={{
            width: 11, height: 11, borderRadius: recording ? 2 : '50%',
            background: '#fff', display: 'inline-block',
            animation: recording ? 'atpulse 1s ease-in-out infinite' : 'none',
          }} />
          {recording ? 'Stop' : 'Record'}
        </button>

        {/* Live pitch readout + level meter while recording */}
        {recording && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
            <div style={{ minWidth: 78, fontSize: 20, fontWeight: 800, color: live ? 'var(--text-primary)' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {live ? live.name : '—'}
              {live && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginLeft: 6 }}>{live.cents > 0 ? '+' : ''}{live.cents}¢</span>}
            </div>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-base)', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <div style={{ width: `${levelPct}%`, height: '100%', background: 'var(--accent)', transition: 'width 60ms linear' }} />
            </div>
          </div>
        )}
        {processing && !recording && (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Correcting…</span>
        )}
      </div>

      {micError && (
        <div role="alert" style={{ marginTop: 12, padding: '10px 12px', borderRadius: 9, background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.4)', color: '#f87171', fontSize: 13 }}>
          {micError}
        </div>
      )}

      {!hasTake && !recording && !micError && (
        <p style={{ marginTop: 16, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Pick a key and scale, then hit <strong>Record</strong> and sing a line. On stop, your take is
          pitch-corrected to the nearest notes in that scale — compare the original with the corrected
          version, tweak the strength, and download the result.
        </p>
      )}

      {/* ── Results: A/B + curve + download ────────────────────────────────── */}
      {hasTake && (
        <div style={{ marginTop: 20 }}>
          {result && <PitchCurve result={result} />}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
            <button
              onClick={() => (playWhich === 'original' ? stopPlayback() : original && playBuffer(original, 'original'))}
              data-testid="at-play-original"
              style={abBtn(playWhich === 'original', false)}
            >
              {playWhich === 'original' ? '■ Stop' : '▶ Original'}
            </button>
            <button
              onClick={() => (playWhich === 'corrected' ? stopPlayback() : corrected && playBuffer(corrected, 'corrected'))}
              data-testid="at-play-corrected"
              style={abBtn(playWhich === 'corrected', true)}
            >
              {playWhich === 'corrected' ? '■ Stop' : '▶ Corrected'}
            </button>
            <button
              onClick={download}
              data-testid="at-download"
              style={{
                marginLeft: 'auto', padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700,
                cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
              }}
            >
              ↓ Download WAV
            </button>
          </div>

          <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {result?.segments.length ?? 0} note segment{(result?.segments.length ?? 0) === 1 ? '' : 's'} · {shiftedSegs} corrected · snapping to {ROOT_NOTES[key]} {SCALE_LABELS[scale]}
            {processing && ' · updating…'}
          </div>
        </div>
      )}

      <style>{`@keyframes atpulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
    </div>
  )
}

// ── Pitch-curve view: detected (heard) vs snapped target ──────────────────────
function PitchCurve({ result }: { result: AutotuneResult }) {
  const W = 100, H = 90
  const frames = result.frames
  const voiced = frames.filter(f => f.hz != null)
  if (voiced.length < 2) return null

  let total = 0.001
  for (const f of frames) total = Math.max(total, f.time)
  let lo = Infinity, hi = -Infinity
  for (const f of voiced) {
    const md = hzToMidi(f.hz as number)
    const mt = f.targetHz ? hzToMidi(f.targetHz) : md
    lo = Math.min(lo, md, mt); hi = Math.max(hi, md, mt)
  }
  const span = Math.max(3, hi - lo + 2)
  const yFor = (m: number) => H - ((m - (lo - 1)) / span) * H
  const xFor = (t: number) => (t / total) * W

  const segLine = (pick: (f: typeof frames[number]) => number | null): string[] => {
    const segs: string[] = []
    let cur: string[] = []
    const flush = () => { if (cur.length > 1) segs.push(cur.join(' ')); cur = [] }
    for (const f of frames) {
      const v = pick(f)
      if (v == null) { flush(); continue }
      cur.push(`${xFor(f.time).toFixed(2)},${yFor(v).toFixed(2)}`)
    }
    flush()
    return segs
  }

  const detected = segLine(f => (f.hz ? hzToMidi(f.hz) : null))
  const target = segLine(f => (f.targetHz ? hzToMidi(f.targetHz) : null))

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" data-testid="at-curve"
        style={{ height: 110, background: 'var(--bg-base)', borderRadius: 10, border: '1px solid var(--border)', display: 'block' }}>
        {target.map((pts, i) => (
          <polyline key={`t${i}`} points={pts} fill="none" stroke="#22c55e" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        ))}
        {detected.map((pts, i) => (
          <polyline key={`d${i}`} points={pts} fill="none" stroke="#60a5fa" strokeWidth={1} strokeDasharray="3 2" opacity={0.75} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 10.5, color: 'var(--text-muted)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 14, height: 0, borderTop: '2px dashed #60a5fa', display: 'inline-block' }} /> detected (sung)
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 14, height: 0, borderTop: '2px solid #22c55e', display: 'inline-block' }} /> snapped target
        </span>
      </div>
    </div>
  )
}

function abBtn(active: boolean, accent: boolean): React.CSSProperties {
  return {
    padding: '9px 18px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    border: 'none',
    background: active ? '#dc2626' : accent ? 'var(--accent)' : 'var(--bg-base)',
    color: active || accent ? '#fff' : 'var(--text-primary)',
    boxShadow: !active && !accent ? 'inset 0 0 0 1px var(--border)' : 'none',
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
      <div style={{ width: 84, flexShrink: 0, fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

const card: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 18, padding: '22px 22px',
  background: 'var(--bg-card)', maxWidth: 520, margin: '0 auto',
}
const select: React.CSSProperties = {
  width: '100%', padding: '9px 10px', borderRadius: 8, fontSize: 13.5,
  background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none',
}
