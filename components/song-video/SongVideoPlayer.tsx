'use client'

import { useEffect, useRef, useState } from 'react'
import { mountSongVideo } from '@/lib/song-video/engine.mjs'
import { FORMATS } from '@/lib/song-video/formats.mjs'

// Turn a song (from lib/song-video/from-project) into a vertical, beat-synced
// video: pick a format, preview, and download it. The reusable heart of the
// "turn my song into a video" feature — used in the admin lab now, the studio next.

type HookLine = { text: string; accent?: boolean }
type SongData = { tempo: number; keyLabel?: string; genre?: string; tracks: { name: string; color: string }[]; notes: unknown[]; loopBeats?: number }

export default function SongVideoPlayer({ song, meta, accent = '#a78bfa', hook, slug = 'song-video', projectId, canPublish = false }: {
  song: SongData; meta?: string; accent?: string; hook?: HookLine[]; slug?: string; projectId?: string; canPublish?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instRef = useRef<ReturnType<typeof mountSongVideo> | null>(null)
  const [fmt, setFmt] = useState('falling-notes')
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
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

  // Record one loop of the current format (canvas + preview audio) to a webm blob.
  // Shared by Download and Send-to-pipeline so both capture the exact same render.
  async function recordBlob(): Promise<Blob | null> {
    const i = instRef.current, canvas = canvasRef.current; if (!i || !canvas) return null
    setStatus('Recording…'); i.play(); setPlaying(true); playingRef.current = true
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
    return new Blob(chunks, { type: 'video/webm' })
  }

  async function exportVideo() {
    if (busy) return
    setBusy(true)
    try {
      const blob = await recordBlob(); if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = `${slug}-${fmt}.webm`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
      setStatus('Downloaded ✓')
    } catch { setStatus('Export failed') }
    setBusy(false)
    setTimeout(() => setStatus(null), 2500)
  }

  // Render the video and send it to the in-app content queue (admin only): POST
  // the webm + musical metadata to /api/admin/content, which drafts a caption and
  // files it as a draft. From there you review, approve, and publish — all in the
  // admin Content panel. Nothing posts anywhere without your explicit approval.
  async function sendToQueue() {
    if (busy) return
    setBusy(true)
    try {
      const blob = await recordBlob(); if (!blob) { setBusy(false); return }
      setStatus('Sending…')
      const meta = {
        projectId,
        slug,
        format: fmt,
        musical: {
          bpm: Math.round(song.tempo),
          key: song.keyLabel ?? null,
          time_signature: '4/4',
          genre_tags: song.genre ? [song.genre] : [],
          instrument_list: song.tracks.map(t => t.name),
        },
      }
      const fd = new FormData()
      fd.append('capture', new File([blob], `${slug}-${fmt}.webm`, { type: 'video/webm' }))
      fd.append('meta', JSON.stringify(meta))
      const res = await fetch('/api/admin/content', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      setStatus(res.ok ? 'Sent to queue ✓' : `Failed: ${j.error || res.status}`)
    } catch { setStatus('Send failed') }
    setBusy(false)
    setTimeout(() => setStatus(null), 4000)
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
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={toggle} disabled={busy} style={{ ...btn, opacity: busy ? 0.5 : 1 }}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={exportVideo} disabled={busy} style={{ ...btn, ...(canPublish ? {} : { background: accent, color: '#0a0812', border: 'none', fontWeight: 700 }), opacity: busy ? 0.6 : 1 }}>Download</button>
        {canPublish && <button onClick={sendToQueue} disabled={busy} style={{ ...btn, background: accent, color: '#0a0812', border: 'none', fontWeight: 700, opacity: busy ? 0.7 : 1 }}>{busy && status ? status : 'Send to queue →'}</button>}
      </div>
      {status && !busy && <p style={{ fontSize: 12, fontWeight: 600, color: status.startsWith('Failed') || status.endsWith('failed') ? '#f87171' : '#4ade80', textAlign: 'center', margin: 0 }}>{status}</p>}
      <p style={{ fontSize: 11.5, color: 'var(--text-muted,#8b88a8)', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
        {canPublish
          ? <><b>Send to queue</b> files this render + a drafted caption in the admin Content queue. You review, approve, and publish there — nothing posts without your approval.</>
          : <>Download uses the preview synth. The auto-posted render swaps in the real mixed audio.</>}
      </p>
    </div>
  )
}

const pill = (on: boolean, accent: string): React.CSSProperties => ({ fontSize: 12, fontWeight: 700, color: on ? '#0a0812' : '#8b88a8', background: on ? accent : '#141220', border: `1px solid ${on ? accent : '#2a2740'}`, borderRadius: 999, padding: '6px 13px', cursor: 'pointer' })
const btn: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary,#cfceda)', background: 'var(--bg-surface,#17171b)', border: '1px solid var(--border,#26262b)', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }
