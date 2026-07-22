import { sql } from './db'

// Uploaded replacements for the demo clips. When a clip has an override, the
// /api/demo-audio route serves that file instead of the generated one — so
// Brae can fix any clip by dropping in his own audio. Stored base64 in the DB
// (the clips are small and few).

let ready = false
async function ensure() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS demo_audio_overrides (
      clip         TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      data_b64     TEXT NOT NULL,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  ready = true
}

export async function getOverride(clip: string): Promise<{ buf: Buffer; contentType: string } | null> {
  try {
    await ensure()
    const [row] = await sql`SELECT content_type, data_b64 FROM demo_audio_overrides WHERE clip = ${clip}`
    if (!row) return null
    return { buf: Buffer.from(row.data_b64 as string, 'base64'), contentType: row.content_type as string }
  } catch {
    return null
  }
}

export async function listOverrides(): Promise<string[]> {
  try {
    await ensure()
    const rows = await sql`SELECT clip FROM demo_audio_overrides`
    return rows.map(r => r.clip as string)
  } catch {
    return []
  }
}

export async function saveOverride(clip: string, bytes: Buffer, contentType: string): Promise<void> {
  await ensure()
  const b64 = bytes.toString('base64')
  await sql`
    INSERT INTO demo_audio_overrides (clip, content_type, data_b64, updated_at)
    VALUES (${clip}, ${contentType}, ${b64}, NOW())
    ON CONFLICT (clip) DO UPDATE SET content_type = EXCLUDED.content_type, data_b64 = EXCLUDED.data_b64, updated_at = NOW()
  `
}

export async function deleteOverride(clip: string): Promise<void> {
  await ensure()
  await sql`DELETE FROM demo_audio_overrides WHERE clip = ${clip}`
}
