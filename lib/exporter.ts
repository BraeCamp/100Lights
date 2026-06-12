/**
 * FFmpeg WASM export pipeline.
 *
 * Loads the single-threaded @ffmpeg/core from CDN on first use (no
 * SharedArrayBuffer / COOP-COEP headers required). Cached across calls.
 *
 * Strategy: re-encode every clip to H.264 + AAC at the target quality, then
 * stream-copy-concat them. Re-encoding normalises codecs/resolution so the
 * concat step is always safe, and gives us frame-accurate in/out points.
 */

import type { ContentType } from '@/lib/types'

// ── Types ──────────────────────────────────────────────────────

export type ExportQuality    = 'high' | 'medium' | 'web'
export type ExportResolution = 'original' | '1080p' | '720p' | '480p'

export interface ExportOptions {
  quality:    ExportQuality
  resolution: ExportResolution
}

export interface ExportClip {
  id:          string
  label:       string
  inPoint:     number
  outPoint:    number
  contentType: ContentType
  file?:       File
  url?:        string     // blob URL fallback
}

export type ExportPhase = 'loading' | 'writing' | 'encoding' | 'merging' | 'done' | 'error'

export interface ExportProgress {
  phase:   ExportPhase
  percent: number          // 0–100
  message: string
}

// ── Quality presets ────────────────────────────────────────────

const QUALITY_CRF:    Record<ExportQuality, number> = { high: 18, medium: 23, web: 28 }
const QUALITY_PRESET: Record<ExportQuality, string> = { high: 'slow', medium: 'medium', web: 'fast' }
const QUALITY_ABR:    Record<ExportQuality, string> = { high: '192k', medium: '128k', web: '96k' }

const RESOLUTION_VF: Record<ExportResolution, string | null> = {
  original: null,
  '1080p':  'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
  '720p':   'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
  '480p':   'scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2',
}

// ── FFmpeg singleton ────────────────────────────────────────────

let _ffmpeg: import('@ffmpeg/ffmpeg').FFmpeg | null = null

async function getFFmpeg(
  onLog?: (msg: string) => void,
): Promise<import('@ffmpeg/ffmpeg').FFmpeg> {
  if (_ffmpeg?.loaded) return _ffmpeg

  const { FFmpeg } = await import('@ffmpeg/ffmpeg')
  const { toBlobURL } = await import('@ffmpeg/util')

  const CORE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
  const ff = new FFmpeg()
  if (onLog) ff.on('log', ({ message }) => onLog(message))

  await ff.load({
    coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`,   'text/javascript'),
    wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, 'application/wasm'),
  })

  _ffmpeg = ff
  return ff
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Export the timeline clips to a single MP4 blob.
 * Calls `onProgress` throughout; throws on failure.
 * Pass an AbortSignal to allow cancellation (terminates FFmpeg).
 */
export async function exportTimeline(
  clips:    ExportClip[],
  options:  ExportOptions,
  onProgress: (p: ExportProgress) => void,
  signal?:  AbortSignal,
): Promise<Blob> {
  const { fetchFile } = await import('@ffmpeg/util')

  // ── 1. Filter to exportable clips ─────────────────────────────
  const work = clips.filter(c => (c.file || c.url) && (c.contentType === 'video' || c.contentType === 'audio'))
  if (work.length === 0) {
    throw new Error('No media clips to export. Add video or audio clips to the timeline first.')
  }
  const isAudioOnly = work.every(c => c.contentType === 'audio')

  // ── 2. Load FFmpeg ─────────────────────────────────────────────
  progress(onProgress, 'loading', 0, 'Loading FFmpeg…')

  const ff = await getFFmpeg()

  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

  // ── 3. Write unique source files to virtual FS ─────────────────
  progress(onProgress, 'writing', 15, 'Writing media files…')

  const fsMap = new Map<string, string>()   // clip.id → fs filename
  const written = new Map<string, string>() // dedup key → fs filename

  for (const clip of work) {
    const dedupKey = clip.url ?? clip.id
    if (!written.has(dedupKey)) {
      const ext  = guessExt(clip)
      const name = `src_${written.size}.${ext}`
      const data = clip.file
        ? await fetchFile(clip.file)
        : await fetchFile(clip.url!)
      await ff.writeFile(name, data)
      written.set(dedupKey, name)
    }
    fsMap.set(clip.id, written.get(clip.url ?? clip.id)!)
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  }

  // ── 4. Trim + encode each clip ─────────────────────────────────
  const ext     = isAudioOnly ? 'm4a' : 'mp4'
  const trimmed: string[] = []
  const vf = RESOLUTION_VF[options.resolution]

  for (let i = 0; i < work.length; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

    const clip = work[i]
    const src  = fsMap.get(clip.id)!
    const out  = `clip_${i}.${ext}`
    const dur  = clip.outPoint - clip.inPoint

    const frac = i / work.length
    progress(onProgress, 'encoding',
      Math.round(20 + frac * 60),
      `Encoding clip ${i + 1} of ${work.length} — ${clip.label}…`,
    )

    // Track per-clip FFmpeg progress for a finer-grained bar.
    const progressListener = ({ progress: p }: { progress: number }) => {
      const base      = 20 + frac * 60
      const clipSlice = 60 / work.length
      onProgress({
        phase:   'encoding',
        percent: Math.round(base + p * clipSlice),
        message: `Encoding clip ${i + 1} of ${work.length} — ${clip.label}…`,
      })
    }
    ff.on('progress', progressListener)

    let args: string[]
    if (isAudioOnly || clip.contentType === 'audio') {
      // Audio-only encode: strip video stream, encode to AAC
      args = [
        '-ss', String(clip.inPoint),
        '-t',  String(dur),
        '-i',  src,
        '-vn',
        '-c:a', 'aac',
        '-b:a', QUALITY_ABR[options.quality],
        '-y', out,
      ]
    } else {
      args = [
        '-ss', String(clip.inPoint),
        '-t',  String(dur),
        '-i',  src,
        ...(vf ? ['-vf', vf] : []),
        '-c:v', 'libx264',
        '-preset', QUALITY_PRESET[options.quality],
        '-crf',    String(QUALITY_CRF[options.quality]),
        '-c:a', 'aac',
        '-b:a', QUALITY_ABR[options.quality],
        '-movflags', '+faststart',
        '-y', out,
      ]
    }

    const exitCode = await ff.exec(args)
    ff.off('progress', progressListener)

    if (exitCode !== 0) throw new Error(`FFmpeg failed on clip "${clip.label}" (exit ${exitCode})`)
    trimmed.push(out)
  }

  // ── 5. Concat ──────────────────────────────────────────────────
  progress(onProgress, 'merging', 83, 'Merging clips…')

  const outputFile = `output.${ext}`
  let finalFile: string

  if (trimmed.length === 1) {
    finalFile = trimmed[0]
  } else {
    const list = trimmed.map(f => `file '${f}'`).join('\n')
    await ff.writeFile('concat.txt', list)
    const concatArgs = isAudioOnly
      ? ['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', '-y', outputFile]
      : ['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', '-movflags', '+faststart', '-y', outputFile]
    const exitCode = await ff.exec(concatArgs)
    if (exitCode !== 0) throw new Error('FFmpeg concat step failed')
    finalFile = outputFile
  }

  // ── 6. Read result ─────────────────────────────────────────────
  progress(onProgress, 'done', 100, 'Export complete!')

  const mimeType = isAudioOnly ? 'audio/mp4' : 'video/mp4'
  const data = await ff.readFile(finalFile)
  // Cast through unknown to satisfy strict ArrayBuffer variance — the data
  // is always a Uint8Array at runtime but the types are overly broad.
  return new Blob([data as unknown as Uint8Array<ArrayBuffer>], { type: mimeType })
}

// ── Helpers ────────────────────────────────────────────────────

function progress(
  cb: (p: ExportProgress) => void,
  phase: ExportPhase,
  percent: number,
  message: string,
) {
  cb({ phase, percent, message })
}

function guessExt(clip: ExportClip): string {
  if (clip.file) {
    const t = clip.file.type
    if (t.includes('mp4'))  return 'mp4'
    if (t.includes('webm')) return 'webm'
    if (t.includes('mov'))  return 'mov'
    if (t.includes('mp3'))  return 'mp3'
    if (t.includes('wav'))  return 'wav'
    if (t.includes('aac'))  return 'aac'
    if (t.includes('ogg'))  return 'ogg'
    if (t.includes('flac')) return 'flac'
    const m = clip.file.name.match(/\.(\w+)$/)
    if (m) return m[1]
  }
  return clip.contentType === 'audio' ? 'm4a' : 'mp4'
}
