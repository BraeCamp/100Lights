'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { mountSongVideo } from '@/lib/song-video/engine.mjs'
import { FORMATS } from '@/lib/song-video/formats.mjs'
import type { DawProject } from '@/lib/daw-types'

// Turn a song (from lib/song-video/from-project) into a vertical, beat-synced
// video. Beyond picking a format you can now edit the overlay text (+ font/size),
// the colour theme, the aspect ratio for different channels, and which slice of
// the song plays — then preview, download, or send it to the content queue.

type Note = { tr: number; p: number; s: number; d: number; v: number }
type SongData = { tempo: number; keyLabel?: string; genre?: string; tracks: { name: string; color: string; kind?: string }[]; notes: Note[]; loopBeats?: number }

const THEMES = [
  { id: 'midnight', name: 'Midnight', accent: '#a78bfa', bg: ['#0a0912', '#050409'] },
  { id: 'sunset', name: 'Sunset', accent: '#fb7185', bg: ['#1a0f14', '#0a0507'] },
  { id: 'mint', name: 'Mint', accent: '#34d399', bg: ['#08140f', '#040a08'] },
  { id: 'gold', name: 'Gold', accent: '#fbbf24', bg: ['#171106', '#0a0703'] },
  { id: 'ice', name: 'Ice', accent: '#38bdf8', bg: ['#08111a', '#04080d'] },
  { id: 'mono', name: 'Mono', accent: '#e5e7eb', bg: ['#0d0d0f', '#050506'] },
]
const FONTS = [
  { id: 'system-ui', name: 'Sans' },
  { id: "Georgia, 'Times New Roman', serif", name: 'Serif' },
  { id: "'Courier New', ui-monospace, monospace", name: 'Mono' },
  { id: "'Arial Narrow', 'Helvetica Neue', sans-serif", name: 'Condensed' },
  { id: "'Trebuchet MS', system-ui, sans-serif", name: 'Rounded' },
]
const ASPECTS = [
  { id: '9 / 16', name: '9:16', hint: 'Shorts · Reels · TikTok' },
  { id: '1 / 1', name: '1:1', hint: 'IG feed' },
  { id: '16 / 9', name: '16:9', hint: 'YouTube landscape' },
]

export default function SongVideoPlayer({ song, meta, accent = '#a78bfa', slug = 'song-video', projectId, canPublish = false, totalBeats, defaultStart = 0, dawProject, userId }: {
  song: SongData; meta?: string; accent?: string; slug?: string; projectId?: string; canPublish?: boolean; totalBeats?: number; defaultStart?: number; dawProject?: DawProject; userId?: string | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const instRef = useRef<ReturnType<typeof mountSongVideo> | null>(null)
  const playingRef = useRef(false)

  // Real project audio (bounced for the current section) — when set, the video
  // uses the actual mix instead of the preview synth.
  const [realUrl, setRealUrl] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)

  const [fmt, setFmt] = useState('falling-notes')
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Song section
  const songTotal = totalBeats ?? Math.max(32, Math.ceil(Math.max(0, ...song.notes.map(n => n.s + n.d))))
  const [winBeats, setWinBeats] = useState(32)
  const [startBeat, setStartBeat] = useState(Math.min(defaultStart, Math.max(0, songTotal - 32)))
  const maxStart = Math.max(0, songTotal - winBeats)
  const start = Math.min(startBeat, maxStart)

  // Text
  const [line1, setLine1] = useState('')
  const [line2, setLine2] = useState('')
  const [line2Accent, setLine2Accent] = useState(true)
  const [metaText, setMetaText] = useState(meta ?? '')
  const [font, setFont] = useState('system-ui')
  const [textScale, setTextScale] = useState(1)

  // Theme
  const [themeId, setThemeId] = useState('midnight')
  const [accentColor, setAccentColor] = useState(accent)
  const theme = THEMES.find(t => t.id === themeId) ?? THEMES[0]
  const bgKey = theme.bg.join(',')

  // Channel
  const [aspect, setAspect] = useState('9 / 16')

  const hookArr = useMemo(() => [
    { text: line1.trim(), accent: false },
    { text: line2.trim(), accent: line2Accent },
  ], [line1, line2, line2Accent])

  // The playing slice: notes in [start, start+winBeats), shifted to start at 0.
  const windowed = useMemo<SongData>(() => {
    const s1 = start + winBeats
    const notes = song.notes.filter(n => n.s >= start && n.s < s1).map(n => ({ ...n, s: n.s - start }))
    return { ...song, notes, loopBeats: winBeats }
  }, [song, start, winBeats])

  // Mount / remount only for structural changes (format, which slice plays, and
  // whether the real bounced audio is driving playback).
  useEffect(() => {
    if (!canvasRef.current) return
    const media = realUrl && audioRef.current ? audioRef.current : null
    const inst = mountSongVideo(canvasRef.current, windowed, {
      format: fmt, brand: '100LIGHTS', meta: metaText, accent: accentColor,
      hook: hookArr, loopBeats: windowed.loopBeats ?? 32,
      font, textScale, bg: theme.bg, media,
    })
    instRef.current = inst
    if (playingRef.current) inst.play()
    return () => inst.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fmt, windowed, realUrl])

  // The bounce is for one specific section — if you change the section, drop it
  // so playback falls back to the synth and prompts a re-bounce.
  useEffect(() => {
    setRealUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, winBeats])

  // Look edits apply live (no remount, no playback restart).
  useEffect(() => {
    instRef.current?.update({ hook: hookArr, meta: metaText, accent: accentColor, font, textScale, bg: theme.bg })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hookArr, metaText, accentColor, font, textScale, bgKey])

  function toggle() {
    const i = instRef.current; if (!i) return
    if (playing) { i.pause(); setPlaying(false); playingRef.current = false }
    else { i.play(); setPlaying(true); playingRef.current = true }
  }

  async function recordBlob(): Promise<Blob | null> {
    const i = instRef.current, canvas = canvasRef.current; if (!i || !canvas) return null
    setStatus('Recording…'); i.play(); setPlaying(true); playingRef.current = true
    const v = canvas.captureStream(30)
    // With real audio, capture the <audio> element's output; otherwise the synth.
    const mediaEl = audioRef.current as (HTMLAudioElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }) | null
    const a = realUrl && mediaEl && (mediaEl.captureStream || mediaEl.mozCaptureStream)
      ? (mediaEl.captureStream ? mediaEl.captureStream() : mediaEl.mozCaptureStream!())
      : i.getAudioStream()
    const stream = new MediaStream([...v.getVideoTracks(), ...(a ? a.getAudioTracks() : [])])
    const prefer = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    const mime = prefer.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm'
    const outType = mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm'
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    const done = new Promise<void>(res => { rec.onstop = () => res() })
    const durMs = winBeats * (60 / song.tempo) * 1000
    rec.start()
    await new Promise(r => setTimeout(r, durMs + 250))
    rec.stop(); await done
    return new Blob(chunks, { type: outType })
  }
  const extFor = (b: Blob) => (b.type.includes('mp4') ? 'mp4' : 'webm')

  async function exportVideo() {
    if (busy) return
    setBusy(true)
    try {
      const blob = await recordBlob(); if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = `${slug}-${fmt}.${extFor(blob)}`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
      setStatus('Downloaded ✓')
    } catch { setStatus('Export failed') }
    setBusy(false)
    setTimeout(() => setStatus(null), 2500)
  }

  async function sendToQueue() {
    if (busy) return
    setBusy(true)
    try {
      const blob = await recordBlob(); if (!blob) { setBusy(false); return }
      setStatus('Uploading…')
      const pres = await fetch('/api/admin/content/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: blob.type, slug }),
      })
      const pj = await pres.json().catch(() => ({}))
      if (!pres.ok) { setStatus(`Failed: ${pj.error || pres.status}`); setBusy(false); return }
      const put = await fetch(pj.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': pj.contentType } })
      if (!put.ok) { setStatus(`Upload failed: ${put.status}`); setBusy(false); return }

      setStatus('Filing…')
      const res = await fetch('/api/admin/content', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoKey: pj.key, projectId, slug, format: fmt,
          musical: {
            bpm: Math.round(song.tempo), key: song.keyLabel ?? null, time_signature: '4/4',
            genre_tags: song.genre ? [song.genre] : [], instrument_list: song.tracks.map(t => t.name),
          },
        }),
      })
      const j = await res.json().catch(() => ({}))
      setStatus(res.ok ? 'Sent to queue ✓' : `Failed: ${j.error || res.status}`)
    } catch { setStatus('Send failed') }
    setBusy(false)
    setTimeout(() => setStatus(null), 4000)
  }

  // Bounce the real project audio for the current section and swap it in for the
  // synth. Heavy (loads the audio engine + samples, real-time render), so it's
  // opt-in and lazy-imported; falls back to the synth on any failure.
  async function useRealAudio() {
    if (!dawProject || rendering || busy) return
    setRendering(true)
    const est = Math.round(winBeats * (60 / song.tempo) + 3)
    setStatus(`Rendering real mix… ~${est}s`)
    try {
      const { renderProjectAudioBlob } = await import('@/lib/song-video/render-audio')
      const blob = await renderProjectAudioBlob(dawProject, { startBeat: start, endBeat: start + winBeats, userId })
      const url = URL.createObjectURL(blob)
      if (audioRef.current) { audioRef.current.src = url; audioRef.current.loop = true; audioRef.current.load() }
      setRealUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url })
      setStatus('Real mix ✓')
    } catch { setStatus('Audio render failed — using synth') }
    setRendering(false)
    setTimeout(() => setStatus(null), 3000)
  }

  const secs = (winBeats * (60 / song.tempo)).toFixed(1)

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 440, margin: '0 auto' }}>
      <audio ref={audioRef} style={{ display: 'none' }} preload="auto" />
      {/* Format */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {Object.entries(FORMATS as Record<string, { name: string }>).map(([id, f]) => (
          <button key={id} onClick={() => setFmt(id)} style={pill(fmt === id, accentColor)}>{f.name}</button>
        ))}
      </div>

      {/* Preview */}
      <div style={{ position: 'relative', aspectRatio: aspect, borderRadius: 16, overflow: 'hidden', background: '#08070c', boxShadow: '0 12px 44px rgba(80,50,180,.28)', maxHeight: '62vh', margin: '0 auto', width: '100%' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        {!playing && (
          <button onClick={toggle} aria-label="Play" style={{ position: 'absolute', inset: 0, margin: 'auto', width: 64, height: 64, borderRadius: '50%', border: `2px solid ${accentColor}`, background: 'rgba(5,4,9,.4)', color: accentColor, fontSize: 22, paddingLeft: 4, cursor: 'pointer' }}>▶</button>
        )}
      </div>

      {/* Transport + export */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={toggle} disabled={busy} style={{ ...btn, opacity: busy ? 0.5 : 1 }}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={exportVideo} disabled={busy} style={{ ...btn, ...(canPublish ? {} : { background: accentColor, color: '#0a0812', border: 'none', fontWeight: 700 }), opacity: busy ? 0.6 : 1 }}>Download</button>
        {canPublish && <button onClick={sendToQueue} disabled={busy} style={{ ...btn, background: accentColor, color: '#0a0812', border: 'none', fontWeight: 700, opacity: busy ? 0.7 : 1 }}>{busy && status ? status : 'Send to queue →'}</button>}
      </div>
      {status && !busy && <p style={{ fontSize: 12, fontWeight: 600, color: status.startsWith('Failed') || status.endsWith('failed') ? '#f87171' : '#4ade80', textAlign: 'center', margin: 0 }}>{status}</p>}

      {/* ── Editing panel ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 14, background: 'var(--bg-surface,#141220)', border: '1px solid var(--border,#26262b)', borderRadius: 12, padding: 14 }}>
        {/* Section */}
        <Section label="Section of song">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={lbl}>Length</span>
            {[16, 32, 48, 64].map(b => (
              <button key={b} onClick={() => { setWinBeats(b); setStartBeat(s => Math.min(s, Math.max(0, songTotal - b))) }} style={chip(winBeats === b, accentColor)} disabled={b > songTotal}>{b} bars</button>
            ))}
            <span style={{ ...lbl, marginLeft: 'auto' }}>{secs}s</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={lbl}>Start</span>
            <input type="range" min={0} max={maxStart} step={1} value={start} onChange={e => setStartBeat(Number(e.target.value))} style={{ flex: 1, accentColor: accentColor }} />
            <span style={{ ...lbl, minWidth: 58, textAlign: 'right' }}>bar {Math.floor(start / 4) + 1}</span>
          </div>
        </Section>

        {/* Text */}
        <Section label="Text">
          <input value={line1} onChange={e => setLine1(e.target.value)} placeholder="Top line (optional)" style={field} maxLength={40} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={line2} onChange={e => setLine2(e.target.value)} placeholder="Second line (optional)" style={{ ...field, flex: 1 }} maxLength={40} />
            <label style={{ ...lbl, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={line2Accent} onChange={e => setLine2Accent(e.target.checked)} /> accent
            </label>
          </div>
          <input value={metaText} onChange={e => setMetaText(e.target.value)} placeholder="Meta line (key · bpm · genre)" style={field} maxLength={48} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={lbl}>Font</span>
            {FONTS.map(fo => <button key={fo.id} onClick={() => setFont(fo.id)} style={{ ...chip(font === fo.id, accentColor), fontFamily: fo.id }}>{fo.name}</button>)}
            <span style={{ ...lbl, marginLeft: 'auto' }}>Size</span>
            <input type="range" min={0.7} max={1.5} step={0.05} value={textScale} onChange={e => setTextScale(Number(e.target.value))} style={{ width: 90, accentColor: accentColor }} />
          </div>
        </Section>

        {/* Theme */}
        <Section label="Theme">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {THEMES.map(t => (
              <button key={t.id} onClick={() => { setThemeId(t.id); setAccentColor(t.accent) }} title={t.name}
                style={{ width: 26, height: 26, borderRadius: 8, cursor: 'pointer', border: themeId === t.id ? `2px solid ${t.accent}` : '2px solid transparent', background: `linear-gradient(135deg, ${t.accent} 0 50%, ${t.bg[0]} 50% 100%)` }} />
            ))}
            <span style={{ ...lbl, marginLeft: 8 }}>Accent</span>
            <input type="color" value={accentColor} onChange={e => setAccentColor(e.target.value)} style={{ width: 30, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }} />
          </div>
        </Section>

        {/* Audio */}
        {dawProject && (
          <Section label="Audio">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={useRealAudio} disabled={rendering || busy} style={{ ...chip(!!realUrl, accentColor), opacity: rendering ? 0.6 : 1 }}>
                {rendering ? 'Rendering…' : realUrl ? 'Real mix ✓ — re-bounce' : 'Use real mix'}
              </button>
              <span style={lbl}>{realUrl ? 'video uses your actual audio' : 'preview uses the synth — bounce this section for the real mix'}</span>
            </div>
          </Section>
        )}

        {/* Channel / aspect */}
        <Section label="Aspect (channel)">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ASPECTS.map(a => (
              <button key={a.id} onClick={() => setAspect(a.id)} style={chip(aspect === a.id, accentColor)} title={a.hint}>{a.name} <span style={{ opacity: 0.6, fontWeight: 500 }}>· {a.hint}</span></button>
            ))}
          </div>
        </Section>
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--text-muted,#8b88a8)', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
        {canPublish
          ? <><b>Send to queue</b> files this render + a drafted caption in the admin Content queue for review + publish. Hit <b>Use real mix</b> under Audio to bounce your actual song audio into the video instead of the synth.</>
          : <>Preview uses the synth.</>}
      </p>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted,#8b88a8)' }}>{label}</div>
      {children}
    </div>
  )
}

const pill = (on: boolean, accent: string): React.CSSProperties => ({ fontSize: 12, fontWeight: 700, color: on ? '#0a0812' : '#8b88a8', background: on ? accent : '#141220', border: `1px solid ${on ? accent : '#2a2740'}`, borderRadius: 999, padding: '6px 13px', cursor: 'pointer' })
const chip = (on: boolean, accent: string): React.CSSProperties => ({ fontSize: 11.5, fontWeight: 700, color: on ? '#0a0812' : 'var(--text-secondary,#cfceda)', background: on ? accent : 'transparent', border: `1px solid ${on ? accent : 'var(--border,#2a2740)'}`, borderRadius: 7, padding: '4px 9px', cursor: 'pointer' })
const btn: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary,#cfceda)', background: 'var(--bg-surface,#17171b)', border: '1px solid var(--border,#26262b)', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }
const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border,#26262b)', background: 'var(--bg-base,#0d0d0f)', color: 'var(--text-primary,#f1f0ff)', outline: 'none' }
const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted,#8b88a8)' }
