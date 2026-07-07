'use client'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDaw } from '@/lib/daw-state'
import { captureAudioInput, listAudioInputDevices } from '@/lib/audio-capture'
import type { AudioDevice } from '@/lib/audio-capture'
import type { DawTrack } from '@/lib/daw-types'

interface Props {
  track: DawTrack
  anchorEl: HTMLElement
  onClose: () => void
}

type TestState = 'idle' | 'testing' | 'error'

export default function TrackInputCard({ track, anchorEl, onClose }: Props) {
  const { dispatch } = useDaw()
  const [devices,     setDevices]    = useState<AudioDevice[]>([])
  const [loadingDevs, setLoadingDevs] = useState(true)
  const [testState,   setTestState]  = useState<TestState>('idle')
  const [level,       setLevel]      = useState(0)
  const [errMsg,      setErrMsg]     = useState('')
  const monitorRef = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null)

  // Enumerate devices on mount
  useEffect(() => {
    listAudioInputDevices(true).then(devs => {
      setDevices(devs)
      setLoadingDevs(false)
    }).catch(() => setLoadingDevs(false))
  }, [])

  // Position below (or above if near bottom) the anchor button
  const rect      = anchorEl.getBoundingClientRect()
  const cardW     = 256
  const left      = Math.min(rect.left, window.innerWidth - cardW - 8)
  const spaceBelow = window.innerHeight - rect.bottom
  const top       = spaceBelow > 220 ? rect.bottom + 4 : rect.top - 4

  // Close on outside click or Escape
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const card = document.getElementById('track-input-card')
      if (card && !card.contains(e.target as Node) && !anchorEl.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorEl, onClose])

  useEffect(() => () => { stopTest() }, [])

  async function startTest(src: string) {
    stopTest()
    setErrMsg('')
    setTestState('testing')
    try {
      const stream  = await captureAudioInput(src)
      const ctx     = new AudioContext()
      const srcNode = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      srcNode.connect(analyser)
      const data = new Float32Array(analyser.frequencyBinCount)
      let smoothed = 0

      function tick() {
        if (!monitorRef.current) return
        analyser.getFloatTimeDomainData(data)
        let sum = 0
        for (const v of data) sum += v * v
        const rms = Math.sqrt(sum / data.length)
        // Noise gate + scale: silence below ~60 dBFS reads as 0
        const target = rms > 0.005 ? Math.min(1, rms * 25) : 0
        // Fast attack, slow decay (~0.4 s to fall from peak to zero)
        smoothed = target > smoothed ? target : Math.max(0, smoothed * 0.88)
        setLevel(smoothed)
        monitorRef.current.raf = requestAnimationFrame(tick)
      }
      const raf = requestAnimationFrame(tick)
      monitorRef.current = { stream, ctx, raf }
    } catch (e) {
      setTestState('error')
      setErrMsg(e instanceof Error ? e.message : 'Access denied')
    }
  }

  function stopTest() {
    if (monitorRef.current) {
      cancelAnimationFrame(monitorRef.current.raf)
      monitorRef.current.stream.getTracks().forEach(t => t.stop())
      monitorRef.current.ctx.close()
      monitorRef.current = null
    }
    setTestState('idle')
    setLevel(0)
  }

  function selectSource(src: string | null) {
    dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { inputSource: src } })
    if (!src) stopTest()
  }

  const cur = track.inputSource ?? null

  // All selectable options: None, then real mic devices, then Computer Audio
  const allOptions: Array<{ id: string | null; label: string; desc?: string }> = [
    { id: null, label: 'None', desc: 'No external input' },
    ...devices.map(d => ({ id: d.id, label: d.label })),
    { id: 'system', label: 'Computer Audio', desc: 'Internal audio — works even when output is muted' },
  ]

  const card = (
    <div
      id="track-input-card"
      style={{
        position: 'fixed', top, left, width: cardW, zIndex: 9999,
        background: '#161616', border: '1px solid #2e2e2e', borderRadius: 8,
        padding: '10px 12px', boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 700, color: '#666', letterSpacing: '0.08em', marginBottom: 8 }}>
        INPUT — {track.name.toUpperCase()}
      </div>

      {loadingDevs ? (
        <div style={{ padding: '10px 0', fontSize: 11, color: '#555', textAlign: 'center' }}>Loading devices…</div>
      ) : (
        allOptions.map(({ id, label, desc }) => {
          const active = cur === id
          return (
            <button
              key={String(id)}
              onClick={() => selectSource(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                padding: '6px 8px', marginBottom: 3, borderRadius: 5, cursor: 'pointer',
                border: `1px solid ${active ? 'rgba(61,143,239,0.5)' : '#222'}`,
                background: active ? 'rgba(61,143,239,0.10)' : 'transparent',
              }}
            >
              <div style={{
                width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                border: `1.5px solid ${active ? '#3d8fef' : '#444'}`,
                background: active ? '#3d8fef' : 'transparent',
              }} />
              <div>
                <div style={{ fontSize: 11, color: active ? '#a8d4ff' : '#aaa', fontWeight: active ? 600 : 400 }}>
                  {label}
                </div>
                {desc && <div style={{ fontSize: 9, color: '#555', marginTop: 1 }}>{desc}</div>}
              </div>
            </button>
          )
        })
      )}

      {/* Test panel */}
      {cur && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #222' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={() => testState === 'testing' ? stopTest() : startTest(cur)}
              style={{
                fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', flexShrink: 0,
                border: `1px solid ${testState === 'testing' ? '#ef4444' : '#3d8fef'}`,
                background: testState === 'testing' ? 'rgba(239,68,68,0.10)' : 'rgba(61,143,239,0.10)',
                color: testState === 'testing' ? '#ef4444' : '#3d8fef',
              }}
            >
              {testState === 'testing' ? 'Stop' : 'Test'}
            </button>

            {testState === 'testing' && (
              <div style={{ flex: 1, height: 8, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden', border: '1px solid #2a2a2a' }}>
                <div style={{
                  height: '100%', width: `${level * 100}%`,
                  background: level > 0.8 ? '#ef4444' : level > 0.5 ? '#eab308' : '#22c55e',
                  borderRadius: 3,
                }} />
              </div>
            )}

            {testState === 'idle' && cur && (
              <span style={{ fontSize: 9, color: '#444' }}>
                {allOptions.find(o => o.id === cur)?.label ?? cur}
              </span>
            )}
          </div>

          {testState === 'error' && (
            <div style={{ fontSize: 9, color: '#ef4444', marginTop: 4 }}>{errMsg}</div>
          )}
        </div>
      )}
    </div>
  )

  return createPortal(card, document.body)
}
