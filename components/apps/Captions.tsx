'use client'

// Captions — the standalone speech→text app. Full app skeleton (toolbar · source sidebar · caption
// editor · status bar). The transcription runs through the SHARED useTranscription hook and the SHARED
// CaptionEditor component — the exact same caption system the video module uses — so they never drift.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, Download, Film, Loader2, Wand2, ThumbsUp, Captions as CaptionsIcon, ChevronDown, AlertTriangle, Type } from 'lucide-react'
import CaptionEditor from '@/components/captions/CaptionEditor'
import CaptionStylePanel from '@/components/captions/CaptionStylePanel'
import { useTranscription } from '@/lib/use-transcription'
import { downloadCaptions } from '@/lib/caption-format'
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from '@/lib/editor-types'

export default function Captions() {
  const tx = useTranscription()
  const [file, setFile] = useState<File | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [isVideo, setIsVideo] = useState(false)
  const [now, setNow] = useState(0)
  const [saved, setSaved] = useState<number | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE)
  const [showStyle, setShowStyle] = useState(false)
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)

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
  const done = tx.status === 'done' && tx.captions.length > 0
  const lowN = tx.captions.filter(c => (c.confidence ?? 1) < 0.7).length
  const activeCaption = tx.captions.find(c => now >= c.start && now < c.end)

  return (
    <div onDragOver={e => { e.preventDefault(); if (!dragging) setDragging(true) }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={onDrop}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
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
                  <span style={{ background: style.bg === 'none' ? 'transparent' : style.bg, color: style.color, padding: style.bg === 'none' ? 0 : '3px 8px', borderRadius: 5, fontSize: Math.round(13 * style.size), fontWeight: 700, lineHeight: 1.5, textShadow: style.bg === 'none' ? '0 1px 3px #000, 0 0 4px #000' : 'none', WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone' }}>
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
        <span style={{ marginLeft: 'auto' }}>{file ? file.name : 'no file'}</span>
      </footer>
    </div>
  )
}

const tbtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }
