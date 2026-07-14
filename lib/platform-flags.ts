import { sql } from '@/lib/db'
import type { ModuleKey } from '@/lib/editor-types'

export interface PlatformFlags {
  enabledModules:    ModuleKey[]
  enabledAudioModes: ('music' | 'podcast')[]
  /** Community operating mode: 'small' keeps every share visible (new-first,
   *  no rate limits); 'large' switches to trending-first, per-user rate
   *  limits, and cached public reads. */
  communityScale:    'small' | 'large'
}

const DEFAULTS: PlatformFlags = {
  enabledModules:    ['audio', 'video', 'image'],
  enabledAudioModes: ['music', 'podcast'],
  communityScale:    'small',
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
    const rows = await sql`SELECT key, value FROM platform_config WHERE key IN ('enabled_modules','enabled_audio_modes','community_scale')`
    const map = Object.fromEntries(rows.map(r => [r.key as string, r.value]))
    return {
      enabledModules:    (map['enabled_modules']    as ModuleKey[]           | undefined) ?? DEFAULTS.enabledModules,
      enabledAudioModes: (map['enabled_audio_modes'] as ('music'|'podcast')[] | undefined) ?? DEFAULTS.enabledAudioModes,
      communityScale:    (map['community_scale']     as 'small'|'large'       | undefined) ?? DEFAULTS.communityScale,
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
  if (flags.communityScale !== undefined) {
    ops.push(sql`
      INSERT INTO platform_config (key, value, updated_at)
      VALUES ('community_scale', ${JSON.stringify(flags.communityScale)}::jsonb, NOW())
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
