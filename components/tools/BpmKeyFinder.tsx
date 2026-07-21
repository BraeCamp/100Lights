'use client'

/**
 * BPM & key finder. Drop in an audio file; it decodes it, estimates the tempo
 * and the key, and shows both. Analysis runs entirely in the browser — the
 * file is never uploaded anywhere.
 */

import { useRef, useState } from 'react'
import { estimateTempo, estimateKey } from '@/lib/tempo-key'

const MAX_SECONDS = 45 // analysing a chunk keeps it fast and non-blocking enough

interface Result { bpm: number; key: string; mode: string; confidence: number; fileName: string }

export default function BpmKeyFinder() {
  const [state, setState] = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function analyze(file: File) {
    setState('analyzing'); setError(null); setResult(null)
    try {
      const buf = await file.arrayBuffer()
      const ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const audio = await ac.decodeAudioData(buf)
      void ac.close()

      // Downmix to mono, capped to the first MAX_SECONDS.
      const sr = audio.sampleRate
      const len = Math.min(audio.length, Math.floor(sr * MAX_SECONDS))
      const mono = new Float32Array(len)
      for (let ch = 0; ch < audio.numberOfChannels; ch++) {
        const data = audio.getChannelData(ch)
        for (let i = 0; i < len; i++) mono[i] += data[i] / audio.numberOfChannels
      }

      // Let the "analyzing" frame paint before the synchronous DSP runs.
      await new Promise(r => setTimeout(r, 30))
      const bpm = estimateTempo(mono, sr)
      const key = estimateKey(mono, sr)
      if (!bpm || !key) throw new Error('Could not analyse that audio.')
      setResult({ bpm, key: key.key, mode: key.mode, confidence: key.confidence, fileName: file.name })
      setState('done')
    } catch (e) {
      setError(e instanceof Error && /decode/i.test(e.message) ? 'That file could not be read as audio. Try an MP3, WAV, M4A, or OGG.' : (e instanceof Error ? e.message : 'Analysis failed.'))
      setState('error')
    }
  }

  function pick(files: FileList | null) {
    const f = files?.[0]
    if (f) void analyze(f)
  }

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 16, padding: '40px 20px', textAlign: 'center', cursor: 'pointer',
          background: dragging ? 'rgba(124,58,237,0.06)' : 'var(--bg-card)', transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <input ref={inputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => { pick(e.target.files); e.target.value = '' }} />
        {state === 'analyzing' ? (
          <div style={{ fontSize: 15, color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
            Analysing…
          </div>
        ) : (
          <>
            <div style={{ fontSize: 30, marginBottom: 10 }}>🎵</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Drop an audio file here</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>or click to choose · MP3, WAV, M4A, OGG · stays on your device</div>
          </>
        )}
      </div>

      {error && <p style={{ fontSize: 12.5, color: '#ef4444', textAlign: 'center', marginTop: 14 }}>{error}</p>}

      {state === 'done' && result && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.fileName}</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1, textAlign: 'center', padding: '20px 12px', borderRadius: 14, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Tempo</div>
              <div style={{ fontSize: 40, fontWeight: 800, color: 'var(--accent-light)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{result.bpm}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>BPM</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center', padding: '20px 12px', borderRadius: 14, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Key</div>
              <div style={{ fontSize: 40, fontWeight: 800, color: '#34d399', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{result.key}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{result.mode}</div>
            </div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12, lineHeight: 1.6 }}>
            Both are estimates{result.confidence < 0.3 ? ' — the key here is a close call, so double-check by ear' : ''}. Analysed the first {MAX_SECONDS} seconds.
          </p>
        </div>
      )}
    </div>
  )
}
