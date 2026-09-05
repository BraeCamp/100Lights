'use client'

// Bringing an outside audio file INTO Beacon, in one place.
//
// This used to live inside TrackRow, closed over one track's id — which meant
// the only way to import was to already have a track and aim at its lane. Every
// other surface that wanted to hand Beacon a file (the dashboard picker, a drop
// on the arrangement's empty space) had nowhere to call. Now the decode lives
// here and the callers differ only in where the clip lands.
//
//   importAudioFile(file, { trackId, beat, engine, dispatch })   → onto a track
//   importAudioAsNewTrack(file, { engine, dispatch })            → its own track
//
// What each file becomes:
//   audio (wav/mp3/m4a/aac/ogg/opus/flac) → original bytes, real mimetype kept
//   aiff                                  → decoded, re-encoded WAV
//   video (mp4/mov/webm…)                 → audio track only, picture discarded

import { extractPeaks, makeAudioClip, type DawAction } from './daw-state'
import { uploadRecordingBlob } from './record-upload'
import { decodeAiff, encodeWav } from './wav-codec'
import type { DawEngine } from './daw-engine'
import { landClip } from './import-settings'

export interface AudioImportDeps {
  engine: DawEngine
  dispatch: (action: DawAction) => void
  /** Called instead of window.alert so a surface can show its own message. */
  onError?: (message: string) => void
  /** The song's beats per bar, for the loop guess when a sample lands (default 4). */
  beatsPerBar?: number
}

/** The bytes to hand the engine, plus a blob to persist and a URL to play from. */
interface Decoded { ab: ArrayBuffer; uploadBlob: Blob; blobUrl: string }

const VIDEO_RE = /^(mp4|mov|m4v|webm|mkv|avi|ogv)$/

// Some drag sources give an empty file.type — derive it from the extension
// rather than blindly guessing mp3 (which mislabels ogg/flac/wav).
const EXT_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg',
  oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav',
}

/**
 * Normalize a picked file into playable bytes.
 * Returns null when the file can't be decoded — the caller has already been
 * told why via `onError`, so it should just stop.
 */
async function decodeForImport(file: File, deps: AudioImportDeps): Promise<Decoded | null> {
  const fail = (msg: string) => { (deps.onError ?? window.alert)(msg); return null }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const isVideo = file.type.startsWith('video/') || VIDEO_RE.test(ext)

  let ab: ArrayBuffer
  try { ab = await file.arrayBuffer() } catch { return fail(`Couldn't read “${file.name}”.`) }

  if (isVideo) {
    // Keep only the audio: decode the container's audio track → WAV.
    let decoded: AudioBuffer
    try {
      decoded = await deps.engine.ctx.decodeAudioData(ab.slice(0))
    } catch {
      return fail(`Couldn't extract audio from “${file.name}”. Try an MP4/WebM, or convert it to an audio file first.`)
    }
    const channels: Float32Array[] = []
    for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c))
    const wav = encodeWav(channels, decoded.sampleRate)
    const uploadBlob = new Blob([wav], { type: 'audio/wav' })
    return { ab: wav, uploadBlob, blobUrl: URL.createObjectURL(uploadBlob) }
  }

  if (ext === 'aif' || ext === 'aiff') {
    try {
      const { channels, sampleRate } = decodeAiff(ab)
      const wav = encodeWav(channels, sampleRate)
      const uploadBlob = new Blob([wav], { type: 'audio/wav' })
      return { ab: wav, uploadBlob, blobUrl: URL.createObjectURL(uploadBlob) }
    } catch {
      return fail(`Couldn't decode “${file.name}”.`)
    }
  }

  // Common audio: keep the original bytes, but preserve the real mimetype so
  // the durable copy (uploadRecordingBlob) gets the correct file extension.
  const uploadBlob = new Blob([ab], { type: file.type || EXT_MIME[ext] || 'audio/mpeg' })
  return { ab, uploadBlob, blobUrl: URL.createObjectURL(file) }
}

/** Strip the extension for a clip label. */
export const clipNameOf = (file: File): string => file.name.replace(/\.[^.]+$/, '')

/**
 * Import one file onto an EXISTING track at `beat`.
 * Resolves with the new clip's id, or null if the file couldn't be read.
 */
export async function importAudioFile(
  file: File,
  { trackId, beat, ...deps }: AudioImportDeps & { trackId: string; beat: number },
): Promise<string | null> {
  const decoded = await decodeForImport(file, deps)
  if (!decoded) return null
  const { ab, uploadBlob, blobUrl } = decoded

  const clip = makeAudioClip(trackId, clipNameOf(file), beat, 8, { audioUrl: blobUrl })
  deps.dispatch({ type: 'ADD_CLIP', clip })
  // Imported files have no library entry — upload so the clip survives reloads.
  void uploadRecordingBlob(uploadBlob, clip.id).then(key => {
    if (key) deps.dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { r2Key: key } })
  })

  try {
    const buf = await deps.engine.loadBufferFromArrayBuffer(clip.id, ab)
    // How it lands — one-shot, loop, or warped straight — is the Loop/Warp
    // Short Samples setting's call (lib/import-settings.ts).
    const landed = landClip(clip, buf.duration, deps.engine.tempo, deps.beatsPerBar ?? 4)
    deps.dispatch({
      type: 'UPDATE_CLIP',
      clipId: clip.id,
      patch: { waveformPeaks: extractPeaks(buf), bufferDuration: buf.duration, ...landed.patch },
    })
    return clip.id
  } catch {
    deps.dispatch({ type: 'REMOVE_CLIP', clipId: clip.id })
    URL.revokeObjectURL(blobUrl)  // clip is gone — don't leak its blob URL
    ;(deps.onError ?? window.alert)(`Couldn't read the audio in “${file.name}”.`)
    return null
  }
}

/**
 * Import one file onto a NEW track named after it. This is what the dashboard
 * picker and a drop on empty arrangement space both want: the user handed us a
 * file, not a destination.
 */
export async function importAudioAsNewTrack(
  file: File,
  deps: AudioImportDeps & { beat?: number },
): Promise<string | null> {
  const trackId = crypto.randomUUID()
  deps.dispatch({ type: 'ADD_TRACK', id: trackId, name: clipNameOf(file) })
  return importAudioFile(file, { ...deps, trackId, beat: deps.beat ?? 0 })
}

/**
 * Import several files, each onto its own track, one at a time.
 * Sequential on purpose: decoding a handful of songs at once competes for the
 * same audio context and makes the whole studio stutter while it lands.
 */
export async function importAudioFiles(files: File[], deps: AudioImportDeps): Promise<number> {
  let landed = 0
  for (const file of files) {
    if (await importAudioAsNewTrack(file, deps)) landed++
  }
  return landed
}
