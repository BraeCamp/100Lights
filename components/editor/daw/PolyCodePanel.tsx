'use client'

// "Code" tab of the sound library: write a small script that generates MIDI
// notes + a poly synth patch with math, run it safely (Web Worker), and add it
// to the project as a poly track. See lib/poly-code.ts for the runtime + the
// /learn/code-a-poly-track-with-math explainer.
import { useState } from 'react'
import { useDaw } from '@/lib/daw-state'
import type { MidiClip } from '@/lib/daw-types'
import { runPolyCode, POLY_CODE_EXAMPLES, type GeneratedTrack } from '@/lib/poly-code'

export default function PolyCodePanel({ onDone }: { onDone?: () => void } = {}) {
  const { project, dispatch, setView, setSelectedTrackId, setExpandedPianoRollClipId } = useDaw()
  const [code, setCode] = useState(POLY_CODE_EXAMPLES[0].code)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<GeneratedTrack | null>(null)

  const bars = Math.max(1, Math.round(project.loopEnd / project.timeSignatureNum) || 4)

  async function run(): Promise<GeneratedTrack | null> {
    setRunning(true)
    setError(null)
    const res = await runPolyCode(code, { tempo: project.tempo, bars })
    setRunning(false)
    if (!res.ok) {
      setError(res.error)
      setPreview(null)
      return null
    }
    if (res.track.notes.length === 0) {
      setError('Script ran, but produced no notes. Return { notes: [...] }.')
      setPreview(null)
      return null
    }
    setPreview(res.track)
    return res.track
  }

  async function addToProject() {
    const track = preview ?? (await run())
    if (!track) return
    const trackId = crypto.randomUUID()
    dispatch({
      type: 'ADD_TRACK',
      id: trackId,
      name: track.name,
      instrument: { type: 'poly', params: track.params },
    })
    const clip: MidiClip = {
      kind: 'midi',
      id: crypto.randomUUID(),
      trackId,
      name: track.name,
      startBeat: 0,
      durationBeats: track.durationBeats,
      notes: track.notes.map((n) => ({ id: crypto.randomUUID(), ...n })),
      isDrumClip: false,
    }
    dispatch({ type: 'ADD_CLIP', clip })
    setSelectedTrackId(trackId)
    setExpandedPianoRollClipId(clip.id)
    setView('arrangement')
    onDone?.()
  }

  const btn: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 6,
    cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-card)',
    color: 'var(--text-primary)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Examples */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', width: '100%', marginBottom: 2 }}>
          Generate a poly track with math ·{' '}
          <a href="/learn/code-a-poly-track-with-math" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
            how it works ↗
          </a>
        </span>
        {POLY_CODE_EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            onClick={() => { setCode(ex.code); setPreview(null); setError(null) }}
            style={{ ...btn, fontSize: 9.5, fontWeight: 600, padding: '3px 8px' }}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* Code editor */}
      <textarea
        value={code}
        onChange={(e) => { setCode(e.target.value); setPreview(null) }}
        spellCheck={false}
        style={{
          flex: 1, minHeight: 120, resize: 'none', border: 'none', outline: 'none',
          padding: '10px 12px', background: 'var(--bg-app)', color: 'var(--text-primary)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5,
          lineHeight: 1.5, tabSize: 2,
        }}
      />

      {/* Status + actions */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
        {error && (
          <div style={{ fontSize: 10.5, color: 'var(--danger, #ef4444)', fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap' }}>
            {error}
          </div>
        )}
        {preview && !error && (
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
            “{preview.name}” · {preview.notes.length} note{preview.notes.length !== 1 ? 's' : ''} ·{' '}
            {preview.durationBeats} beats · {preview.params.waveform}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={run} disabled={running} style={{ ...btn, opacity: running ? 0.6 : 1 }}>
            {running ? 'Running…' : 'Run'}
          </button>
          <button
            onClick={addToProject}
            disabled={running}
            style={{ ...btn, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', marginLeft: 'auto' }}
          >
            Add track
          </button>
        </div>
      </div>
    </div>
  )
}
