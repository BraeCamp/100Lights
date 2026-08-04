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
  raw: { _type?: string; name?: string; id?: string } & Record<string, unknown>
  meta: string
  slug: string
  totalBeats: number
  defaultStart: number
}

export default function UploadMaker({ userId }: { userId?: string | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null); setSaveMsg(null)
    try {
      const parsed = JSON.parse(await file.text())
      const daw: DawProject | undefined = parsed.dawProject ?? (parsed.tracks && parsed.arrangementClips ? parsed : undefined)
      if (!daw || !Array.isArray(daw.tracks)) throw new Error('Not a 100Lights project (.cfproj) — no dawProject inside.')
      const song = songVideoData(daw, { startBeat: 0, beats: 100000 })
      if (!song.notes.length) throw new Error('This project has no MIDI notes to visualize.')
      const totalBeats = Math.max(32, Math.ceil(Math.max(32, ...song.notes.map(n => n.s + n.d))))
      const slug = (parsed.name || file.name.replace(/\.cfproj$/i, '') || 'song-video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song-video'
      setLoaded({ song, daw, raw: parsed, meta: defaultMeta({ ...song, loopBeats: 32 }), slug, totalBeats, defaultStart: bestWindow(daw, 32) })
    } catch (e) {
      setError((e as Error).message || 'Could not read that file.')
      setLoaded(null)
    }
  }

  // Persist the uploaded project to the account so it appears in the menu (and the
  // studio) from now on — instead of re-uploading it each time.
  async function saveToProjects() {
    if (!loaded || saving) return
    if (loaded.raw._type !== '100lights-project' || !loaded.raw.id || !loaded.raw.name) {
      setSaveMsg('This file can’t be saved as a project (missing project header).'); return
    }
    setSaving(true); setSaveMsg('Saving…')
    try {
      const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loaded.raw) })
      const j = await res.json().catch(() => ({}))
      setSaveMsg(res.ok ? 'Saved to your projects ✓ — it’s in the menu now' : `Save failed: ${j.error || res.status}`)
    } catch { setSaveMsg('Save failed') }
    setSaving(false)
  }

  if (loaded) {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{loaded.slug}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{loaded.meta}</span>
          <button onClick={saveToProjects} disabled={saving} style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: '#0a0812', background: 'var(--accent)', border: 'none', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>Save to my projects</button>
          <button onClick={() => { setLoaded(null); setSaveMsg(null) }} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 11px', cursor: 'pointer' }}>← Upload another</button>
        </div>
        {saveMsg && <div style={{ fontSize: 12, fontWeight: 600, color: saveMsg.includes('failed') || saveMsg.includes('can’t') ? '#f87171' : '#4ade80' }}>{saveMsg}</div>}
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
