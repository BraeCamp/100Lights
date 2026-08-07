// ── Music-visual overlay renderer ────────────────────────────────────────────
// A self-contained, deterministic renderer for the video editor's "music visual"
// overlay clips. It reuses the song-video FORMAT library (lib/song-video/
// formats.mjs) but drives it from OUR own frame context — no RAF loop, no
// brand/progress chrome, no loop-relative clock — so the exact same code renders
// the live preview (fed a live AnalyserNode) and the deterministic export (fed an
// offline FFT at frame time t).
//
// Scope: the AUDIO-REACTIVE formats (waveform / EQ bars / radial spectrum). They
// visualize the timeline's audio via f.freq / f.wave and need no MIDI notes, so
// they work on any video project. Note-driven formats (falling notes, piano, …)
// need a source song's notes and can be added later once a project carries them.

// formats.mjs is an untyped ES module; the shapes we rely on are declared here.
import { FORMATS as FORMATS_RAW } from './song-video/formats.mjs'

type FormatEntry = { name: string; create: (song: unknown, opts: unknown) => { draw: (f: unknown) => void } }
const FORMATS = FORMATS_RAW as Record<string, FormatEntry>

/** Formats offered in the video editor — the audio-reactive set. */
export const MUSIC_VIZ_FORMATS: { id: string; name: string }[] = [
  { id: 'waveform', name: 'Waveform' },
  { id: 'eq-bars', name: 'EQ Bars' },
  { id: 'radial', name: 'Radial Spectrum' },
]
export const MUSIC_VIZ_FORMAT_IDS = MUSIC_VIZ_FORMATS.map(f => f.id)
export const DEFAULT_MUSIC_VIZ_FORMAT = 'waveform'

export interface MusicVizConfig {
  format: string
  /** Main visual colour (hex). */
  accent: string
  /** Two-stop background gradient, or null for a transparent overlay (draws the
   *  visual straight over the video below). */
  bg: [string, string] | null
}

/** Per-frame audio data — byte FFT + byte time-domain, exactly what an
 *  AnalyserNode's getByteFrequencyData / getByteTimeDomainData produce. Export
 *  fills these from an offline FFT of the rendered mix; preview taps a live node. */
export interface MusicVizAudio {
  freq: Uint8Array | null
  wave: Uint8Array | null
}

const hexa = (c: string, a: number): string => {
  const h = c.startsWith('#') ? c.slice(1) : c
  const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath(); ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

/** The engine passes a `tempo` for the idle (audio-less) fallback animation; a
 *  music-viz overlay has no song, so a default tempo just paces that fallback. */
export interface MusicVizRenderer {
  draw(ctx: CanvasRenderingContext2D, W: number, H: number, timeSec: number, audio: MusicVizAudio | null): void
}

/** Build a renderer for a config. Cheap — safe to recreate when the format or
 *  colours change; keep it across frames of the same look for the live preview. */
export function createMusicViz(config: MusicVizConfig, tempo = 120): MusicVizRenderer {
  const entry = FORMATS[config.format] || FORMATS.waveform
  // Audio-reactive formats ignore the song arg; pass a minimal stand-in.
  const song = { tempo, notes: [] as unknown[], tracks: [] as unknown[] }
  const fmt = entry.create(song, { accent: config.accent })

  return {
    draw(ctx, W, H, timeSec, audio) {
      const SPB = 60 / (tempo || 120)
      const beat = timeSec / SPB
      const f = {
        ctx, W, H, beat,
        pulse: Math.pow(1 - (beat - Math.floor(beat)), 3),
        SPB, LOOP: Number.MAX_SAFE_INTEGER, now: timeSec * 1000,
        accent: config.accent, hexa, tracks: [] as unknown[],
        rr: (x: number, y: number, w: number, h: number, r: number) => rr(ctx, x, y, w, h, r),
        fieldTop: H * 0.13, fieldBot: H * 0.82,
        freq: audio?.freq ?? null, wave: audio?.wave ?? null,
        pmin: 47, pmax: 73,
        px: (p: number) => (0.08 + (p - 47) / 26 * 0.84) * W,
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.clearRect(0, 0, W, H)
      if (config.bg) {
        const g = ctx.createLinearGradient(0, 0, 0, H)
        g.addColorStop(0, config.bg[0]); g.addColorStop(1, config.bg[1])
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      }
      fmt.draw(f)
      ctx.globalCompositeOperation = 'source-over'   // formats may leave 'lighter'
    },
  }
}
