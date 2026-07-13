'use client'

// Voice mapping for the piano roll: sing into the mic while the transport
// plays and a karaoke-style pitch ribbon lands on the roll's 2D plane —
// a reference for placing notes by hand (it never creates notes itself).
// The recorded take replays in sync with the transport at its own volume,
// and a delay control nudges everything earlier to cancel input latency.

import { useEffect, useRef, useState } from 'react'
import { Mic, Eye, EyeOff, X } from 'lucide-react'
import { detectPitch } from '@/lib/pitch-detect'
import type { MidiClip } from '@/lib/daw-types'
import type { DawEngine } from '@/lib/daw-engine'
import type { DawAction } from '@/lib/daw-state'

const NUM_NOTES = 128
const POLL_MS = 33
const MAX_RECORD_SEC = 180
const TRACE_COLOR = '#22d3ee'

export interface VoiceMap {
  recording: boolean
  hasTrace: boolean
  visible: boolean
  volume: number
  offsetMs: number
  version: number
  points: React.RefObject<[number, number][]>
  hasAudio: boolean
  start: () => void
  stop: () => void
  clear: () => void
  setVisible: (v: boolean) => void
  setVolume: (v: number) => void
  nudgeOffset: (deltaMs: number) => void
}

export function useVoiceMap(engine: DawEngine, clip: MidiClip, dispatch: (a: DawAction) => void): VoiceMap {
  const [recording, setRecording] = useState(false)
  const [visible, setVisible] = useState(true)
  const [volume, setVolumeState] = useState(0.9)
  const [offsetMs, setOffsetMs] = useState(clip.voiceMap?.offsetMs ?? 0)
  const [version, setVersion] = useState(0)  // bumps as points stream in

  const pointsRef = useRef<[number, number][]>(clip.voiceMap?.points ?? [])
  const bufferRef = useRef<AudioBuffer | null>(null)      // session-only replay audio
  const audioAnchorBeatRef = useRef(0)                    // absolute beat where the take began
  const gainRef = useRef<GainNode | null>(null)
  const srcRef = useRef<AudioBufferSourceNode | null>(null)
  const stopFnRef = useRef<() => void>(() => {})
  const clipIdRef = useRef(clip.id)

  // Fresh clip in the roll → adopt its stored trace, drop the old take's audio
  useEffect(() => {
    if (clipIdRef.current === clip.id) return
    clipIdRef.current = clip.id
    stopFnRef.current()
    pointsRef.current = clip.voiceMap?.points ?? []
    setOffsetMs(clip.voiceMap?.offsetMs ?? 0)
    bufferRef.current = null
    killReplay()
    setVersion(v => v + 1)
  }, [clip.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function ensureGain(): GainNode {
    if (!gainRef.current) {
      gainRef.current = engine.ctx.createGain()
      gainRef.current.connect(engine.ctx.destination)  // own bus — master FX never color the reference vocal
    }
    return gainRef.current
  }

  function killReplay() {
    try { srcRef.current?.stop() } catch { /* not started */ }
    srcRef.current = null
  }

  function msToBeats(ms: number) { return engine.secondsToBeats(ms / 1000) }

  function scheduleReplay() {
    killReplay()
    const buf = bufferRef.current
    if (!buf || !engine.isPlaying) return
    const g = ensureGain()
    g.gain.value = volume
    const startBeat = audioAnchorBeatRef.current + msToBeats(offsetMs)
    const cur = engine.currentBeat
    const src = engine.ctx.createBufferSource()
    src.buffer = buf
    src.connect(g)
    if (cur <= startBeat) {
      src.start(engine.ctx.currentTime + engine.beatsToSeconds(startBeat - cur))
    } else {
      const offsetSec = engine.beatsToSeconds(cur - startBeat)
      if (offsetSec >= buf.duration) return
      src.start(engine.ctx.currentTime, offsetSec)
    }
    srcRef.current = src
  }
  const scheduleRef = useRef(scheduleReplay)
  scheduleRef.current = scheduleReplay

  // Replay follows the transport
  useEffect(() => {
    function onTransport(e: Event) {
      const { playing } = (e as CustomEvent).detail as { playing: boolean }
      if (playing) scheduleRef.current()
      else killReplay()
    }
    function onSeek() { if (engine.isPlaying) scheduleRef.current(); else killReplay() }
    engine.addEventListener('transport', onTransport)
    engine.addEventListener('seek', onSeek)
    return () => {
      engine.removeEventListener('transport', onTransport)
      engine.removeEventListener('seek', onSeek)
    }
  }, [engine])

  // Unmount: stop capture and replay
  useEffect(() => () => { stopFnRef.current(); killReplay() }, [])  

  async function start() {
    if (recording) return
    const ctx = engine.ctx
    if (ctx.state === 'suspended') await ctx.resume()
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch {
      alert('Microphone access is needed for voice mapping.')
      return
    }

    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)  // analysis only — the mic is never monitored out loud

    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    recorder.start()

    if (!engine.isPlaying) engine.play()
    const anchorBeat = engine.currentBeat
    const anchorTime = ctx.currentTime
    audioAnchorBeatRef.current = anchorBeat
    pointsRef.current = []
    killReplay()

    // First take on a fresh context: default the delay to the measurable half
    // of the round trip (output latency) — the rest is nudged by ear.
    if (!clip.voiceMap && offsetMs === 0) {
      const auto = -Math.round(((ctx.outputLatency ?? 0) + (ctx.baseLatency ?? 0)) * 1000)
      if (auto !== 0) setOffsetMs(auto)
    }

    const frame = new Float32Array(analyser.fftSize)
    const clipStart = clip.startBeat
    const poll = window.setInterval(() => {
      analyser.getFloatTimeDomainData(frame)
      const elapsed = ctx.currentTime - anchorTime
      if (elapsed > MAX_RECORD_SEC) { stopFnRef.current(); return }
      const r = detectPitch(frame, ctx.sampleRate)
      if (r) {
        const beatAbs = anchorBeat + engine.secondsToBeats(elapsed)
        pointsRef.current.push([beatAbs - clipStart, r.midi])
      }
      setVersion(v => v + 1)
    }, POLL_MS)

    stopFnRef.current = () => {
      clearInterval(poll)
      stopFnRef.current = () => {}
      const done = new Promise<Blob>(resolve => { recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType })) })
      recorder.stop()
      void done.then(async blob => {
        try {
          bufferRef.current = await ctx.decodeAudioData(await blob.arrayBuffer())
          if (engine.isPlaying) scheduleRef.current()
        } catch { /* replay unavailable; the trace still stands */ }
      })
      source.disconnect()
      stream.getTracks().forEach(t => t.stop())
      setRecording(false)
      // Persist the trace on the clip (audio stays in-session)
      const rounded = pointsRef.current.map(([b, m]) => [Math.round(b * 1000) / 1000, Math.round(m * 100) / 100] as [number, number])
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { voiceMap: { offsetMs, points: rounded } } })
    }
    setRecording(true)
  }

  function stop() { stopFnRef.current() }

  function clear() {
    stopFnRef.current()
    killReplay()
    pointsRef.current = []
    bufferRef.current = null
    setVersion(v => v + 1)
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { voiceMap: undefined } })
  }

  function setVolume(v: number) {
    setVolumeState(v)
    if (gainRef.current) gainRef.current.gain.value = v
  }

  function nudgeOffset(deltaMs: number) {
    const next = Math.max(-500, Math.min(250, offsetMs + deltaMs))
    setOffsetMs(next)
    if (pointsRef.current.length) {
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { voiceMap: { offsetMs: next, points: pointsRef.current } } })
    }
    // reschedule after the re-render so the replay picks up the new offset
    if (engine.isPlaying) setTimeout(() => scheduleRef.current(), 0)
  }

  return {
    recording, visible, volume, offsetMs, version,
    hasTrace: pointsRef.current.length > 0 || recording,
    hasAudio: bufferRef.current !== null,
    points: pointsRef,
    start, stop, clear, setVisible, setVolume, nudgeOffset,
  }
}

// ── Overlay ribbon (renders inside the roll's scrolled note plane) ────────────

export function VoiceMapTrace({ vm, beatW, rowH, scrollLeft, scrollTop, totalW, offsetBeats }: {
  vm: VoiceMap; beatW: number; rowH: number; scrollLeft: number; scrollTop: number; totalW: number
  offsetBeats: number  // the delay compensation, converted to beats at the project tempo
}) {
  void vm.version  // re-render as points stream in while recording
  if (!vm.visible || !vm.hasTrace) return null
  const pts = vm.points.current
  const gapBeats = 0.3  // silence longer than this breaks the ribbon
  const glow = buildPath(pts, beatW, rowH, offsetBeats, gapBeats)
  return (
    <div style={{ position: 'absolute', top: -scrollTop, left: -scrollLeft, pointerEvents: 'none', zIndex: 3 }}>
      <svg width={totalW} height={NUM_NOTES * rowH} style={{ display: 'block', overflow: 'visible' }}>
        <path d={glow} fill="none" stroke={TRACE_COLOR} strokeOpacity={0.28}
          strokeWidth={Math.max(4, rowH * 0.9)} strokeLinecap="round" strokeLinejoin="round" />
        <path d={glow} fill="none" stroke={TRACE_COLOR} strokeOpacity={0.85}
          strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function buildPath(pts: [number, number][], beatW: number, rowH: number, offsetBeats: number, gapBeats: number): string {
  let d = ''
  let prevBeat = -Infinity
  for (const [beat, midi] of pts) {
    const x = (beat + offsetBeats) * beatW
    const y = (NUM_NOTES - 1 - midi) * rowH + rowH / 2
    d += beat - prevBeat > gapBeats ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`
    prevBeat = beat
  }
  return d
}

// ── Toolbar cluster ───────────────────────────────────────────────────────────

export function VoiceMapControls({ vm }: { vm: VoiceMap }) {
  const btn: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600,
    padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: '1px solid #333',
    background: '#222', color: '#aaa', whiteSpace: 'nowrap',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <button
        onClick={() => vm.recording ? vm.stop() : vm.start()}
        title={vm.recording ? 'Stop voice mapping' : 'Voice mapping: sing along and your pitch lands on the roll as a guide'}
        style={{
          ...btn,
          border: vm.recording ? '1px solid #ef4444' : `1px solid ${TRACE_COLOR}55`,
          background: vm.recording ? 'rgba(239,68,68,0.2)' : 'rgba(34,211,238,0.08)',
          color: vm.recording ? '#ef4444' : TRACE_COLOR,
        }}
      >
        <Mic size={10} /> {vm.recording ? '● Stop' : 'Voice'}
      </button>

      {vm.hasTrace && !vm.recording && (
        <>
          <input
            type="range" min={0} max={1} step={0.05} value={vm.volume}
            onChange={e => vm.setVolume(Number(e.target.value))}
            title={vm.hasAudio ? 'Voice playback volume' : 'Voice playback volume (this take has no audio — re-record to hear it)'}
            style={{ width: 52, accentColor: TRACE_COLOR }}
          />
          <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, color: '#888' }} title="Input-delay compensation — shifts the trace and playback earlier/later">
            <button onClick={() => vm.nudgeOffset(-10)} style={{ ...btn, padding: '1px 5px' }}>−</button>
            <span style={{ minWidth: 40, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{vm.offsetMs}ms</span>
            <button onClick={() => vm.nudgeOffset(10)} style={{ ...btn, padding: '1px 5px' }}>+</button>
          </span>
          <button onClick={() => vm.setVisible(!vm.visible)} title={vm.visible ? 'Hide voice trace' : 'Show voice trace'} style={btn}>
            {vm.visible ? <Eye size={10} /> : <EyeOff size={10} />}
          </button>
          <button onClick={vm.clear} title="Clear voice mapping" style={btn}><X size={10} /></button>
        </>
      )}
    </div>
  )
}
