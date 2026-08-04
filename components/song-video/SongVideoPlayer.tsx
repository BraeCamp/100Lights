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

export default function SongVideoPlayer({ song, meta, accent = '#a78bfa', slug = 'song-video', projectId, canPublish = false, totalBeats, dawProject, userId, audioKey }: {
  song: SongData; meta?: string; accent?: string; slug?: string; projectId?: string; canPublish?: boolean; totalBeats?: number; dawProject?: DawProject; userId?: string | null; audioKey?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const instRef = useRef<ReturnType<typeof mountSongVideo> | null>(null)
  const playingRef = useRef(false)

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

  // Theme
  const [themeId, setThemeId] = useState('midnight')
  const [accentColor, setAccentColor] = useState(accent)
  // The theme (accentColor + bg) re-colors the VIDEO only. The maker's own UI
  // keeps a stable accent so changing a video theme doesn't repaint the controls.
  const ui = accent
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
      // With a project we ONLY ever play the real bounced mix — no synth, ever.
      // (Without one — no real-mix source — the synth is the only preview.)
      synth: !dawProject,
    })
    instRef.current = inst
    if (playingRef.current) inst.play()
    return () => inst.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fmt, windowed, realUrl])

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
    instRef.current?.update({ hook: hookArr, meta: metaText, accent: accentColor, font, textScale, bg: theme.bg })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hookArr, metaText, accentColor, font, textScale, bgKey])

  function toggle() {
    const i = instRef.current; if (!i) return
    if (playing) { i.pause(); setPlaying(false); playingRef.current = false }
    else { if (waiting) return; i.play(); setPlaying(true); playingRef.current = true } // no play until the real mix is ready
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
    // Tuned for social: the audio is muxed + compressed (AAC/Opus @128k) rather
    // than the raw WAV, and the video bitrate is trimmed to keep the file small.
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 128_000 })
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
    if (audioRef.current) { audioRef.current.src = url; audioRef.current.loop = true; audioRef.current.load() }
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
        <button onClick={exportVideo} disabled={busy || waiting} style={{ ...btn, ...(canPublish ? {} : { background: ui, color: '#0a0812', border: 'none', fontWeight: 700 }), opacity: busy || waiting ? 0.6 : 1 }}>Download</button>
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
