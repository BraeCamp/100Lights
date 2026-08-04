'use client'

import { useState } from 'react'
import { songVideoData, defaultMeta, bestWindow } from '@/lib/song-video/from-project.mjs'
import SongVideoPlayer from './SongVideoPlayer'
import type { DawProject } from '@/lib/daw-types'

// Make a video from a .cfproj FILE without first saving it as a studio project —
// the answer to "how do I upload to it". Parses the project client-side and hands
// the same maker its dawProject (notes for the visuals, full project for the real
// mix bounce). Used for recreations / generated songs that live as files.

type Loaded = {
  song: ReturnType<typeof songVideoData>
  daw: DawProject
  meta: string
  slug: string
  totalBeats: number
  defaultStart: number
}

export default function UploadMaker({ userId }: { userId?: string | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const parsed = JSON.parse(await file.text())
      const daw: DawProject | undefined = parsed.dawProject ?? (parsed.tracks && parsed.arrangementClips ? parsed : undefined)
      if (!daw || !Array.isArray(daw.tracks)) throw new Error('Not a 100Lights project (.cfproj) — no dawProject inside.')
      const song = songVideoData(daw, { startBeat: 0, beats: 100000 })
      if (!song.notes.length) throw new Error('This project has no MIDI notes to visualize.')
      const totalBeats = Math.max(32, Math.ceil(Math.max(32, ...song.notes.map(n => n.s + n.d))))
      const slug = (parsed.name || file.name.replace(/\.cfproj$/i, '') || 'song-video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song-video'
      setLoaded({ song, daw, meta: defaultMeta({ ...song, loopBeats: 32 }), slug, totalBeats, defaultStart: bestWindow(daw, 32) })
    } catch (e) {
      setError((e as Error).message || 'Could not read that file.')
      setLoaded(null)
    }
  }

  if (loaded) {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{loaded.slug}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{loaded.meta}</span>
          <button onClick={() => setLoaded(null)} style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 11px', cursor: 'pointer' }}>← Upload another</button>
        </div>
        <SongVideoPlayer song={loaded.song} meta={loaded.meta} slug={loaded.slug} canPublish totalBeats={loaded.totalBeats} defaultStart={loaded.defaultStart} dawProject={loaded.daw} userId={userId} />
      </div>
    )
  }

  return (
    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '22px 16px', border: '1.5px dashed var(--border)', borderRadius: 12, cursor: 'pointer', textAlign: 'center', background: 'var(--bg-base)' }}>
      <input type="file" accept=".cfproj,application/json" onChange={e => onFile(e.target.files?.[0])} style={{ display: 'none' }} />
      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>Upload a .cfproj → make a video</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Drop in a recreation or generated song file — no need to save it as a project first.</span>
      {error && <span style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>{error}</span>}
    </label>
  )
}
