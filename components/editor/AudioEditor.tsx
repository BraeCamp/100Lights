'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Upload, Play, Pause, SkipBack, SkipForward, Volume2, Cloud, CheckCircle2, Music, AlertCircle, Loader2, ChevronDown, ChevronRight, Drum, Scissors, Zap } from 'lucide-react'
import AudioWaveform from './AudioWaveform'
import BeatLab from './BeatLab'
import SoundLibrary from './SoundLibrary'
import ModuleSwitcher from './ModuleSwitcher'
import type { Caption } from '@/lib/types'
import type { AudioTrackInit, ModuleKey } from '@/lib/editor-types'
import type { BeatTrackEntry, BeatHit, BeatType } from '@/lib/beat-analyzer'

// ── AudioTrack extends the shared init type with runtime-only fields ──────────

export interface AudioTrack extends AudioTrackInit {
  url: string
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

// Compact color map for beat type hit blocks in the track timeline
const BEAT_COLORS: Partial<Record<BeatType, string>> = {
  kick: '#7c3aed', snare: '#dc2626', hihat: '#ca8a04', 'open-hihat': '#d97706',
  clap: '#0284c7', tom: '#059669', crash: '#9333ea', rim: '#db2777',
}
function beatColor(type: string, overrides: BeatTrackEntry['typeOverrides']): string {
  return overrides[type]?.color ?? BEAT_COLORS[type as BeatType] ?? '#6b7280'
}
function beatLabel(type: string, overrides: BeatTrackEntry['typeOverrides']): string {
  return overrides[type]?.label ?? type
}

// ── Read-only track row for committed beat recordings ─────────────────────────

function BeatTrackRow({ track }: { track: BeatTrackEntry }) {
  const activeLanes = [...new Set(track.hits.map(h => h.type))]
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {activeLanes.map(type => {
        const color = beatColor(type, track.typeOverrides)
        const laneHits = track.hits.filter(h => h.type === type)
        return (
          <div key={type} style={{ display: 'flex', height: 26, alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
            {/* Lane label */}
            <div style={{ width: 88, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 10, paddingRight: 6, height: '100%', background: 'var(--bg-surface)', borderRight: '1px solid var(--border)' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {beatLabel(type, track.typeOverrides)}
              </span>
            </div>
            {/* Hit blocks */}
            <div style={{ flex: 1, position: 'relative', height: '100%', background: 'var(--bg-card)' }}>
              {laneHits.map(hit => (
                <div
                  key={hit.id}
                  style={{
                    position: 'absolute',
                    left: `${(hit.time / track.duration) * 100}%`,
                    top: 4, bottom: 4, width: 4,
                    background: color,
                    borderRadius: 1,
                    opacity: 0.5 + 0.5 * hit.velocity,
                    transform: 'translateX(-2px)',
                  }}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
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
  const [localName, setLocalName]   = useState(initialName)
  const [editingName, setEditingName] = useState(false)
  const [tracks, setTracks]         = useState<AudioTrack[]>(initialTracks)
  const [selectedId, setSelectedId] = useState<string | null>(initialTracks[0]?.id ?? null)
  const [isPlaying, setIsPlaying]   = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration]     = useState(0)
  const [volume, setVolume]         = useState(1)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const audioRef    = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rafRef      = useRef<number>(0)

  // Beat tracks — committed recordings from BeatLab
  const [beatTracks, setBeatTracks] = useState<BeatTrackEntry[]>([])

  // Increment to trigger BeatLab to start recording (with song auto-play)
  const [singCount, setSingCount] = useState(0)
  const [beatLabPhase, setBeatLabPhase] = useState<'idle' | 'recording' | 'analyzing' | 'editing'>('editing')
  // Portal target: BeatLab renders its lane editor here (inside the main scroll area)
  const [beatLabLanesEl, setBeatLabLanesEl] = useState<HTMLDivElement | null>(null)
  // Stem URL to feed directly into BeatLab for analysis (bypasses mic)
  const [analyzeStemUrl, setAnalyzeStemUrl] = useState<string | null>(null)
  const [analyzeStemLabel, setAnalyzeStemLabel] = useState<string>('')

  // Stem separation state per track id
  const [stemJobs, setStemJobs] = useState<Record<string, { predId: string; status: 'running' | 'done' | 'error' }>>({})

  const selectedTrack = tracks.find(t => t.id === selectedId) ?? null

  useEffect(() => { setLocalName(initialName) }, [initialName])

  useEffect(() => {
    if (initialTracks.length > 0) {
      setTracks(initialTracks)
      setSelectedId(prev => prev ?? initialTracks[0].id)
    }
  }, [initialTracks]) // eslint-disable-line

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

  function skipBack()    { seekTo(Math.max(0, currentTime - 5)) }
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
      const putRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': contentType || 'application/octet-stream' } })
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
        id: crypto.randomUUID(), name: file.name, url, duration: dur,
        contentType: file.type, uploadStatus: 'uploading', savedAt: new Date().toISOString(),
      }
      newTracks.push(track)
    }
    if (newTracks.length === 0) return
    setTracks(prev => [...prev, ...newTracks])
    setSelectedId(newTracks[0].id)
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

  // ── Stem separation ──────────────────────────────────────────

  async function separateStems(track: AudioTrack) {
    setStemJobs(prev => ({ ...prev, [track.id]: { predId: '', status: 'running' } }))
    try {
      // Fetch the audio as a blob so we can POST it as multipart
      const audioBlob = await fetch(track.url).then(r => r.blob())
      const form = new FormData()
      form.append('audio', audioBlob, track.name || 'audio.mp3')
      const startRes = await fetch('/api/stems', { method: 'POST', body: form })
      if (!startRes.ok) throw new Error(await startRes.text())
      const { predictionId } = await startRes.json() as { predictionId: string; status: string }

      setStemJobs(prev => ({ ...prev, [track.id]: { predId: predictionId, status: 'running' } }))

      // Poll until done
      let stems: Record<string, string> | null = null
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 5000))
        const pollRes = await fetch(`/api/stems?id=${predictionId}`)
        const data    = await pollRes.json() as { status: string; stems?: Record<string, string>; error?: string }
        if (data.status === 'succeeded' && data.stems) { stems = data.stems; break }
        if (data.status === 'failed' || data.status === 'canceled') throw new Error(data.error ?? 'Stem separation failed')
      }
      if (!stems) throw new Error('Timed out waiting for stems')

      // Add each stem as a new track, tagged with stemType
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
          url,
          duration: dur,
          contentType: 'audio/mpeg',
          uploadStatus: 'uploaded',
          savedAt: new Date().toISOString(),
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

        {/* ── Sidebar: Sounds & Samples ───────────────────────── */}
        <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Sounds &amp; Samples</span>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
              title="Import audio file into timeline"
            >
              <Upload size={10} /> Import
            </button>
          </div>
          <SoundLibrary embedded />
        </div>

        {/* ── Right column: track timeline + BeatLab workspace + transport ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Track timeline — audio waveforms + beat track rows — fills all remaining space */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', borderBottom: '1px solid var(--border)' }}>


              {/* Audio tracks */}
              {tracks.map(track => (
                <div key={track.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  {/* Track label row */}
                  <div
                    onClick={() => setSelectedId(track.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: selectedId === track.id ? 'var(--accent-subtle)' : 'var(--bg-surface)', borderLeft: `2px solid ${selectedId === track.id ? 'var(--accent)' : 'transparent'}`, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                  >
                    <Music size={9} color={selectedId === track.id ? 'var(--accent-light)' : 'var(--text-muted)'} />
                    <span style={{ fontSize: 10, color: selectedId === track.id ? 'var(--accent-light)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {track.name}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>{fmtTime(track.duration)}</span>
                    {/* Analyze drums stem in BeatLab */}
                    {track.stemType === 'drums' && (
                      <button
                        onClick={e => { e.stopPropagation(); setAnalyzeStemUrl(track.url); setAnalyzeStemLabel('drums stem') }}
                        title="Send drums stem directly into BeatLab for accurate hit detection"
                        style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)', color: 'var(--accent-light)', cursor: 'pointer', flexShrink: 0 }}
                      >
                        <Zap size={8} /> Analyze
                      </button>
                    )}
                    {/* Separate stems button */}
                    {(() => {
                      const job = stemJobs[track.id]
                      if (job?.status === 'running') return (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: 'var(--accent-light)', flexShrink: 0 }}>
                          <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> Separating…
                        </span>
                      )
                      if (job?.status === 'done') return (
                        <span style={{ fontSize: 9, color: 'var(--success)', flexShrink: 0 }}>✓ Stems added</span>
                      )
                      if (job?.status === 'error') return (
                        <span style={{ fontSize: 9, color: 'var(--error)', flexShrink: 0 }}>Failed</span>
                      )
                      if (track.stemType) return null  // no Stems button on stem tracks
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
                  {/* Waveform row */}
                  <div style={{ height: 60, position: 'relative', overflow: 'hidden' }}>
                    {selectedId === track.id ? (
                      <AudioWaveform
                        src={track.url}
                        contentType="audio"
                        currentTime={currentTime}
                        duration={duration}
                        onSeek={seekTo}
                      />
                    ) : (
                      <div style={{ height: '100%', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', padding: '0 10px' }}>
                        <div style={{ flex: 1, height: 2, background: 'var(--border)', borderRadius: 1 }} />
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Beat tracks (read-only) */}
              {beatTracks.map((track, i) => (
                <div key={track.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', borderLeft: '2px solid rgba(139,92,246,0.4)' }}>
                    <Drum size={9} color="var(--text-muted)" />
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)', flex: 1 }}>Beat {i + 1}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
                      {track.hits.length} hits{track.bpm ? ` · ${track.bpm} BPM` : ''}
                    </span>
                  </div>
                  <BeatTrackRow track={track} />
                </div>
              ))}

              {/* BeatLab lane editor lives here when in editing phase — rendered via portal from BeatLab */}
              <div ref={el => setBeatLabLanesEl(el)} />
          </div>

          {/* BeatLab toolbar panel — always compact; lanes portal into the timeline above */}
          <div style={{
            flexShrink: 0,
            height: beatLabPhase === 'idle' ? 44 : beatLabPhase === 'analyzing' ? 140 : beatLabPhase === 'recording' ? 180 : 52,
            overflow: 'hidden',
            transition: 'height 0.2s ease',
            borderTop: '1px solid var(--border)',
          }}>
            <BeatLab
              projectId={projectId}
              hasSong={tracks.length > 0}
              requestRecord={singCount}
              lanesContainer={beatLabLanesEl}
              analyzeStemUrl={analyzeStemUrl}
              stemLabel={analyzeStemLabel}
              onStemAnalyzed={() => setAnalyzeStemUrl(null)}
              onPhaseChange={p => setBeatLabPhase(p as 'idle' | 'recording' | 'analyzing' | 'editing')}
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
              onAddTrack={entry => {
                setBeatTracks(prev => [...prev, { ...entry, name: `Beat ${prev.length + 1}` }])
              }}
            />
          </div>

          {/* Song transport — only shown when audio tracks are loaded */}
          <div style={{ height: tracks.length > 0 ? 52 : 0, overflow: 'hidden', borderTop: tracks.length > 0 ? '1px solid var(--border)' : 'none', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flexShrink: 0, padding: '0 20px', transition: 'height 0.2s ease' }}>
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
