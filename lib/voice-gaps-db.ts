import { sql } from '@/lib/db'

// ── Sentences the built-in commands could not read ──────────────────────────
//
// Brae: "make sure that 'Type' (the function with a button next to voice) still
// runs on the non ai version unless it gets confused. Then it executes with AI
// and sends the system a correction that we can work from when I'm making
// patches."
//
// So this is the patch queue. Every time somebody says something the rules
// cannot read and the assistant works it out instead, the pair is written down:
// the words a person actually used, and the commands they turned out to mean.
// That is exactly the raw material for a new phrasing in commands.ts — and it
// is the only source of it that is not guesswork, because it comes from
// somebody trying to get something done rather than from imagining how they
// might ask.
//
// The point is that the queue drains. Each row is a phrasing the studio pays a
// model to understand today and could understand for free tomorrow, so the
// column that matters is `status`: new, added (there is a rule for it now), or
// ignored (a one-off, or too vague to be worth a rule).
//
// Mirrors lib/voice-corrections-db.ts: lazy self-creating table, fail-soft
// reads and writes. A studio must never fail a command because the place we
// keep notes was unavailable.

export interface GapRow {
  id: string
  ts: number
  /** What the person actually said or typed, verbatim. */
  said: string
  /** What the assistant decided it meant — the tool calls it produced. */
  calls: unknown
  /** The read-back, so the row is legible without decoding the calls. */
  say: string
  /** 'typed' or 'spoken'. Typed sentences are the more useful ones: nothing was
   *  misheard, so the gap is genuinely in the vocabulary and not in the ear. */
  source: string
  /** The tracks in play, so a phrasing that depends on a name can be read back
   *  in context months later. */
  tracks: unknown
  /**
   * Which rung answered: rules | learned | shared | macro | assistant.
   *
   * ⚠️ Brae: "all voice commands and responses have been read by previous
   * iterations." They had not: only the assistant's completed exchanges were
   * written here, so the two truncated replies that failed his last session
   * were nowhere, and neither was a single command the built-in rules
   * answered. A record that holds the successes and drops the failures is a
   * record that says everything works.
   */
  path?: string
  /**
   * How it actually went: 'ran', or 'refused: <reason>'.
   *
   * ⚠️ The half that was missing. A row saying only what the assistant DECIDED
   * a sentence meant is an intention, and a queue of intentions cannot tell you
   * which readings were wrong — the phrasings worth fixing first are exactly the
   * ones that were understood and then failed, and they looked identical to the
   * ones that worked.
   */
  outcome: string
  /** How many assistant turns it took. More than one means it had to look
   *  something up or recover from a refusal — the interesting rows. */
  turns: number
  userId: string
  status: string
  note: string
  createdAt?: string
}

let ready = false
async function ensure() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS voice_command_gaps (
      id         TEXT PRIMARY KEY,
      ts         BIGINT NOT NULL DEFAULT 0,
      said       TEXT NOT NULL DEFAULT '',
      calls      JSONB NOT NULL DEFAULT '[]'::jsonb,
      say        TEXT NOT NULL DEFAULT '',
      source     TEXT NOT NULL DEFAULT 'typed',
      tracks     JSONB NOT NULL DEFAULT '[]'::jsonb,
      user_id    TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'new',
      note       TEXT NOT NULL DEFAULT '',
      outcome    TEXT NOT NULL DEFAULT '',
      turns      INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  // The same sentence from ten people is one phrasing to write, not ten. The
  // list is read newest-first and grouped on the words, so both need an index
  // once this is more than a handful of rows.
  await sql`CREATE INDEX IF NOT EXISTS voice_gaps_said ON voice_command_gaps (lower(said))`
  await sql`CREATE INDEX IF NOT EXISTS voice_gaps_ts ON voice_command_gaps (ts DESC)`
  // Added after the table existed — a separate statement, since CREATE TABLE
  // IF NOT EXISTS does nothing to a table that is already there.
  await sql`ALTER TABLE voice_command_gaps ADD COLUMN IF NOT EXISTS path TEXT NOT NULL DEFAULT 'assistant'`
  // CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
  // the columns added after the first deploy have to be added explicitly or
  // they exist only on a database that has never run this code.
  await sql`ALTER TABLE voice_command_gaps ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT ''`
  await sql`ALTER TABLE voice_command_gaps ADD COLUMN IF NOT EXISTS turns INT NOT NULL DEFAULT 1`
  ready = true
}

/** How many times one phrasing may be recorded before it stops being news. */
const PER_PHRASE_CAP = 20

export async function addGap(row: Omit<GapRow, 'id' | 'ts' | 'status' | 'note'>): Promise<void> {
  const said = row.said.trim().slice(0, 400)
  if (!said) return
  try {
    await ensure()
    // A phrasing somebody uses constantly should not bury the ones they used
    // once. Counted rather than deduplicated, because how OFTEN a gap is hit is
    // the whole argument for writing a rule for it — but capped, so a script or
    // a habit cannot flood the queue it is supposed to inform.
    const [{ n }] = await sql`
      SELECT COUNT(*)::int AS n FROM voice_command_gaps WHERE lower(said) = lower(${said})`
    if (n >= PER_PHRASE_CAP) return
    await sql`
      INSERT INTO voice_command_gaps (id, ts, said, calls, say, source, tracks, user_id, outcome, turns, path)
      VALUES (
        ${crypto.randomUUID()}, ${Date.now()}, ${said},
        ${JSON.stringify(row.calls ?? [])}::jsonb, ${row.say ?? ''}, ${row.source ?? 'typed'},
        ${JSON.stringify(row.tracks ?? [])}::jsonb, ${row.userId ?? ''},
        ${row.outcome ?? ''}, ${row.turns ?? 1}, ${row.path ?? 'assistant'}
      )`
  } catch {
    // Fail-soft, deliberately and completely. This is a notebook. A command
    // that worked must never be reported as failed because the notebook was
    // unavailable.
  }
}

export interface GapGroup {
  said: string
  count: number
  lastAt: number
  say: string
  calls: unknown
  source: string
  status: string
  /** How the most recent attempt went, and how many of the grouped attempts
   *  were refused — a phrasing that fails half the time is the one to fix. */
  outcome: string
  /** Which rung answered the most recent attempt — rules, learned, assistant, failed. */
  path: string
  refused: number
  ids: string[]
}

/**
 * The queue, grouped by phrasing.
 *
 * Grouped rather than listed because the unit of work is a PHRASING, not an
 * occurrence: "make it punchier" said nine times is one rule to write. The
 * count is kept because it is the argument for writing it.
 */
export async function listGaps(limit = 200): Promise<GapGroup[]> {
  try {
    await ensure()
    const rows = await sql`
      SELECT
        said,
        COUNT(*)::int          AS count,
        MAX(ts)::bigint        AS last_at,
        (ARRAY_AGG(say  ORDER BY ts DESC))[1] AS say,
        (ARRAY_AGG(calls ORDER BY ts DESC))[1] AS calls,
        (ARRAY_AGG(source ORDER BY ts DESC))[1] AS source,
        (ARRAY_AGG(status ORDER BY ts DESC))[1] AS status,
        (ARRAY_AGG(outcome ORDER BY ts DESC))[1] AS outcome,
        (ARRAY_AGG(path ORDER BY ts DESC))[1] AS path,
        COUNT(*) FILTER (WHERE outcome LIKE 'refused%')::int AS refused,
        ARRAY_AGG(id)          AS ids
      FROM voice_command_gaps
      GROUP BY lower(said), said
      ORDER BY MAX(ts) DESC
      LIMIT ${limit}`
    return rows.map(r => ({
      said: String(r.said),
      count: Number(r.count),
      lastAt: Number(r.last_at),
      say: String(r.say ?? ''),
      calls: r.calls,
      source: String(r.source ?? ''),
      status: String(r.status ?? 'new'),
      outcome: String(r.outcome ?? ''),
      path: String(r.path ?? ''),
      refused: Number(r.refused ?? 0),
      ids: (r.ids ?? []) as string[],
    }))
  } catch {
    return []
  }
}

/** Mark a phrasing done — a rule exists for it now — or not worth one. */
export async function setGapStatus(ids: string[], status: string, note = ''): Promise<void> {
  if (!ids.length) return
  try {
    await ensure()
    await sql`
      UPDATE voice_command_gaps SET status = ${status}, note = ${note}
      WHERE id = ANY(${ids})`
  } catch { /* fail-soft, as above */ }
}
