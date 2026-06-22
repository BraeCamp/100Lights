// Ableton Live .als project parser
// .als files are gzip-compressed XML. We decompress with DecompressionStream,
// parse with DOMParser, then extract track structure and audio file references.

export interface AbletonClip {
  id: string
  name: string
  /** Position in the arrangement timeline, in seconds */
  timeSec: number
  /** Duration in seconds (end - start within the file) */
  durationSec: number
  /** Path relative to the project folder, e.g. "Samples/Recorded/Kick.wav" */
  relativePath: string
  /** Absolute path — may not be valid on a different machine */
  absolutePath: string
}

export interface AbletonTrack {
  id: string
  name: string
  /** Linear amplitude: 1.0 = 0 dB, 2.0 = +6 dB */
  volume: number
  /** -1.0 = full left, 0 = center, 1.0 = full right */
  pan: number
  muted: boolean
  clips: AbletonClip[]
}

export interface AbletonProject {
  name: string
  bpm: number
  tracks: AbletonTrack[]
  /** Handle to the project folder — needed to resolve relative audio paths */
  dir: FileSystemDirectoryHandle
}

// ── Decompress ────────────────────────────────────────────────────────────

async function gunzip(ab: ArrayBuffer): Promise<string> {
  const ds = new DecompressionStream('gzip')
  const stream = new Blob([ab]).stream().pipeThrough(ds)
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return new TextDecoder().decode(out)
}

// ── XML helpers ───────────────────────────────────────────────────────────

function val(el: Element | null | undefined, ...selectors: string[]): string {
  if (!el) return ''
  for (const sel of selectors) {
    const found = el.querySelector(sel)
    if (found) return found.getAttribute('Value') ?? ''
  }
  return ''
}

// ── Parser ────────────────────────────────────────────────────────────────

export async function parseAbletonProject(dir: FileSystemDirectoryHandle): Promise<AbletonProject> {
  // Find the .als file in the project folder root
  let alsHandle: FileSystemFileHandle | null = null
  let projectName = dir.name
  for await (const [name, handle] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (name.endsWith('.als') && handle.kind === 'file') {
      alsHandle = handle as FileSystemFileHandle
      projectName = name.replace(/\.als$/, '')
      break
    }
  }
  if (!alsHandle) throw new Error('No .als file found in this folder')

  const file = await alsHandle.getFile()
  const xml = await gunzip(await file.arrayBuffer())
  const doc = new DOMParser().parseFromString(xml, 'application/xml')

  if (doc.querySelector('parsererror')) throw new Error('Failed to parse .als XML')

  // BPM — stored under MasterTrack's Tempo device or top-level Tempo
  const tempoEl =
    doc.querySelector('MasterTrack DeviceChain Mixer Tempo AutomationTarget') ??
    doc.querySelector('MasterTrack DeviceChain AudioOutputRouting') ??
    null

  // Simpler approach: find any Manual element under "Tempo"
  let bpm = 120
  for (const el of Array.from(doc.querySelectorAll('Tempo > Manual'))) {
    const v = parseFloat(el.getAttribute('Value') ?? '')
    if (v > 20 && v < 999) { bpm = v; break }
  }
  const secPerBeat = 60 / bpm

  // Audio tracks
  const tracks: AbletonTrack[] = []

  for (const trackEl of Array.from(doc.querySelectorAll('AudioTrack'))) {
    const id = trackEl.getAttribute('Id') ?? crypto.randomUUID()
    const name = trackEl.querySelector('Name EffectiveName')?.getAttribute('Value') ?? `Track ${id}`

    // Volume: linear amp. Default 0.794 ≈ -2 dB (Ableton's default fader position)
    const volumeStr = val(trackEl, 'DeviceChain > Mixer > Volume > Manual')
    const volume = volumeStr ? parseFloat(volumeStr) : 1.0

    // Pan: -1 to 1
    const panStr = val(trackEl, 'DeviceChain > Mixer > Pan > Manual')
    const pan = panStr ? parseFloat(panStr) : 0

    // Mute: Speaker Manual Value="false" means muted (speaker off)
    const speakerStr = val(trackEl, 'DeviceChain > Mixer > Speaker > Manual')
    const muted = speakerStr === 'false'

    // Clips in the arrangement (AudioClip elements with a Time attribute)
    const clips: AbletonClip[] = []
    for (const clipEl of Array.from(trackEl.querySelectorAll('AudioClip'))) {
      const timeBeats = parseFloat(clipEl.getAttribute('Time') ?? '0')
      if (isNaN(timeBeats)) continue

      // Clip in/out points within the audio file (beats)
      const startBeats = parseFloat(val(clipEl, 'CurrentStart') || val(clipEl, 'Start') || '0')
      const endBeats   = parseFloat(val(clipEl, 'CurrentEnd')   || val(clipEl, 'End')   || '0')
      if (endBeats <= startBeats) continue

      const relPath = clipEl.querySelector('SampleRef FileRef RelativePath')?.getAttribute('Value') ?? ''
      const absPath = clipEl.querySelector('SampleRef FileRef AbsolutePath')?.getAttribute('Value') ?? ''
      if (!relPath && !absPath) continue

      const clipName = clipEl.querySelector('Name')?.getAttribute('Value') ?? name

      clips.push({
        id: clipEl.getAttribute('Id') ?? crypto.randomUUID(),
        name: clipName,
        timeSec:     timeBeats * secPerBeat,
        durationSec: (endBeats - startBeats) * secPerBeat,
        relativePath: relPath,
        absolutePath: absPath,
      })
    }

    // Only include tracks that have arrangement clips (ignore empty/session-only tracks)
    if (clips.length > 0) tracks.push({ id, name, volume, pan, muted, clips })
  }

  return { name: projectName, bpm, tracks, dir }
}

// ── Audio file loader ─────────────────────────────────────────────────────

// Resolves a clip's audio file from the project directory and decodes it.
// Tries the relative path first (works cross-machine), falls back to the
// filename extracted from the absolute path.
export async function loadClipAudio(
  dir: FileSystemDirectoryHandle,
  clip: AbletonClip,
): Promise<AudioBuffer> {
  let file: File | null = null

  // Try relative path navigation
  if (clip.relativePath) {
    try {
      const parts = clip.relativePath.replace(/\\/g, '/').replace(/^\/+/, '').split('/')
      let handle: FileSystemHandle = dir
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if (!part) continue
        if (i === parts.length - 1) {
          handle = await (handle as FileSystemDirectoryHandle).getFileHandle(part)
        } else {
          handle = await (handle as FileSystemDirectoryHandle).getDirectoryHandle(part)
        }
      }
      file = await (handle as FileSystemFileHandle).getFile()
    } catch { /* fall through to filename search */ }
  }

  // Fall back: search for the filename anywhere in Samples/
  if (!file && clip.absolutePath) {
    const filename = clip.absolutePath.replace(/\\/g, '/').split('/').pop() ?? ''
    if (filename) {
      try {
        const samplesDir = await dir.getDirectoryHandle('Samples')
        file = await findFileRecursive(samplesDir, filename)
      } catch { /* file not found */ }
    }
  }

  if (!file) throw new Error(`Audio file not found for clip "${clip.name}"`)

  const ctx = new AudioContext()
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer())
  } finally {
    ctx.close()
  }
}

async function findFileRecursive(
  dir: FileSystemDirectoryHandle,
  filename: string,
  depth = 0,
): Promise<File | null> {
  if (depth > 4) return null
  for await (const [name, handle] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (handle.kind === 'file' && name === filename) {
      return (handle as FileSystemFileHandle).getFile()
    }
    if (handle.kind === 'directory') {
      const found = await findFileRecursive(handle as FileSystemDirectoryHandle, filename, depth + 1)
      if (found) return found
    }
  }
  return null
}
