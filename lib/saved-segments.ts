import { sql } from './db'
import { LIFECYCLE_CTE, STAGE_CASE } from './lifecycle'

// Saved "smart segments" — named, reusable filters over the whole user base,
// built from a fixed, safe set of criteria (so the SQL is fully parameterised —
// no free-form query strings). They layer on the same lifecycle CTE the Users
// panel already uses, so a segment can combine a lifecycle stage, plan/access,
// project depth, activity recency, and an admin tag.

export interface SegmentCriteria {
  stage?: string | null            // a lifecycle stage id, or empty for any
  access?: string | null           // 'paying' | 'comped' | 'free' | any
  minProjects?: number | null      // saved-project count ≥ N
  savedWithinDays?: number | null   // active in the last N days
  notSavedWithinDays?: number | null // NOT saved in the last N days (gone quiet)
  tag?: string | null              // has this admin tag
}

export interface SavedSegment { id: number; name: string; criteria: SegmentCriteria; createdAt: string }

let ready = false
async function ensure() {
  if (ready) return
  await sql`CREATE TABLE IF NOT EXISTS saved_segments (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    criteria JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
  ready = true
}

function norm(c: SegmentCriteria) {
  const i = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : null }
  const tag = c.tag?.trim() || null
  return {
    stage: c.stage?.trim() || null,
    access: c.access && ['paying', 'comped', 'free'].includes(c.access) ? c.access : null,
    minProjects: i(c.minProjects),
    savedWithin: i(c.savedWithinDays),
    notSavedWithin: i(c.notSavedWithinDays),
    tag,
    tagArr: tag ? JSON.stringify([tag]) : null,
  }
}

// Columns the Users list needs, filtered by a criteria set (best-effort).
export async function segmentPageRows(c: SegmentCriteria, limit: number, offset: number): Promise<Record<string, unknown>[]> {
  const p = norm(c)
  try {
    return await sql`
      WITH ${LIFECYCLE_CTE}, staged AS (SELECT base.*, ${STAGE_CASE} AS stage FROM base)
      SELECT user_id, stripe_customer_id, plan, status, current_period_end, gift_plan, gift_until, updated_at
      FROM staged
      WHERE (${p.stage}::text IS NULL OR stage = ${p.stage})
        AND (${p.access}::text IS NULL OR CASE ${p.access}
              WHEN 'paying' THEN paying
              WHEN 'comped' THEN ((gifted OR coded) AND NOT paying)
              WHEN 'free'   THEN (NOT paying AND NOT gifted AND NOT coded)
              ELSE TRUE END)
        AND (${p.minProjects}::int IS NULL OR pc >= ${p.minProjects})
        AND (${p.savedWithin}::int IS NULL OR (last_saved IS NOT NULL AND last_saved > NOW() - (${p.savedWithin}::int * INTERVAL '1 day')))
        AND (${p.notSavedWithin}::int IS NULL OR last_saved IS NULL OR last_saved < NOW() - (${p.notSavedWithin}::int * INTERVAL '1 day'))
        AND (${p.tag}::text IS NULL OR EXISTS (SELECT 1 FROM user_notes n WHERE n.user_id = staged.user_id AND n.tags @> ${p.tagArr}::jsonb))
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}`
  } catch { return [] }
}

// Matching user_ids up to a cap — for bulk actions on a segment.
export async function segmentUserIds(c: SegmentCriteria, cap: number): Promise<string[]> {
  const rows = await segmentPageRows(c, cap, 0)
  return rows.map(r => String(r.user_id))
}

export async function segmentCount(c: SegmentCriteria): Promise<number> {
  const p = norm(c)
  try {
    const rows = await sql`
      WITH ${LIFECYCLE_CTE}, staged AS (SELECT base.*, ${STAGE_CASE} AS stage FROM base)
      SELECT COUNT(*)::int AS n FROM staged
      WHERE (${p.stage}::text IS NULL OR stage = ${p.stage})
        AND (${p.access}::text IS NULL OR CASE ${p.access}
              WHEN 'paying' THEN paying
              WHEN 'comped' THEN ((gifted OR coded) AND NOT paying)
              WHEN 'free'   THEN (NOT paying AND NOT gifted AND NOT coded)
              ELSE TRUE END)
        AND (${p.minProjects}::int IS NULL OR pc >= ${p.minProjects})
        AND (${p.savedWithin}::int IS NULL OR (last_saved IS NOT NULL AND last_saved > NOW() - (${p.savedWithin}::int * INTERVAL '1 day')))
        AND (${p.notSavedWithin}::int IS NULL OR last_saved IS NULL OR last_saved < NOW() - (${p.notSavedWithin}::int * INTERVAL '1 day'))
        AND (${p.tag}::text IS NULL OR EXISTS (SELECT 1 FROM user_notes n WHERE n.user_id = staged.user_id AND n.tags @> ${p.tagArr}::jsonb))`
    return Number(rows[0]?.n ?? 0)
  } catch { return 0 }
}

export async function listSegments(): Promise<SavedSegment[]> {
  await ensure()
  const rows = await sql`SELECT id, name, criteria, created_at FROM saved_segments ORDER BY created_at DESC LIMIT 100`
  return rows.map(r => ({ id: Number(r.id), name: String(r.name), criteria: (r.criteria ?? {}) as SegmentCriteria, createdAt: String(r.created_at) }))
}

export async function getSegment(id: number): Promise<SavedSegment | null> {
  await ensure()
  const rows = await sql`SELECT id, name, criteria, created_at FROM saved_segments WHERE id = ${id}`
  const r = rows[0]
  return r ? { id: Number(r.id), name: String(r.name), criteria: (r.criteria ?? {}) as SegmentCriteria, createdAt: String(r.created_at) } : null
}

export async function createSegment(name: string, criteria: SegmentCriteria): Promise<SavedSegment> {
  await ensure()
  const clean = norm(criteria)
  const stored: SegmentCriteria = {
    stage: clean.stage, access: clean.access, minProjects: clean.minProjects,
    savedWithinDays: clean.savedWithin, notSavedWithinDays: clean.notSavedWithin, tag: clean.tag,
  }
  const rows = await sql`INSERT INTO saved_segments (name, criteria) VALUES (${name.slice(0, 80)}, ${JSON.stringify(stored)}::jsonb) RETURNING id, name, criteria, created_at`
  const r = rows[0]
  return { id: Number(r.id), name: String(r.name), criteria: (r.criteria ?? {}) as SegmentCriteria, createdAt: String(r.created_at) }
}

export async function deleteSegment(id: number): Promise<void> {
  await ensure()
  await sql`DELETE FROM saved_segments WHERE id = ${id}`
}
