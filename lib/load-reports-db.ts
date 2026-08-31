import { sql } from '@/lib/db'

// ── What went wrong while a song was loading ────────────────────────────────
//
// Brae: "Errors should go to the program and save in the admin so that you can
// use it to make edits when we make a pass. Keep the information of when the
// user hits play while it's loading and when loading resumes. This way we can
// see how playing can get in the way of loading."
//
// The loader already records everything worth knowing — render failures, clips
// set aside, silent renders, stalls, and the pause/resume pair that shows what
// listening costs — but it records it in a 200-entry array in one browser tab,
// which is gone the moment the tab is. So the only failures anyone ever saw
// were the ones somebody happened to be watching.
//
// A row here is one session's summary, not one event: what device it was, how
// far it got, how long it took, how often play interrupted it, and the events
// that mattered. That is the shape a PASS over them wants — the question is
// "which songs load badly, and on what", not "list every window that retried".
//
// Mirrors lib/voice-gaps-db.ts deliberately: lazy self-creating table,
// fail-soft everywhere. A studio must never fail a load because the place we
// keep notes was unavailable.

export interface LoadReportRow {
  id: string
  ts: number
  userId: string
  /** The project, so a song that always loads badly can be found. */
  projectId: string
  projectName: string
  /** Clips wanted / finished when the report was sent. */
  wanted: number
  done: number
  /** How long the job had been going, ms. */
  elapsedMs: number
  /** Counts that make a row triageable without reading the events. */
  errors: number
  silent: number
  setAside: number
  givenUp: number
  /** How often play interrupted the bake, and how long it was parked in total. */
  playInterruptions: number
  pausedMs: number
  /** 'ok' | 'stalled' | 'gave-up' | 'switched-to-server' */
  outcome: string
  /** Rough device signature — cores and memory decide whether a machine can do
   *  this at all, and "it is slow for me" needs something to compare. */
  device: string
  /** The events themselves, capped. */
  events: unknown
  createdAt?: string
}

let ready = false
async function ensure() {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS load_reports (
      id                 TEXT PRIMARY KEY,
      ts                 BIGINT NOT NULL DEFAULT 0,
      user_id            TEXT NOT NULL DEFAULT '',
      project_id         TEXT NOT NULL DEFAULT '',
      project_name       TEXT NOT NULL DEFAULT '',
      wanted             INT NOT NULL DEFAULT 0,
      done               INT NOT NULL DEFAULT 0,
      elapsed_ms         INT NOT NULL DEFAULT 0,
      errors             INT NOT NULL DEFAULT 0,
      silent             INT NOT NULL DEFAULT 0,
      set_aside          INT NOT NULL DEFAULT 0,
      given_up           INT NOT NULL DEFAULT 0,
      play_interruptions INT NOT NULL DEFAULT 0,
      paused_ms          INT NOT NULL DEFAULT 0,
      outcome            TEXT NOT NULL DEFAULT 'ok',
      device             TEXT NOT NULL DEFAULT '',
      events             JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`CREATE INDEX IF NOT EXISTS load_reports_ts ON load_reports (ts DESC)`
  await sql`CREATE INDEX IF NOT EXISTS load_reports_outcome ON load_reports (outcome)`
  ready = true
}

/** One session's loading story. Fail-soft: never throws. */
export async function addLoadReport(row: Omit<LoadReportRow, 'id' | 'createdAt'>): Promise<void> {
  try {
    await ensure()
    // A session that loaded cleanly and fast is not news, and writing one row
    // per page view would bury the reports that matter under the ones that do
    // not. Only trouble, or a genuinely slow load, is worth a row.
    const worthKeeping = row.errors > 0 || row.silent > 0 || row.setAside > 0 || row.givenUp > 0
      || row.outcome !== 'ok' || row.elapsedMs > 20_000
    if (!worthKeeping) return
    await sql`
      INSERT INTO load_reports (
        id, ts, user_id, project_id, project_name, wanted, done, elapsed_ms,
        errors, silent, set_aside, given_up, play_interruptions, paused_ms,
        outcome, device, events
      ) VALUES (
        ${crypto.randomUUID()}, ${row.ts}, ${row.userId}, ${row.projectId},
        ${row.projectName.slice(0, 200)}, ${row.wanted}, ${row.done}, ${Math.round(row.elapsedMs)},
        ${row.errors}, ${row.silent}, ${row.setAside}, ${row.givenUp},
        ${row.playInterruptions}, ${Math.round(row.pausedMs)},
        ${row.outcome.slice(0, 40)}, ${row.device.slice(0, 200)},
        ${JSON.stringify(row.events ?? [])}::jsonb
      )`
  } catch {
    // See the header. A notebook being unavailable must never break a load.
  }
}

export interface LoadReportSummary {
  totalSessions: number
  troubled: number
  gaveUp: number
  medianElapsedMs: number
  /** Sessions where play interrupted the bake at least once, and the average
   *  time parked — the number that answers "does listening slow loading down". */
  interrupted: number
  avgPausedMs: number
  rows: LoadReportRow[]
}

/** Newest first, with the counts that make a pass over them possible. */
export async function listLoadReports(limit = 100): Promise<LoadReportSummary> {
  const empty: LoadReportSummary = {
    totalSessions: 0, troubled: 0, gaveUp: 0, medianElapsedMs: 0,
    interrupted: 0, avgPausedMs: 0, rows: [],
  }
  try {
    await ensure()
    const rows = await sql`
      SELECT id, ts, user_id, project_id, project_name, wanted, done, elapsed_ms,
             errors, silent, set_aside, given_up, play_interruptions, paused_ms,
             outcome, device, events
      FROM load_reports ORDER BY ts DESC LIMIT ${limit}`
    const mapped: LoadReportRow[] = rows.map(r => ({
      id: String(r.id), ts: Number(r.ts), userId: String(r.user_id ?? ''),
      projectId: String(r.project_id ?? ''), projectName: String(r.project_name ?? ''),
      wanted: Number(r.wanted), done: Number(r.done), elapsedMs: Number(r.elapsed_ms),
      errors: Number(r.errors), silent: Number(r.silent), setAside: Number(r.set_aside),
      givenUp: Number(r.given_up), playInterruptions: Number(r.play_interruptions),
      pausedMs: Number(r.paused_ms), outcome: String(r.outcome ?? ''),
      device: String(r.device ?? ''), events: r.events,
    }))
    const times = mapped.map(m => m.elapsedMs).sort((a, b) => a - b)
    const interrupted = mapped.filter(m => m.playInterruptions > 0)
    return {
      totalSessions: mapped.length,
      troubled: mapped.filter(m => m.errors + m.silent + m.setAside > 0).length,
      gaveUp: mapped.filter(m => m.givenUp > 0 || m.outcome === 'gave-up').length,
      medianElapsedMs: times.length ? times[Math.floor(times.length / 2)] : 0,
      interrupted: interrupted.length,
      avgPausedMs: interrupted.length
        ? Math.round(interrupted.reduce((s, m) => s + m.pausedMs, 0) / interrupted.length)
        : 0,
      rows: mapped,
    }
  } catch {
    return empty
  }
}
