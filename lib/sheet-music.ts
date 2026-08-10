// ── Sheet-music import (unified, HYBRID) ─────────────────────────────────────
// One entry point for turning an uploaded score into DAW notes:
//   · .musicxml / .xml / .mxl → parsed locally, exactly (no recognition needed)
//   · raster image            → LOCAL OMR first (lib/omr, free/no-AI); low-confidence or failure
//                               falls back to Claude vision via /api/sheet-music
//   · PDF                     → Claude vision (local OMR needs a rendered raster — deferred)
// All paths return the same `ParsedMidi` shape as the MIDI importer. Same hybrid shape as the
// transcription pipeline: local-first, escalate only the hard cases to paid AI.

import type { ParsedMidi } from './midi-file'
import { parseMusicXml } from './musicxml'
import { recognizeScore } from './omr'

export const isMusicXmlFile = (name: string) => /\.(musicxml|xml|mxl)$/i.test(name)
export const isScoreImageFile = (name: string, type = '') =>
  /\.(png|jpe?g|webp|gif|pdf)$/i.test(name) || /^image\//.test(type) || type === 'application/pdf'
// Raster (canvas-decodable) image — eligible for local OMR. Excludes PDF.
export const isRasterScoreImage = (name: string, type = '') =>
  (/\.(png|jpe?g|webp|gif)$/i.test(name) || (/^image\//.test(type) && type !== 'application/pdf'))
  && !/\.pdf$/i.test(name)
// Below this local-OMR self-confidence, escalate to the AI vision pass.
const OMR_CONFIDENCE_FLOOR = 0.6
/** Accept attribute for a "import sheet music" file input. */
export const SHEET_MUSIC_ACCEPT = '.musicxml,.xml,.mxl,image/png,image/jpeg,image/webp,application/pdf'

function base64FromArrayBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(bin)
}

function guessType(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || ''
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' } as Record<string, string>)[ext] || 'image/png'
}

// Downscale a large raster scan before the vision call — fewer image tokens + a much smaller upload,
// with no loss of legibility for Claude (which reads notation well at ~1400px). Returns null (send the
// original) when the image is already small enough or can't be decoded. Browser only.
async function downscaleForVision(file: File, maxEdge = 1400): Promise<{ data: string; mediaType: string } | null> {
  if (typeof document === 'undefined') return null
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = url })
    const long = Math.max(img.naturalWidth, img.naturalHeight)
    if (!long || long <= maxEdge) return null                 // already small — send as-is
    const scale = maxEdge / long
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale)
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d'); if (!ctx) return null
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h)   // flatten any alpha to white paper
    const dataUrl = c.toDataURL('image/jpeg', 0.85)
    return { data: dataUrl.replace(/^data:[^;]+;base64,/, ''), mediaType: 'image/jpeg' }
  } catch { return null } finally { URL.revokeObjectURL(url) }
}

/** Import any supported sheet-music file into notes. Throws with a user-facing
 *  message on failure (unsupported / unreadable / transcription error). */
export async function importSheetMusic(file: File): Promise<ParsedMidi> {
  if (isMusicXmlFile(file.name)) {
    return parseMusicXml(await file.arrayBuffer(), file.name)
  }
  // Local OMR first (free, no AI, no auth) for raster images of clean printed scores. Any low-confidence
  // result or error falls through to the Claude-vision pass below — so hard/handwritten pages still work.
  if (isRasterScoreImage(file.name, file.type)) {
    try {
      const omr = await recognizeScore(file)
      if (omr.confidence >= OMR_CONFIDENCE_FLOOR && omr.notes.length > 0) {
        return { notes: omr.notes, tempo: omr.tempo, name: file.name.replace(/\.[^.]+$/, '') }
      }
    } catch { /* fall through to the AI vision pass */ }
  }
  if (isScoreImageFile(file.name, file.type)) {
    // Downscale a big raster scan first (fewer vision tokens + smaller upload); PDFs go as-is.
    const small = isRasterScoreImage(file.name, file.type) ? await downscaleForVision(file) : null
    const data = small ? small.data : base64FromArrayBuffer(await file.arrayBuffer())
    const mediaType = small ? small.mediaType : (file.type || guessType(file.name))
    const res = await fetch('/api/sheet-music', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data, mediaType }),
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({} as { error?: string }))
      throw new Error(e.error || `Transcription failed (${res.status})`)
    }
    const j = await res.json() as ParsedMidi
    return { notes: j.notes, tempo: j.tempo, name: j.name || file.name.replace(/\.[^.]+$/, '') }
  }
  throw new Error('Unsupported file — upload a MusicXML (.musicxml/.xml/.mxl) or an image/PDF of the score.')
}
