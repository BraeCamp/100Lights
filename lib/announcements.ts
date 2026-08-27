import { sql } from './db'
import { schemaManaged } from './schema-guard'

// Broadcast announcements — a message the founder can push to everyone (or a
// plan segment) that renders as a dismissible banner across the app. One place
// to say "new feature", "scheduled maintenance", or "holiday offer" without a
// deploy.

export type AnnLevel = 'info' | 'success' | 'warn'
export type AnnAudience = 'all' | 'free' | 'pro'

export interface Announcement {
  id: number
  message: string
  level: AnnLevel
  href: string | null
  href_label: string | null
  audience: AnnAudience
  dismissible: boolean
  active: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
}

let ready = false
async function ensure() {
  if (ready || schemaManaged) return
  await sql`CREATE TABLE IF NOT EXISTS announcements (
    id BIGSERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    href TEXT,
    href_label TEXT,
    audience TEXT NOT NULL DEFAULT 'all',
    dismissible BOOLEAN NOT NULL DEFAULT true,
    active BOOLEAN NOT NULL DEFAULT true,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
  ready = true
}

// All announcements for the admin list (newest first).
export async function listAnnouncements(): Promise<Announcement[]> {
  await ensure()
  const rows = await sql`SELECT * FROM announcements ORDER BY created_at DESC LIMIT 200`
  return rows as unknown as Announcement[]
}

// The banners a given viewer should see right now: active, inside any time
// window, and matching audience. plan null = signed-out (sees 'all' only).
export async function activeAnnouncements(plan: 'free' | 'pro' | null): Promise<Announcement[]> {
  await ensure()
  const rows = await sql`
    SELECT id, message, level, href, href_label, audience, dismissible
    FROM announcements
    WHERE active = true
      AND (starts_at IS NULL OR starts_at <= NOW())
      AND (ends_at IS NULL OR ends_at > NOW())
      AND (audience = 'all' OR audience = ${plan ?? 'free'})
    ORDER BY created_at DESC
    LIMIT 5`
  return rows as Announcement[]
}

const LEVELS: AnnLevel[] = ['info', 'success', 'warn']
const AUDIENCES: AnnAudience[] = ['all', 'free', 'pro']

export async function createAnnouncement(a: Partial<Announcement>): Promise<Announcement> {
  await ensure()
  const level = LEVELS.includes(a.level as AnnLevel) ? a.level : 'info'
  const audience = AUDIENCES.includes(a.audience as AnnAudience) ? a.audience : 'all'
  const rows = await sql`
    INSERT INTO announcements (message, level, href, href_label, audience, dismissible, active, starts_at, ends_at)
    VALUES (${(a.message ?? '').slice(0, 400)}, ${level}, ${a.href || null}, ${a.href_label?.slice(0, 40) || null},
            ${audience}, ${a.dismissible ?? true}, ${a.active ?? true},
            ${a.starts_at || null}, ${a.ends_at || null})
    RETURNING *`
  return rows[0] as Announcement
}

export async function getAnnouncement(id: number): Promise<Announcement | null> {
  await ensure()
  const rows = await sql`SELECT * FROM announcements WHERE id = ${id}`
  return (rows[0] as Announcement) ?? null
}

// Full replace — the caller merges its patch over the existing row first, so
// every column is written unconditionally (no conditional SQL fragments, which
// the local dev adapter can't compose in a value slot).
export async function updateAnnouncement(id: number, a: Announcement): Promise<Announcement | null> {
  await ensure()
  const level = LEVELS.includes(a.level) ? a.level : 'info'
  const audience = AUDIENCES.includes(a.audience) ? a.audience : 'all'
  const rows = await sql`
    UPDATE announcements SET
      message     = ${(a.message ?? '').slice(0, 400)},
      level       = ${level},
      href        = ${a.href || null},
      href_label  = ${a.href_label?.slice(0, 40) || null},
      audience    = ${audience},
      dismissible = ${a.dismissible},
      active      = ${a.active},
      starts_at   = ${a.starts_at || null},
      ends_at     = ${a.ends_at || null}
    WHERE id = ${id}
    RETURNING *`
  return (rows[0] as Announcement) ?? null
}

export async function deleteAnnouncement(id: number): Promise<void> {
  await ensure()
  await sql`DELETE FROM announcements WHERE id = ${id}`
}
