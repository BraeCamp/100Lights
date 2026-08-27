// Broadcast CONTROL PLANE — the scalable core of "run streams 24/7 without my devices". Split from
// the station CONFIG (lib/broadcast-stations) on purpose: config = what a broadcast looks/sounds like;
// control = whether it should be LIVE and which worker is running it right now.
//
// The model is desired-state reconciliation (like a tiny Kubernetes for streams):
//   • the admin sets DESIRED state — "this broadcast should be live" (broadcast_stations.desired_live).
//   • worker "agents" (the broadcast-streamer boxes) poll `agentSync` with their id + what they're
//     running; the control plane assigns each desired-live broadcast to exactly one live worker and
//     returns that worker's assignment. Agents spawn/kill child streamers to match.
//   • agents report per-stream STATUS (live/fps/error) back on every sync → the dashboard reads it.
// Stream KEYS never touch the DB — each worker holds keys for the slugs it can run. The control plane
// only decides on/off + who runs what. This keeps it secure and lets it scale to many workers (and,
// later, many tenants) by just adding boxes.
import { sql } from '@/lib/db'
import { schemaManaged } from './schema-guard'

export type StreamStatus = 'starting' | 'live' | 'error' | 'offline'
export interface AgentReport { slug: string; status: StreamStatus; fps?: number; error?: string }
export interface Assignment { slug: string; streamKey: string; rtmpUrl: string }
export interface RuntimeRow {
  slug: string; title: string; channel: string | null; enabled: boolean; desiredLive: boolean
  status: StreamStatus; workerId: string | null; fps: number | null; error: string | null
  lastHeartbeat: string | null; stale: boolean   // stale = a status row older than the liveness window
}
export interface AgentRow { workerId: string; lastSeen: string; capacity: number; running: number; stale: boolean }

const FRESH_SECS = 30   // a worker/stream is considered live if seen within this window

let ready = false
async function ensure() {
  if (ready || schemaManaged) return
  await sql`ALTER TABLE broadcast_stations ADD COLUMN IF NOT EXISTS desired_live BOOLEAN NOT NULL DEFAULT FALSE`
  await sql`
    CREATE TABLE IF NOT EXISTS broadcast_agents (
      worker_id TEXT PRIMARY KEY,
      capacity  INT NOT NULL DEFAULT 1,
      note      TEXT NOT NULL DEFAULT '',
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  await sql`
    CREATE TABLE IF NOT EXISTS broadcast_status (
      slug       TEXT PRIMARY KEY,
      worker_id  TEXT,
      status     TEXT NOT NULL DEFAULT 'offline',
      fps        REAL,
      error      TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  ready = true
}

/** Admin: mark a broadcast as should-be-live (or not). Agents pick it up on their next sync. */
export async function setDesiredLive(slug: string, live: boolean): Promise<void> {
  await ensure()
  await sql`UPDATE broadcast_stations SET desired_live = ${live}, updated_at = NOW() WHERE slug = ${slug}`
  if (!live) await sql`UPDATE broadcast_status SET status = 'offline', worker_id = NULL, updated_at = NOW() WHERE slug = ${slug}`
}

/** A worker agent checks in: record its heartbeat + the status of what it's running, then return the
 *  set of slugs THIS worker should be running (sticky: keep what it already owns, take free ones up to
 *  capacity). This one call is the whole agent↔control-plane protocol. */
export async function agentSync(workerId: string, capacity: number, reports: AgentReport[]): Promise<{ assignments: Assignment[] }> {
  await ensure()
  await sql`
    INSERT INTO broadcast_agents (worker_id, capacity, last_seen) VALUES (${workerId}, ${capacity}, NOW())
    ON CONFLICT (worker_id) DO UPDATE SET capacity = EXCLUDED.capacity, last_seen = NOW()`
  for (const r of reports) {
    await sql`
      INSERT INTO broadcast_status (slug, worker_id, status, fps, error, updated_at)
      VALUES (${r.slug}, ${workerId}, ${r.status}, ${r.fps ?? null}, ${r.error ?? null}, NOW())
      ON CONFLICT (slug) DO UPDATE SET worker_id = ${workerId}, status = EXCLUDED.status, fps = EXCLUDED.fps, error = EXCLUDED.error, updated_at = NOW()`
  }
  // Desired-live + enabled broadcasts are the work to be done.
  const desired = (await sql`SELECT slug FROM broadcast_stations WHERE enabled AND desired_live`).map(r => String(r.slug))
  if (!desired.length) return { assignments: [] }
  // Which desired slugs are currently owned by a FRESH worker (someone actively running them)?
  const owners = await sql`
    SELECT slug, worker_id FROM broadcast_status
    WHERE slug = ANY(${desired}) AND status <> 'offline' AND updated_at > NOW() - (${FRESH_SECS} || ' seconds')::interval`
  const ownedByMe = new Set<string>(), ownedByOther = new Set<string>()
  for (const o of owners) { if (String(o.worker_id) === workerId) ownedByMe.add(String(o.slug)); else ownedByOther.add(String(o.slug)) }
  const keep = desired.filter(s => ownedByMe.has(s))
  const free = desired.filter(s => !ownedByMe.has(s) && !ownedByOther.has(s))
  const take = free.slice(0, Math.max(0, capacity - keep.length))
  const slugs = [...keep, ...take]
  if (!slugs.length) return { assignments: [] }
  // Hand the worker each channel's stream key + ingest URL so it needs no local key config. (This
  // endpoint is token-gated; the key never leaves via a public route.)
  const cfgs = await sql`SELECT slug, config->>'streamKey' AS key, config->>'rtmpUrl' AS rtmp FROM broadcast_stations WHERE slug = ANY(${slugs})`
  const byId = new Map(cfgs.map(c => [String(c.slug), { key: c.key ? String(c.key) : '', rtmp: c.rtmp ? String(c.rtmp) : '' }]))
  return { assignments: slugs.map(s => ({ slug: s, streamKey: byId.get(s)?.key || '', rtmpUrl: byId.get(s)?.rtmp || '' })) }
}

/** Dashboard: every broadcast with its desired + reported runtime state. */
export async function listRuntime(): Promise<RuntimeRow[]> {
  await ensure()
  const rows = await sql`
    SELECT s.slug, s.config->>'title' AS title, s.config->>'channel' AS channel, s.enabled, s.desired_live,
           st.status, st.worker_id, st.fps, st.error, st.updated_at,
           (st.updated_at IS NULL OR st.updated_at < NOW() - (${FRESH_SECS} || ' seconds')::interval) AS stale
    FROM broadcast_stations s
    LEFT JOIN broadcast_status st ON st.slug = s.slug
    ORDER BY s.sort, s.slug`
  return rows.map(r => ({
    slug: String(r.slug), title: String(r.title ?? r.slug), channel: r.channel ? String(r.channel) : null, enabled: r.enabled !== false, desiredLive: r.desired_live === true,
    status: (r.stale ? 'offline' : (r.status as StreamStatus)) ?? 'offline',
    workerId: r.stale ? null : (r.worker_id ? String(r.worker_id) : null),
    fps: r.stale || r.fps == null ? null : Number(r.fps),
    error: r.stale ? null : (r.error ? String(r.error) : null),
    lastHeartbeat: r.updated_at ? String(r.updated_at) : null, stale: r.stale === true,
  }))
}

/** Dashboard: connected worker agents. */
export async function listAgents(): Promise<AgentRow[]> {
  await ensure()
  const rows = await sql`
    SELECT a.worker_id, a.capacity, a.last_seen,
           (SELECT COUNT(*)::int FROM broadcast_status st WHERE st.worker_id = a.worker_id AND st.status <> 'offline' AND st.updated_at > NOW() - (${FRESH_SECS} || ' seconds')::interval) AS running,
           (a.last_seen < NOW() - (${FRESH_SECS} || ' seconds')::interval) AS stale
    FROM broadcast_agents a ORDER BY a.last_seen DESC`
  return rows.map(r => ({ workerId: String(r.worker_id), lastSeen: String(r.last_seen), capacity: Number(r.capacity ?? 1), running: Number(r.running ?? 0), stale: r.stale === true }))
}
