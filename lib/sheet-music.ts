// ── Sheet-music import (unified) ─────────────────────────────────────────────
// One entry point for turning an uploaded score into DAW notes:
//   · .musicxml / .xml / .mxl → parsed locally, exactly (no recognition needed)
//   · image / PDF             → Claude-vision transcription via /api/sheet-music
// Both return the same `ParsedMidi` shape as the MIDI importer.

import type { ParsedMidi } from './midi-file'
import { parseMusicXml } from './musicxml'

export const isMusicXmlFile = (name: string) => /\.(musicxml|xml|mxl)$/i.test(name)
export const isScoreImageFile = (name: string, type = '') =>
  /\.(png|jpe?g|webp|gif|pdf)$/i.test(name) || /^image\//.test(type) || type === 'application/pdf'
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

/** Import any supported sheet-music file into notes. Throws with a user-facing
 *  message on failure (unsupported / unreadable / transcription error). */
export async function importSheetMusic(file: File): Promise<ParsedMidi> {
  if (isMusicXmlFile(file.name)) {
    return parseMusicXml(await file.arrayBuffer(), file.name)
  }
  if (isScoreImageFile(file.name, file.type)) {
    const data = base64FromArrayBuffer(await file.arrayBuffer())
    const mediaType = file.type || guessType(file.name)
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
