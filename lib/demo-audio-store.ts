import { sql } from './db'
import { DEFAULT_SETTINGS, withDefaults, type DemoSettings } from './demo-audio'

// Persisted tuner settings for the learn-article demo clips (single row). The
// admin tuner writes them; the /api/demo-audio route renders clips from them.

let ready = false
async function ensure() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS demo_audio_settings (
      id         TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  ready = true
}

export async function getDemoSettings(): Promise<DemoSettings> {
  try {
    await ensure()
    const [row] = await sql`SELECT data FROM demo_audio_settings WHERE id = 'current'`
    return withDefaults(row?.data as Partial<DemoSettings> | undefined)
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** A cheap cache key that changes whenever settings are saved. */
export async function getDemoSettingsVersion(): Promise<string> {
  try {
    await ensure()
    const [row] = await sql`SELECT updated_at FROM demo_audio_settings WHERE id = 'current'`
    return row?.updated_at ? String(new Date(row.updated_at as string).getTime()) : '0'
  } catch {
    return '0'
  }
}

export async function saveDemoSettings(s: DemoSettings): Promise<void> {
  await ensure()
  await sql`
    INSERT INTO demo_audio_settings (id, data, updated_at)
    VALUES ('current', ${JSON.stringify(s)}::jsonb, NOW())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
  `
}
