import { isAudioClip, type DawProject } from './daw-types'

// ── Project-admin overlay ────────────────────────────────────────────────────
// The music-admin layer for a project (the "/lab" Project Hub). Tier-1 documents
// — split sheet, credits, metadata sheet, sample-usage/clearance, proof-of-creation
// — are AUTO-GENERATED from the project's own data (that's the wedge: 100Lights
// owns the creation, so the paperwork writes itself). This module is PURE (no db
// import) so both the server hub and the client UI can share the generators; the
// JSONB persistence lives in ./project-admin-store (server-only).
//   Tier 1 = the auto-generated docs. Tier 2 (Release) + Tier 3 (Money) layer on
//   top: readiness checklist, ISRC/UPC + e-sign, distribution package; income
//   ledger, split payouts, invoicing, tax summary.

/** User edits layered over the auto-generated Tier-1 docs (+ Tier 2/3 data). */
export interface ProjectAdmin {
  /** Split-sheet overrides: name → percent. Missing → equal auto-split. */
  splitOverrides?: Record<string, number>
  metadata?: { genre?: string; mood?: string; isrc?: string; upc?: string; releaseDate?: string; notes?: string }
  /** Tier 2 — Release. status/date/distributor/cover + per-contributor split sign-off. */
  release?: {
    status?: 'draft' | 'ready' | 'scheduled' | 'released'
    date?: string
    distributor?: string
    coverUrl?: string
    /** Split-sheet sign-off: contributor name → ISO time they approved. */
    signatures?: Record<string, string>
    /** Registrant prefix for minting ISRCs, e.g. "US-ABC" + running counter. */
    isrcPrefix?: string
  }
  /** Tier 3 — Money. Income ledger + freelance invoices for this project. */
  income?: IncomeEntry[]
  invoices?: Invoice[]
  clearances?: Record<string, 'owned' | 'cleared' | 'needs-clearance'> // clipId → status override
  updatedAt?: string
}

export interface IncomeEntry {
  id: string
  source: string       // e.g. "Spotify", "Sync — Netflix", "Bandcamp"
  amount: number       // gross, in whole currency units
  date: string         // ISO date
  note?: string
  /** true once this income has been distributed to collaborators per the splits. */
  paidOut?: boolean
}

export interface Invoice {
  id: string
  client: string
  items: Array<{ desc: string; amount: number }>
  date: string
  dueDate?: string
  status: 'draft' | 'sent' | 'paid'
  notes?: string
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
// ── Tier 2 · Release ─────────────────────────────────────────────────────────

/** An ISRC is CC-XXX-YY-NNNNN (country, registrant, year, designation). Accept it
 *  with or without the separating dashes. */
export function isValidIsrc(s?: string): boolean {
  return !!s && /^[A-Za-z]{2}-?[A-Za-z0-9]{3}-?\d{2}-?\d{5}$/.test(s.trim())
}

export interface ChecklistItem { key: string; label: string; done: boolean; hint?: string }

// ── Tier 3 · Money ───────────────────────────────────────────────────────────

export interface PayoutRow { name: string; pct: number; owed: number; paid: number; outstanding: number }
export interface PayoutBreakdown { gross: number; distributed: number; undistributed: number; rows: PayoutRow[] }
