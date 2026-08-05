import type { Caption } from '@/lib/types'

/**
 * Word timings for karaoke highlighting. Real Deepgram timings when the
 * transcript has them; otherwise estimated by spreading the caption's window
 * across its words proportionally to word length — close enough for the
 * word-pop effect on transcripts made before timings were stored.
 */
export function captionWords(cap: Caption): Array<{ w: string; s: number; e: number }> {
  if (cap.words?.length) return cap.words
  const words = cap.text.split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const span = Math.max(0.1, cap.end - cap.start)
  const totalLen = words.reduce((s, w) => s + w.length + 1, 0)
  let t = cap.start
  return words.map(w => {
    const d = span * ((w.length + 1) / totalLen)
    const out = { w, s: t, e: t + d }
    t += d
    return out
  })
}

function pad(n: number, digits = 2) {
  return String(Math.floor(n)).padStart(digits, '0')
}

function toSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, '0')}`
}

function toVTTTime(seconds: number): string {
  return toSRTTime(seconds).replace(',', '.')
}

/** Returns captions within [start, end] with timestamps rebased to 0. */
export function sliceCaptions(captions: Caption[], start: number, end: number): Caption[] {
  return captions
    .filter((c) => c.end > start && c.start < end)
    .map((c) => ({
      ...c,
      start: Math.max(0, c.start - start),
      end: Math.min(end - start, c.end - start),
    }))
}

export function formatSRT(captions: Caption[]): string {
  return captions
    .map((c, i) => `${i + 1}\n${toSRTTime(c.start)} --> ${toSRTTime(c.end)}\n${c.text}`)
    .join('\n\n')
}

export function formatVTT(captions: Caption[]): string {
  const body = captions
    .map((c) => `${toVTTTime(c.start)} --> ${toVTTTime(c.end)}\n${c.text}`)
    .join('\n\n')
  return `WEBVTT\n\n${body}`
}

export function downloadCaption(
  filename: string,
  captions: Caption[],
  format: 'srt' | 'vtt'
) {
  const content = format === 'srt' ? formatSRT(captions) : formatVTT(captions)
  const mime = format === 'srt' ? 'text/plain' : 'text/vtt'
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.${format}`
  a.click()
  URL.revokeObjectURL(url)
}

export function formatDisplayTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${pad(s)}`
}
