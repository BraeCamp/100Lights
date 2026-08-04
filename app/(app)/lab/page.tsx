import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Entry point: pick a project to open in the consolidated Project Hub.
export default async function LabIndex() {
  const { userId } = await auth()
  let rows: Array<{ id: string; name: string; saved_at: string }> = []
  try {
    rows = userId
      ? await sql`SELECT id, name, saved_at FROM projects WHERE user_id = ${userId} AND deleted_at IS NULL ORDER BY saved_at DESC LIMIT 100` as typeof rows
      // dev (DEV_OPEN, no session): show recent projects so the hub is testable
      : await sql`SELECT id, name, saved_at FROM projects WHERE deleted_at IS NULL ORDER BY saved_at DESC LIMIT 100` as typeof rows
  } catch { rows = [] }

  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '32px 20px 72px', color: 'var(--text-primary, #f1f0ff)' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#a78bfa', marginBottom: 8 }}>Lab · Admin</div>
      <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.01em', margin: '0 0 8px' }}>Project Hub</h1>
      <p style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-secondary, #cfceda)', margin: '0 0 26px', maxWidth: 640 }}>
        The consolidated home for a song — everything hangs off the project. Open one to see its
        split sheet, credits, metadata, sample clearances and provenance <b>auto-generated</b> from the
        project itself. The paperwork writes itself because the music was made here.
      </p>

      {rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted, #a3a2b5)', fontSize: 14 }}>
          No saved projects found. Make and save one in the studio, then it&rsquo;ll appear here.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {rows.map(r => (
            <li key={r.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              background: 'var(--bg-surface, #17171b)', border: '1px solid var(--border, #26262b)',
              borderRadius: 10, padding: '13px 16px',
            }}>
              <Link href={`/lab/${r.id}`} style={{ textDecoration: 'none', color: 'inherit', fontSize: 15, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || 'Untitled'}</Link>
              <span style={{ display: 'flex', gap: 12, flexShrink: 0, fontSize: 11.5 }}>
                <Link href={`/lab/video/${r.id}`} style={{ textDecoration: 'none', color: '#a78bfa', fontWeight: 600 }}>🎬 Video</Link>
                <Link href={`/lab/${r.id}`} style={{ textDecoration: 'none', color: 'var(--text-muted, #a3a2b5)' }}>Hub →</Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
