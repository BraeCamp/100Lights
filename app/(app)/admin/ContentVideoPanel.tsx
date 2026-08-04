import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { FORMATS } from '@/lib/song-video/formats.mjs'
import UploadMaker from '@/components/song-video/UploadMaker'

export const dynamic = 'force-dynamic'

// The content engine's home in admin: pick any saved project and turn it into a
// branded vertical video with the falling-notes / format system. Each row links
// to the live maker at /lab/video/[id] (preview, switch format, export webm).
export default async function ContentVideoPanel() {
  const { userId } = await auth()
  let rows: Array<{ id: string; name: string; saved_at: string }> = []
  try {
    rows = userId
      ? (await sql`SELECT id, name, saved_at FROM projects WHERE user_id = ${userId} AND deleted_at IS NULL ORDER BY saved_at DESC LIMIT 100`) as typeof rows
      : (await sql`SELECT id, name, saved_at FROM projects WHERE deleted_at IS NULL ORDER BY saved_at DESC LIMIT 100`) as typeof rows
  } catch {
    rows = []
  }

  const formatNames = Object.values(FORMATS as Record<string, { name?: string }>)
    .map(f => f.name)
    .filter(Boolean)

  return (
    <div>
      {/* Upload a .cfproj straight into the maker — for songs that live as files
          (recreations / generated) and aren't saved studio projects. */}
      <div style={{ marginBottom: 18 }}>
        <UploadMaker userId={userId} />
      </div>

      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '4px 0 10px' }}>
        …or pick a saved project
      </div>

      {/* Format legend — what looks the maker can render */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 18,
          padding: '11px 13px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}
      >
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', alignSelf: 'center', marginRight: 4 }}>
          {formatNames.length} formats
        </span>
        {formatNames.map(name => (
          <span
            key={name}
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              padding: '3px 9px',
              borderRadius: 99,
              background: 'color-mix(in srgb, #3b82f6 14%, transparent)',
              color: '#3b82f6',
              border: '1px solid color-mix(in srgb, #3b82f6 30%, transparent)',
            }}
          >
            {name}
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>
          No saved projects yet. Make and save a song in the studio, then it&rsquo;ll appear here ready to turn into a video.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {rows.map(r => (
            <li
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '12px 15px',
              }}
            >
              <span style={{ fontSize: 14.5, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                {r.name || 'Untitled'}
              </span>
              <Link
                href={`/lab/video/${r.id}`}
                style={{
                  flexShrink: 0,
                  textDecoration: 'none',
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: '#fff',
                  background: '#3b82f6',
                  padding: '6px 13px',
                  borderRadius: 8,
                }}
              >
                🎬 Make video →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
