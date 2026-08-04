import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import type { CfProjFile } from '@/lib/project-serializer'
import { songVideoData, defaultMeta, bestWindow } from '@/lib/song-video/from-project.mjs'
import SongVideoPlayer from '@/components/song-video/SongVideoPlayer'

export const dynamic = 'force-dynamic'

// Admin: turn a saved project into a vertical song-video (format picker + export).
// Gated by the /lab layout (admin / DEV_OPEN). The same <SongVideoPlayer> becomes
// the user-facing "turn my song into a video" feature in the studio.
export default async function SongVideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId } = await auth()
  let row: { name: string; data: CfProjFile; saved_at: string } | undefined
  try {
    const rows = await sql`SELECT name, data, saved_at FROM projects WHERE id = ${id} AND deleted_at IS NULL`
    row = rows[0] as typeof row
  } catch { /* notFound */ }
  if (!row) notFound()
  const daw = row.data?.dawProject
  if (!daw) notFound()

  // Pass the WHOLE song so the maker can scrub which section plays; open it on
  // the densest 32-bar window by default.
  const data = songVideoData(daw, { startBeat: 0, beats: 100000 })
  const totalBeats = Math.max(32, Math.ceil(Math.max(32, ...data.notes.map(n => n.s + n.d))))
  const defaultStart = bestWindow(daw, 32)
  const meta = defaultMeta({ ...data, loopBeats: 32 })
  const slug = (row.name || 'song-video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song-video'

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <main style={{ maxWidth: 520, margin: '0 auto', padding: '28px 20px 90px', color: 'var(--text-primary, #f1f0ff)' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#a78bfa' }}>Song video · Lab</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', margin: '6px 0 2px' }}>{row.name}</h1>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted,#a3a2b5)' }}>{meta}</div>
        </div>
        {data.notes.length === 0
          ? <p style={{ fontSize: 13.5, color: 'var(--text-muted,#a3a2b5)' }}>This project has no MIDI notes to visualize yet — add some in the studio, then come back.</p>
          : <SongVideoPlayer song={data} meta={meta} slug={slug} projectId={id} canPublish totalBeats={totalBeats} defaultStart={defaultStart} dawProject={daw} userId={userId} audioKey={`${id}:${row.saved_at}`} />}
      </main>
    </div>
  )
}
