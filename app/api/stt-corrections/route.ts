import { auth } from '@clerk/nextjs/server'
import { isAdmin } from '@/lib/admin-auth'
import { recordCorrections, listCorrections, correctionStats, type SttCorrection } from '@/lib/stt-corrections'

export const runtime = 'nodejs'

// POST: record caption confirmations/corrections (the "it's right" / "I fixed it" signal). Open to any
// signed-in or anonymous user — it's low-value feedback data, and it fails soft. GET: admin-only review
// + calibration stats.
export async function POST(req: Request) {
  const { userId } = await auth()
  let body: { records?: SttCorrection[] }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const records = (body.records ?? []).filter(r => r && r.id && (r.original || r.final)).slice(0, 500)
  if (!records.length) return Response.json({ error: 'No records' }, { status: 400 })
  const saved = await recordCorrections(records, userId)
  return Response.json({ saved })
}

export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json({ stats: await correctionStats(), corrections: await listCorrections() })
}
