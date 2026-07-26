import { isAdmin } from '@/lib/admin-auth'
import { listSegments, createSegment, segmentCount, type SegmentCriteria } from '@/lib/saved-segments'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// GET /api/admin/segments — saved smart segments, each with a live match count.
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const segments = await listSegments()
  const withCounts = await Promise.all(segments.map(async s => ({ ...s, count: await segmentCount(s.criteria) })))
  return Response.json({ segments: withCounts })
}

// POST /api/admin/segments — save a new segment. Body: { name, criteria }.
// If ?preview=1, don't save — just return the match count for the given criteria.
export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const { name, criteria } = await req.json().catch(() => ({})) as { name?: string; criteria?: SegmentCriteria }
  const crit = criteria ?? {}
  if (new URL(req.url).searchParams.get('preview') === '1') {
    return Response.json({ count: await segmentCount(crit) })
  }
  if (!name?.trim()) return Response.json({ error: 'A name is required' }, { status: 400 })
  const segment = await createSegment(name.trim(), crit)
  await logAdmin('segment.create', String(segment.id), { name: segment.name })
  return Response.json({ segment: { ...segment, count: await segmentCount(segment.criteria) } })
}
