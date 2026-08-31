// Rendering a clip on the server, so the listener's machine does not have to.
//
// Brae: "The server render gave up trying. Please fix."
//
// ⚠️ WHY IT WAS GIVING UP. /api/render-clip could SERVE renders but nothing
// ever MADE one, so every clip came back 404 and the studio reported, honestly
// but uselessly, that it had given up. A cache with no producer is not a
// feature. This is the producer.
//
// The note in the route said this "cannot be a serverless function" because a
// song is minutes of DSP against a 60s cap. That was true of a SONG and false
// of the thing actually being asked for: the cache is keyed per CLIP, and a
// clip in plain Node measures ~20× realtime — a dense 32-second clip renders in
// 1.4s. The cap was never the obstacle.
//
// ── What makes this safe to share ──────────────────────────────────────────
//
// A stamp is a content hash of the notes, the patch and the tempo, so the
// server can RECOMPUTE it and refuse anything that does not match what it was
// asked to store. That check is the whole security model, and it is the reason
// this renders server-side rather than accepting uploads: audio rendered by a
// client cannot be verified against its stamp without rendering it anyway, so
// an upload endpoint would let anyone put whatever they liked under a popular
// song's key and have it served to everybody else.
//
// It is also why render determinism had to be fixed first (lib/render-rate.ts,
// lib/seeded-random.ts, ApolloEngine.flush). Sharing one machine's render with
// another is only correct if the two machines would have produced the same
// audio.

import { createRenderHost as createRenderHostJs } from '@/lib/apollo/render-host.mjs'
import { initPatch, PARAMS, FX_DEFS } from '@/lib/apollo/patch'
import { generateFactoryTable, buildTableMips } from '@/lib/apollo/tables'
import { referencedSampleIds } from '@/lib/apollo/sample-store'
import { freezeStamp } from '@/lib/apollo/daw-freeze'
import { RENDER_SAMPLE_RATE } from '@/lib/render-rate'
import type { ApolloPatch } from '@/lib/apollo/patch'
import type { MidiClip } from '@/lib/daw-types'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** A clip is one track's notes; nothing here renders a whole song at once. */
export interface ClipRenderRequest {
  key: string
  clipId: string
  notes: MidiClip['notes']
  patch: ApolloPatch
  bpm: number
}

/** Generous enough for any real clip, small enough that nobody can bill us for
 *  a symphony. A clip past these is not rejected as suspicious — it is simply
 *  not the shape of thing this endpoint is for, and renders locally instead. */
export const LIMITS = { notes: 4_000, seconds: 240 }

// render-host.mjs is plain JS shared with the CLI and the desktop worker, so
// its options are inferred from defaults and the ones without defaults vanish.
// Spelling out the contract here is also the only place it is written down.
const createRenderHost = createRenderHostJs as unknown as (opts: {
  patch: ApolloPatch
  bpm?: number
  playing?: boolean
  seed?: number
  modules?: unknown
  engineSource?: string
}) => Promise<{
  finish(): void
  render(notes: { note: number; t: number; dur: number; vel: number }[], seconds: number):
    { left: Float32Array; right: Float32Array; sampleRate: number }
  errors(): string[]
}>

let engineSourcePromise: Promise<string> | null = null

/**
 * The worklet's source text.
 *
 * ⚠️ Read, not imported. `public/apollo/engine.js` is a static asset: a bundler
 * will not follow a computed import to it, and in a deployed function the path
 * this file sits at bears no relation to the repo's. Reading it from the
 * project root and handing the text to the host works in both places — and
 * next.config.ts has to say so explicitly, or the file is served from the CDN
 * and never lands in the function at all.
 */
function engineSource(): Promise<string> {
  engineSourcePromise ??= readFile(path.join(process.cwd(), 'public', 'apollo', 'engine.js'), 'utf8')
  return engineSourcePromise
}

/** patch.ts and tables.ts, in the shape the render host expects — imported
 *  through the app rather than read off disk, because a deployed function has
 *  compiled JS and no TypeScript to read. */
const modules = { initPatch, PARAMS, FX_DEFS, generateFactoryTable, buildTableMips }

export type RenderRefusal =
  | { ok: false; reason: 'stamp-mismatch' }
  | { ok: false; reason: 'needs-samples'; samples: number }
  | { ok: false; reason: 'too-big' }
  | { ok: false; reason: 'empty' }

/**
 * Why this clip cannot be rendered here — or null if it can.
 *
 * Every one of these is a fall-back-to-local answer rather than an error. The
 * studio plays live perfectly well; the only wrong move is to leave it waiting
 * for something that is not coming, which is the failure this whole change is
 * about.
 */
export function refuse(req: ClipRenderRequest): RenderRefusal | null {
  const notes = req.notes ?? []
  if (!notes.length) return { ok: false, reason: 'empty' }
  if (notes.length > LIMITS.notes) return { ok: false, reason: 'too-big' }

  // ⚠️ The integrity check. Without it the stamp is a name the caller chose,
  // and this endpoint writes attacker-supplied audio into a key every other
  // listener of that song reads.
  const expected = `${req.clipId}|${freezeStamp(notes, req.patch, req.bpm)}`
  if (expected !== req.key) return { ok: false, reason: 'stamp-mismatch' }

  // Samples live in the user's own library, not here. A sampled patch rendered
  // server-side would come back with its sampled layers simply missing — which
  // is worse than not rendering it, because it is silently wrong rather than
  // visibly absent. (A silent render also reads as a FAILED render to the cache,
  // so this would poison the shared key for everyone.)
  const samples = referencedSampleIds(req.patch)
  if (samples.length) return { ok: false, reason: 'needs-samples', samples: samples.length }

  return null
}

/** Seconds of audio a clip needs, from its last note-off. */
export function clipSeconds(req: ClipRenderRequest): number {
  const spb = 60 / (req.bpm || 120)
  let end = 0
  for (const n of req.notes) end = Math.max(end, (n.startBeat + n.durationBeats) * spb)
  // A tail, so a release or a reverb is not cut off mid-decay.
  return Math.min(LIMITS.seconds, end + 2)
}

/**
 * Render one clip to a 16-bit stereo WAV.
 *
 * WAV rather than something smaller because there is no audio encoder in a Node
 * function without shipping a native binary, and the browser decodes WAV
 * natively. The bytes go to R2 and are served from there, so the size is a
 * storage question rather than a request-latency one — and a clip is rendered
 * once, ever, for every listener who will ever hear it.
 */
export async function renderClip(req: ClipRenderRequest): Promise<Uint8Array> {
  const seconds = clipSeconds(req)
  const host = await createRenderHost({
    patch: req.patch,
    bpm: req.bpm,
    modules,
    engineSource: await engineSource(),
  })
  host.finish()

  const spb = 60 / (req.bpm || 120)
  const notes = req.notes.map(n => ({
    note: n.pitch,
    t: n.startBeat * spb,
    dur: Math.max(0.02, n.durationBeats * spb),
    vel: Math.max(0.05, (n.velocity ?? 100) / 127),
  }))

  const { left, right } = host.render(notes, seconds)
  return wav16(left, right, RENDER_SAMPLE_RATE)
}

/** Interleaved 16-bit stereo WAV. */
function wav16(left: Float32Array, right: Float32Array, rate: number): Uint8Array {
  const frames = left.length
  const bytes = new ArrayBuffer(44 + frames * 4)
  const view = new DataView(bytes)
  const ascii = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }

  ascii(0, 'RIFF'); view.setUint32(4, 36 + frames * 4, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)            // PCM
  view.setUint16(22, 2, true)            // stereo
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 4, true)     // byte rate
  view.setUint16(32, 4, true)            // block align
  view.setUint16(34, 16, true)           // bits
  ascii(36, 'data'); view.setUint32(40, frames * 4, true)

  let o = 44
  for (let i = 0; i < frames; i++) {
    // Clamp before scaling: a sample past ±1 wraps to the opposite sign as a
    // 16-bit integer, which is not clipping but a loud tearing noise.
    const l = Math.max(-1, Math.min(1, left[i]))
    const r = Math.max(-1, Math.min(1, right[i] ?? left[i]))
    view.setInt16(o, l < 0 ? l * 0x8000 : l * 0x7fff, true); o += 2
    view.setInt16(o, r < 0 ? r * 0x8000 : r * 0x7fff, true); o += 2
  }
  return new Uint8Array(bytes)
}
