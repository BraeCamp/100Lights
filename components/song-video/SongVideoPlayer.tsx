'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { mountSongVideo } from '@/lib/song-video/engine.mjs'
import { FORMATS } from '@/lib/song-video/formats.mjs'
import type { DawProject } from '@/lib/daw-types'
import { encodeWav16 } from '@/lib/song-video/wav16'

// Turn a song (from lib/song-video/from-project) into a vertical, beat-synced
// video. Beyond picking a format you can now edit the overlay text (+ font/size),
// the colour theme, the aspect ratio for different channels, and which slice of
// the song plays — then preview, download, or send it to the content queue.

type Note = { tr: number; p: number; s: number; d: number; v: number }
type SongData = { tempo: number; keyLabel?: string; genre?: string; tracks: { name: string; color: string; kind?: string; vol?: number; muted?: boolean }[]; notes: Note[]; loopBeats?: number }

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
const QUALITIES = [{ v: 720, name: '720p' }, { v: 1080, name: '1080p' }, { v: 1440, name: '1440p' }]
const TEXT_ANIMS = [{ id: 'none', name: 'None' }, { id: 'fade', name: 'Fade' }, { id: 'rise', name: 'Rise' }, { id: 'pop', name: 'Pop' }]
const TEXT_POS = [{ id: 'top', name: 'Top' }, { id: 'center', name: 'Center' }, { id: 'bottom', name: 'Bottom' }]

// Render dimensions for a quality (short-side px) at a given aspect.
function resDims(quality: number, aspect: string): [number, number] {
  const [aw, ah] = aspect.split('/').map(s => Number(s.trim()))
  return aw <= ah ? [quality, Math.round(quality * ah / aw)] : [Math.round(quality * aw / ah), quality]
}
const bitrateFor = (q: number) => (q <= 720 ? 3_500_000 : q <= 1080 ? 6_000_000 : 11_000_000)

export default function SongVideoPlayer({ song, meta, accent = '#a78bfa', slug = 'song-video', projectId, canPublish = false, totalBeats, dawProject, userId, audioKey }: {
  song: SongData; meta?: string; accent?: string; slug?: string; projectId?: string; canPublish?: boolean; totalBeats?: number; dawProject?: DawProject; userId?: string | null; audioKey?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const instRef = useRef<ReturnType<typeof mountSongVideo> | null>(null)
  const playingRef = useRef(false)
  // Persistent Web Audio graph on the <audio> element: source → analyser →
  // (speakers + a capture stream). Created once (a MediaElementSource can only be
  // made once per element) and reused across remounts; feeds audio-reactive formats.
  const audioGraphRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode; capture: MediaStreamAudioDestinationNode } | null>(null)
  function ensureAudioGraph() {
    if (audioGraphRef.current || !audioRef.current) return audioGraphRef.current
    try {
      const ACtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new ACtor()
      const src = ctx.createMediaElementSource(audioRef.current)
      const analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.82
      const capture = ctx.createMediaStreamDestination()
      src.connect(analyser); analyser.connect(ctx.destination); analyser.connect(capture)
      audioGraphRef.current = { ctx, analyser, capture }
    } catch { /* already connected or unsupported */ }
    return audioGraphRef.current
  }

  // Real project audio (bounced for the current section) — when set, the video
  // uses the actual mix instead of the preview synth.
  const [realUrl, setRealUrl] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderFailed, setRenderFailed] = useState(false)
  const renderToken = useRef(0)      // discards results from a superseded render
  const renderingRef = useRef(false) // single-flight (one full render at a time)
  const latestWin = useRef({ s: 0, w: 32 })
  // The WHOLE song is bounced ONCE (from the start) into this decoded buffer; any
  // section is then SLICED from it instantly — changing bars never re-renders.
  const fullBufferRef = useRef<AudioBuffer | null>(null)
  const fullKeyRef = useRef<string | null>(null)
  // When we have a project, the video uses ONLY the real mix — never a synth.
  // `waiting` = the full-song render for this project isn't ready yet.
  const realOnly = !!dawProject
  const waiting = realOnly && !realUrl

  const [fmt, setFmt] = useState('falling-notes')
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Song section — default to the WHOLE song from the start.
  const songTotal = totalBeats ?? Math.max(32, Math.ceil(Math.max(0, ...song.notes.map(n => n.s + n.d))))
  const [winBeats, setWinBeats] = useState(songTotal)
  const [startBeat, setStartBeat] = useState(0)
  const maxStart = Math.max(0, songTotal - winBeats)
  const start = Math.min(startBeat, maxStart)

  // Text
  const [line1, setLine1] = useState('')
  const [line2, setLine2] = useState('')
  const [line2Accent, setLine2Accent] = useState(true)
  const [metaText, setMetaText] = useState(meta ?? '')
  const [font, setFont] = useState('system-ui')
  const [textScale, setTextScale] = useState(1)
  const [textColor, setTextColor] = useState('#eceafd')
  const [hookPos, setHookPos] = useState('bottom')
  const [hookAnim, setHookAnim] = useState('none')
  const [textOutline, setTextOutline] = useState(false)
  type Layer = { id: string; text: string; x: number; y: number; size: number; color: string; from?: number; to?: number }
  const [layers, setLayers] = useState<Layer[]>([])
  const addLayer = () => setLayers(ls => [...ls, { id: crypto.randomUUID(), text: 'text', x: 0.5, y: 0.4, size: 0.05, color: '#ffffff' }])
  const updLayer = (id: string, patch: Partial<Layer>) => setLayers(ls => ls.map(l => (l.id === id ? { ...l, ...patch } : l)))
  const rmLayer = (id: string) => setLayers(ls => ls.filter(l => l.id !== id))
  const layersKey = layers.map(l => `${l.text}|${l.x}|${l.y}|${l.size}|${l.color}|${l.from ?? ''}|${l.to ?? ''}`).join(';')

  // Theme — accent + a two-stop background gradient. Re-colors the VIDEO only;
  // the maker's own UI keeps a stable accent (ui) so themes don't repaint it.
  const [themeId, setThemeId] = useState('midnight')
  const [accentColor, setAccentColor] = useState(accent)
  const [bgColors, setBgColors] = useState<[string, string]>(THEMES[0].bg as [string, string])
  const ui = accent
  const bgKey = bgColors.join(',')

  // Channel + quality
  const [aspect, setAspect] = useState('9 / 16')
  const [quality, setQuality] = useState(1080) // short-side px (render resolution)
  const [fps, setFps] = useState(30)
  const [rw, rh] = resDims(quality, aspect)

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
      font, textScale, bg: bgColors, media, layers,
      textColor, hookPos, hookAnim, textOutline, width: rw, height: rh,
      // With a project we ONLY ever play the real bounced mix — no synth, ever.
      // (Without one — no real-mix source — the synth is the only preview.)
      synth: !dawProject,
      analyser: audioGraphRef.current?.analyser ?? null,
    })
    instRef.current = inst
    if (playingRef.current) inst.play()
    return () => inst.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fmt, windowed, realUrl, rw, rh])

  useEffect(() => { latestWin.current = { s: start, w: winBeats } }, [start, winBeats])

  // The full song renders once (from the start); the current section is then
  // sliced from it instantly — so changing bars NEVER re-renders. A new project
  // version (audioKey) invalidates the buffer and triggers one fresh full render.
  useEffect(() => {
    if (!dawProject) return
    const token = ++renderToken.current
    if (fullBufferRef.current && fullKeyRef.current === (audioKey ?? null)) {
      sliceAndApply(start, winBeats, token) // instant — no re-render
      return
    }
    setRealUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    const t = setTimeout(() => { void ensureFull(token, false) }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, winBeats, dawProject, audioKey])

  // Look edits apply live (no remount, no playback restart).
  useEffect(() => {
    instRef.current?.update({ hook: hookArr, meta: metaText, accent: accentColor, font, textScale, bg: bgColors, textColor, hookPos, hookAnim, textOutline, layers })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hookArr, metaText, accentColor, font, textScale, bgKey, textColor, hookPos, hookAnim, textOutline, layersKey])

  function toggle() {
    const i = instRef.current; if (!i) return
    if (playing) { i.pause(); setPlaying(false); playingRef.current = false }
    else { if (waiting) return; audioGraphRef.current?.ctx.resume?.(); i.play(); setPlaying(true); playingRef.current = true } // no play until the real mix is ready
  }

  async function recordBlob(): Promise<Blob | null> {
    const i = instRef.current, canvas = canvasRef.current; if (!i || !canvas) return null
    setStatus('Recording…'); audioGraphRef.current?.ctx.resume?.(); i.play(); setPlaying(true); playingRef.current = true
    const v = canvas.captureStream(fps)
    // With real audio, capture the analyser graph's output; otherwise the synth.
    const a = realUrl && audioGraphRef.current ? audioGraphRef.current.capture.stream : i.getAudioStream()
    const stream = new MediaStream([...v.getVideoTracks(), ...(a ? a.getAudioTracks() : [])])
    const prefer = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    const mime = prefer.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm'
    const outType = mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm'
    const chunks: Blob[] = []
    // Tuned for social: the audio is muxed + compressed (AAC/Opus @128k) rather
    // than the raw WAV, and the video bitrate is trimmed to keep the file small.
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrateFor(quality), audioBitsPerSecond: 128_000 })
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

  // Export the loop as an animated GIF: capture downscaled canvas frames across
  // one loop, then encode (self-contained encoder). No audio (GIFs are silent).
  async function exportGif() {
    if (busy || waiting) return
    const canvas = canvasRef.current, i = instRef.current; if (!canvas || !i) return
    setBusy(true); setStatus('Capturing GIF…')
    try {
      const gifW = 400, gifH = Math.round(400 * canvas.height / canvas.width)
      const off = document.createElement('canvas'); off.width = gifW; off.height = gifH
      const octx = off.getContext('2d'); if (!octx) throw new Error('no canvas')
      const gfps = 12, loopMs = winBeats * (60 / song.tempo) * 1000
      const nFrames = Math.min(96, Math.max(8, Math.round((loopMs / 1000) * gfps)))
      const interval = loopMs / nFrames
      i.play(); setPlaying(true); playingRef.current = true; audioGraphRef.current?.ctx.resume?.()
      await new Promise(r => setTimeout(r, 60))
      const frames: { data: Uint8ClampedArray; width: number; height: number }[] = []
      for (let k = 0; k < nFrames; k++) { await new Promise(r => setTimeout(r, interval)); octx.drawImage(canvas, 0, 0, gifW, gifH); frames.push({ data: octx.getImageData(0, 0, gifW, gifH).data, width: gifW, height: gifH }) }
      setStatus('Encoding GIF…')
      const { encodeGif } = await import('@/lib/song-video/gif')
      const gif = encodeGif(frames, 1000 / gfps)
      const url = URL.createObjectURL(new Blob([gif as BlobPart], { type: 'image/gif' }))
      const link = document.createElement('a'); link.href = url; link.download = `${slug}-${fmt}.gif`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
      setStatus('GIF downloaded ✓')
    } catch { setStatus('GIF failed') }
    setBusy(false); setTimeout(() => setStatus(null), 2500)
  }

  // Pull an accent + background gradient out of an uploaded image.
  async function applyImagePalette(file: File | undefined) {
    if (!file) return
    try {
      const { extractPalette } = await import('@/lib/song-video/palette')
      const { accent, bg } = await extractPalette(file)
      setAccentColor(accent); setBgColors(bg); setThemeId('')
      setStatus('Palette applied ✓'); setTimeout(() => setStatus(null), 2000)
    } catch { setStatus('Could not read image'); setTimeout(() => setStatus(null), 3000) }
  }

  // Send the render into the app's VideoEditor (uploads to the media library +
  // opens a video project with the clip on the timeline) so it can be edited
  // further. Navigates away on success.
  async function editInVideoEditor() {
    if (busy || waiting) return
    setBusy(true); setStatus('Rendering…')
    try {
      const blob = await recordBlob(); if (!blob) { setBusy(false); return }
      setStatus('Sending to editor…')
      const { saveRenderToVideoEditor } = await import('@/lib/song-video/to-video-editor')
      // Maker aspect ('9 / 16' CSS style) → editor ProjectAspect ('9:16').
      const editorAspect = aspect === '1 / 1' ? '1:1' as const : aspect === '16 / 9' ? '16:9' as const : '9:16' as const
      await saveRenderToVideoEditor(blob, {
        name: `${slug} video`,
        durationSec: winBeats * (60 / song.tempo),
        tempo: song.tempo,
        aspect: editorAspect,
      })
      // success → the page navigates to the video editor
    } catch (e) { setStatus(`Failed: ${(e as Error).message}`); setBusy(false); setTimeout(() => setStatus(null), 4000) }
  }

  // Slice [s, s+w] out of the already-rendered full-song buffer and play it. Pure
  // array work — instant, so scrubbing bars never re-renders.
  const sliceAndApply = (s: number, w: number, token: number) => {
    const buf = fullBufferRef.current
    if (!buf || token !== renderToken.current) return
    const SPB = 60 / song.tempo, sr = buf.sampleRate
    const startSamp = Math.max(0, Math.floor(s * SPB * sr))
    const lenSamp = Math.max(1, Math.min(Math.floor(w * SPB * sr), buf.length - startSamp))
    const chans: Float32Array[] = []
    for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c).subarray(startSamp, startSamp + lenSamp))
    const wav = encodeWav16(chans, sr)
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
    if (audioRef.current) { audioRef.current.src = url; audioRef.current.loop = true; audioRef.current.load(); ensureAudioGraph() }
    setRealUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url })
  }

  // Ensure the WHOLE song is rendered once (from the start) into fullBufferRef,
  // from cache if we've done it before, then slice the current section. This is
  // the only expensive step and it happens a single time per project version.
  async function ensureFull(token: number, force: boolean) {
    if (!dawProject || renderingRef.current) return
    renderingRef.current = true
    setRendering(true); setRenderFailed(false)
    const fullSec = Math.round(songTotal * (60 / song.tempo))
    setStatus(`Rendering full song… ~${fullSec}s (one time)`)
    try {
      const fullKey = audioKey ? `${audioKey}:full` : null
      let fullBlob: Blob | null = null
      if (fullKey && !force) { try { const { getCachedAudio } = await import('@/lib/song-video/audio-cache'); fullBlob = await getCachedAudio(fullKey) } catch { /* render */ } }
      if (!fullBlob) {
        const { renderProjectAudioBlob } = await import('@/lib/song-video/render-audio')
        fullBlob = await renderProjectAudioBlob(dawProject, { startBeat: 0, endBeat: songTotal, userId })
        if (fullKey) { try { const { putCachedAudio } = await import('@/lib/song-video/audio-cache'); await putCachedAudio(fullKey, fullBlob, Date.now()) } catch { /* non-fatal */ } }
      }
      const ACtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ac = new ACtor()
      const decoded = await ac.decodeAudioData(await fullBlob.arrayBuffer())
      ac.close()
      fullBufferRef.current = decoded
      fullKeyRef.current = audioKey ?? null
      if (token === renderToken.current) { setRenderFailed(false); sliceAndApply(latestWin.current.s, latestWin.current.w, token); setStatus('Real mix ✓'); setTimeout(() => setStatus(null), 2500) }
    } catch {
      if (token === renderToken.current) { setRenderFailed(true); setStatus('Render failed — retry') }
    } finally {
      renderingRef.current = false
      setRendering(false)
    }
  }

  const secs = (winBeats * (60 / song.tempo)).toFixed(1)

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 'min(96vw, 560px)', margin: '0 auto' }}>
      <style>{'@keyframes svspin{to{transform:rotate(360deg)}}'}</style>
      <audio ref={audioRef} style={{ display: 'none' }} preload="auto" />
      {/* Format */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {Object.entries(FORMATS as Record<string, { name: string }>).map(([id, f]) => (
          <button key={id} onClick={() => setFmt(id)} style={pill(fmt === id, ui)}>{f.name}</button>
        ))}
      </div>

      {/* Preview */}
      <div style={{ position: 'relative', aspectRatio: aspect, borderRadius: 16, overflow: 'hidden', background: '#08070c', boxShadow: '0 12px 44px rgba(80,50,180,.28)', maxHeight: '84vh', margin: '0 auto', width: '100%' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        {waiting ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'rgba(5,4,9,.6)', color: '#eceafd', textAlign: 'center', padding: 16 }}>
            {renderFailed ? (
              <>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#f87171' }}>Real mix render failed</span>
                <button onClick={() => { const token = ++renderToken.current; void ensureFull(token, false) }} style={{ fontSize: 12.5, fontWeight: 700, color: '#0a0812', background: ui, border: 'none', borderRadius: 8, padding: '7px 16px', cursor: 'pointer' }}>Retry</button>
              </>
            ) : (
              <>
                <div style={{ width: 34, height: 34, borderRadius: '50%', border: `3px solid ${ui}`, borderTopColor: 'transparent', animation: 'svspin 0.8s linear infinite' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Rendering the full song…</span>
                <span style={{ fontSize: 11, color: '#a3a2b5' }}>~{Math.round(songTotal * (60 / song.tempo))}s · one time — then every section is instant</span>
              </>
            )}
          </div>
        ) : !playing ? (
          <button onClick={toggle} aria-label="Play" style={{ position: 'absolute', inset: 0, margin: 'auto', width: 64, height: 64, borderRadius: '50%', border: `2px solid ${ui}`, background: "rgba(5,4,9,.4)", color: ui, fontSize: 22, paddingLeft: 4, cursor: 'pointer' }}>▶</button>
        ) : null}
      </div>

      {/* Transport + export */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={toggle} disabled={busy || waiting} style={{ ...btn, opacity: busy || waiting ? 0.5 : 1 }}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={exportVideo} disabled={busy || waiting} style={{ ...btn, opacity: busy || waiting ? 0.6 : 1 }}>Download</button>
        <button onClick={exportGif} disabled={busy || waiting} style={{ ...btn, opacity: busy || waiting ? 0.6 : 1 }}>GIF</button>
        <button onClick={editInVideoEditor} disabled={busy || waiting} style={{ ...btn, opacity: busy || waiting ? 0.6 : 1 }}>Edit in editor →</button>
        {canPublish && <button onClick={sendToQueue} disabled={busy || waiting} style={{ ...btn, background: ui, color: '#0a0812', border: 'none', fontWeight: 700, opacity: busy || waiting ? 0.7 : 1 }}>{busy && status ? status : 'Send to queue →'}</button>}
      </div>
      {status && !busy && <p style={{ fontSize: 12, fontWeight: 600, color: status.startsWith('Failed') || status.endsWith('failed') ? '#f87171' : '#4ade80', textAlign: 'center', margin: 0 }}>{status}</p>}

      {/* ── Editing panel ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 14, background: 'var(--bg-surface,#141220)', border: '1px solid var(--border,#26262b)', borderRadius: 12, padding: 14 }}>
        {/* Section */}
        <Section label="Section of song">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={lbl}>Length</span>
            {[16, 32, 48, 64].map(b => (
              <button key={b} onClick={() => { setWinBeats(b); setStartBeat(s => Math.min(s, Math.max(0, songTotal - b))) }} style={chip(winBeats === b, ui)} disabled={b >= songTotal}>{b} bars</button>
            ))}
            <button onClick={() => { setWinBeats(songTotal); setStartBeat(0) }} style={chip(winBeats >= songTotal, ui)}>Full song</button>
            <span style={{ ...lbl, marginLeft: 'auto' }}>{secs}s</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={lbl}>Start</span>
            <input type="range" min={0} max={maxStart} step={1} value={start} onChange={e => setStartBeat(Number(e.target.value))} style={{ flex: 1, accentColor: ui }} />
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
            {FONTS.map(fo => <button key={fo.id} onClick={() => setFont(fo.id)} style={{ ...chip(font === fo.id, ui), fontFamily: fo.id }}>{fo.name}</button>)}
            <span style={{ ...lbl, marginLeft: 'auto' }}>Size</span>
            <input type="range" min={0.7} max={1.5} step={0.05} value={textScale} onChange={e => setTextScale(Number(e.target.value))} style={{ width: 90, accentColor: ui }} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={lbl}>Color</span>
            <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)} style={swatchInput} />
            <span style={lbl}>Place</span>
            {TEXT_POS.map(p => <button key={p.id} onClick={() => setHookPos(p.id)} style={chip(hookPos === p.id, ui)}>{p.name}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={lbl}>Animate</span>
            {TEXT_ANIMS.map(a => <button key={a.id} onClick={() => setHookAnim(a.id)} style={chip(hookAnim === a.id, ui)}>{a.name}</button>)}
            <label style={{ ...lbl, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer', marginLeft: 'auto' }}>
              <input type="checkbox" checked={textOutline} onChange={e => setTextOutline(e.target.checked)} /> outline
            </label>
          </div>
        </Section>

        {/* Theme */}
        <Section label="Theme">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {THEMES.map(t => (
              <button key={t.id} onClick={() => { setThemeId(t.id); setAccentColor(t.accent); setBgColors(t.bg as [string, string]) }} title={t.name}
                style={{ width: 26, height: 26, borderRadius: 8, cursor: 'pointer', border: themeId === t.id ? `2px solid ${t.accent}` : '2px solid transparent', background: `linear-gradient(135deg, ${t.accent} 0 50%, ${t.bg[0]} 50% 100%)` }} />
            ))}
            <span style={{ ...lbl, marginLeft: 8 }}>Accent</span>
            <input type="color" value={accentColor} onChange={e => setAccentColor(e.target.value)} style={swatchInput} />
            <span style={lbl}>BG</span>
            <input type="color" value={bgColors[0]} onChange={e => setBgColors([e.target.value, bgColors[1]])} title="Background top" style={swatchInput} />
            <input type="color" value={bgColors[1]} onChange={e => setBgColors([bgColors[0], e.target.value])} title="Background bottom" style={swatchInput} />
            <label style={{ ...chip(false, ui), marginLeft: 'auto', cursor: 'pointer' }}>
              From image
              <input type="file" accept="image/*" onChange={e => applyImagePalette(e.target.files?.[0])} style={{ display: 'none' }} />
            </label>
          </div>
        </Section>

        {/* Text layers — extra placed / timed text (lyrics etc.) */}
        <Section label="Text layers">
          {layers.map(l => (
            <div key={l.id} style={{ display: 'grid', gap: 6, padding: '8px', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input value={l.text} onChange={e => updLayer(l.id, { text: e.target.value })} style={{ ...field, flex: 1 }} maxLength={60} />
                <input type="color" value={l.color} onChange={e => updLayer(l.id, { color: e.target.value })} style={swatchInput} />
                <button onClick={() => rmLayer(l.id)} style={{ ...chip(false, ui), color: '#f87171' }}>×</button>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={lbl}>X</span><input type="range" min={0.05} max={0.95} step={0.01} value={l.x} onChange={e => updLayer(l.id, { x: Number(e.target.value) })} style={{ width: 64, accentColor: ui }} />
                <span style={lbl}>Y</span><input type="range" min={0.05} max={0.95} step={0.01} value={l.y} onChange={e => updLayer(l.id, { y: Number(e.target.value) })} style={{ width: 64, accentColor: ui }} />
                <span style={lbl}>Size</span><input type="range" min={0.02} max={0.11} step={0.005} value={l.size} onChange={e => updLayer(l.id, { size: Number(e.target.value) })} style={{ width: 56, accentColor: ui }} />
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={lbl}>Show beats</span>
                <input type="number" placeholder="from" value={l.from ?? ''} onChange={e => updLayer(l.id, { from: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ ...field, width: 64, padding: '4px 7px' }} />
                <span style={lbl}>–</span>
                <input type="number" placeholder="to" value={l.to ?? ''} onChange={e => updLayer(l.id, { to: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ ...field, width: 64, padding: '4px 7px' }} />
                <span style={{ ...lbl, fontSize: 10.5 }}>blank = always</span>
              </div>
            </div>
          ))}
          <button onClick={addLayer} style={{ ...chip(false, ui) }}>+ Add text layer</button>
        </Section>

        {/* Audio — always the real mix; renders on load, cached after. */}
        {dawProject && (
          <Section label="Audio">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => { fullBufferRef.current = null; const token = ++renderToken.current; void ensureFull(token, true) }} disabled={rendering || busy} style={{ ...chip(false, ui), opacity: rendering ? 0.6 : 1 }}>
                {rendering ? 'Rendering…' : 'Re-render song'}
              </button>
              <span style={lbl}>{rendering ? 'rendering your real mix…' : realUrl ? 'your real mix ✓' : renderFailed ? 'render failed — retry' : 'real mix'}</span>
            </div>
          </Section>
        )}

        {/* Channel / aspect */}
        <Section label="Aspect (channel)">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ASPECTS.map(a => (
              <button key={a.id} onClick={() => setAspect(a.id)} style={chip(aspect === a.id, ui)} title={a.hint}>{a.name} <span style={{ opacity: 0.6, fontWeight: 500 }}>· {a.hint}</span></button>
            ))}
          </div>
        </Section>

        {/* Quality / export */}
        <Section label="Quality">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={lbl}>Res</span>
            {QUALITIES.map(q => <button key={q.v} onClick={() => setQuality(q.v)} style={chip(quality === q.v, ui)}>{q.name}</button>)}
            <span style={{ ...lbl, marginLeft: 8 }}>FPS</span>
            {[30, 60].map(x => <button key={x} onClick={() => setFps(x)} style={chip(fps === x, ui)}>{x}</button>)}
            <span style={{ ...lbl, marginLeft: 'auto' }}>{rw}×{rh} · {(bitrateFor(quality) / 1e6).toFixed(1)}M</span>
          </div>
        </Section>
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--text-muted,#8b88a8)', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
        {dawProject
          ? <><b>Send to queue</b> files this render + a drafted caption in the admin Content queue for review + publish. Audio is your <b>real mix</b> — rendered on load and cached, so nothing plays or exports until it&rsquo;s ready (no synth).</>
          : <>Audio uses the preview synth.</>}
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
const swatchInput: React.CSSProperties = { width: 28, height: 24, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }
