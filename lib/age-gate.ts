import { sql } from '@/lib/db'
import { ensureSchema } from '@/lib/schema-version'

// 13+ age gate (COPPA). The Privacy Policy already states the Service isn't for
// under-13; this enforces it: every signed-in user confirms their birth date
// once, and anyone under 13 is blocked from using the account. We keep the
// record so the block persists and so "we do not knowingly serve under-13" is
// backed by an actual check.

async function ensure(): Promise<void> {
  await ensureSchema('user_age', 1, async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS user_age (
      user_id      TEXT        PRIMARY KEY,
      birthdate    DATE        NOT NULL,
      blocked      BOOLEAN     NOT NULL DEFAULT FALSE,
      confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  })
}

export interface AgeStatus {
  /** The user has answered the age question. */
  confirmed: boolean
  /** Under 13 — must be blocked from using the account. */
  blocked: boolean
  /** The check itself could not run (database down / over quota). Distinct from
   *  "not confirmed": we do not know, so we must not act as though they refused. */
  unavailable?: boolean
}

export async function getAgeStatus(userId: string): Promise<AgeStatus> {
  try {
    await ensure()
    const rows = await sql`SELECT blocked FROM user_age WHERE user_id = ${userId}`
    if (rows.length === 0) return { confirmed: false, blocked: false }
    return { confirmed: true, blocked: Boolean(rows[0].blocked) }
  } catch {
    // The check could not run. Fail OPEN and say so.
    //
    // This used to return "not confirmed", which reads as "ask them again" — so
    // when the database was unreachable the gate appeared for every signed-in
    // user, on every page, and no answer could ever be recorded because the
    // write failed too. An outage should not lock people out of their own work.
    return { confirmed: true, blocked: false, unavailable: true }
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
  const t = Date.parse(birthdate)
  if (Number.isNaN(t)) return { ok: false, error: 'Enter a valid date.' }
  const birth = new Date(t)
  const now = new Date()
  if (birth > now) return { ok: false, error: 'That date is in the future.' }
  const age = ageOn(birth, now)
  if (age > 120) return { ok: false, error: 'Enter a valid date.' }
  const blocked = age < 13
  // Storage failures are NOT the user's input being wrong. Saying "try again"
  // when the date was perfectly valid sends people round a loop they cannot win:
  // the answer is fine, the database is simply not accepting writes.
  try {
    await ensure()
    await sql`
      INSERT INTO user_age (user_id, birthdate, blocked, confirmed_at)
      VALUES (${userId}, ${birth.toISOString().slice(0, 10)}, ${blocked}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET birthdate = EXCLUDED.birthdate, blocked = EXCLUDED.blocked, confirmed_at = NOW()
    `
  } catch {
    return { ok: false, error: "We couldn't save that just now — it's us, not your date. Try again in a bit." }
  }
  return { ok: true, blocked }
}
