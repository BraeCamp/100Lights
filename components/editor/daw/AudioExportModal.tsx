'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, Loader2, Globe2 } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import { isAudioClip } from '@/lib/daw-types'
import type { PodcastMeta } from '@/lib/project-serializer'
import { audioBufferToWav, blobToAudioBuffer } from '@/lib/wav-encoder'

// Resample to the chosen export rate via OfflineAudioContext — the browser's
// resampler, no dependency. Skipped when the buffer is already at the target.
async function resampleBuffer(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
  if (Math.abs(buffer.sampleRate - targetRate) < 1) return buffer
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(buffer.duration * targetRate), targetRate)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  src.start(0)
  return ctx.startRendering()
}
import { shareSong, shareProjectStarter } from '@/lib/community'

interface Props {
  onClose: () => void
  audioMode?: 'music' | 'podcast'
  podcastMeta?: PodcastMeta
  defaultFormat?: ExportFormat
}

type ExportFormat  = 'webm' | 'wav' | 'stems'

const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const keyLabel = (key: unknown, scale: unknown) => `${typeof key === 'number' ? KEY_NAMES[key % 12] ?? 'C' : key} ${scale}`
type StatusMessage = 'recording' | 'converting' | 'normalizing' | 'done'

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ''
}

async function normalizeAudioBuffer(buffer: AudioBuffer, targetLufs = -16): Promise<AudioBuffer> {
  // Calculate RMS power across all channels
  let sumSquares = 0
  let count = 0
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < data.length; i++) {
      sumSquares += data[i] * data[i]
      count++
    }
  }
  const rms    = Math.sqrt(sumSquares / (count || 1))
  const rmsDb  = 20 * Math.log10(rms || 0.00001)

  // Target RMS for the given LUFS (rough LUFS→RMS approximation, +3 dB offset)
  const targetDb   = targetLufs + 3
  const gainDb     = targetDb - rmsDb
  const gainLinear = Math.pow(10, gainDb / 20)

  // Apply gain via OfflineAudioContext
  const offlineCtx = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
  )
  const source   = offlineCtx.createBufferSource()
  source.buffer  = buffer
  const gainNode = offlineCtx.createGain()
  gainNode.gain.value = Math.min(gainLinear, 4)  // cap at +12 dB
  source.connect(gainNode)
  gainNode.connect(offlineCtx.destination)
  source.start(0)

  return offlineCtx.startRendering()
}

export default function AudioExportModal({ onClose, audioMode, podcastMeta, defaultFormat }: Props) {
  const { project, engine } = useDaw()
  const [phase, setPhase]                 = useState<'idle' | 'recording' | 'done' | 'error'>('idle')
  const phaseRef = useRef(phase)
  useEffect(() => { phaseRef.current = phase }, [phase])
  const [progress, setProgress]           = useState(0)
  const [downloadUrl, setDownloadUrl]     = useState<string | null>(null)
  const [sampleRate, setSampleRate]       = useState<44100 | 48000>(48000)
  const [format, setFormat]               = useState<ExportFormat>(defaultFormat ?? 'webm')
  const [normalize, setNormalize]         = useState(false)
  const [statusMessage, setStatusMessage] = useState<StatusMessage>('recording')
  const ivRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const finalBlobRef = useRef<Blob | null>(null)
  const [shareState, setShareState]       = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [shareName, setShareName]         = useState('')
  const [sharedId, setSharedId]           = useState<string | null>(null)
  const [starterState, setStarterState]   = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [starterId, setStarterId]         = useState<string | null>(null)

  // Escape closes the modal — except mid-export, matching the overlay-click guard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && phaseRef.current !== 'recording') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const endBeat = Math.max(
    project.arrangementClips.filter(isAudioClip).reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 0),
    project.loopEnd,
    8,
  )

  // Clean up if modal unmounts mid-export
  useEffect(() => () => {
    if (ivRef.current) clearInterval(ivRef.current)
    if (engine.isRecording) { engine.stop(); void engine.stopRecording() }
  }, [engine])

  // One playback pass; every track's post-fader output is tapped by its own
  // recorder, then each becomes a WAV inside a single zip.
  async function startStemExport() {
    const stemTracks = project.tracks.filter(t =>
      project.arrangementClips.some(c => c.trackId === t.id))
    if (stemTracks.length === 0) { setPhase('error'); return }
    setPhase('recording')
    setStatusMessage('recording')
    setProgress(0)
    engine.seek(0)
    // The pass must reach the end — with looping on, it never would
    engine.setLoopEnabled(false)
    const { taps, dispose } = engine.tapTrackOutputs(stemTracks.map(t => t.id))
    const recs = new Map<string, { rec: MediaRecorder; chunks: Blob[] }>()
    const mime = ['audio/webm;codecs=opus', 'audio/webm'].find(m => MediaRecorder.isTypeSupported(m)) ?? ''
    for (const [id, dest] of taps) {
      const chunks: Blob[] = []
      const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined)
      rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      rec.start(200)
      recs.set(id, { rec, chunks })
    }
    engine.play()

    ivRef.current = setInterval(() => {
      const beat = engine.currentBeat
      setProgress(Math.min(0.99, beat / endBeat))
      if (beat >= endBeat) {
        clearInterval(ivRef.current!)
        ivRef.current = null
        engine.stop()
        void (async () => {
          try {
            setStatusMessage('converting')
            const files: Array<{ name: string; blob: Blob }> = []
            for (const t of stemTracks) {
              const entry = recs.get(t.id)
              if (!entry) continue
              await new Promise<void>(res => { entry.rec.onstop = () => res(); entry.rec.stop() })
              const blob = new Blob(entry.chunks, { type: mime || 'audio/webm' })
              if (blob.size === 0) continue
              const audioBuffer = await resampleBuffer(await blobToAudioBuffer(blob), sampleRate)
              const safe = t.name.replace(/[^\w\- ]+/g, '').trim() || 'track'
              files.push({ name: `${safe}.wav`, blob: audioBufferToWav(audioBuffer) })
            }
            dispose()
            if (files.length === 0) { setPhase('error'); return }
            const { makeZip } = await import('@/lib/zip')
            const zip = await makeZip(files)
            finalBlobRef.current = zip
            setDownloadUrl(URL.createObjectURL(zip))
            setProgress(1)
            setStatusMessage('done')
            setPhase('done')
          } catch {
            dispose()
            setPhase('error')
          }
        })()
      }
    }, 100)
  }

  async function startExport() {
    if (format === 'stems') { await startStemExport(); return }
    setPhase('recording')
    setStatusMessage('recording')
    setProgress(0)
    engine.seek(0)
    // The pass must reach the end — with looping on, it never would
    engine.setLoopEnabled(false)
    await engine.startRecording()
    engine.play()

    ivRef.current = setInterval(() => {
      const beat = engine.currentBeat
      setProgress(Math.min(0.99, beat / endBeat))
      if (beat >= endBeat) {
        clearInterval(ivRef.current!)
        ivRef.current = null
        engine.stop()
        void engine.stopRecording().then(async (blob) => {
          if (!blob) { setPhase('error'); return }
          try {
            let finalBlob: Blob

            if (format === 'wav') {
              setStatusMessage('converting')
              const audioBuffer = await blobToAudioBuffer(blob)

              let finalBuffer = audioBuffer
              if (normalize && audioMode === 'podcast') {
                setStatusMessage('normalizing')
                finalBuffer = await normalizeAudioBuffer(audioBuffer)
              }
              finalBuffer = await resampleBuffer(finalBuffer, sampleRate)

              finalBlob = audioBufferToWav(finalBuffer)
            } else {
              finalBlob = blob
            }

            finalBlobRef.current = finalBlob
            setDownloadUrl(URL.createObjectURL(finalBlob))
            setProgress(1)
            setStatusMessage('done')
            setPhase('done')
          } catch (_err: unknown) {
            setPhase('error')
          }
        })
      }
    }, 100)
  }

  const ext = format === 'stems' ? 'zip' : format === 'wav' ? 'wav' : 'webm'

  // Filename: slug from podcast metadata or project name
  const filename = (() => {
    if (audioMode === 'podcast' && podcastMeta) {
      const showSlug = slugify(podcastMeta.showName)
      const epPart   = podcastMeta.episodeNumber != null ? `ep-${podcastMeta.episodeNumber}` : null
      const parts    = [showSlug, epPart].filter((p): p is string => Boolean(p))
      return parts.length > 0 ? `${parts.join('-')}.${ext}` : `podcast-export.${ext}`
    }
    const safeName = (project.name ?? 'export').replace(/[^a-z0-9_\-\s]/gi, '').trim() || 'export'
    return `${safeName}.${ext}`
  })()

  const isPodcast = audioMode === 'podcast'

  const statusLabel: Record<StatusMessage, string> = {
    recording:   'Recording… do not close this window',
    converting:  'Converting to WAV…',
    normalizing: 'Normalizing for podcast delivery…',
    done:        'Done',
  }

  const overlay = (
    <div
className="electron-nodrag"
style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={phase === 'recording' ? undefined : onClose}
    >
      <div
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 12, width: 380, overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            {isPodcast ? 'Export Podcast Episode' : 'Export Audio'}
          </span>
          {phase !== 'recording' && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '20px 18px 22px' }}>
          {phase === 'idle' && (
            <>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.5 }}>
                Plays your project from beat 1 to the end while capturing the master output.
              </p>

              {/* Format selector */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Format
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['webm', 'wav', 'stems'] as ExportFormat[]).map(f => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      style={{
                        flex: 1, padding: '7px 0', borderRadius: 6,
                        fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        border: format === f ? '1px solid var(--accent)' : '1px solid var(--border)',
                        background: format === f ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                        color: format === f ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                    >
                      {f === 'webm' ? 'WebM / Opus' : f === 'wav' ? 'WAV (lossless)' : 'Stems (zip of WAVs)'}
                    </button>
                  ))}
                </div>
                {format === 'wav' && (
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.4 }}>
                    Converts after recording — slightly slower, lossless 16-bit PCM
                  </p>
                )}
                {(format === 'wav' || format === 'stems') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Sample rate</span>
                    {([44100, 48000] as const).map(r => (
                      <button key={r}
                        onClick={() => setSampleRate(r)}
                        title={r === 44100 ? 'CD / streaming standard' : 'Video / broadcast standard (recording rate — no resample)'}
                        style={{
                          padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          border: sampleRate === r ? '1px solid var(--accent)' : '1px solid var(--border)',
                          background: sampleRate === r ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                          color: sampleRate === r ? 'var(--accent)' : 'var(--text-secondary)',
                        }}
                      >{r === 44100 ? '44.1 kHz' : '48 kHz'}</button>
                    ))}
                  </div>
                )}
              </div>

              {/* Normalize — podcast + WAV only */}
              {isPodcast && format === 'wav' && (
                <label
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14, cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={normalize}
                    onChange={e => setNormalize(e.target.checked)}
                    style={{ marginTop: 2, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    Normalize for podcast delivery (~-16 LUFS)
                  </span>
                </label>
              )}

              <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-muted)', marginBottom: 22 }}>
                <span>Duration: ~{Math.ceil(engine.beatsToSeconds(endBeat))}s</span>
                <span>·</span>
                <span>File: {filename}</span>
              </div>
              <button
                onClick={() => void startExport()}
                style={{
                  width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
                  background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Start Export
              </button>
            </>
          )}

          {phase === 'recording' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <Loader2 size={16} color="var(--accent-light)" style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {statusLabel[statusMessage]}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  background: statusMessage === 'normalizing' ? '#f97316'
                    : statusMessage !== 'recording' ? '#22c55e'
                    : 'var(--accent)',
                  width: statusMessage === 'recording' ? `${Math.round(progress * 100)}%` : '100%',
                  transition: 'width 0.1s linear',
                }} />
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'right' }}>
                {statusMessage === 'recording' ? `${Math.round(progress * 100)}%` : statusLabel[statusMessage]}
              </p>
            </>
          )}

          {phase === 'done' && downloadUrl && (
            <>
              {/* Episode info card — shown in podcast mode */}
              {isPodcast && podcastMeta && (
                <div style={{
                  marginBottom: 16, padding: '10px 12px', borderRadius: 8,
                  background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)',
                }}>
                  {podcastMeta.showName && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#f97316', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                      {podcastMeta.showName}
                    </div>
                  )}
                  {podcastMeta.episodeTitle && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                      {podcastMeta.episodeTitle}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 10, color: 'var(--text-muted)' }}>
                    {podcastMeta.season != null && <span>S{podcastMeta.season}</span>}
                    {podcastMeta.episodeNumber != null && <span>E{podcastMeta.episodeNumber}</span>}
                    {podcastMeta.host && <span>· Host: {podcastMeta.host}</span>}
                    {podcastMeta.guests && <span>· {podcastMeta.guests}</span>}
                    {podcastMeta.episodeType && podcastMeta.episodeType !== 'full' && <span style={{ textTransform: 'capitalize' }}>· {podcastMeta.episodeType}</span>}
                  </div>
                </div>
              )}

              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Export complete. Click below to download.
              </p>
              <a
                href={downloadUrl}
                download={filename}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
                  background: '#22c55e', color: '#fff', fontSize: 13, fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                <Download size={14} /> {isPodcast ? 'Download Podcast Episode' : `Download ${filename}`}
              </a>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
                {format === 'wav'
                  ? `Exported as 16-bit PCM WAV.${normalize && isPodcast ? ' Normalized to approximate -16 LUFS.' : ''}`
                  : 'Exported as WebM/Opus. For MP3, re-encode with any converter.'}
              </p>

              {/* Share the finished mix to the community feed (music mode) */}
              {!isPodcast && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  {shareState === 'done' ? (
                    <p style={{ fontSize: 11.5, color: '#4ade80', margin: 0 }}>
                      Shared! <a href={sharedId ? `/community/${sharedId}` : '/community?kind=song'} target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>View its public page ↗</a>
                      {sharedId && (
                        <button
                          onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/community/${sharedId}`) }}
                          style={{ marginLeft: 10, fontSize: 10.5, padding: '2px 10px', borderRadius: 999, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
                        >Copy link</button>
                      )}
                    </p>
                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          value={shareName}
                          onChange={e => setShareName(e.target.value)}
                          placeholder={project.name ?? 'Song title'}
                          style={{
                            flex: 1, minWidth: 0, background: '#101010', border: '1px solid var(--border)', borderRadius: 7,
                            color: 'var(--text-primary)', fontSize: 12, padding: '8px 10px', outline: 'none',
                          }}
                        />
                        <button
                          onClick={async () => {
                            const blob = finalBlobRef.current
                            if (!blob) return
                            setShareState('busy')
                            try {
                              // Stamp BPM/key/duration and pre-render the waveform so
                              // the feed card and share unfurl draw instantly.
                              let meta: { bpm: number; key: string; durationSec?: number; peaks?: number[] } = {
                                bpm: project.tempo, key: keyLabel(project.key, project.scale),
                              }
                              try {
                                const decoded = await blobToAudioBuffer(blob)
                                const ch = decoded.getChannelData(0)
                                const bars = 120
                                const per = Math.max(1, Math.floor(ch.length / bars))
                                const peaks: number[] = []
                                for (let i = 0; i < bars; i++) {
                                  let m = 0
                                  for (let j = i * per; j < Math.min((i + 1) * per, ch.length); j += 16) m = Math.max(m, Math.abs(ch[j]))
                                  peaks.push(m)
                                }
                                const mx = Math.max(...peaks, 0.01)
                                meta = { ...meta, durationSec: Math.round(decoded.duration * 10) / 10, peaks: peaks.map(v => Math.round((v / mx) * 100) / 100) }
                              } catch { /* meta stays partial */ }
                              const id = await shareSong(blob, shareName.trim() || project.name || 'Untitled song', '', meta)
                              setSharedId(id)
                              setShareState('done')
                            } catch { setShareState('error') }
                          }}
                          disabled={shareState === 'busy'}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, fontSize: 12, fontWeight: 700,
                            padding: '8px 13px', borderRadius: 7, border: 'none', cursor: 'pointer',
                            background: 'var(--accent)', color: '#fff', opacity: shareState === 'busy' ? 0.6 : 1,
                          }}
                        >
                          <Globe2 size={13} /> {shareState === 'busy' ? 'Sharing…' : 'Share to Community'}
                        </button>
                      </div>
                      <p style={{ fontSize: 10, color: shareState === 'error' ? '#ef4444' : 'var(--text-muted)', margin: '6px 0 0' }}>
                        {shareState === 'error' ? 'Share failed — try again.' : 'Posts this mix publicly so other producers can listen and vote.'}
                      </p>
                    </>
                  )}

                  {/* Share the arrangement itself as a remixable starter */}
                  <div style={{ marginTop: 10 }}>
                    {starterState === 'done' ? (
                      <p style={{ fontSize: 11, color: '#4ade80', margin: 0 }}>
                        Starter shared! <a href={starterId ? `/community/${starterId}` : '/community?kind=project'} target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>View its public page ↗</a>
                      </p>
                    ) : (
                      <button
                        onClick={async () => {
                          setStarterState('busy')
                          try {
                            // Strip session-only bits: blob URLs die with the tab and
                            // voice-map traces are heavy — collaborative audio still
                            // resolves via r2Key / libraryId.
                            const dawProject = {
                              ...project,
                              arrangementClips: project.arrangementClips.map(c => {
                                const copy = { ...c } as Record<string, unknown>
                                if (typeof copy.audioUrl === 'string' && (copy.audioUrl as string).startsWith('blob:')) delete copy.audioUrl
                                delete copy.voiceMap
                                return copy
                              }),
                            }
                            const id = await shareProjectStarter(dawProject, shareName.trim() || project.name || 'Untitled starter', '', {
                              tempo: project.tempo, key: keyLabel(project.key, project.scale),
                              tracks: project.tracks.length, clips: project.arrangementClips.length,
                            })
                            setStarterId(id)
                            setStarterState('done')
                          } catch { setStarterState('error') }
                        }}
                        disabled={starterState === 'busy'}
                        style={{
                          fontSize: 10.5, fontWeight: 600, padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
                          border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)',
                          opacity: starterState === 'busy' ? 0.6 : 1,
                        }}
                      >
                        {starterState === 'busy' ? 'Sharing starter…' : starterState === 'error' ? 'Starter share failed — retry' : 'Also share the project as a remixable starter'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {phase === 'error' && (
            <p style={{ fontSize: 12, color: '#ef4444' }}>Export failed. Please try again.</p>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : null
}
