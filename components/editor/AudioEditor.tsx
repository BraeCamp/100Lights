'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Upload, Play, Pause, SkipBack, SkipForward, Volume2, Cloud, CheckCircle2, Music, Mic, AlertCircle, Loader2, ChevronDown, ChevronRight, Drum, AudioWaveform as WaveIcon } from 'lucide-react'
import AudioWaveform from './AudioWaveform'
import BeatLab from './BeatLab'
import SoundLibrary from './SoundLibrary'
import ModuleSwitcher from './ModuleSwitcher'
import type { Caption } from '@/lib/types'
import type { AudioTrackInit, ModuleKey } from '@/lib/editor-types'

type RecordMode = 'drums' | 'voice' | null

// ── AudioTrack extends the shared init type with runtime-only fields ──────────

export interface AudioTrack extends AudioTrackInit {
  url: string   // always present at runtime (blob or signed R2 URL)
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
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

export default function AudioEditor({
  projectId, projectName: initialName, initialTracks = [],
  captions = [], currentTime: externalTime, onTimeChange,
  onProjectNameCommit, onSave, hideHeader,
  activeModules, onModulesChange,
}: AudioEditorProps) {
  const [localName, setLocalName]       = useState(initialName)
  const [editingName, setEditingName]   = useState(false)
  const [tracks, setTracks]             = useState<AudioTrack[]>(initialTracks)
  const [selectedId, setSelectedId]     = useState<string | null>(initialTracks[0]?.id ?? null)
  const [isPlaying, setIsPlaying]       = useState(false)
  const [currentTime, setCurrentTime]   = useState(0)
  const [duration, setDuration]         = useState(0)
  const [volume, setVolume]             = useState(1)
  const [saveStatus, setSaveStatus]     = useState<'idle' | 'saving' | 'saved'>('idle')
  const [recordSectionOpen, setRecordSectionOpen] = useState(false)
  const [recordMode, setRecordMode]     = useState<RecordMode>(null)
  const audioRef    = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rafRef      = useRef<number>(0)

  useEffect(() => { setLocalName(initialName) }, [initialName])

  // Re-sync tracks when initialTracks changes (project loaded with cloud tracks)
  useEffect(() => {
    if (initialTracks.length > 0) {
      setTracks(initialTracks)
      setSelectedId(prev => prev ?? initialTracks[0].id)
    }
  }, [initialTracks]) // eslint-disable-line

  const selectedTrack = tracks.find(t => t.id === selectedId) ?? null

  // Audio element management
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

  function skipBack() { seekTo(Math.max(0, currentTime - 5)) }
  function skipForward() { seekTo(Math.min(duration, currentTime + 5)) }

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
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': contentType || 'application/octet-stream' },
      })
      if (!putRes.ok) throw new Error(`R2 upload failed (${putRes.status})`)
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

  async function handleImport(files: FileList | null) {
    if (!files) return
    const newTracks: AudioTrack[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) continue
      const url = URL.createObjectURL(file)
      const dur = await getAudioDuration(url, file.type)
      const track: AudioTrack = {
        id: crypto.randomUUID(),
        name: file.name,
        url,
        duration: dur,
        contentType: file.type,
        uploadStatus: 'uploading',
        savedAt: new Date().toISOString(),
      }
      newTracks.push(track)
    }
    if (newTracks.length === 0) return
    setTracks(prev => [...prev, ...newTracks])
    setSelectedId(newTracks[0].id)
    // Upload each new track to R2 in the background
    for (const track of newTracks) {
      const file = Array.from(files).find(f => f.name === track.name)
      if (file) uploadToR2(file, track.id)
    }
  }

  function getAudioDuration(url: string, type: string): Promise<number> {
    return new Promise(resolve => {
      const el = document.createElement(type.startsWith('video/') ? 'video' : 'audio')
      el.src = url
      el.addEventListener('durationchange', () => resolve(el.duration || 0), { once: true })
      el.addEventListener('error', () => resolve(0), { once: true })
      setTimeout(() => resolve(0), 4000)
    })
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

  // ── Keyboard shortcuts ────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      if (e.code === 'ArrowLeft') { e.preventDefault(); skipBack() }
      if (e.code === 'ArrowRight') { e.preventDefault(); skipForward() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isPlaying, selectedTrack, currentTime, duration]) // eslint-disable-line

  // ── Upload status helpers ─────────────────────────────────────

  function UploadDot({ status }: { status?: AudioTrack['uploadStatus'] }) {
    if (!status || status === 'uploaded') return null
    if (status === 'uploading') return <Loader2 size={9} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-light)', flexShrink: 0 }} />
    return <AlertCircle size={9} color="#ef4444" style={{ flexShrink: 0 }} />
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); handleImport(e.dataTransfer.files) }}
    >
      <audio ref={audioRef} style={{ display: 'none' }} />

      {/* ── Header ──────────────────────────────────────────── */}
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
            <button onClick={() => setEditingName(true)} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', background: 'none', border: 'none', cursor: 'pointer' }} title="Click to rename">
              {localName}
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 16 }}>
            <Music size={11} color="var(--text-muted)" />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Audio + Beat Lab</span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {saveStatus === 'saved' && <span style={{ fontSize: 11, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={11} /> Saved</span>}
            <button onClick={save} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <Cloud size={11} /> Save
            </button>
            {activeModules && onModulesChange && (
              <ModuleSwitcher activeModules={activeModules} onModulesChange={onModulesChange} />
            )}
          </div>
        </div>
      )}

      {/* ── Unified layout ────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex' }}>

        {/* Track list sidebar */}
        <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Tracks header */}
          <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Tracks</span>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              <Upload size={10} /> Import
            </button>
          </div>

          {/* Track list */}
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {tracks.length === 0 && (
              <div style={{ padding: '16px 12px', textAlign: 'center' }}>
                <Music size={20} color="var(--text-muted)" style={{ marginBottom: 8 }} />
                <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>Drop audio here or click Import</p>
              </div>
            )}
            {tracks.map(track => (
              <button
                key={track.id}
                onClick={() => setSelectedId(track.id)}
                style={{
                  display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left',
                  background: selectedId === track.id ? 'var(--accent-subtle)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  borderLeft: `2px solid ${selectedId === track.id ? 'var(--accent)' : 'transparent'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
                  <Music size={11} color={selectedId === track.id ? 'var(--accent-light)' : 'var(--text-muted)'} />
                  <span style={{ fontSize: 11, fontWeight: 500, color: selectedId === track.id ? 'var(--accent-light)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {track.name}
                  </span>
                  <UploadDot status={track.uploadStatus} />
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', paddingLeft: 18, display: 'flex', gap: 6, alignItems: 'center' }}>
                  {fmtTime(track.duration)}
                  {track.uploadStatus === 'uploading' && <span style={{ color: 'var(--accent-light)' }}>uploading…</span>}
                  {track.uploadStatus === 'error' && <span style={{ color: '#ef4444' }}>upload failed</span>}
                </div>
              </button>
            ))}
          </div>

          {/* ── Record section ──────────────────────────────────── */}
          <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => setRecordSectionOpen(v => !v)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              {recordSectionOpen
                ? <ChevronDown size={10} color="var(--text-muted)" />
                : <ChevronRight size={10} color="var(--text-muted)" />}
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: recordMode ? '#dc2626' : 'var(--text-muted)', animation: recordMode ? 'pulse 1s ease-in-out infinite' : 'none' }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: recordMode ? '#dc2626' : 'var(--text-muted)' }}>Record</span>
            </button>

            {recordSectionOpen && (
              <div style={{ padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {/* Beat Recording */}
                <button
                  onClick={() => setRecordMode(recordMode === 'drums' ? null : 'drums')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                    borderRadius: 7, border: `1.5px solid ${recordMode === 'drums' ? '#dc2626' : 'var(--border)'}`,
                    background: recordMode === 'drums' ? 'rgba(220,38,38,0.08)' : 'var(--bg-card)',
                    cursor: 'pointer', textAlign: 'left', width: '100%',
                  }}
                >
                  <Drum size={13} color={recordMode === 'drums' ? '#dc2626' : 'var(--text-muted)'} />
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: recordMode === 'drums' ? '#dc2626' : 'var(--text-secondary)' }}>Beat Recording</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>Beatbox drums & percussion</div>
                  </div>
                </button>

                {/* Voice Transcription */}
                <button
                  onClick={() => setRecordMode(recordMode === 'voice' ? null : 'voice')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                    borderRadius: 7, border: `1.5px solid ${recordMode === 'voice' ? 'var(--accent)' : 'var(--border)'}`,
                    background: recordMode === 'voice' ? 'var(--accent-subtle)' : 'var(--bg-card)',
                    cursor: 'pointer', textAlign: 'left', width: '100%',
                  }}
                >
                  <Mic size={13} color={recordMode === 'voice' ? 'var(--accent-light)' : 'var(--text-muted)'} />
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: recordMode === 'voice' ? 'var(--accent-light)' : 'var(--text-secondary)' }}>Voice Transcription</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>Sing or hum → music notes</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* ── Sound Library ───────────────────────────────────── */}
          <SoundLibrary />

        </div>

        {/* Right column: waveform + beat lab + transport */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Song waveform */}
          <div style={{ flex: '0 0 148px', overflow: 'hidden', position: 'relative', borderBottom: '1px solid var(--border)' }}>
            {selectedTrack ? (
              <AudioWaveform
                src={selectedTrack.url}
                contentType="audio"
                currentTime={currentTime}
                duration={duration}
                onSeek={seekTo}
              />
            ) : (
              <div
                style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-muted)', cursor: 'pointer' }}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={32} strokeWidth={1} />
                <p style={{ fontSize: 12, textAlign: 'center' }}>Drop audio here or click to import</p>
                <p style={{ fontSize: 10, color: 'var(--border-light)' }}>MP3 · WAV · FLAC · AAC · M4A</p>
              </div>
            )}
          </div>

          {/* Beat Lab */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <BeatLab
              hasSong={!!selectedTrack}
              requestedFamily={
                recordMode === 'drums' ? 'drums'
                : recordMode === 'voice' ? 'piano'
                : null
              }
              onRequestSongPlay={() => {
                if (audioRef.current && selectedTrack) {
                  audioRef.current.play().catch(() => {})
                  setIsPlaying(true)
                }
              }}
              onRequestSongStop={() => {
                audioRef.current?.pause()
                setIsPlaying(false)
              }}
            />
          </div>

          {/* Song transport */}
          <div style={{ height: 52, borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flexShrink: 0, padding: '0 20px' }}>
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', minWidth: 52, textAlign: 'right' }}>{fmtTime(currentTime)}</span>
            <button onClick={skipBack} tabIndex={-1} style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}><SkipBack size={16} /></button>
            <button
              onClick={togglePlay}
              tabIndex={-1}
              disabled={!selectedTrack}
              style={{ width: 34, height: 34, borderRadius: '50%', background: selectedTrack ? 'var(--accent)' : 'var(--border)', border: 'none', cursor: selectedTrack ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}
            >
              {isPlaying ? <Pause size={14} fill="#fff" /> : <Play size={14} fill="#fff" style={{ marginLeft: 1 }} />}
            </button>
            <button onClick={skipForward} tabIndex={-1} style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}><SkipForward size={16} /></button>
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

        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,video/*"
        multiple
        style={{ display: 'none' }}
        onChange={e => handleImport(e.target.files)}
      />
    </div>
  )
}
