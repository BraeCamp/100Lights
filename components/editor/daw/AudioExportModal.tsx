'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, Loader2, Globe2, Lock } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import { isAudioClip } from '@/lib/daw-types'
import type { PodcastMeta } from '@/lib/project-serializer'
import SongDetails from '@/components/editor/SongDetails'
import { audioBufferToWav, blobToAudioBuffer } from '@/lib/wav-encoder'
import { usePlan } from '@/hooks/usePlan'
import { useUpgradeModal } from '@/components/UpgradeModal'
import { useUITierOptional } from '../UITierProvider'

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

type ExportFormat  = 'webm' | 'wav' | 'stems' | 'midi'

const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const keyLabel = (key: unknown, scale: unknown) => `${typeof key === 'number' ? KEY_NAMES[key % 12] ?? 'C' : key} ${scale}`
type StatusMessage = 'recording' | 'rendering' | 'converting' | 'normalizing' | 'done'

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
  const { isPro, ent } = usePlan()
  const { showUpgrade } = useUpgradeModal()
  const uiTier = useUITierOptional()
  const [phase, setPhase]                 = useState<'idle' | 'recording' | 'done' | 'error'>('idle')
  const phaseRef = useRef(phase)
  useEffect(() => { phaseRef.current = phase }, [phase])
  const [progress, setProgress]           = useState(0)
  const [downloadUrl, setDownloadUrl]     = useState<string | null>(null)
  const [sampleRate, setSampleRate]       = useState<44100 | 48000 | 88200 | 96000>(48000)
  const [format, setFormat]               = useState<ExportFormat>(defaultFormat ?? 'webm')
  const [normalize, setNormalize]         = useState(false)
  const [statusMessage, setStatusMessage] = useState<StatusMessage>('recording')
  const ivRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stemDisposeRef = useRef<(() => void) | null>(null)
  const finalBlobRef = useRef<Blob | null>(null)
  const [shareState, setShareState]       = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [shareName, setShareName]         = useState('')
  const [sharedId, setSharedId]           = useState<string | null>(null)
  const [starterState, setStarterState]   = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [starterId, setStarterId]         = useState<string | null>(null)

  // Admin "edit this article clip in the studio" flow: the URL carries
  // ?saveTo=demo:<clipId> or r2:<learn-audio key>, meaning the finished mixdown
  // should overwrite that source in place rather than (only) download. Parsed
  // once; when present we default to lossless WAV so the saved file isn't Opus.
  const [saveTarget, setSaveTarget] = useState<{ kind: 'demo' | 'r2'; id: string; label: string } | null>(null)
  const [saveToState, setSaveToState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('saveTo')
    if (!raw) return
    const i = raw.indexOf(':')
    const kind = raw.slice(0, i), id = raw.slice(i + 1)
    if ((kind === 'demo' || kind === 'r2') && id) {
      setSaveTarget({ kind, id, label: kind === 'demo' ? id : id.replace(/^learn-audio\//, '') })
      setFormat('wav')
    }
  }, [])

  async function saveToSource() {
    const blob = finalBlobRef.current
    if (!blob || !saveTarget) return
    setSaveToState('busy')
    try {
      const url = saveTarget.kind === 'demo'
        ? `/api/admin/demo-audio/${encodeURIComponent(saveTarget.id)}`
        : `/api/admin/articles/audio?key=${encodeURIComponent(saveTarget.id)}`
      const type = /^audio\//.test(blob.type) ? blob.type : 'audio/wav'
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body: blob })
      if (!r.ok) throw new Error(await r.text().catch(() => '') || 'save failed')
      setSaveToState('done')
    } catch { setSaveToState('error') }
  }

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
    stemDisposeRef.current?.()  // release tapped stem outputs if we closed mid-stem-export
  }, [engine])

  // Revoke the download blob URL when it's replaced (re-export) or on unmount —
  // otherwise every export permanently leaks a blob: URL for the tab's lifetime.
  useEffect(() => () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl) }, [downloadUrl])

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
    // Idempotent teardown, tracked in a ref so unmount-mid-export releases the taps.
    let disposed = false
    const disposeStems = () => { if (disposed) return; disposed = true; stemDisposeRef.current = null; dispose() }
    stemDisposeRef.current = disposeStems
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
            disposeStems()
            if (files.length === 0) { setPhase('error'); return }
            const { makeZip } = await import('@/lib/zip')
            const zip = await makeZip(files)
            finalBlobRef.current = zip
            setDownloadUrl(URL.createObjectURL(zip))
            setProgress(1)
            setStatusMessage('done')
            setPhase('done')
          } catch {
            disposeStems()
            setPhase('error')
          }
        })()
      }
    }, 100)
  }

  const [producedExt, setProducedExt] = useState<string | null>(null)

  async function startExport() {
    if (format === 'midi') {
      // Instant — no render pass. Serialize notes + tempo/meter to a .mid.
      const { writeProjectMidi } = await import('@/lib/midi-file')
      const { blob, midiTracks } = writeProjectMidi(project)
      if (midiTracks === 0) { setStatusMessage('done'); setPhase('error'); return }
      finalBlobRef.current = blob
      setDownloadUrl(URL.createObjectURL(blob))
      setProgress(1)
      setStatusMessage('done')
      setPhase('done')
      return
    }
    if (format === 'stems') { await startStemExport(); return }
    // Render OFFLINE rather than recording playback.
    //
    // This used to press play and capture the output with a MediaRecorder, so
    // exporting a three-minute song took three minutes of listening to it —
    // and any hiccup on the audio thread went into the file, because a
    // real-time capture records whatever actually came out. The mix is data;
    // it does not need to be performed to be written down. An OfflineAudioContext
    // renders as fast as the CPU allows and is deterministic.
    //
    // ⚠ Not yet safe for Apollo synth tracks. On a seven-track Apollo project the
    // offline render silently drops the Pad: its intro renders as digital
    // silence and the section where only pad and choir play comes back 93% sub.
    // That predates the combining work and is not a warm-up race
    // (preloadApolloInstrument does wait for readiness). Until it is understood,
    // those projects keep the slow-but-correct capture: an export missing a
    // whole track is far worse than one that takes a while.
    const hasApollo = project.tracks.some(t => t.instrument?.type === 'apollo')

    if (hasApollo) {
      // The slow, correct path. Capture a real playback pass.
      setPhase('recording')
      setStatusMessage('recording')
      setProgress(0)
      engine.seek(0)
      engine.setLoopEnabled(false)   // the pass must reach the end; looping never would
      await engine.startRecording()
      engine.play()
      ivRef.current = setInterval(() => {
        const beat = engine.currentBeat
        setProgress(Math.min(0.99, beat / endBeat))
        if (beat < endBeat) return
        clearInterval(ivRef.current!)
        ivRef.current = null
        engine.stop()
        void engine.stopRecording().then(async (blob) => {
          if (!blob) { setPhase('error'); return }
          try {
            let finalBlob: Blob
            if (format === 'wav') {
              setStatusMessage('converting')
              let finalBuffer = await blobToAudioBuffer(blob)
              if (normalize && audioMode === 'podcast') {
                setStatusMessage('normalizing')
                finalBuffer = await normalizeAudioBuffer(finalBuffer)
              }
              finalBuffer = await resampleBuffer(finalBuffer, sampleRate)
              finalBlob = audioBufferToWav(finalBuffer)
            } else {
              finalBlob = blob
            }
            finalBlobRef.current = finalBlob
            setProducedExt(format === 'wav' ? 'wav' : 'webm')
            setDownloadUrl(URL.createObjectURL(finalBlob))
            setProgress(1)
            setStatusMessage('done')
            setPhase('done')
          } catch { setPhase('error') }
        })
      }, 100)
      return
    }

    setPhase('recording')
    setStatusMessage('rendering')
    setProgress(0.05)
    try {
      const { renderProjectAudioBlob } = await import('@/lib/song-video/render-audio')
      const mix = await renderProjectAudioBlob(project, { startBeat: 0, endBeat })
      setProgress(0.8)

      let finalBlob: Blob
      if (format === 'wav') {
        setStatusMessage('converting')
        let finalBuffer = await blobToAudioBuffer(mix.blob)
        if (normalize && audioMode === 'podcast') {
          setStatusMessage('normalizing')
          finalBuffer = await normalizeAudioBuffer(finalBuffer)
        }
        finalBuffer = await resampleBuffer(finalBuffer, sampleRate)
        finalBlob = audioBufferToWav(finalBuffer)
      } else {
        finalBlob = mix.blob
      }

      finalBlobRef.current = finalBlob
      setProducedExt(format === 'wav' ? 'wav'
        : finalBlob.type.includes('mp4') ? 'm4a'
        : finalBlob.type.includes('wav') ? 'wav' : 'audio')
      setDownloadUrl(URL.createObjectURL(finalBlob))
      setProgress(1)
      setStatusMessage('done')
      setPhase('done')
    } catch {
      setPhase('error')
    }
  }

  // The compressed mixdown is whatever the offline encoder produced (AAC-in-MP4
  // where the browser has an encoder, WAV otherwise) — naming it .webm would be
  // a lie about the file's contents.
  const ext = format === 'stems' ? 'zip'
    : format === 'midi' ? 'mid'
    : format === 'wav' ? 'wav'
    : (producedExt ?? 'm4a')

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

  // Beginner tier: one-click export. Hide the format + sample-rate choices and
  // just bounce a WebM mixdown. (Podcast keeps its options — WAV matters there.)
  const simpleExport = (uiTier?.tier ?? 'full') === 'beginner' && !isPodcast
  useEffect(() => {
    if (simpleExport && format !== 'webm') setFormat('webm')
  }, [simpleExport, format])

  const statusLabel: Record<StatusMessage, string> = {
    recording:   'Recording… do not close this window',
    rendering:   'Rendering the mix…',
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

              {/* Song details + sample credits — auto-generated; credits travel with the export. */}
              {!isPodcast && (
                <details style={{ marginBottom: 14 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Song details &amp; credits</summary>
                  <div style={{ marginTop: 10, padding: '12px 14px', background: 'var(--bg-base, #0f0f11)', border: '1px solid var(--border, #26262b)', borderRadius: 8 }}>
                    <SongDetails project={project} />
                  </div>
                </details>
              )}

              {/* Format selector — hidden in Simple mode (one-click WebM) */}
              {!simpleExport && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Format
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['webm', 'wav', 'stems', 'midi'] as ExportFormat[]).map(f => {
                    // WAV + stems are release-grade output → Pro. Free exports a
                    // high-quality WebM/Opus mixdown (not crippled). MIDI is free —
                    // it's note data for interop, not an audio master. The admin
                    // article-editing flow (saveTarget) forces WAV and bypasses.
                    const locked = f !== 'webm' && f !== 'midi' && !isPro && !saveTarget && !ent.audioFormats.includes(f)
                    return (
                      <button
                        key={f}
                        onClick={() => locked
                          ? showUpgrade('WAV and stem exports are a Pro feature. Free exports a high-quality compressed mixdown — upgrade for lossless masters and per-track stems.')
                          : setFormat(f)}
                        title={locked ? 'Pro feature' : undefined}
                        style={{
                          flex: 1, padding: '7px 0', borderRadius: 6,
                          fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                          border: format === f ? '1px solid var(--accent)' : '1px solid var(--border)',
                          background: format === f ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                          color: locked ? 'var(--text-muted)' : format === f ? 'var(--accent)' : 'var(--text-secondary)',
                          opacity: locked ? 0.75 : 1,
                        }}
                      >
                        {locked && <Lock size={10} />}
                        {f === 'webm' ? 'Compressed (M4A)' : f === 'wav' ? 'WAV (lossless)' : f === 'stems' ? 'Stems (zip of WAVs)' : 'MIDI (.mid)'}
                      </button>
                    )
                  })}
                </div>
                {format === 'wav' && (
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.4 }}>
                    Converts after recording — slightly slower, lossless 16-bit PCM
                  </p>
                )}
                {format === 'midi' && (
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.4 }}>
                    Notes, tempo &amp; time signature for other DAWs — no audio or sounds. Audio tracks are skipped.
                  </p>
                )}
                {(format === 'wav' || format === 'stems') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Sample rate</span>
                    {([44100, 48000, 88200, 96000] as const).map(r => (
                      <button key={r}
                        onClick={() => setSampleRate(r)}
                        title={{ 44100: 'CD / streaming standard', 48000: 'Video / broadcast standard (recording rate — no resample)', 88200: 'Hi-res (2× CD) — larger files', 96000: 'Hi-res (2× video) — larger files' }[r]}
                        style={{
                          padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          border: sampleRate === r ? '1px solid var(--accent)' : '1px solid var(--border)',
                          background: sampleRate === r ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                          color: sampleRate === r ? 'var(--accent)' : 'var(--text-secondary)',
                        }}
                      >{{ 44100: '44.1 kHz', 48000: '48 kHz', 88200: '88.2 kHz', 96000: '96 kHz' }[r]}</button>
                    ))}
                  </div>
                )}
              </div>
              )}

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
                onClick={() => {
                  if ((format === 'wav' || format === 'stems') && !isPro && !saveTarget) {
                    showUpgrade('WAV and stem exports are a Pro feature. Free exports a high-quality compressed mixdown — upgrade for lossless masters and per-track stems.')
                    return
                  }
                  void startExport()
                }}
                style={{
                  width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
                  background: 'var(--accent)', color: 'var(--accent-contrast)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
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
                  width: statusMessage === 'recording' || statusMessage === 'rendering' ? `${Math.round(progress * 100)}%` : '100%',
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
              {/* Save back to the article source (admin edit-in-place flow) */}
              {saveTarget && (
                <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8, background: 'rgb(var(--accent-rgb) / 0.08)', border: '1px solid rgb(var(--accent-rgb) / 0.35)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-light)', marginBottom: 6 }}>
                    Editing article source · {saveTarget.kind === 'demo' ? 'demo clip' : 'uploaded file'}
                  </div>
                  {saveToState === 'done' ? (
                    <p style={{ fontSize: 12, color: '#4ade80', margin: 0 }}>
                      Saved in place ✓ — <strong style={{ color: 'var(--text-secondary)' }}>{saveTarget.label}</strong> now serves this edit. Give it a hard-refresh in the article to hear it.
                    </p>
                  ) : (
                    <>
                      <button
                        onClick={() => void saveToSource()}
                        disabled={saveToState === 'busy'}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                          width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                          background: 'var(--accent)', color: 'var(--accent-contrast)', fontSize: 13, fontWeight: 700,
                          opacity: saveToState === 'busy' ? 0.6 : 1,
                        }}
                      >
                        {saveToState === 'busy' ? 'Saving…' : `Save to article source (in place)`}
                      </button>
                      <p style={{ fontSize: 10, color: saveToState === 'error' ? '#ef4444' : 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }}>
                        {saveToState === 'error'
                          ? 'Save failed — are you still signed in as admin? Try again.'
                          : `Overwrites ${saveTarget.label} — no new file. Export WAV above to keep a copy, or Download for a fresh one instead.`}
                      </p>
                    </>
                  )}
                </div>
              )}

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
                  : 'Exported as a compressed mixdown. For MP3, re-encode with any converter.'}
              </p>

              {/* Share the finished mix to the community feed (music mode) */}
              {!isPodcast && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  {shareState === 'done' ? (
                    <p style={{ fontSize: 11.5, color: '#4ade80', margin: 0 }}>
                      Shared! <a href={sharedId ? `/community/${sharedId}` : '/community?kind=song'} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-light)' }}>View its public page ↗</a>
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
                            flex: 1, minWidth: 0, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 7,
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
                            background: 'var(--accent)', color: 'var(--accent-contrast)', opacity: shareState === 'busy' ? 0.6 : 1,
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
                        Starter shared! <a href={starterId ? `/community/${starterId}` : '/community?kind=project'} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-light)' }}>View its public page ↗</a>
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
