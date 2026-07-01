import { sql } from '@/lib/db'
import type { ModuleKey } from '@/lib/editor-types'

export interface PlatformFlags {
  enabledModules:    ModuleKey[]
  enabledAudioModes: ('music' | 'podcast')[]
}

const DEFAULTS: PlatformFlags = {
  enabledModules:    ['audio', 'video', 'image'],
  enabledAudioModes: ['music', 'podcast'],
}

let tableReady = false
async function ensureTable() {
  if (tableReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS platform_config (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  tableReady = true
}

export async function getFlags(): Promise<PlatformFlags> {
  try {
    await ensureTable()
    const rows = await sql`SELECT key, value FROM platform_config WHERE key IN ('enabled_modules','enabled_audio_modes')`
    const map = Object.fromEntries(rows.map(r => [r.key as string, r.value]))
    return {
      enabledModules:    (map['enabled_modules']    as ModuleKey[]           | undefined) ?? DEFAULTS.enabledModules,
      enabledAudioModes: (map['enabled_audio_modes'] as ('music'|'podcast')[] | undefined) ?? DEFAULTS.enabledAudioModes,
    }
  } catch {
    return DEFAULTS
  }
}

export async function setFlags(flags: Partial<PlatformFlags>): Promise<void> {
  await ensureTable()
  const ops: Promise<unknown>[] = []
  if (flags.enabledModules !== undefined) {
    ops.push(sql`
      INSERT INTO platform_config (key, value, updated_at)
      VALUES ('enabled_modules', ${JSON.stringify(flags.enabledModules)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `)
  }
  if (flags.enabledAudioModes !== undefined) {
    ops.push(sql`
      INSERT INTO platform_config (key, value, updated_at)
      VALUES ('enabled_audio_modes', ${JSON.stringify(flags.enabledAudioModes)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `)
  }
  await Promise.all(ops)
}

export async function getWeeklyReport(): Promise<{ content: string; generatedAt: string } | null> {
  try {
    await ensureTable()
    const rows = await sql`SELECT value FROM platform_config WHERE key = 'weekly_report'`
    if (!rows[0]) return null
    return rows[0].value as { content: string; generatedAt: string }
  } catch {
    return null
  }
}

export async function saveWeeklyReport(content: string): Promise<void> {
  await ensureTable()
  await sql`
    INSERT INTO platform_config (key, value, updated_at)
    VALUES ('weekly_report', ${JSON.stringify({ content, generatedAt: new Date().toISOString() })}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `
}
