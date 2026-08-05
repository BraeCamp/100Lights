import { CF_VERSION, type CfProjFile } from '@/lib/project-serializer'
import { DEFAULT_ADJUSTMENTS, DEFAULT_TRACKS, type ProjectAspect } from '@/lib/editor-types'

// Send a rendered song-video into the app's VideoEditor so it can be edited
// further (trim, add clips/overlays/text/transitions). Uploads the render to the
// user's media library (R2 + /api/media/library) and opens a new video project
// with the clip already on the timeline, via the stash-and-open flow the editor
// uses for .cfproj files. Client-only.

export async function saveRenderToVideoEditor(
  blob: Blob,
  opts: {
    name: string
    durationSec: number
    /** Song tempo — arrives in the editor as its beat grid, so cuts snap to the music. */
    tempo?: number | null
    /** The maker's channel aspect — the editor project opens in the same frame shape. */
    aspect?: ProjectAspect
  },
): Promise<void> {
  const mediaId = crypto.randomUUID()
  const projId = crypto.randomUUID()
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
  const filename = `${opts.name}.${ext}`

  // 1. Presign a user-namespaced R2 key, 2. PUT the bytes straight to R2.
  const pres = await fetch('/api/media/presign-upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, contentType: blob.type, mediaId, size: blob.size }),
  })
  const pj = await pres.json().catch(() => ({}))
  if (!pres.ok || !pj.uploadUrl || !pj.key) throw new Error(pj.error || 'Could not start the upload')
  const put = await fetch(pj.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type } })
  if (!put.ok) throw new Error(`Upload failed (${put.status})`)

  // 3. Register it in the user's media library so it's reusable across projects.
  await fetch('/api/media/library', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: mediaId, name: filename, contentType: blob.type, duration: opts.durationSec, r2Key: pj.key }),
  }).catch(() => { /* non-fatal — the clip still resolves via signed-url */ })

  // 4. Build a video project with the render already on the timeline.
  const proj: CfProjFile = {
    _type: '100lights-project', version: CF_VERSION, id: projId, name: opts.name,
    savedAt: new Date().toISOString(),
    tracks: DEFAULT_TRACKS.map(t => ({ ...t })),
    clips: [{
      id: crypto.randomUUID(), label: opts.name, startTime: 0, inPoint: 0, outPoint: opts.durationSec,
      color: '#a78bfa', trackId: DEFAULT_TRACKS[0].id, mediaRefId: mediaId, captions: [], contentType: 'video',
    }],
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    aspect: opts.aspect,
    beatGrid: opts.tempo ? { bpm: opts.tempo, offset: 0, beatsPerBar: 4 } : null,
    zoomLevel: 1, captions: [], outputs: [], chapters: [],
    media: [{ id: mediaId, name: filename, contentType: 'video', duration: opts.durationSec, r2Key: pj.key }],
    modules: ['video'], audioMode: 'music',
  }

  // 5. Stash + open the editor (the same path .cfproj files use).
  localStorage.setItem(`cf_pending_cfproj_${projId}`, JSON.stringify(proj))
  window.location.href = `/projects/${projId}`
}
