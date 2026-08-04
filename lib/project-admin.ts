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

// ── Tier 2 · Release ─────────────────────────────────────────────────────────

/** An ISRC is CC-XXX-YY-NNNNN (country, registrant, year, designation). Accept it
 *  with or without the separating dashes. */
export function isValidIsrc(s?: string): boolean {
  return !!s && /^[A-Za-z]{2}-?[A-Za-z0-9]{3}-?\d{2}-?\d{5}$/.test(s.trim())
}

/** A UPC/EAN is 12–13 digits. */
export function isValidUpc(s?: string): boolean {
  return !!s && /^\d{12,13}$/.test(s.trim())
}

/** Mint a well-formed ISRC from a registrant prefix ("US-ABC" or "USABC") + a
 *  running designation number, stamping the two-digit year of the release. */
export function mintIsrc(prefix: string, designation: number, year: number): string {
  const p = prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase().padEnd(5, 'X').slice(0, 5)
  const cc = p.slice(0, 2)
  const reg = p.slice(2, 5)
  const yy = String(year % 100).padStart(2, '0')
  const nnnnn = String(Math.max(0, Math.min(99999, Math.floor(designation)))).padStart(5, '0')
  return `${cc}-${reg}-${yy}-${nnnnn}`
}

export interface ChecklistItem { key: string; label: string; done: boolean; hint?: string }

/** The release-readiness checklist — everything a distributor needs, computed live
 *  from the auto-generated docs + the overlay so it ticks green as the user fills in. */
export function releaseReadiness(
  meta: SongMetadata,
  splits: SplitRow[],
  overlay: Pick<ProjectAdmin, 'metadata' | 'release'>,
  contributorCount: number,
): ChecklistItem[] {
  const splitTotal = splits.reduce((n, r) => n + (Number(r.pct) || 0), 0)
  const signed = Object.keys(overlay.release?.signatures ?? {}).length
  return [
    { key: 'title', label: 'Title set', done: !!meta.title && meta.title !== 'Untitled' },
    { key: 'genre', label: 'Genre set', done: !!overlay.metadata?.genre, hint: 'Distributors require a primary genre' },
    { key: 'splits', label: 'Splits total 100%', done: Math.abs(splitTotal - 100) < 0.05, hint: `${Math.round(splitTotal * 10) / 10}%` },
    { key: 'signed', label: 'Split sheet approved by all writers', done: contributorCount <= 1 || signed >= splits.length, hint: `${signed}/${splits.length} signed` },
    { key: 'isrc', label: 'ISRC assigned', done: isValidIsrc(overlay.metadata?.isrc) },
    { key: 'cover', label: 'Cover art', done: !!overlay.release?.coverUrl, hint: 'Square, 3000×3000 recommended' },
    { key: 'date', label: 'Release date', done: !!overlay.metadata?.releaseDate },
    { key: 'distributor', label: 'Distributor chosen', done: !!overlay.release?.distributor },
  ]
}

// ── Tier 3 · Money ───────────────────────────────────────────────────────────

export interface PayoutRow { name: string; pct: number; owed: number; paid: number; outstanding: number }
export interface PayoutBreakdown { gross: number; distributed: number; undistributed: number; rows: PayoutRow[] }

/** Given the income ledger and the split sheet, compute what each writer is owed,
 *  what's already been paid out (income marked paidOut), and what's outstanding. */
export function payoutBreakdown(splits: SplitRow[], income: IncomeEntry[]): PayoutBreakdown {
  const gross = income.reduce((n, e) => n + (Number(e.amount) || 0), 0)
  const paid = income.filter(e => e.paidOut).reduce((n, e) => n + (Number(e.amount) || 0), 0)
  const round = (n: number) => Math.round(n * 100) / 100
  const rows: PayoutRow[] = splits.map(s => {
    const frac = (Number(s.pct) || 0) / 100
    const owed = round(gross * frac)
    const already = round(paid * frac)
    return { name: s.name, pct: s.pct, owed, paid: already, outstanding: round(owed - already) }
  })
  return { gross: round(gross), distributed: round(paid), undistributed: round(gross - paid), rows }
}

export function invoiceTotal(inv: Invoice): number {
  return Math.round(inv.items.reduce((n, i) => n + (Number(i.amount) || 0), 0) * 100) / 100
}

/** Year-by-year income summary for tax prep (gross received per calendar year). */
export function taxSummary(income: IncomeEntry[]): Array<{ year: string; gross: number; count: number }> {
  const byYear = new Map<string, { gross: number; count: number }>()
  for (const e of income) {
    const year = (e.date || '').slice(0, 4) || '—'
    const cur = byYear.get(year) ?? { gross: 0, count: 0 }
    cur.gross = Math.round((cur.gross + (Number(e.amount) || 0)) * 100) / 100
    cur.count += 1
    byYear.set(year, cur)
  }
  return [...byYear.entries()].map(([year, v]) => ({ year, ...v })).sort((a, b) => b.year.localeCompare(a.year))
}
