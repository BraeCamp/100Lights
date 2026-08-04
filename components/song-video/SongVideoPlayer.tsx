'use client'

import { useEffect, useRef, useState } from 'react'
import { mountSongVideo } from '@/lib/song-video/engine.mjs'
import { FORMATS } from '@/lib/song-video/formats.mjs'

// Turn a song (from lib/song-video/from-project) into a vertical, beat-synced
// video: pick a format, preview, and download it. The reusable heart of the
// "turn my song into a video" feature — used in the admin lab now, the studio next.

type HookLine = { text: string; accent?: boolean }
type SongData = { tempo: number; keyLabel?: string; tracks: { name: string; color: string }[]; notes: unknown[]; loopBeats?: number }

export default function SongVideoPlayer({ song, meta, accent = '#a78bfa', hook, slug = 'song-video' }: {
  song: SongData; meta?: string; accent?: string; hook?: HookLine[]; slug?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instRef = useRef<ReturnType<typeof mountSongVideo> | null>(null)
  const [fmt, setFmt] = useState('falling-notes')
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const playingRef = useRef(false)

  useEffect(() => {
    if (!canvasRef.current) return
    const inst = mountSongVideo(canvasRef.current, song, {
      format: fmt, brand: '100LIGHTS', meta, accent,
      hook: hook ?? [{ text: 'an AI wrote this' }, { text: 'in one pass.', accent: true }],
      loopBeats: song.loopBeats ?? 32,
    })
    instRef.current = inst
    if (playingRef.current) inst.play()
    return () => inst.destroy()
  }, [fmt]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle() {
    const i = instRef.current; if (!i) return
    if (playing) { i.pause(); setPlaying(false); playingRef.current = false }
    else { i.play(); setPlaying(true); playingRef.current = true }
  }

  async function exportVideo() {
    const i = instRef.current, canvas = canvasRef.current; if (!i || !canvas) return
    setStatus('Recording…'); i.play(); setPlaying(true); playingRef.current = true
    try {
      const v = canvas.captureStream(30)
      const a = i.getAudioStream()
      const stream = new MediaStream([...v.getVideoTracks(), ...(a ? a.getAudioTracks() : [])])
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm'
      const chunks: Blob[] = []
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      const done = new Promise<void>(res => { rec.onstop = () => res() })
      const durMs = (song.loopBeats ?? 32) * (60 / song.tempo) * 1000
      rec.start()
      await new Promise(r => setTimeout(r, durMs + 250))
      rec.stop(); await done
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = `${slug}-${fmt}.webm`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
      setStatus('Downloaded')
    } catch { setStatus('Export failed') }
    setTimeout(() => setStatus(null), 2500)
  }

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 400, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {Object.entries(FORMATS as Record<string, { name: string }>).map(([id, f]) => (
          <button key={id} onClick={() => setFmt(id)} style={pill(fmt === id, accent)}>{f.name}</button>
        ))}
      </div>
      <div style={{ position: 'relative', aspectRatio: '9 / 16', borderRadius: 16, overflow: 'hidden', background: '#08070c', boxShadow: '0 12px 44px rgba(80,50,180,.28)' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        {!playing && (
          <button onClick={toggle} aria-label="Play" style={{ position: 'absolute', inset: 0, margin: 'auto', width: 64, height: 64, borderRadius: '50%', border: `2px solid ${accent}`, background: 'rgba(5,4,9,.4)', color: accent, fontSize: 22, paddingLeft: 4, cursor: 'pointer' }}>▶</button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
        <button onClick={toggle} style={btn}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={exportVideo} disabled={!!status} style={{ ...btn, background: accent, color: '#0a0812', border: 'none', opacity: status ? 0.7 : 1 }}>{status ?? 'Download video'}</button>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted,#8b88a8)', textAlign: 'center', margin: 0 }}>Download uses the preview synth. The auto-posted render swaps in the real mixed audio.</p>
    </div>
  )
}

const pill = (on: boolean, accent: string): React.CSSProperties => ({ fontSize: 12, fontWeight: 700, color: on ? '#0a0812' : '#8b88a8', background: on ? accent : '#141220', border: `1px solid ${on ? accent : '#2a2740'}`, borderRadius: 999, padding: '6px 13px', cursor: 'pointer' })
const btn: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary,#cfceda)', background: 'var(--bg-surface,#17171b)', border: '1px solid var(--border,#26262b)', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }
