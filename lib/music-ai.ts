// Client helpers for the "Generate music with AI" feature. These talk to the
// Clerk-gated proxy routes under /api/music-ai (the ElevenLabs key stays
// server-side) and return plain audio ArrayBuffers ready to import as DAW
// tracks. See components/editor/GenerateMusicModal.tsx for the import flow.

/** Parse a JSON `{ error }` body (or fall back to raw text / status). */
async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const j = JSON.parse(text) as { error?: string }
    if (j?.error) return j.error
  } catch { /* not JSON — fall through */ }
  return text.slice(0, 300) || `Request failed (${res.status})`
}

export interface GenerateOpts {
  prompt: string
  /** Song length in milliseconds (server clamps to 3000..600000). */
  lengthMs?: number
  /** When true, ask for an instrumental (no vocals). */
  instrumental?: boolean
}

/** Generate a song from a prompt. Resolves to the raw audio bytes (mp3). */
export async function generateSong(opts: GenerateOpts): Promise<ArrayBuffer> {
  const res = await fetch('/api/music-ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: opts.prompt,
      lengthMs: opts.lengthMs,
      instrumental: opts.instrumental,
    }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.arrayBuffer()
}

export interface Stem {
  /** Prettified stem name, e.g. "Vocals". */
  name: string
  /** The stem's audio bytes. */
  data: ArrayBuffer
}

// Preferred order so the arrangement reads top-to-bottom in a familiar way.
const STEM_ORDER = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'keys', 'synth', 'other']
function stemRank(name: string): number {
  const i = STEM_ORDER.indexOf(name.toLowerCase())
  return i === -1 ? STEM_ORDER.length : i
}

function prettifyStemName(filename: string): string {
  const base = filename.split('/').pop() ?? filename
  const noExt = base.replace(/\.[^.]+$/, '')
  const cleaned = noExt.replace(/[_-]+/g, ' ').trim()
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || 'Stem'
}

const AUDIO_EXT = /\.(mp3|wav|flac|ogg|m4a|aac|opus)$/i

/**
 * Separate a song into stems. POSTs the audio to the stems route, receives a
 * ZIP, unzips it (jszip) and returns one entry per audio file, sorted in a
 * sensible instrument order.
 */
export async function separateStems(audio: ArrayBuffer): Promise<Stem[]> {
  const res = await fetch('/api/music-ai/stems', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/mpeg' },
    body: audio,
  })
  if (!res.ok) throw new Error(await readError(res))

  const zipBytes = await res.arrayBuffer()
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(zipBytes)

  const entries = Object.values(zip.files).filter(f => !f.dir && AUDIO_EXT.test(f.name))
  const stems: Stem[] = []
  for (const entry of entries) {
    const data = await entry.async('arraybuffer')
    stems.push({ name: prettifyStemName(entry.name), data })
  }

  stems.sort((a, b) => stemRank(a.name) - stemRank(b.name) || a.name.localeCompare(b.name))
  return stems
}
