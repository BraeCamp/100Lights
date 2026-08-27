import { sql } from '@/lib/db'
import { schemaManaged } from './schema-guard'

// 13+ age gate (COPPA). The Privacy Policy already states the Service isn't for
// under-13; this enforces it: every signed-in user confirms their birth date
// once, and anyone under 13 is blocked from using the account. We keep the
// record so the block persists and so "we do not knowingly serve under-13" is
// backed by an actual check.

let ready = false
async function ensure(): Promise<void> {
  if (ready || schemaManaged) return
  await sql`
    CREATE TABLE IF NOT EXISTS user_age (
      user_id      TEXT        PRIMARY KEY,
      birthdate    DATE        NOT NULL,
      blocked      BOOLEAN     NOT NULL DEFAULT FALSE,
      confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  ready = true
}

export interface AgeStatus {
  /** The user has answered the age question. */
  confirmed: boolean
  /** Under 13 — must be blocked from using the account. */
  blocked: boolean
}

export async function getAgeStatus(userId: string): Promise<AgeStatus> {
  try {
    await ensure()
    const rows = await sql`SELECT blocked FROM user_age WHERE user_id = ${userId}`
    if (rows.length === 0) return { confirmed: false, blocked: false }
    return { confirmed: true, blocked: Boolean(rows[0].blocked) }
  } catch {
    // Never hard-fail the app on the gate; treat as unconfirmed so it re-asks.
    return { confirmed: false, blocked: false }
  }
}

function ageOn(birth: Date, now: Date): number {
  let age = now.getUTCFullYear() - birth.getUTCFullYear()
  const m = now.getUTCMonth() - birth.getUTCMonth()
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) age--
  return age
}

export type SubmitAgeResult =
  | { ok: true; blocked: boolean }
  | { ok: false; error: string }

/** Record a user's birth date and whether they're under 13. */
export async function submitAge(userId: string, birthdate: string): Promise<SubmitAgeResult> {
  await ensure()
  const t = Date.parse(birthdate)
  if (Number.isNaN(t)) return { ok: false, error: 'Enter a valid date.' }
  const birth = new Date(t)
  const now = new Date()
  if (birth > now) return { ok: false, error: 'That date is in the future.' }
  const age = ageOn(birth, now)
  if (age > 120) return { ok: false, error: 'Enter a valid date.' }
  const blocked = age < 13
  await sql`
    INSERT INTO user_age (user_id, birthdate, blocked, confirmed_at)
    VALUES (${userId}, ${birth.toISOString().slice(0, 10)}, ${blocked}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET birthdate = EXCLUDED.birthdate, blocked = EXCLUDED.blocked, confirmed_at = NOW()
  `
  return { ok: true, blocked }
}
