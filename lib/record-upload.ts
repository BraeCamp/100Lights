/**
 * Eager R2 upload for recorded audio clips.
 *
 * Recordings are born as blob: URLs — playable only in the browser that made
 * them. Uploading at record-stop gives every clip a durable r2Key that
 * (a) survives reloads/crashes before the user saves, and (b) syncs through
 * the collab room so other clients can fetch and play the audio
 * (engine.loadClipBuffer falls back to the r2Key when the blob URL is dead).
 *
 * Fire-and-forget: failures leave the clip on its blob URL, which is exactly
 * the pre-upload behavior.
 */

const EXT_BY_TYPE: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
}

export async function uploadRecordingBlob(blob: Blob, clipId: string): Promise<string | null> {
  try {
    const baseType = (blob.type || 'audio/webm').split(';')[0]
    const ext = EXT_BY_TYPE[baseType] ?? '.webm'
    const presign = await fetch('/api/media/presign-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: `recording-${clipId}${ext}`,
        contentType: baseType,
        mediaId: `rec-${clipId}`,
        size: blob.size,
      }),
    })
    if (!presign.ok) return null
    const { uploadUrl, key } = await presign.json() as { uploadUrl: string; key: string }
    const put = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': baseType } })
    return put.ok ? key : null
  } catch {
    return null
  }
}
