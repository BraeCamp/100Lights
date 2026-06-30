'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, Loader2 } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import { isAudioClip } from '@/lib/daw-types'

interface Props {
  onClose: () => void
}

export default function AudioExportModal({ onClose }: Props) {
  const { project, engine } = useDaw()
  const [phase, setPhase] = useState<'idle' | 'recording' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const ivRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const endBeat = Math.max(
    project.arrangementClips.filter(isAudioClip).reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 0),
    project.loopEnd,
    8,
  )

  // Clean up if modal unmounts mid-export
  useEffect(() => () => {
    if (ivRef.current) clearInterval(ivRef.current)
    if (engine.isRecording) { engine.stop(); void engine.stopRecording() }
  }, [engine])

  async function startExport() {
    setPhase('recording')
    setProgress(0)
    engine.seek(0)
    await engine.startRecording()
    engine.play()

    ivRef.current = setInterval(() => {
      const beat = engine.currentBeat
      setProgress(Math.min(0.99, beat / endBeat))
      if (beat >= endBeat) {
        clearInterval(ivRef.current!)
        ivRef.current = null
        engine.stop()
        void engine.stopRecording().then(blob => {
          if (!blob) { setPhase('error'); return }
          setDownloadUrl(URL.createObjectURL(blob))
          setProgress(1)
          setPhase('done')
        })
      }
    }, 100)
  }

  const safeName = (project.name ?? 'export').replace(/[^a-z0-9_\-\s]/gi, '').trim() || 'export'
  const filename = `${safeName}.webm`

  const overlay = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={phase === 'recording' ? undefined : onClose}
    >
      <div
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 12, width: 360, overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Export Audio</span>
          {phase !== 'recording' && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '20px 18px 22px' }}>
          {phase === 'idle' && (
            <>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 18, lineHeight: 1.5 }}>
                Plays your project from beat 1 to the end while capturing the master output. Exports as <strong style={{ color: 'var(--text-primary)' }}>WebM/Opus</strong>.
              </p>
              <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-muted)', marginBottom: 22 }}>
                <span>Duration: ~{Math.ceil(engine.beatsToSeconds(endBeat))}s</span>
                <span>·</span>
                <span>File: {filename}</span>
              </div>
              <button
                onClick={() => void startExport()}
                style={{
                  width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
                  background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Start Export
              </button>
            </>
          )}

          {phase === 'recording' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <Loader2 size={16} color="var(--accent-light)" style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Rendering… do not close this window</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  background: 'var(--accent)',
                  width: `${Math.round(progress * 100)}%`,
                  transition: 'width 0.1s linear',
                }} />
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'right' }}>
                {Math.round(progress * 100)}%
              </p>
            </>
          )}

          {phase === 'done' && downloadUrl && (
            <>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 18 }}>
                Export complete. Click below to download.
              </p>
              <a
                href={downloadUrl}
                download={filename}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
                  background: '#22c55e', color: '#fff', fontSize: 13, fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                <Download size={14} /> Download {filename}
              </a>
            </>
          )}

          {phase === 'error' && (
            <p style={{ fontSize: 12, color: '#ef4444' }}>Export failed. Please try again.</p>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : null
}
