/**
 * Import a Firefly bundle — the `.zip` the mobile app exports when a sketch
 * contains recordings.
 *
 * Layout is fixed by the Firefly exporter (packages/firefly_core/src/bundle.dart):
 *
 *   <name>.cfproj        the project JSON, audio clips pointing at audio/<id>.wav
 *   audio/<assetId>.wav  16-bit mono PCM, one per recorded track
 *
 * Those `audio/…` paths are archive-relative, so they mean nothing once the ZIP
 * is gone. On import each WAV is uploaded to R2 and the clip is rewritten to
 * carry the resulting `r2Key` — the durable path the engine falls back to
 * (lib/daw-engine.ts `_loadClipBufferInner`). A blob: URL would play for this
 * session and break on the next reload, which is the exact failure the r2Key
 * fallback exists to prevent.
 */

import JSZip from 'jszip'
import type { CfProjFile } from './project-serializer'
import type { AudioClip } from './daw-types'

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] // "PK\x03\x04"

/** True if the file's leading bytes are a ZIP local-file-header signature. */
export async function isZipFile(file: File): Promise<boolean> {
  if (file.size < 4) return false
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return ZIP_MAGIC.every((b, i) => head[i] === b)
}

export interface BundleImportResult {
  project: CfProjFile
  /** Recordings that made it to durable storage. */
  uploaded: number
  /** Recordings that fell back to a session-only blob URL. */
  degraded: number
}

export class BundleImportError extends Error {}

/**
 * Unzip a Firefly bundle, upload its recordings, and return a project whose
 * audio clips resolve.
 *
 * Upload failures are not fatal: the clip falls back to a blob URL so the user
 * still hears their recording this session, and the count comes back in
 * `degraded` so the caller can say so out loud.
 */
export async function importFireflyBundle(file: File): Promise<BundleImportResult> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new BundleImportError('That file is not a readable archive.')
  }

  const projectEntry = Object.values(zip.files).find(
    f => !f.dir && f.name.endsWith('.cfproj'),
  )
  if (!projectEntry) {
    throw new BundleImportError('No .cfproj found inside the bundle.')
  }

  let project: CfProjFile
  try {
    project = JSON.parse(await projectEntry.async('string')) as CfProjFile
  } catch {
    throw new BundleImportError('The project file inside the bundle is corrupted.')
  }
  if (project?._type !== '100lights-project') {
    throw new BundleImportError('That archive is not a 100Lights project bundle.')
  }

  const clips = (project.dawProject?.arrangementClips ?? []) as AudioClip[]
  const audioClips = clips.filter(
    (c): c is AudioClip => c.kind === 'audio' && !!c.audioUrl?.startsWith('audio/'),
  )

  let uploaded = 0
  let degraded = 0

  for (const clip of audioClips) {
    const entry = zip.file(clip.audioUrl!)
    if (!entry) {
      // Dangling reference — drop the pointer so the engine doesn't chase a
      // path that will never resolve.
      delete clip.audioUrl
      degraded++
      continue
    }
    const blob = await entry.async('blob')
    const wav = new Blob([blob], { type: 'audio/wav' })
    const key = await uploadBundleAudio(wav, clip.id)
    if (key) {
      clip.r2Key = key
      delete clip.audioUrl
      uploaded++
    } else {
      clip.audioUrl = URL.createObjectURL(wav)
      degraded++
    }
  }

  return { project, uploaded, degraded }
}

/**
 * Presign + PUT one recording to R2, mirroring lib/record-upload.ts.
 * Returns null on any failure (including signed-out users, who have no
 * storage quota to write to).
 */
async function uploadBundleAudio(blob: Blob, clipId: string): Promise<string | null> {
  try {
    const presign = await fetch('/api/media/presign-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: `firefly-${clipId}.wav`,
        contentType: 'audio/wav',
        mediaId: `rec-${clipId}`,
        size: blob.size,
      }),
    })
    if (!presign.ok) return null
    const { uploadUrl, key } = await presign.json() as { uploadUrl: string; key: string }
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': 'audio/wav' },
    })
    return put.ok ? key : null
  } catch {
    return null
  }
}
