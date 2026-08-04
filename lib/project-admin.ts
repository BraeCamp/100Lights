import { sql } from './db'
import { isAudioClip, type DawProject } from './daw-types'

// ── Project-admin overlay ────────────────────────────────────────────────────
// The music-admin layer for a project (the "/lab" Project Hub). Tier-1 documents
// — split sheet, credits, metadata sheet, sample-usage/clearance, proof-of-creation
// — are AUTO-GENERATED from the project's own data (that's the wedge: 100Lights
// owns the creation, so the paperwork writes itself). This module holds:
//   • the pure generators (project data → documents), and
//   • a JSONB overlay table for user EDITS on top of the auto-generated defaults
//     (adjusted split %, genre/mood, ISRC, release status) + future Tier 2/3.

let ready = false
export async function ensureProjectAdminSchema(): Promise<void> {
  if (ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS project_admin (
      project_id TEXT PRIMARY KEY,
      data       JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  ready = true
}

/** User edits layered over the auto-generated Tier-1 docs (+ Tier 2/3 scaffold). */
export interface ProjectAdmin {
  /** Split-sheet overrides: name → percent. Missing → equal auto-split. */
  splitOverrides?: Record<string, number>
  metadata?: { genre?: string; mood?: string; isrc?: string; upc?: string; releaseDate?: string; notes?: string }
  release?: { status?: 'draft' | 'ready' | 'scheduled' | 'released'; distributor?: string; coverUrl?: string }
  clearances?: Record<string, 'owned' | 'cleared' | 'needs-clearance'> // clipId → status override
  updatedAt?: string
}

export async function getProjectAdmin(projectId: string): Promise<ProjectAdmin> {
  await ensureProjectAdminSchema()
  try {
    const rows = await sql`SELECT data FROM project_admin WHERE project_id = ${projectId}`
    return (rows[0]?.data as ProjectAdmin) ?? {}
  } catch {
    return {}
  }
}

export async function saveProjectAdmin(projectId: string, data: ProjectAdmin): Promise<void> {
  await ensureProjectAdminSchema()
  const payload = JSON.stringify({ ...data, updatedAt: new Date().toISOString() })
  await sql`
    INSERT INTO project_admin (project_id, data) VALUES (${projectId}, ${payload}::jsonb)
    ON CONFLICT (project_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`
}

// ── Pure generators ──────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export interface Contributor { userId?: string; email?: string; name: string; role: 'owner' | 'edit' | 'view' }

export interface SongMetadata {
  title: string
  bpm: number
  keyLabel: string
  timeSignature: string
  durationSec: number
  trackCount: number
  clipCount: number
  instruments: string[]
}

export function songMetadata(daw: DawProject): SongMetadata {
  const endBeat = daw.arrangementClips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 0)
  const durationSec = daw.tempo > 0 ? (endBeat * 60) / daw.tempo : 0
  const instruments = [...new Set(
    daw.tracks.filter(t => t.kind !== 'group').map(t => t.instrument?.type).filter(t => !!t && t !== 'none'),
  )] as string[]
  return {
    title: daw.name || 'Untitled',
    bpm: Math.round(daw.tempo),
    keyLabel: `${NOTE_NAMES[((daw.key % 12) + 12) % 12] ?? 'C'} ${daw.scale || 'major'}`,
    timeSignature: `${daw.timeSignatureNum}/${daw.timeSignatureDen}`,
    durationSec,
    trackCount: daw.tracks.filter(t => t.kind !== 'group').length,
    clipCount: daw.arrangementClips.length,
    instruments,
  }
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export interface SplitRow { name: string; role: string; pct: number }

/** Default split sheet: an equal share among the writers (owner + editors; view-only
 *  collaborators aren't credited as writers). Overrides from the admin overlay win. */
export function splitSheet(contributors: Contributor[], overrides?: Record<string, number>): SplitRow[] {
  const writers = contributors.filter(c => c.role === 'owner' || c.role === 'edit')
  const base = writers.length ? writers : contributors.slice(0, 1)
  const equal = base.length ? 100 / base.length : 100
  const rows = base.map(c => ({
    name: c.name,
    role: c.role === 'owner' ? 'Writer / Owner' : 'Writer',
    pct: overrides?.[c.name] ?? Math.round(equal * 10) / 10,
  }))
  return rows
}

export interface CreditLine { role: string; who: string }

/** Liner-notes credits, assembled from the project: performers/producers from the
 *  contributors, plus any community samples (credited to their original author). */
export function credits(contributors: Contributor[], sampleAuthors: string[]): CreditLine[] {
  const out: CreditLine[] = []
  const owner = contributors.find(c => c.role === 'owner')
  if (owner) out.push({ role: 'Written & produced by', who: owner.name })
  const others = contributors.filter(c => c.role === 'edit')
  if (others.length) out.push({ role: 'Additional production', who: others.map(c => c.name).join(', ') })
  const uniqAuthors = [...new Set(sampleAuthors.filter(Boolean))]
  if (uniqAuthors.length) out.push({ role: 'Contains samples by', who: uniqAuthors.join(', ') })
  out.push({ role: 'Made with', who: '100Lights' })
  return out
}

export interface SampleUse {
  clipId: string
  clipName: string
  source: 'recording' | 'community' | 'library'
  author?: string
  communityItemId?: string
  clearance: 'owned' | 'community' | 'needs-clearance'
}

/** Every sampled sound in the project + its clearance status. UNIQUELY possible
 *  because we own both the project and the sample library: community samples are
 *  flagged with their source item + author so they can be cleared/attributed. */
export function sampleUsage(daw: DawProject, communityAuthorsByItem: Map<string, string>): SampleUse[] {
  const out: SampleUse[] = []
  const seen = new Set<string>()
  for (const c of daw.arrangementClips) {
    if (!isAudioClip(c)) continue
    const lib = c.libraryId ?? ''
    const communityItemId = lib.startsWith('community:') ? lib.split(':')[1] : undefined
    const key = communityItemId ?? lib ?? c.name
    if (seen.has(key)) continue
    seen.add(key)
    if (communityItemId) {
      out.push({
        clipId: c.id, clipName: c.name, source: 'community', communityItemId,
        author: communityAuthorsByItem.get(communityItemId),
        clearance: 'community', // shared under the community terms — attribute the author
      })
    } else if (lib) {
      out.push({ clipId: c.id, clipName: c.name, source: 'library', clearance: 'owned' })
    } else {
      // A recording / imported file with no library origin → the user's own audio.
      out.push({ clipId: c.id, clipName: c.name, source: 'recording', clearance: 'owned' })
    }
  }
  return out
}

export interface TimelineEvent { at: string | null; label: string; kind: 'created' | 'comment' | 'saved' | 'member' | 'build' }

/** A dated provenance timeline (proof-of-creation). Real timestamps come from
 *  per-clip createdAt, timeline comments, the members list, and the save time;
 *  the ordered build-log (daw.history) contributes a step count. */
// DB TIMESTAMPTZ columns arrive as Date objects, JSONB times as ISO strings —
// normalize everything to an ISO string (or null) so sorting/rendering is uniform.
function iso(x: unknown): string | null {
  if (!x) return null
  try { return new Date(x as string | number | Date).toISOString() } catch { return null }
}

export function provenanceTimeline(
  daw: DawProject,
  savedAt: unknown,
  members: Array<{ name: string; at: unknown }>,
): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const clipTimes = daw.arrangementClips.map(c => iso(c.createdAt)).filter((t): t is string => !!t).sort()
  if (clipTimes.length) events.push({ at: clipTimes[0], label: `First element added (${clipTimes.length} timestamped)`, kind: 'created' })
  for (const c of daw.comments ?? []) events.push({ at: iso(c.createdAt), label: `Comment by ${c.author}`, kind: 'comment' })
  for (const m of members) events.push({ at: iso(m.at), label: `${m.name} joined the project`, kind: 'member' })
  if (daw.history?.length) events.push({ at: null, label: `${daw.history.length} recorded build steps`, kind: 'build' })
  if (savedAt) events.push({ at: iso(savedAt), label: 'Last saved', kind: 'saved' })
  return events.sort((a, b) => (a.at ?? '9999').localeCompare(b.at ?? '9999'))
}
