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
