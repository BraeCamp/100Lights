'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { mountSongVideo } from '@/lib/song-video/engine.mjs'
import { FORMATS } from '@/lib/song-video/formats.mjs'
import type { DawProject } from '@/lib/daw-types'
import { encodeWav16 } from '@/lib/song-video/wav16'
import { ProgressivePlayer, makeMediaShim, XFADE_SEC, type MediaShim } from '@/lib/song-video/progressive-audio'

// The real mix is rendered in ordered CHUNKS so playback can start ~1s in (after
// the first chunk) while later chunks stream into a gapless ProgressivePlayer.
// Each chunk is rendered with a LOOK-BACK so incoming note/reverb tails are intact
// at the cut, then trimmed to keep the chunk plus a tiny crossfade overlap.
const CHUNK_BEATS = 16      // render granularity (~one phrase)
const LOOKBACK_BEATS = 8    // warm-up bars so tails ring correctly at the cut


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
  const instRef = useRef<ReturnType<typeof mountSongVideo> | null>(null)
  const playingRef = useRef(false)
  // Persistent Web Audio graph: ProgressivePlayer → analyser → (speakers + a
  // capture stream for export). The player schedules rendered chunks gaplessly;
  // the analyser feeds audio-reactive formats. Built once and reused across
  // remounts. The context is created up front (so chunk decode uses the real
  // output sample rate) but only RESUMED inside a play/record gesture — a
  // suspended context is inaudible until then, and the visualiser still animates
  // off note data, so audio is only ever heard after an explicit gesture-resume.
  const audioGraphRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode; capture: MediaStreamAudioDestinationNode; player: ProgressivePlayer; shim: MediaShim } | null>(null)
  const [playerReady, setPlayerReady] = useState(false)
  function ensureAudioGraph() {
    if (audioGraphRef.current) return audioGraphRef.current
    try {
      const ACtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new ACtor()
      const analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.82
      const capture = ctx.createMediaStreamDestination()
      analyser.connect(ctx.destination); analyser.connect(capture)
      const totalSec = Math.max(0.01, latestWin.current.w * (60 / song.tempo))
      const player = new ProgressivePlayer({ ctx, destination: analyser, totalSec, loop: true })
      const shim = makeMediaShim(player)
      audioGraphRef.current = { ctx, analyser, capture, player, shim }
      setPlayerReady(true)
    } catch { /* unsupported */ }
    return audioGraphRef.current
  }

  const [rendering, setRendering] = useState(false)
  const [renderFailed, setRenderFailed] = useState(false)
  const [firstReady, setFirstReady] = useState(false) // first chunk playable
  const firstReadyRef = useRef(false)
  const renderToken = useRef(0)      // discards results from a superseded render
  const renderingRef = useRef(false) // single-flight (one chunked render at a time)
  // A render is only worth persisting if the user did something with it (export,
  // queue, or send to editor). Otherwise it's a throwaway preview — delete its
  // cached bounce on leave so previews don't pile up in IndexedDB over time.
  const savedRef = useRef(false)
  useEffect(() => () => {
    audioGraphRef.current?.player.destroy()
    audioGraphRef.current?.ctx.close?.().catch?.(() => {})
    if (!savedRef.current && audioKey) {
      import('@/lib/song-video/audio-cache').then(m => m.deleteCachedAudio(`${audioKey}:full`)).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const latestWin = useRef({ s: 0, w: 32 })
  // Session cache: the decoded full-song mix for the current project version, so
  // re-opening the full-song window pushes one seamless section instantly.
  const fullBufferRef = useRef<AudioBuffer | null>(null)
  const fullKeyRef = useRef<string | null>(null)
  // With a project the video plays ONLY the real mix (never a synth). `waiting` =
  // not even the first chunk is ready yet.
  const realOnly = !!dawProject
  const waiting = realOnly && !firstReady

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
    // Real-mix projects drive the engine clock from the ProgressivePlayer via a
    // media shim (once the graph exists); synth-only previews pass no media.
    const media = realOnly && playerReady ? audioGraphRef.current?.shim ?? null : null
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
  }, [fmt, windowed, playerReady, rw, rh])

  useEffect(() => { latestWin.current = { s: start, w: winBeats } }, [start, winBeats])

  // The current window's real mix renders in chunks (progressive + gapless).
  // Changing the window/version resets the player and re-renders; a session or
  // IndexedDB cache hit for the full song pushes one seamless section instantly.
  useEffect(() => {
    if (!dawProject) return
    const token = ++renderToken.current
    const g = ensureAudioGraph()
    g?.player.pause()
    setPlaying(false); playingRef.current = false
    firstReadyRef.current = false; setFirstReady(false)
    g?.player.reset(Math.max(0.01, winBeats * (60 / song.tempo)))
    const t = setTimeout(() => { void ensureChunked(token, false) }, 250)
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
    if (playing) { i.pause(); setPlaying(false); playingRef.current = false; return }
    if (waiting) return // no play until the first chunk is ready
    // Resume the audio context INSIDE the click gesture. The context is created
    // up front (for decode) but starts suspended and stays inaudible until this
    // gesture-resume — meanwhile the visualiser animates off note data. Hand the
    // analyser to the running engine so reactive formats keep working. The engine
    // then calls the shim (→ player.play), which schedules the rendered chunks.
    if (realOnly) { const g = ensureAudioGraph(); if (g) { g.ctx.resume?.(); i.update({ analyser: g.analyser }) } }
    i.play(); setPlaying(true); playingRef.current = true
  }

  async function recordBlob(): Promise<Blob | null> {
    const i = instRef.current, canvas = canvasRef.current; if (!i || !canvas) return null
    setStatus('Recording…')
    if (realOnly) { const g = ensureAudioGraph(); if (g) { g.ctx.resume?.(); i.update({ analyser: g.analyser }) } }
    i.play(); setPlaying(true); playingRef.current = true
    const v = canvas.captureStream(fps)
    // With real audio, capture the analyser graph's output; otherwise the synth.
    const a = realOnly && audioGraphRef.current ? audioGraphRef.current.capture.stream : i.getAudioStream()
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
      savedRef.current = true
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
      if (res.ok) savedRef.current = true
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
      ensureAudioGraph(); i.play(); setPlaying(true); playingRef.current = true; audioGraphRef.current?.ctx.resume?.()
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
      savedRef.current = true   // the mix is now persisted in the media library; keep its cache
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

  // Copy [startSec, endSec) of an AudioBuffer into a fresh one (on the graph ctx).
  const sliceBuffer = (ctx: AudioContext, buf: AudioBuffer, startSec: number, endSec?: number): AudioBuffer => {
    const sr = buf.sampleRate
    const s = Math.max(0, Math.floor(startSec * sr))
    const e = endSec == null ? buf.length : Math.min(buf.length, Math.floor(endSec * sr))
    const len = Math.max(1, e - s)
    const out = ctx.createBuffer(buf.numberOfChannels, len, sr)
    for (let c = 0; c < buf.numberOfChannels; c++) out.getChannelData(c).set(buf.getChannelData(c).subarray(s, s + len))
    return out
  }

  // Render the current window's real mix in ordered CHUNKS and stream them into
  // the gapless ProgressivePlayer. Each chunk is rendered with a LOOK-BACK so
  // incoming note/reverb tails ring correctly at the cut, then trimmed to keep
  // [chunk] plus one crossfade's worth of pre-roll (the overlap the player
  // equal-power crossfades against the previous chunk's tail). Playback becomes
  // available after the FIRST chunk. The full concatenated mix is assembled and
  // cached (`${audioKey}:full`) so re-opening the full song is instant.
  async function ensureChunked(token: number, force: boolean) {
    if (!dawProject || renderingRef.current) return
    const g = ensureAudioGraph(); if (!g) return
    renderingRef.current = true
    setRendering(true); setRenderFailed(false)
    const spb = 60 / song.tempo
    const winStartBeat = latestWin.current.s, winLen = latestWin.current.w
    const isFull = winStartBeat === 0 && winLen >= songTotal
    g.player.reset(Math.max(0.01, winLen * spb))
    firstReadyRef.current = false; setFirstReady(false)
    const fullKey = audioKey && isFull ? `${audioKey}:full` : null
    const markFirst = () => { if (!firstReadyRef.current) { firstReadyRef.current = true; setFirstReady(true) } }
    setStatus('Rendering real mix…')
    try {
      // Once the WHOLE song is decoded, ANY window — any loop/export length — is
      // just a slice of it, so changing the length never re-renders. Push that
      // slice as one seamless section.
      const pushWindow = (full: AudioBuffer) => {
        const a = winStartBeat * spb, b = a + winLen * spb
        const seg = (winStartBeat === 0 && b >= full.duration - 0.001) ? full : sliceBuffer(g.ctx, full, a, b)
        g.player.pushSection(0, seg, 0); markFirst()
        setStatus('Real mix ✓'); setTimeout(() => setStatus(null), 1500)
      }
      // Full song already decoded this session → slice instantly (no re-render).
      if (!force && fullBufferRef.current && fullKeyRef.current === (audioKey ?? null)) {
        pushWindow(fullBufferRef.current); return
      }
      // Full song persisted (IndexedDB) → decode once this session, then slice.
      if (audioKey && !force) {
        try {
          const { getCachedAudio } = await import('@/lib/song-video/audio-cache')
          const blob = await getCachedAudio(`${audioKey}:full`)
          if (blob && token === renderToken.current) {
            const buf = await g.ctx.decodeAudioData(await blob.arrayBuffer())
            fullBufferRef.current = buf; fullKeyRef.current = audioKey ?? null
            pushWindow(buf); return
          }
        } catch { /* fall through to render */ }
      }

      const { renderProjectAudioBlob } = await import('@/lib/song-video/render-audio')
      const nChunks = Math.max(1, Math.ceil(winLen / CHUNK_BEATS))
      const fullChans: Float32Array[] = [] // exact [chunk] audio, concatenated → cache
      let sr = 44100
      for (let i = 0; i < nChunks; i++) {
        if (token !== renderToken.current) return
        const cs = i * CHUNK_BEATS, ce = Math.min(winLen, cs + CHUNK_BEATS)
        const absCs = winStartBeat + cs, absCe = winStartBeat + ce
        const lookbackBeats = Math.min(LOOKBACK_BEATS, absCs)
        const blob = await renderProjectAudioBlob(dawProject, { startBeat: absCs - lookbackBeats, endBeat: absCe, userId })
        if (token !== renderToken.current) return
        const decoded = await g.ctx.decodeAudioData(await blob.arrayBuffer())
        sr = decoded.sampleRate
        const csSec = cs * spb
        const leadSec = i === 0 ? 0 : XFADE_SEC
        // Drop the look-back down to just the crossfade pre-roll; kept audio then
        // covers [csSec - leadSec, ceSec] in window-media time.
        const kept = sliceBuffer(g.ctx, decoded, lookbackBeats * spb - leadSec)
        g.player.pushSection(csSec, kept, leadSec)
        markFirst()
        setStatus(`Rendering… ${Math.min(100, Math.round(((i + 1) / nChunks) * 100))}%`)
        // Exact [csSec, ceSec] region (drop the pre-roll) for the concatenated cache.
        const exact = sliceBuffer(g.ctx, kept, leadSec)
        for (let c = 0; c < exact.numberOfChannels; c++) {
          const prev = fullChans[c] ?? new Float32Array(0), add = exact.getChannelData(c)
          const merged = new Float32Array(prev.length + add.length); merged.set(prev); merged.set(add, prev.length)
          fullChans[c] = merged
        }
      }
      if (token !== renderToken.current) return
      setRenderFailed(false); setStatus('Real mix ✓'); setTimeout(() => setStatus(null), 2000)
      // Assemble + cache the full mix (and keep a decoded copy for instant re-open).
      if (fullChans.length && fullKey) {
        try {
          const fullBlob = new Blob([encodeWav16(fullChans, sr)], { type: 'audio/wav' })
          const { putCachedAudio } = await import('@/lib/song-video/audio-cache')
          await putCachedAudio(fullKey, fullBlob, Date.now())
          fullBufferRef.current = await g.ctx.decodeAudioData(await fullBlob.arrayBuffer())
          fullKeyRef.current = audioKey ?? null
        } catch { /* non-fatal */ }
      }
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
                <button onClick={() => { const token = ++renderToken.current; void ensureChunked(token, false) }} style={{ fontSize: 12.5, fontWeight: 700, color: '#0a0812', background: ui, border: 'none', borderRadius: 8, padding: '7px 16px', cursor: 'pointer' }}>Retry</button>
              </>
            ) : (
              <>
                <div style={{ width: 34, height: 34, borderRadius: '50%', border: `3px solid ${ui}`, borderTopColor: 'transparent', animation: 'svspin 0.8s linear infinite' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Rendering the real mix…</span>
                <span style={{ fontSize: 11, color: '#a3a2b5' }}>starts playing in about a second — the rest streams in as you watch</span>
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
              <button onClick={() => { fullBufferRef.current = null; fullKeyRef.current = null; const token = ++renderToken.current; void ensureChunked(token, true) }} disabled={rendering || busy} style={{ ...chip(false, ui), opacity: rendering ? 0.6 : 1 }}>
                {rendering ? 'Rendering…' : 'Re-render song'}
              </button>
              <span style={lbl}>{rendering ? 'rendering your real mix…' : firstReady ? 'your real mix ✓' : renderFailed ? 'render failed — retry' : 'real mix'}</span>
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
