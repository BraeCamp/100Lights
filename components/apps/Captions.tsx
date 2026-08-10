'use client'

// Captions — speech → text, in the browser. Drop in audio or a video, get timed captions from the
// on-device Whisper hybrid (the same local-first STT the video editor uses — $0, no upload, no sign-in
// for the local pass). Edit the words, then export SRT/VTT/TXT or send them straight to the Video
// editor to burn onto the clip. This is the standalone home of the speech→text tool; the video module
// consumes the same captions.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, Download, Film, Loader2, Wand2, Trash2, AlertTriangle, Check, ThumbsUp } from 'lucide-react'
import type { Caption } from '@/lib/types'

// original = what the model heard (kept so we can tell corrected from confirmed); confirmed = user said
// "this is right". Both feed /api/stt-corrections so the hybrid learns where its confidence was wrong.
type EditCaption = Caption & { id: string; original: string; confidence?: number; confirmed?: boolean }
type Status = 'idle' | 'loading' | 'transcribing' | 'done' | 'error'
const LOW_CONF = 0.7   // below this = the base + tiny Whisper models disagreed → likely needs an edit

const fmt = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${h ? String(h).padStart(2, '0') + ':' : ''}${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`
}
const srtTime = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}
const download = (name: string, text: string, type = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name }); a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function Captions() {
  const [file, setFile] = useState<File | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [isVideo, setIsVideo] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)     // 0–100 model download / 101 = transcribing
  const [captions, setCaptions] = useState<EditCaption[]>([])
  const [lowFrac, setLowFrac] = useState(0)       // share of captions the hybrid flagged uncertain
  const [saved, setSaved] = useState<number | null>(null)   // feedback records sent
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [now, setNow] = useState(0)
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)

  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl) }, [mediaUrl])

  const pick = useCallback((f: File) => {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl)
    setFile(f); setCaptions([]); setError(''); setStatus('idle')
    setIsVideo(f.type.startsWith('video/'))
    setMediaUrl(URL.createObjectURL(f))
  }, [mediaUrl])

  const transcribe = useCallback(async () => {
    if (!file) return
    setStatus('loading'); setProgress(0); setError('')
    try {
      const { transcribeLocally } = await import('@/lib/local-stt')
      setStatus('transcribing')
      const res = await transcribeLocally(file, {
        onProgress: p => setProgress(p.status === 'transcribing' ? 101 : Math.min(100, Math.round(p.progress ?? 0))),
      })
      setCaptions(res.captions.map(c => ({ id: crypto.randomUUID(), start: c.start, end: c.end, text: c.text, words: c.words, speaker: c.speaker, confidence: c.confidence, original: c.text, confirmed: false })))
      setLowFrac(res.lowConfidenceFraction); setSaved(null)
      setStatus('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transcription failed. Try a shorter or clearer clip.')
      setStatus('error')
    }
  }, [file])

  const editText = (i: number, text: string) => { setSaved(null); setCaptions(cs => cs.map((c, j) => j === i ? { ...c, text } : c)) }
  const removeCap = (i: number) => setCaptions(cs => cs.filter((_, j) => j !== i))
  const toggleConfirm = (i: number) => { setSaved(null); setCaptions(cs => cs.map((c, j) => j === i ? { ...c, confirmed: !c.confirmed } : c)) }
  const seek = (t: number) => { if (mediaRef.current) { mediaRef.current.currentTime = t; setNow(t) } }

  // Send the "it's right" (confirmed) + "I fixed it" (edited) signal so the hybrid learns where its
  // confidence was off. Only sends captions the user actually touched or confirmed.
  const saveFeedback = async () => {
    const records = captions
      .filter(c => c.confirmed || c.text.trim() !== c.original.trim())
      .map(c => ({ id: c.id, source: 'captions', original: c.original, final: c.text, confidence: c.confidence, startSec: c.start, endSec: c.end }))
    if (!records.length) { setSaved(0); return }
    try {
      const r = await fetch('/api/stt-corrections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records }) })
      const d = await r.json().catch(() => ({} as { saved?: number })); setSaved(d.saved ?? records.length)
    } catch { setSaved(records.length) }
  }

  const exportSrt = () => download((file?.name || 'captions').replace(/\.[^.]+$/, '') + '.srt',
    captions.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}`).join('\n\n'), 'text/plain')
  const exportVtt = () => download((file?.name || 'captions').replace(/\.[^.]+$/, '') + '.vtt',
    'WEBVTT\n\n' + captions.map(c => `${srtTime(c.start).replace(',', '.')} --> ${srtTime(c.end).replace(',', '.')}\n${c.text}`).join('\n\n'), 'text/vtt')
  const exportTxt = () => download((file?.name || 'transcript').replace(/\.[^.]+$/, '') + '.txt', captions.map(c => c.text).join(' '))

  // Hand the captions to the Video editor. The video module reads this stash on load and applies the
  // captions to the current clip (so this app is the entry point; the editor burns them onto the video).
  const sendToVideo = () => {
    try {
      sessionStorage.setItem('cf_pending_captions', JSON.stringify({ captions, fileName: file?.name, isVideo, at: Date.now() }))
      window.location.href = '/new?modules=video&captions=pending'
    } catch { setError('Could not hand off — try exporting SRT and importing it instead.') }
  }

  const active = captions.findIndex(c => now >= c.start && now < c.end)
  const busy = status === 'loading' || status === 'transcribing'

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px', color: 'var(--text-primary)' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Captions</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 4, fontSize: 14 }}>
          Speech → timed captions, on-device and free. Drop in audio or a video, edit the words, export SRT/VTT/TXT — or send them to the Video editor.
        </p>
      </header>

      {/* Upload */}
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 22, border: '1.5px dashed var(--border)', borderRadius: 14, cursor: 'pointer', background: 'var(--bg-card)', marginBottom: 16 }}>
        <Upload size={18} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>{file ? file.name : 'Choose an audio or video file'}</span>
        <input type="file" accept="audio/*,video/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) pick(f) }} />
      </label>

      {/* Media preview */}
      {mediaUrl && (
        <div style={{ marginBottom: 16 }}>
          {isVideo
            ? <video ref={mediaRef as React.RefObject<HTMLVideoElement>} src={mediaUrl} style={{ width: '100%', borderRadius: 12, background: '#000', maxHeight: 340 }} onTimeUpdate={e => setNow(e.currentTarget.currentTime)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
            : <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} src={mediaUrl} style={{ width: '100%' }} controls onTimeUpdate={e => setNow(e.currentTarget.currentTime)} />}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <button onClick={transcribe} disabled={!file || busy}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: file && !busy ? 'pointer' : 'not-allowed', opacity: file && !busy ? 1 : 0.5 }}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
          {status === 'loading' ? `Loading model ${progress}%` : status === 'transcribing' ? 'Transcribing…' : captions.length ? 'Re-transcribe' : 'Transcribe'}
        </button>
        {captions.length > 0 && <>
          <button onClick={exportSrt} style={btn}><Download size={15} /> SRT</button>
          <button onClick={exportVtt} style={btn}><Download size={15} /> VTT</button>
          <button onClick={exportTxt} style={btn}><Download size={15} /> Text</button>
          <button onClick={sendToVideo} style={{ ...btn, background: 'rgba(52,211,153,0.15)', color: '#34d399', borderColor: 'transparent' }}><Film size={15} /> Send to Video editor</button>
          <button onClick={saveFeedback} title="Tell the transcriber which captions it got right and which you fixed — it uses this to calibrate its confidence."
            style={{ ...btn, background: saved != null && saved > 0 ? 'rgba(52,211,153,0.15)' : 'var(--bg-card)', color: saved != null && saved > 0 ? '#34d399' : 'var(--text-secondary)' }}>
            <ThumbsUp size={15} /> {saved == null ? 'Save feedback' : saved > 0 ? `Saved ${saved} ✓` : 'Confirm or edit some first'}
          </button>
        </>}
      </div>
      {captions.length > 0 && saved == null && (
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: -8, marginBottom: 14 }}>
          Fix any wrong words (that's a correction) or hit ✓ on lines that are right, then <strong>Save feedback</strong> — it teaches the transcriber where its confidence was off.
        </p>
      )}

      {error && <p style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {status === 'transcribing' && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Running on-device (first run downloads the model, ~40–115 MB). No audio leaves your device.</p>}

      {/* Hybrid summary: local Whisper (base + tiny verifier) did this for $0. Confidence tells you what to edit. */}
      {status === 'done' && captions.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, marginBottom: 12 }}>
          <span style={{ color: '#34d399', fontWeight: 700 }}>{captions.length} captions · on-device · $0 (no AI)</span>
          <span style={{ color: 'var(--text-muted)' }}>·</span>
          {lowFrac < 0.15
            ? <span style={{ color: 'var(--text-muted)' }}>{Math.round((1 - lowFrac) * 100)}% high-confidence.</span>
            : <span style={{ color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={13} />{Math.round(lowFrac * 100)}% flagged (amber) — review those, or use the video editor's AI transcription for tough audio.</span>}
        </div>
      )}

      {/* Caption list */}
      {captions.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {captions.map((c, i) => {
            const low = (c.confidence ?? 1) < LOW_CONF   // hybrid flagged this one — the models disagreed
            const edited = c.text.trim() !== c.original.trim()
            const leftColor = edited ? '#38bdf8' : low ? '#f59e0b' : 'transparent'   // blue = you corrected it, amber = model unsure
            return (
            <div key={c.id} title={edited ? `Corrected (was: "${c.original}")` : low ? `Low confidence (${Math.round((c.confidence ?? 1) * 100)}%) — the two local models disagreed here; check this line.` : undefined}
              style={{ display: 'flex', gap: 8, padding: '8px 12px', borderLeft: `3px solid ${leftColor}`, borderBottom: i < captions.length - 1 ? '1px solid var(--border)' : 'none', background: i === active ? 'rgba(124,92,255,0.10)' : c.confirmed ? 'rgba(52,211,153,0.07)' : low && !edited ? 'rgba(245,158,11,0.06)' : 'transparent' }}>
              <button onClick={() => seek(c.start)} title="Jump here"
                style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'var(--accent-light)', background: 'none', border: 'none', cursor: 'pointer', width: 62, textAlign: 'left', paddingTop: 3 }}>
                {fmt(c.start)}
              </button>
              <textarea value={c.text} onChange={e => editText(i, e.target.value)} rows={1}
                style={{ flex: 1, resize: 'vertical', background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 8px', fontSize: 13, fontFamily: 'inherit' }} />
              {low && !edited && <AlertTriangle size={13} style={{ flexShrink: 0, color: '#f59e0b', marginTop: 6 }} />}
              <button onClick={() => toggleConfirm(i)} title={c.confirmed ? 'Marked correct — click to undo' : 'Mark this caption correct'}
                style={{ flexShrink: 0, background: c.confirmed ? '#34d399' : 'none', border: c.confirmed ? 'none' : '1px solid var(--border)', borderRadius: 6, color: c.confirmed ? '#04120b' : 'var(--text-muted)', cursor: 'pointer', marginTop: 3, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Check size={14} />
              </button>
              <button onClick={() => removeCap(i)} title="Delete" style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginTop: 3 }}><Trash2 size={14} /></button>
            </div>
          )})}
        </div>
      )}
    </div>
  )
}

const btn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }
