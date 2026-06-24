'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Upload, Play, Pause, SkipBack, SkipForward, Volume2, Cloud, CheckCircle2, Music, AlertCircle, Loader2, Scissors } from 'lucide-react'
import AudioWaveform from './AudioWaveform'
import SoundLibrary from './SoundLibrary'
import ModuleSwitcher from './ModuleSwitcher'
import type { Caption } from '@/lib/types'
import type { AudioTrackInit, ModuleKey } from '@/lib/editor-types'

export interface AudioTrack extends AudioTrackInit {
  url: string
}

export interface AudioEditorProps {
  projectId?: string
  projectName: string
  initialTracks?: AudioTrack[]
  captions?: Caption[]
  currentTime?: number
  onTimeChange?: (t: number) => void
  onProjectNameCommit?: (name: string) => void
  onSave?: (tracks: AudioTrack[]) => Promise<void>
  hideHeader?: boolean
  activeModules?: ModuleKey[]
  onModulesChange?: (modules: ModuleKey[]) => void
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export default function AudioEditor({
  projectId, projectName: initialName, initialTracks = [],
  onTimeChange, onProjectNameCommit, onSave, hideHeader,
  activeModules, onModulesChange,
}: AudioEditorProps) {
  const [localName, setLocalName]     = useState(initialName)
  const [editingName, setEditingName] = useState(false)
  const [tracks, setTracks]           = useState<AudioTrack[]>(initialTracks)
  const [selectedId, setSelectedId]   = useState<string | null>(initialTracks[0]?.id ?? null)
  const [isPlaying, setIsPlaying]     = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration]       = useState(0)
  const [volume, setVolume]           = useState(1)
  const [saveStatus, setSaveStatus]   = useState<'idle' | 'saving' | 'saved'>('idle')
  const [stemJobs, setStemJobs]       = useState<Record<string, { predId: string; status: 'running' | 'done' | 'error' }>>({})
  const [trackAreaDragOver, setTrackAreaDragOver] = useState(false)

  const audioRef    = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rafRef      = useRef<number>(0)

  const selectedTrack = tracks.find(t => t.id === selectedId) ?? null

  useEffect(() => { setLocalName(initialName) }, [initialName])

  useEffect(() => {
    if (initialTracks.length > 0) {
      setTracks(initialTracks)
      setSelectedId(prev => prev ?? initialTracks[0].id)
    }
  }, [initialTracks]) // eslint-disable-line

  // Audio element
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !selectedTrack) return
    audio.src = selectedTrack.url
    audio.volume = volume
    audio.load()
    setCurrentTime(0)
    setIsPlaying(false)
    const onDurationChange = () => setDuration(audio.duration || 0)
    const onEnded = () => { setIsPlaying(false); setCurrentTime(0) }
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('ended', onEnded)
    }
  }, [selectedTrack?.url]) // eslint-disable-line

  // RAF clock
  useEffect(() => {
    const tick = () => {
      const audio = audioRef.current
      if (audio && !audio.paused) {
        const t = audio.currentTime
        setCurrentTime(t)
        onTimeChange?.(t)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [onTimeChange])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.code === 'Space')      { e.preventDefault(); togglePlay() }
      if (e.code === 'ArrowLeft')  { e.preventDefault(); seekTo(Math.max(0, currentTime - 5)) }
      if (e.code === 'ArrowRight') { e.preventDefault(); seekTo(Math.min(duration, currentTime + 5)) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isPlaying, selectedTrack, currentTime, duration]) // eslint-disable-line

  function togglePlay() {
    const audio = audioRef.current
    if (!audio || !selectedTrack) return
    if (isPlaying) { audio.pause(); setIsPlaying(false) }
    else           { audio.play().catch(() => {}); setIsPlaying(true) }
  }

  function seekTo(t: number) {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = t
    setCurrentTime(t)
    onTimeChange?.(t)
  }

  // ── R2 upload ────────────────────────────────────────────────

  async function uploadToR2(file: File, trackId: string) {
    const contentType = file.type || ''
    try {
      const presignRes = await fetch('/api/media/presign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType, mediaId: trackId, size: file.size }),
      })
      if (!presignRes.ok) throw new Error(`presign failed (${presignRes.status})`)
      const { uploadUrl, key } = await presignRes.json() as { uploadUrl: string; key: string }
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': contentType || 'application/octet-stream' } })
      setTracks(prev => prev.map(t =>
        t.id === trackId ? { ...t, r2Key: key, uploadStatus: 'uploaded' as const, savedAt: new Date().toISOString() } : t
      ))
    } catch {
      setTracks(prev => prev.map(t =>
        t.id === trackId ? { ...t, uploadStatus: 'error' as const } : t
      ))
    }
  }

  // ── Import ───────────────────────────────────────────────────

  function getAudioDuration(url: string, type: string): Promise<number> {
    return new Promise(resolve => {
      const el = document.createElement(type.startsWith('video/') ? 'video' : 'audio')
      el.src = url
      el.addEventListener('durationchange', () => resolve(el.duration || 0), { once: true })
      el.addEventListener('error', () => resolve(0), { once: true })
      setTimeout(() => resolve(0), 4000)
    })
  }

  async function handleImport(files: FileList | null) {
    if (!files) return
    const newTracks: AudioTrack[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) continue
      const url = URL.createObjectURL(file)
      const dur = await getAudioDuration(url, file.type)
      newTracks.push({
        id: crypto.randomUUID(), name: file.name, url, duration: dur,
        contentType: file.type, uploadStatus: 'uploading', savedAt: new Date().toISOString(),
      })
    }
    if (newTracks.length === 0) return
    setTracks(prev => [...prev, ...newTracks])
    setSelectedId(newTracks[0].id)
    for (const track of newTracks) {
      const file = Array.from(files).find(f => f.name === track.name)
      if (file) uploadToR2(file, track.id)
    }
  }

  // ── Stem separation ──────────────────────────────────────────

  async function separateStems(track: AudioTrack) {
    setStemJobs(prev => ({ ...prev, [track.id]: { predId: '', status: 'running' } }))
    try {
      const audioBlob = await fetch(track.url).then(r => r.blob())
      const form = new FormData()
      form.append('audio', audioBlob, track.name || 'audio.mp3')
      const startRes = await fetch('/api/stems', { method: 'POST', body: form })
      if (!startRes.ok) throw new Error(await startRes.text())
      const { predictionId } = await startRes.json() as { predictionId: string }
      setStemJobs(prev => ({ ...prev, [track.id]: { predId: predictionId, status: 'running' } }))

      let stems: Record<string, string> | null = null
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 5000))
        const data = await fetch(`/api/stems?id=${predictionId}`).then(r => r.json()) as { status: string; stems?: Record<string, string>; error?: string }
        if (data.status === 'succeeded' && data.stems) { stems = data.stems; break }
        if (data.status === 'failed' || data.status === 'canceled') throw new Error(data.error ?? 'failed')
      }
      if (!stems) throw new Error('timed out')

      const stemOrder = ['drums', 'bass', 'vocals', 'other'] as const
      type StemName = typeof stemOrder[number]
      const ordered = [...stemOrder.filter(k => stems![k]), ...Object.keys(stems).filter(k => !(stemOrder as readonly string[]).includes(k))]
      const newTracks: AudioTrack[] = []
      for (const name of ordered) {
        const url = stems[name]
        const dur = await getAudioDuration(url, 'audio/mpeg')
        newTracks.push({
          id: crypto.randomUUID(),
          name: `${track.name.replace(/\.\w+$/, '')} — ${name}`,
          url, duration: dur, contentType: 'audio/mpeg',
          uploadStatus: 'uploaded', savedAt: new Date().toISOString(),
          stemType: stemOrder.includes(name as StemName) ? (name as StemName) : undefined,
        })
      }
      setTracks(prev => [...prev, ...newTracks])
      setStemJobs(prev => ({ ...prev, [track.id]: { predId: predictionId, status: 'done' } }))
    } catch {
      setStemJobs(prev => ({ ...prev, [track.id]: { ...prev[track.id], status: 'error' } }))
    }
  }

  // ── Save ─────────────────────────────────────────────────────

  async function save() {
    if (!onSave) return
    setSaveStatus('saving')
    try {
      await onSave(tracks)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch {
      setSaveStatus('idle')
    }
  }

  // ── Render ───────────────────────────────────────────────────

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); handleImport(e.dataTransfer.files) }}
    >
      <audio ref={audioRef} style={{ display: 'none' }} />

      {/* Header */}
      {!hideHeader && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 40, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)', fontSize: 12, textDecoration: 'none', flexShrink: 0 }}>
            <ArrowLeft size={12} /> Dashboard
          </Link>
          <div style={{ width: 1, height: 14, background: 'var(--border)', flexShrink: 0 }} />
          {editingName ? (
            <input
              autoFocus value={localName}
              onChange={e => setLocalName(e.target.value)}
              onBlur={() => { setEditingName(false); onProjectNameCommit?.(localName) }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { setEditingName(false); onProjectNameCommit?.(localName) } }}
              style={{ fontSize: 12, fontWeight: 600, background: 'transparent', border: 'none', borderBottom: '1px solid var(--accent)', outline: 'none', color: 'var(--text-primary)', maxWidth: 220 }}
            />
          ) : (
            <button onClick={() => setEditingName(true)} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', background: 'none', border: 'none', cursor: 'pointer' }}>
              {localName}
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {saveStatus === 'saved' && <span style={{ fontSize: 11, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={11} /> Saved</span>}
            <button
              onClick={save}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <Cloud size={11} /> Save
            </button>
            {activeModules && onModulesChange && (
              <ModuleSwitcher activeModules={activeModules} onModulesChange={onModulesChange} />
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex' }}>

        {/* Sound Library sidebar */}
        <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <SoundLibrary embedded />
        </div>

        {/* Main column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Track list */}
          <div
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }}
            onDragOver={e => { if (e.dataTransfer.types.includes('application/x-library-entry-id') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); setTrackAreaDragOver(true) } }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setTrackAreaDragOver(false) }}
            onDrop={e => { setTrackAreaDragOver(false); handleImport(e.dataTransfer.files) }}
          >
            {tracks.length === 0 ? (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                <Upload size={28} color="var(--text-muted)" strokeWidth={1.5} />
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>Drop audio files here</p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>or</p>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{ fontSize: 12, padding: '7px 16px', borderRadius: 7, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
                >
                  Choose files
                </button>
              </div>
            ) : (
              tracks.map(track => (
                <div key={track.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  {/* Track header */}
                  <div
                    onClick={() => setSelectedId(track.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: selectedId === track.id ? 'var(--accent-subtle)' : 'var(--bg-surface)', borderLeft: `2px solid ${selectedId === track.id ? 'var(--accent)' : 'transparent'}`, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                  >
                    <Music size={9} color={selectedId === track.id ? 'var(--accent-light)' : 'var(--text-muted)'} />
                    {track.uploadStatus === 'uploading' && <Loader2 size={9} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-light)', flexShrink: 0 }} />}
                    {track.uploadStatus === 'error' && <AlertCircle size={9} color="#ef4444" style={{ flexShrink: 0 }} />}
                    <span style={{ fontSize: 10, color: selectedId === track.id ? 'var(--accent-light)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {track.name}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>{fmtTime(track.duration)}</span>
                    {/* Stems button */}
                    {!track.stemType && (() => {
                      const job = stemJobs[track.id]
                      if (job?.status === 'running') return <span style={{ fontSize: 9, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}><Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> Separating…</span>
                      if (job?.status === 'done')    return <span style={{ fontSize: 9, color: 'var(--success)', flexShrink: 0 }}>✓ Stems added</span>
                      if (job?.status === 'error')   return <span style={{ fontSize: 9, color: '#ef4444', flexShrink: 0 }}>Failed</span>
                      return (
                        <button
                          onClick={e => { e.stopPropagation(); separateStems(track) }}
                          title="Separate into stems (drums, bass, vocals, other)"
                          style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
                        >
                          <Scissors size={8} /> Stems
                        </button>
                      )
                    })()}
                  </div>
                  {/* Waveform */}
                  <div style={{ height: 60, position: 'relative', overflow: 'hidden' }}>
                    {selectedId === track.id ? (
                      <AudioWaveform src={track.url} contentType="audio" currentTime={currentTime} duration={duration} onSeek={seekTo} />
                    ) : (
                      <div style={{ height: '100%', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', padding: '0 10px' }}>
                        <div style={{ flex: 1, height: 2, background: 'var(--border)', borderRadius: 1 }} />
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {/* Drop overlay */}
            {trackAreaDragOver && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(139,92,246,0.08)', border: '2px dashed rgba(139,92,246,0.5)', borderRadius: 4, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(167,139,250,1)', background: 'var(--bg-card)', padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(139,92,246,0.4)' }}>
                  Drop to add track
                </span>
              </div>
            )}
          </div>

          {/* Upload button strip (when tracks exist) */}
          {tracks.length > 0 && (
            <div style={{ height: 36, flexShrink: 0, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 12px', background: 'var(--bg-surface)' }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <Upload size={10} /> Add audio
              </button>
            </div>
          )}

          {/* Transport */}
          {tracks.length > 0 && (
            <div style={{ height: 52, flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '0 20px' }}>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', minWidth: 52, textAlign: 'right' }}>{fmtTime(currentTime)}</span>
              <button onClick={() => seekTo(Math.max(0, currentTime - 5))} style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}><SkipBack size={16} /></button>
              <button
                onClick={togglePlay}
                disabled={!selectedTrack}
                style={{ width: 34, height: 34, borderRadius: '50%', background: selectedTrack ? 'var(--accent)' : 'var(--border)', border: 'none', cursor: selectedTrack ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}
              >
                {isPlaying ? <Pause size={14} fill="#fff" /> : <Play size={14} fill="#fff" style={{ marginLeft: 1 }} />}
              </button>
              <button onClick={() => seekTo(Math.min(duration, currentTime + 5))} style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}><SkipForward size={16} /></button>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', minWidth: 52 }}>{fmtTime(duration)}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
                <Volume2 size={12} color="var(--text-muted)" />
                <input
                  type="range" min={0} max={1} step={0.01} value={volume}
                  onChange={e => { const v = Number(e.target.value); setVolume(v); if (audioRef.current) audioRef.current.volume = v }}
                  style={{ width: 64 }}
                  className="cf-slider"
                />
              </div>
            </div>
          )}

        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="audio/*,video/*" multiple style={{ display: 'none' }} onChange={e => handleImport(e.target.files)} />
    </div>
  )
}
