'use client'

/**
 * Record what you're doing in the studio — screen plus the DAW's own audio —
 * then preview it and save it.
 *
 * Audio is tapped from the engine's master bus rather than from system
 * capture, so what lands in the file is exactly what the studio played: no
 * notification sounds, no other tabs, no platform gaps.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDaw } from '@/lib/daw-state'
import {
  ScreenRecorder as Recorder,
  formatDuration,
  formatSize,
  screenRecordingSupported,
  type RecordingResult,
} from '@/lib/screen-recorder'

export default function ScreenRecorderPanel({ onClose }: { onClose: () => void }) {
  const { engine, project } = useDaw()
  const recRef = useRef<Recorder | null>(null)
  const [state, setState] = useState<'idle' | 'recording' | 'done'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [includeMic, setIncludeMic] = useState(false)
  const [result, setResult] = useState<RecordingResult | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const supported = screenRecordingSupported()

  const finish = useCallback(async () => {
    const r = await recRef.current?.stop() ?? null
    setState(r ? 'done' : 'idle')
    if (r) {
      setResult(r)
      setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(r.blob) })
    }
  }, [])

  useEffect(() => {
    if (state !== 'recording') return
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [state])

  // Revoke the preview URL on unmount — a few of these per session is tens of
  // megabytes of blob held alive otherwise.
  useEffect(() => () => {
    recRef.current?.cleanup()
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }, [])

  async function start() {
    setError(null)
    const rec = new Recorder()
    recRef.current = rec
    rec.onExternalStop = () => { void finish() }
    try {
      await rec.start({
        masterNode: engine.masterCompressor,
        audioContext: engine.ctx,
        includeMic,
      })
      setElapsed(0)
      setState('recording')
    } catch (e) {
      // A cancelled picker throws NotAllowedError — that's a choice, not a fault.
      const msg = e instanceof Error && e.name === 'NotAllowedError'
        ? 'Screen sharing was cancelled.'
        : e instanceof Error ? e.message : 'Could not start recording.'
      setError(msg)
      rec.cleanup()
      setState('idle')
    }
  }

  function download() {
    if (!result || !previewUrl) return
    const ext = result.mimeType.includes('mp4') ? 'mp4' : 'webm'
    const name = (project.name || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const a = Object.assign(document.createElement('a'), { href: previewUrl, download: `${name || 'session'}.${ext}` })
    document.body.appendChild(a); a.click(); a.remove()
  }

  function reset() {
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    setResult(null)
    setState('idle')
  }

  return (
    <div style={{
      position: 'fixed', right: 18, bottom: 84, zIndex: 60, width: 330,
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
      padding: '14px 16px', boxShadow: '0 18px 50px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text-primary)' }}>Record session</span>
        <button onClick={onClose} aria-label="Close"
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
      </div>

      {!supported && (
        <p style={{ fontSize: 11.5, color: '#f59e0b', lineHeight: 1.6, margin: 0 }}>
          This browser can&rsquo;t capture the screen. Chrome, Edge or Firefox on desktop can.
        </p>
      )}

      {supported && state === 'idle' && (
        <>
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.65, margin: '0 0 10px' }}>
            Captures your screen plus the studio&rsquo;s audio straight from the mixer — not system
            sound, so nothing else on your machine ends up in the take.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={includeMic} onChange={e => setIncludeMic(e.target.checked)} />
            Also record my microphone
          </label>
          <button onClick={() => void start()}
            style={{ width: '100%', padding: '9px 0', borderRadius: 9, border: 'none', background: '#dc2626', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            ● Start recording
          </button>
        </>
      )}

      {state === 'recording' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 5, background: '#dc2626', animation: 'pulse 1.2s infinite' }} />
            <span style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', fontWeight: 700 }}>
              {formatDuration(elapsed * 1000)}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {includeMic ? 'screen + studio + mic' : 'screen + studio'}
            </span>
          </div>
          <button onClick={() => void finish()}
            style={{ width: '100%', padding: '9px 0', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            ■ Stop
          </button>
        </>
      )}

      {state === 'done' && result && previewUrl && (
        <>
          <video src={previewUrl} controls playsInline
            style={{ width: '100%', borderRadius: 9, border: '1px solid var(--border)', display: 'block', marginBottom: 8, background: '#000' }} />
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 10px' }}>
            {formatDuration(result.durationMs)} · {formatSize(result.sizeBytes)}
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={download}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Save video
            </button>
            <button onClick={reset}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>
              Record another
            </button>
          </div>
        </>
      )}

      {error && (
        <p style={{ fontSize: 11.5, color: '#ef4444', margin: '10px 0 0', lineHeight: 1.6 }}>{error}</p>
      )}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }`}</style>
    </div>
  )
}
