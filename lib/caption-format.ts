// Shared caption formatting — used by BOTH the standalone Captions app and the video module's transcript
// editor so exports never drift between them. A caption may carry extra fields (confidence/original/
// confirmed) for the hybrid's edit-feedback loop; the exporters ignore them.
import type { Caption } from './types'

export type EditCaption = Caption & { id?: string; confidence?: number; original?: string; confirmed?: boolean }

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`

const stamp = (t: number, sep: ',' | '.') => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms).padStart(3, '0')}`
}

export const toSRT = (captions: Caption[]) =>
  captions.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}`).join('\n\n')

export const toVTT = (captions: Caption[]) =>
  'WEBVTT\n\n' + captions.map(c => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}`).join('\n\n')

export const toTXT = (captions: Caption[]) => captions.map(c => c.text).join(' ')

/** Browser download helper for a caption export. */
export function downloadCaptions(name: string, fmt: 'srt' | 'vtt' | 'txt', captions: Caption[]) {
  const content = fmt === 'srt' ? toSRT(captions) : fmt === 'vtt' ? toVTT(captions) : toTXT(captions)
  const url = URL.createObjectURL(new Blob([content], { type: fmt === 'vtt' ? 'text/vtt' : 'text/plain' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name.replace(/\.[^.]+$/, '')}.${fmt}` })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** LOW-confidence threshold: below this, the base + tiny Whisper models disagreed → likely needs an edit. */
export const LOW_CONF = 0.7

// ── fine timing ──────────────────────────────────────────────────────────────
/** mm:ss.mmm — precise enough for caption timing. */
export const fmtTimeMs = (s: number) => {
  const m = Math.floor(Math.max(0, s) / 60), sec = Math.max(0, s) % 60
  return `${m}:${sec.toFixed(3).padStart(6, '0')}`
}
/** Parse "m:ss.mmm" | "ss.mmm" | seconds back to seconds; returns null if unparseable. */
export function parseTime(v: string): number | null {
  const t = v.trim()
  if (/^\d*\.?\d+$/.test(t)) return parseFloat(t)
  const m = t.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/)
  if (m) return parseInt(m[1], 10) * 60 + parseFloat(m[2])
  return null
}

/** Split one caption into two at absolute time `t` (must fall inside the caption). Text is divided by
 *  word timings when present, else by the time fraction — so the halves stay roughly in sync. */
export function splitCaption(c: EditCaption, t: number): [EditCaption, EditCaption] | null {
  if (t <= c.start + 0.02 || t >= c.end - 0.02) return null
  const frac = (t - c.start) / Math.max(0.001, c.end - c.start)
  let leftText: string, rightText: string, lw: EditCaption['words'], rw: EditCaption['words']
  if (c.words?.length) {
    const li = c.words.filter(w => w.s < t); const ri = c.words.filter(w => w.s >= t)
    leftText = li.map(w => w.w).join(' '); rightText = ri.map(w => w.w).join(' ')
    lw = li; rw = ri
  } else {
    const words = c.text.split(/\s+/); const cut = Math.max(1, Math.round(words.length * frac))
    leftText = words.slice(0, cut).join(' '); rightText = words.slice(cut).join(' ')
  }
  const mk = (start: number, end: number, text: string, words: EditCaption['words']): EditCaption =>
    ({ start, end, text, words, speaker: c.speaker, confidence: c.confidence })
  return [mk(c.start, t, leftText || c.text, lw), mk(t, c.end, rightText || '', rw)]
}

/** Merge caption `i` with the next one — combined span + text + word timings. */
export function mergeCaptions(list: EditCaption[], i: number): EditCaption[] {
  if (i < 0 || i >= list.length - 1) return list
  const a = list[i], b = list[i + 1]
  const merged: EditCaption = {
    ...a, start: Math.min(a.start, b.start), end: Math.max(a.end, b.end),
    text: `${a.text} ${b.text}`.trim(),
    words: (a.words || b.words) ? [...(a.words || []), ...(b.words || [])] : undefined,
  }
  return [...list.slice(0, i), merged, ...list.slice(i + 2)]
}

/** The word playing at time `t` within a caption (index into c.words), or -1. */
export function activeWord(c: EditCaption, t: number): number {
  if (!c.words?.length) return -1
  return c.words.findIndex(w => t >= w.s && t < w.e)
}
