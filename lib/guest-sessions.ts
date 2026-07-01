import { sql } from '@/lib/db'
import { randomUUID } from 'crypto'

export type GuestStatus = 'pending' | 'waiting' | 'ready' | 'uploaded' | 'pulled'

export interface GuestSession {
  token: string
  projectId: string
  hostUserId: string
  guestName: string | null
  status: GuestStatus
  r2Key: string | null
  sessionStartMs: number | null
  recordingStartMs: number | null
  timelineOffsetMs: number | null
  durationMs: number | null
  createdAt: string
}

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS guest_sessions (
      token              TEXT PRIMARY KEY,
      project_id         TEXT NOT NULL,
      host_user_id       TEXT NOT NULL,
      guest_name         TEXT,
      status             TEXT NOT NULL DEFAULT 'pending',
      r2_key             TEXT,
      session_start_ms   BIGINT,
      recording_start_ms BIGINT,
      timeline_offset_ms BIGINT,
      duration_ms        BIGINT,
      created_at         TIMESTAMPTZ DEFAULT NOW()
    )
  `
}

function row2session(r: Record<string, unknown>): GuestSession {
  return {
    token:            r.token as string,
    projectId:        r.project_id as string,
    hostUserId:       r.host_user_id as string,
    guestName:        r.guest_name as string | null,
    status:           r.status as GuestStatus,
    r2Key:            r.r2_key as string | null,
    sessionStartMs:   r.session_start_ms ? Number(r.session_start_ms) : null,
    recordingStartMs: r.recording_start_ms ? Number(r.recording_start_ms) : null,
    timelineOffsetMs: r.timeline_offset_ms ? Number(r.timeline_offset_ms) : null,
    durationMs:       r.duration_ms ? Number(r.duration_ms) : null,
    createdAt:        r.created_at as string,
  }
}

export async function createSession(projectId: string, hostUserId: string): Promise<GuestSession> {
  await ensureTable()
  const token = randomUUID()
  const rows = await sql`
    INSERT INTO guest_sessions (token, project_id, host_user_id)
    VALUES (${token}, ${projectId}, ${hostUserId})
    RETURNING *
  `
  return row2session(rows[0] as Record<string, unknown>)
}

export async function getSession(token: string): Promise<GuestSession | null> {
  await ensureTable()
  const rows = await sql`SELECT * FROM guest_sessions WHERE token = ${token}`
  if (!rows[0]) return null
  return row2session(rows[0] as Record<string, unknown>)
}

export async function listSessions(projectId: string, hostUserId: string): Promise<GuestSession[]> {
  await ensureTable()
  const rows = await sql`
    SELECT * FROM guest_sessions
    WHERE project_id = ${projectId} AND host_user_id = ${hostUserId}
    ORDER BY created_at DESC
  `
  return (rows as Record<string, unknown>[]).map(row2session)
}

export async function markWaiting(token: string, guestName: string) {
  await sql`
    UPDATE guest_sessions SET status = 'waiting', guest_name = ${guestName}
    WHERE token = ${token} AND status = 'pending'
  `
}

export async function startSession(token: string): Promise<number> {
  const now = Date.now()
  await sql`
    UPDATE guest_sessions SET status = 'ready', session_start_ms = ${now}
    WHERE token = ${token}
  `
  return now
}

export async function confirmUpload(
  token: string,
  r2Key: string,
  recordingStartMs: number,
  durationMs: number,
) {
  const rows = await sql`SELECT session_start_ms FROM guest_sessions WHERE token = ${token}`
  const sessionStartMs = rows[0] ? Number((rows[0] as Record<string, unknown>).session_start_ms) : null
  const timelineOffsetMs = sessionStartMs !== null ? recordingStartMs - sessionStartMs : 0

  await sql`
    UPDATE guest_sessions
    SET status = 'uploaded', r2_key = ${r2Key},
        recording_start_ms = ${recordingStartMs},
        timeline_offset_ms = ${timelineOffsetMs},
        duration_ms        = ${durationMs}
    WHERE token = ${token}
  `
  return { timelineOffsetMs }
}

export async function markPulled(token: string) {
  await sql`UPDATE guest_sessions SET status = 'pulled' WHERE token = ${token}`
}

export async function deleteSession(token: string) {
  await sql`DELETE FROM guest_sessions WHERE token = ${token}`
}
