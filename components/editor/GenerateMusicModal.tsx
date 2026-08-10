'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, X } from 'lucide-react'
import { useDaw, makeAudioClip, extractPeaks } from '@/lib/daw-state'
import { uploadRecordingBlob } from '@/lib/record-upload'
import { generateSong, separateStems } from '@/lib/music-ai'

const EXAMPLE_PROMPTS = [
  'Warm lo-fi hip-hop with dusty piano and vinyl crackle',
  'Uplifting cinematic orchestral build with strings and brass',
  'Driving synthwave with punchy drums and an 80s bassline',
  'Chill acoustic guitar folk with soft brushed drums',
]

const LENGTH_OPTIONS = [
  { label: '10s', ms: 10000 },
  { label: '20s', ms: 20000 },
  { label: '30s', ms: 30000 },
  { label: '45s', ms: 45000 },
  { label: '60s', ms: 60000 },
  { label: '90s', ms: 90000 },
  { label: '120s', ms: 120000 },
]

export default function GenerateMusicModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dispatch, engine } = useDaw()

  const [prompt, setPrompt] = useState('')
  const [lengthMs, setLengthMs] = useState(30000)
  const [instrumental, setInstrumental] = useState(false)
  const [splitStems, setSplitStems] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  // Import one audio buffer as its own editable DAW track — mirrors the verified
  // audio-import template in AudioEditor.tsx (ADD_TRACK → makeAudioClip →
  // ADD_CLIP → decode → UPDATE_CLIP peaks/duration → persist to R2).
  async function importTrack(name: string, data: ArrayBuffer) {
    // Build the blob first: it snapshots the bytes, so decodeAudioData detaching
    // `data` below is harmless.
    const blob = new Blob([data], { type: 'audio/mpeg' })
    const url = URL.createObjectURL(blob)
    const trackId = crypto.randomUUID()
    dispatch({ type: 'ADD_TRACK', id: trackId, name })
    const clip = makeAudioClip(trackId, name, 0, 8, { audioUrl: url })
    dispatch({ type: 'ADD_CLIP', clip })
    const buf = await engine.loadBufferFromArrayBuffer(clip.id, data)
    if (buf) dispatch({
      type: 'UPDATE_CLIP', clipId: clip.id, patch: {
        waveformPeaks: extractPeaks(buf),
        durationBeats: engine.secondsToBeats(buf.duration),
        bufferDuration: buf.duration,
      },
    })
    void uploadRecordingBlob(blob, clip.id).then(k => k && dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { r2Key: k } }))
  }

  // Fire-and-forget: send what the AI PRODUCED (stems + prompt/params) to the learning corpus. Opt-out
  // is enforced server-side; any failure is swallowed so it never affects the user's generation.
  function captureGeneration(promptText: string, song: ArrayBuffer, stems: { name: string; data: ArrayBuffer }[]) {
    try {
      const fd = new FormData()
      fd.append('prompt', promptText)
      fd.append('params', JSON.stringify({ lengthMs, instrumental }))
      fd.append('model', 'music_v2')
      fd.append('mix', new File([song], 'mix.mp3', { type: 'audio/mpeg' }))
      for (const s of stems) fd.append('stem', new File([s.data], `${s.name}.wav`, { type: 'audio/wav' }))
      void fetch('/api/generation-capture', { method: 'POST', body: fd }).catch(() => {})
    } catch { /* never block generation */ }
  }

  async function handleGenerate() {
    const p = prompt.trim()
    if (!p || busy) return
    setBusy(true)
    setError(null)
    try {
      setStatus('Generating…')
      const song = await generateSong({ prompt: p, lengthMs, instrumental })

      if (splitStems) {
        setStatus('Separating stems…')
        const stems = await separateStems(song)
        if (!stems.length) throw new Error('No stems were returned.')
        setStatus('Importing tracks…')
        for (const stem of stems) await importTrack(stem.name, stem.data)
        captureGeneration(p, song, stems)   // → learning corpus (opt-out-gated server-side)
      } else {
        setStatus('Importing track…')
        const name = p.length > 40 ? p.slice(0, 40).trimEnd() + '…' : p
        await importTrack(name, song)
      }

      // Reset + close on success
      setBusy(false)
      setStatus('')
      onClose()
    } catch (e) {
      setBusy(false)
      setStatus('')
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    }
  }

  const chipStyle: React.CSSProperties = {
    fontSize: 10, padding: '4px 8px', borderRadius: 12, border: '1px solid var(--border)',
    background: 'var(--bg-surface)', color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1.3,
  }

  return createPortal(
    <div
      className="electron-nodrag"
      style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, width: 480, maxWidth: '92vw', boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} color="var(--accent)" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Generate music with AI</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Describe a song — it imports as editable tracks.</div>
            </div>
          </div>
          <button onClick={() => { if (!busy) onClose() }} disabled={busy}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: busy ? 'default' : 'pointer', padding: 2 }}>
            <X size={16} />
          </button>
        </div>

        {/* Prompt */}
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          disabled={busy}
          placeholder="e.g. Warm lo-fi hip-hop with dusty piano and vinyl crackle"
          rows={3}
          style={{ width: '100%', resize: 'vertical', fontSize: 12, padding: 10, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'inherit', marginBottom: 8 }}
        />

        {/* Example chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {EXAMPLE_PROMPTS.map(ex => (
            <button key={ex} onClick={() => setPrompt(ex)} disabled={busy} style={chipStyle}>{ex}</button>
          ))}
        </div>

        {/* Length */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Length</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {LENGTH_OPTIONS.map(opt => {
              const active = lengthMs === opt.ms
              return (
                <button key={opt.ms} onClick={() => setLengthMs(opt.ms)} disabled={busy}
                  style={{ fontSize: 11, padding: '4px 12px', borderRadius: 4, cursor: busy ? 'default' : 'pointer',
                    border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: active ? 'rgb(var(--accent-rgb) / 0.15)' : 'var(--bg-surface)',
                    color: active ? 'var(--accent-light)' : 'var(--text-muted)' }}>
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Toggles */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11, color: 'var(--text-primary)', cursor: busy ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={instrumental} disabled={busy} onChange={e => setInstrumental(e.target.checked)} />
          Instrumental only (no vocals)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 11, color: 'var(--text-primary)', cursor: busy ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={splitStems} disabled={busy} onChange={e => setSplitStems(e.target.checked)} />
          Split into stems (separate tracks)
        </label>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 24, marginBottom: 14 }}>
          Separates vocals, drums, bass and more onto their own tracks. Takes longer.
        </div>

        {/* Status / error */}
        {busy && (
          <div style={{ fontSize: 11, color: 'var(--accent-light)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
            {status}
          </div>
        )}
        {error && (
          <div style={{ fontSize: 11, color: '#ff6b6b', marginBottom: 12, background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.25)', borderRadius: 6, padding: '8px 10px' }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => { if (!busy) onClose() }} disabled={busy}
            style={{ fontSize: 11, padding: '6px 16px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: busy ? 'default' : 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleGenerate} disabled={busy || !prompt.trim()}
            style={{ fontSize: 11, padding: '6px 16px', borderRadius: 5, border: 'none', fontWeight: 600,
              background: (busy || !prompt.trim()) ? 'var(--border)' : 'var(--accent)',
              color: '#fff', cursor: (busy || !prompt.trim()) ? 'default' : 'pointer' }}>
            {busy ? 'Working…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
