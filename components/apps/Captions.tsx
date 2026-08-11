'use client'

// Captions — the standalone speech→text app. Full app skeleton (toolbar · source sidebar · caption
// editor · status bar). The transcription runs through the SHARED useTranscription hook and the SHARED
// CaptionEditor component — the exact same caption system the video module uses — so they never drift.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, Download, Film, Loader2, Wand2, ThumbsUp, Captions as CaptionsIcon, ChevronDown, AlertTriangle, Type, Copy, CheckCheck, History } from 'lucide-react'
import CaptionEditor from '@/components/captions/CaptionEditor'
import CaptionStylePanel from '@/components/captions/CaptionStylePanel'
import WaveformStrip from '@/components/captions/WaveformStrip'
import { useTranscription } from '@/lib/use-transcription'
import { downloadCaptions } from '@/lib/caption-format'
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from '@/lib/editor-types'
import { useAppShellOptional } from '@/components/apps/AppChrome'

export default function Captions() {
  const tx = useTranscription()
  const shell = useAppShellOptional()
  const [file, setFile] = useState<File | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [isVideo, setIsVideo] = useState(false)
  const [now, setNow] = useState(0)
  const [saved, setSaved] = useState<number | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [copied, setCopied] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE)
  const [showStyle, setShowStyle] = useState(false)
  const [savingVideo, setSavingVideo] = useState(false)
  const [peaks, setPeaks] = useState<number[]>([])
  const [dur, setDur] = useState(0)
  const [restorable, setRestorable] = useState<{ captions: typeof tx.captions; style?: CaptionStyle; fileName?: string; at: number } | null>(null)
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)

  const SESSION_KEY = 'captions-app-session'
  // On mount: offer to restore the last session (captions survive a refresh; media has to be re-added).
  useEffect(() => {
    try { const raw = localStorage.getItem(SESSION_KEY); if (raw) { const s = JSON.parse(raw); if (s?.captions?.length) setRestorable(s) } } catch { /* ignore */ }
  }, [])
  // Auto-save captions + style so a refresh or crash doesn't lose the edits.
  useEffect(() => {
    if (!tx.captions.length) return
    const id = setTimeout(() => { try { localStorage.setItem(SESSION_KEY, JSON.stringify({ captions: tx.captions, style, fileName: file?.name, at: Date.now() })) } catch { /* quota */ } }, 400)
    return () => clearTimeout(id)
  }, [tx.captions, style, file])
  const restore = () => { if (!restorable) return; tx.setCaptions(restorable.captions); if (restorable.style) setStyle(restorable.style); setRestorable(null) }

  // Decode the file once → a downsampled peak array for the waveform strip.
  useEffect(() => {
    if (!file) { setPeaks([]); setDur(0); return }
    let cancelled = false
    ;(async () => {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ac = new AC()
        const buf = await ac.decodeAudioData(await file.arrayBuffer()); await ac.close()
        const ch = buf.getChannelData(0), N = 500, block = Math.max(1, Math.floor(ch.length / N))
        const p: number[] = []
        for (let i = 0; i < N; i++) { let m = 0; const s = i * block; for (let j = 0; j < block; j++) { const v = Math.abs(ch[s + j] || 0); if (v > m) m = v } p.push(m) }
        const max = Math.max(0.01, ...p)
        if (!cancelled) { setPeaks(p.map(v => v / max)); setDur(buf.duration) }
      } catch { if (!cancelled) { setPeaks([]); setDur(0) } }
    })()
    return () => { cancelled = true }
  }, [file])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = Array.from(e.dataTransfer.files).find(x => x.type.startsWith('audio/') || x.type.startsWith('video/'))
    if (f) pick(f)
  }

  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl) }, [mediaUrl])

  const pick = useCallback((f: File) => {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl)
    setFile(f); setSaved(null); tx.reset()
    setIsVideo(f.type.startsWith('video/'))
    setMediaUrl(URL.createObjectURL(f))
  }, [mediaUrl, tx])

  const transcribe = () => file && tx.transcribe(file)          // local-only ($0) in the standalone app
  const seek = (t: number) => { if (mediaRef.current) { mediaRef.current.currentTime = t; setNow(t) } }
  const name = file?.name || 'captions'
  const baseName = name.replace(/\.[^.]+$/, '')

  // Reopen a saved session from the shared History (captions + style; media is re-added).
  useEffect(() => {
    if (!shell) return
    shell.registerRestore((data) => {
      const d = data as { captions?: typeof tx.captions; style?: CaptionStyle }
      if (d.captions?.length) tx.setCaptions(d.captions)
      if (d.style) setStyle(d.style)
    })
  }, [shell]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save the CAPTIONED VIDEO to the device — burn the styled, animated captions onto the frames
  // (canvas + MediaRecorder, on-device, no upload) and download. Also drops a session into History.
  const saveVideo = useCallback(async () => {
    const vid = mediaRef.current as HTMLVideoElement | null
    if (!vid || !isVideo || savingVideo || !tx.captions.length) return
    setSavingVideo(true)
    try {
      const W = 1280, H = 720
      const ex = document.createElement('canvas'); ex.width = W; ex.height = H
      const c = ex.getContext('2d'); if (!c) throw new Error('canvas unavailable')
      const stream = ex.captureStream(30)
      const vs = (vid as unknown as { captureStream?: () => MediaStream }).captureStream?.()
      for (const tr of vs?.getAudioTracks() ?? []) stream.addTrack(tr)
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      const chunks: BlobPart[] = []
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      const stopped = new Promise<void>(res => { rec.onstop = () => res() })
      const caps = tx.captions
      let raf = 0
      const draw = () => {
        const t = vid.currentTime
        const iw = vid.videoWidth || W, ih = vid.videoHeight || H, ir = iw / ih, cr = W / H
        let dw: number, dh: number
        if (ir > cr) { dh = H; dw = H * ir } else { dw = W; dh = W / ir }
        c.fillStyle = '#000'; c.fillRect(0, 0, W, H)
        c.drawImage(vid, (W - dw) / 2, (H - dh) / 2, dw, dh)
        const cap = caps.find(x => t >= x.start && t < x.end)
        if (cap) drawCaptionFrame(c, W, H, cap.text, t - cap.start, style)
        raf = requestAnimationFrame(draw)
      }
      vid.pause(); vid.currentTime = 0
      await new Promise(res => setTimeout(res, 120))
      rec.start(100); draw()
      await vid.play().catch(() => {})
      await new Promise<void>(res => { const on = () => { vid.removeEventListener('ended', on); res() }; vid.addEventListener('ended', on) })
      cancelAnimationFrame(raf); rec.stop(); await stopped
      const blob = new Blob(chunks, { type: 'video/webm' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${baseName}-captioned.webm`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      shell?.history.save({ title: baseName, subtitle: `${caps.length} captions`, data: { captions: caps, style, fileName: name } })
    } catch { /* export failed — the media may block captureStream */ }
    finally { setSavingVideo(false) }
  }, [isVideo, savingVideo, tx.captions, style, name, baseName, shell])

  const copyTranscript = async () => { try { await navigator.clipboard.writeText(tx.captions.map(c => c.text).join(' ')); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ } }
  const togglePlay = () => { const m = mediaRef.current; if (!m) return; if (m.paused) m.play(); else m.pause() }
  const nudgeSeek = (d: number) => { const m = mediaRef.current; if (m) m.currentTime = Math.max(0, Math.min(m.duration || 1e9, m.currentTime + d)) }
  const confirmAll = () => { setSaved(null); tx.setCaptions(tx.captions.map(c => ({ ...c, confirmed: true }))) }

  // Keyboard shortcuts (ignored while typing in a field): space/k play·pause, j/l ←→ seek, ⌘C copy, ⌘S feedback.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing = !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); if (tx.captions.length) saveFeedback(); return }
      if (meta && e.key.toLowerCase() === 'c' && !typing && !window.getSelection()?.toString()) { e.preventDefault(); copyTranscript(); return }
      if (typing || !mediaRef.current) return
      if (e.key === ' ' || e.key.toLowerCase() === 'k') { e.preventDefault(); togglePlay() }
      else if (e.key === 'j' || e.key === 'ArrowLeft') { e.preventDefault(); nudgeSeek(-2) }
      else if (e.key === 'l' || e.key === 'ArrowRight') { e.preventDefault(); nudgeSeek(2) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tx.captions]) // eslint-disable-line

  const sendToVideo = () => {
    try {
      sessionStorage.setItem('cf_pending_captions', JSON.stringify({ captions: tx.captions, style, fileName: file?.name, isVideo, at: Date.now() }))
      window.location.href = '/new?modules=video&captions=pending'
    } catch { /* ignore */ }
  }
  const saveFeedback = async () => {
    const records = tx.captions
      .filter(c => c.confirmed || (c.original != null && c.text.trim() !== c.original.trim()))
      .map(c => ({ id: c.id, source: 'captions', original: c.original, final: c.text, confidence: c.confidence, startSec: c.start, endSec: c.end }))
    if (!records.length) { setSaved(0); return }
    try {
      const r = await fetch('/api/stt-corrections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records }) })
      const d = await r.json().catch(() => ({} as { saved?: number })); setSaved(d.saved ?? records.length)
    } catch { setSaved(records.length) }
  }

  const busy = tx.status === 'loading' || tx.status === 'transcribing'
  const done = tx.captions.length > 0 && !busy   // true for fresh transcripts AND restored sessions
  const lowN = tx.captions.filter(c => (c.confidence ?? 1) < 0.7).length
  const activeCaption = tx.captions.find(c => now >= c.start && now < c.end)

  return (
    <div onDragOver={e => { e.preventDefault(); if (!dragging) setDragging(true) }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={onDrop}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <style>{`
        @keyframes cap-pop { from { transform: scale(.72); opacity: 0 } to { transform: scale(1); opacity: 1 } }
        @keyframes cap-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes cap-rise { from { transform: translateY(0.7em); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        @keyframes cap-bounce { 0% { transform: translateY(1.1em); opacity: 0 } 60% { transform: translateY(-0.18em); opacity: 1 } 100% { transform: translateY(0) } }
        .cap-anim-pop { animation: cap-pop .26s cubic-bezier(.34,1.56,.64,1) both }
        .cap-anim-fade { animation: cap-fade .26s ease both }
        .cap-anim-rise { animation: cap-rise .26s cubic-bezier(.22,1,.36,1) both }
        .cap-anim-bounce { animation: cap-bounce .4s cubic-bezier(.22,1,.36,1) both }
        @media (prefers-reduced-motion: reduce) { .cap-anim-pop,.cap-anim-fade,.cap-anim-rise,.cap-anim-bounce { animation: none !important } }
      `}</style>
      {dragging && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'rgba(124,92,255,0.14)', border: '2px dashed var(--accent)', backdropFilter: 'blur(2px)', pointerEvents: 'none', fontWeight: 700, fontSize: 16 }}>
          <Upload size={22} /> Drop audio or video to caption
        </div>
      )}
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 52, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CaptionsIcon size={18} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 800, fontSize: 15 }}>Captions</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>speech → timed captions · on-device</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {done && <>
            <button onClick={copyTranscript} title="Copy the full transcript (⌘C)" style={{ ...tbtn, color: copied ? '#34d399' : 'var(--text-secondary)' }}>
              <Copy size={14} /> {copied ? 'Copied ✓' : 'Copy'}
            </button>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowExport(v => !v)} style={tbtn}><Download size={14} /> Export <ChevronDown size={11} /></button>
              {showExport && (
                <div onMouseLeave={() => setShowExport(false)} style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 50, minWidth: 110, overflow: 'hidden' }}>
                  {(['srt', 'vtt', 'txt'] as const).map(f => (
                    <button key={f} onClick={() => { downloadCaptions(name, f, tx.captions); setShowExport(false) }}
                      style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>.{f}</button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={saveFeedback} title="Tell the transcriber which captions it got right and which you fixed — it calibrates its confidence."
              style={{ ...tbtn, color: saved != null && saved > 0 ? '#34d399' : 'var(--text-secondary)' }}>
              <ThumbsUp size={14} /> {saved == null ? 'Save feedback' : saved > 0 ? `Saved ${saved} ✓` : 'Nothing to send'}
            </button>
            {isVideo && done && (
              <button onClick={saveVideo} disabled={savingVideo} title="Burn the captions onto the video and save it to your device"
                style={{ ...tbtn, opacity: savingVideo ? 0.7 : 1 }}>
                {savingVideo ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {savingVideo ? 'Saving video…' : 'Save video'}
              </button>
            )}
            <button onClick={sendToVideo} style={{ ...tbtn, background: 'var(--accent)', color: '#fff', border: 'none' }}><Film size={14} /> Send to Video editor</button>
          </>}
        </div>
      </header>

      {/* ── Body: source sidebar + caption editor ───────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <aside style={{ width: 320, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg-surface)', padding: 16, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, border: '1.5px dashed var(--border)', borderRadius: 12, cursor: 'pointer', background: 'var(--bg-card)' }}>
            <Upload size={16} />
            <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file ? file.name : 'Choose audio or video'}</span>
            <input type="file" accept="audio/*,video/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) pick(f) }} />
          </label>

          {mediaUrl && (
            <div style={{ position: 'relative' }}>
              {isVideo
                ? <video ref={mediaRef as React.RefObject<HTMLVideoElement>} src={mediaUrl} controls style={{ width: '100%', borderRadius: 10, background: '#000', maxHeight: 220, display: 'block' }} onTimeUpdate={e => setNow(e.currentTarget.currentTime)} />
                : <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} src={mediaUrl} controls style={{ width: '100%' }} onTimeUpdate={e => setNow(e.currentTarget.currentTime)} />}
              {/* live subtitle burned on the video as it plays — the payoff of a caption tool */}
              {isVideo && activeCaption && (
                <div style={{ position: 'absolute', left: 8, right: 8, textAlign: 'center', pointerEvents: 'none',
                  ...(style.position === 'top' ? { top: 8 } : style.position === 'center' ? { top: '50%', transform: 'translateY(-50%)' } : { bottom: 46 }) }}>
                  <span key={activeCaption.id} className={`cap-anim-${style.anim ?? 'none'}`} style={{ display: 'inline-block', background: style.bg === 'none' ? 'transparent' : style.bg, color: style.color, padding: style.bg === 'none' ? 0 : '3px 8px', borderRadius: 5, fontSize: Math.round(13 * style.size), fontWeight: 700, lineHeight: 1.5, textShadow: style.bg === 'none' ? '0 1px 3px #000, 0 0 4px #000' : 'none', WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone' }}>
                    {style.karaoke && activeCaption.words?.length
                      ? activeCaption.words.map((w, i) => <span key={i} style={{ color: now >= w.s && now < w.e ? style.highlightColor : style.color }}>{w.w}{i < activeCaption.words!.length - 1 ? ' ' : ''}</span>)
                      : activeCaption.text}
                  </span>
                </div>
              )}
            </div>
          )}
          {/* audio has no picture — show the current line prominently so you can still follow along */}
          {mediaUrl && !isVideo && done && (
            <div style={{ minHeight: 42, padding: '10px 12px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', textAlign: 'center', fontSize: 14, fontWeight: 600, color: activeCaption ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              {activeCaption?.text || 'Play to follow along'}
            </div>
          )}

          {peaks.length > 0 && dur > 0 && (
            <WaveformStrip peaks={peaks} duration={dur} captions={tx.captions} currentTime={now} onSeek={seek} />
          )}

          <button onClick={transcribe} disabled={!file || busy}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 14px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: file && !busy ? 'pointer' : 'not-allowed', opacity: file && !busy ? 1 : 0.5 }}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
            {tx.status === 'loading' ? `Loading model ${tx.progress}%` : tx.status === 'transcribing' ? 'Transcribing…' : tx.captions.length ? 'Re-transcribe' : 'Transcribe'}
          </button>

          {busy && (
            <div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-card)', overflow: 'hidden', marginBottom: 6 }}>
                <div style={{ height: '100%', width: tx.status === 'transcribing' ? '100%' : `${tx.progress}%`, background: 'var(--accent)', borderRadius: 3, transition: 'width 0.2s', opacity: tx.status === 'transcribing' ? 0.55 : 1 }} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {tx.status === 'loading' ? `Downloading the model (${tx.progress}%) — first run only, ~40–115 MB.` : 'Transcribing on-device… no audio leaves your device.'}
              </p>
            </div>
          )}
          {tx.error && <p style={{ fontSize: 12, color: '#f87171' }}>{tx.error}</p>}

          {done && (
            <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', fontSize: 12, lineHeight: 1.6 }}>
              <div style={{ color: '#34d399', fontWeight: 700 }}>{tx.captions.length} captions · $0 (no AI)</div>
              {tx.lowFraction < 0.15
                ? <div style={{ color: 'var(--text-muted)' }}>{Math.round((1 - tx.lowFraction) * 100)}% high-confidence.</div>
                : <div style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={12} />{lowN} flagged — review the amber lines, or use the video editor's AI for tough audio.</div>}
              <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>Fix wrong words or hit ✓ on right ones, then <strong style={{ color: 'var(--text-primary)' }}>Save feedback</strong>.</div>
              <button onClick={confirmAll} style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <CheckCheck size={13} /> Mark all correct
              </button>
            </div>
          )}

          {done && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <button onClick={() => setShowStyle(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', padding: 0 }}>
                <Type size={14} /> Subtitle style
                <ChevronDown size={13} style={{ marginLeft: 'auto', transform: showStyle ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
              </button>
              {showStyle && <div style={{ marginTop: 10 }}><CaptionStylePanel style={style} onChange={setStyle} /></div>}
            </div>
          )}
        </aside>

        {/* Caption editor — the SHARED component the video module uses */}
        <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {restorable && !tx.captions.length && !file && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'rgba(124,92,255,0.08)', fontSize: 13 }}>
              <History size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span>Restore your last session — <strong>{restorable.captions.length} captions</strong>{restorable.fileName ? ` from ${restorable.fileName}` : ''}. (Re-add the media to play it.)</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={restore} style={{ ...tbtn, background: 'var(--accent)', color: '#fff', border: 'none' }}>Restore</button>
                <button onClick={() => { setRestorable(null); try { localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ } }} style={tbtn}>Dismiss</button>
              </div>
            </div>
          )}
          <CaptionEditor
            captions={tx.captions} onChange={tx.setCaptions}
            currentTime={now} onSeek={seek}
            search confidence feedback deletable timing
            emptyHint={file ? 'Hit Transcribe to generate captions.' : 'Choose an audio or video file to begin.'}
          />
        </section>
      </main>

      {/* ── Status bar ──────────────────────────────────────────────────────── */}
      <footer style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 16px', height: 30, borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0, fontSize: 11, color: 'var(--text-muted)' }}>
        <span>{tx.captions.length} caption{tx.captions.length === 1 ? '' : 's'}</span>
        {done && <span style={{ color: '#34d399' }}>on-device · $0</span>}
        {done && lowN > 0 && <span style={{ color: '#f59e0b' }}>{lowN} flagged</span>}
        {saved != null && saved > 0 && <span style={{ color: '#34d399' }}>feedback saved ✓</span>}
        {done && <span style={{ marginLeft: 'auto', opacity: 0.75 }}>␣ play · J/L seek · ⌘C copy · ⌘S feedback</span>}
        <span style={{ marginLeft: done ? 16 : 'auto' }}>{file ? file.name : 'no file'}</span>
      </footer>
    </div>
  )
}

const tbtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }

// Draw one styled caption onto an export canvas at time `age` seconds after it appeared.
// Mirrors the live overlay: position, size, colour, box/outline, plus the entrance animation.
function drawCaptionFrame(ctx: CanvasRenderingContext2D, W: number, H: number, text: string, age: number, style: CaptionStyle) {
  const fs = Math.round(H * 0.05 * (style.size || 1))
  ctx.font = `700 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const maxW = W * 0.86
  // word-wrap into up to 3 lines
  const words = text.split(/\s+/); const lines: string[] = []; let cur = ''
  for (const w of words) { const test = cur ? `${cur} ${w}` : w; if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w } else cur = test }
  if (cur) lines.push(cur)
  const shown = lines.slice(0, 3)
  const lh = fs * 1.34
  const blockH = shown.length * lh
  const cy = style.position === 'top' ? H * 0.12 + blockH / 2 : style.position === 'center' ? H / 2 : H - H * 0.10 - blockH / 2
  const p = Math.max(0, Math.min(1, age / 0.28)), e = 1 - Math.pow(1 - p, 3)
  let alpha = 1, scale = 1, dy = 0
  if (style.anim === 'fade') alpha = e
  else if (style.anim === 'pop') { alpha = e; scale = 0.72 + 0.28 * e }
  else if (style.anim === 'rise') { alpha = e; dy = (1 - e) * fs * 0.9 }
  else if (style.anim === 'bounce') { alpha = e; dy = (1 - e) * fs * 1.15 - Math.sin(p * Math.PI) * fs * 0.35 }
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(W / 2, cy + dy); ctx.scale(scale, scale); ctx.translate(-W / 2, -cy)
  const noBox = !style.bg || style.bg === 'none'
  shown.forEach((ln, i) => {
    const y = cy - blockH / 2 + lh * (i + 0.5)
    const tw = ctx.measureText(ln).width
    if (!noBox) {
      const bw = tw + fs, bh = lh
      ctx.fillStyle = style.bg
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') ctx.roundRect(W / 2 - bw / 2, y - bh / 2, bw, bh, 8)
      else ctx.rect(W / 2 - bw / 2, y - bh / 2, bw, bh)
      ctx.fill()
    } else {
      ctx.lineWidth = fs * 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.88)'; ctx.lineJoin = 'round'; ctx.strokeText(ln, W / 2, y)
    }
    ctx.fillStyle = style.color; ctx.fillText(ln, W / 2, y)
  })
  ctx.restore()
}
