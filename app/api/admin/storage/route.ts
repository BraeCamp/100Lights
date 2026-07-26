import { isAdmin } from '@/lib/admin-auth'
import { listAllObjects } from '@/lib/r2'

export const runtime = 'nodejs'
export const maxDuration = 30

// GET /api/admin/storage — R2 usage broken down by category, plus the biggest
// objects, so storage cost is visible. Enumerates the whole bucket, so it's a
// lazy panel (only runs when the Storage tab is opened), not on every load.
const CATS: [string, string][] = [
  ['learn-audio/', 'Article audio'],
  ['learn-media/', 'Article images & video'],
  ['catalog/', 'Sound catalog'],
]

export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  try {
    const all = await listAllObjects('')
    const groups: Record<string, { count: number; bytes: number }> = { 'User content': { count: 0, bytes: 0 } }
    for (const [, label] of CATS) groups[label] = { count: 0, bytes: 0 }
    let total = 0
    for (const o of all) {
      total += o.size
      const hit = CATS.find(([p]) => o.key.startsWith(p))
      const label = hit ? hit[1] : 'User content'
      groups[label].count++
      groups[label].bytes += o.size
    }
    const largest = [...all].sort((a, b) => b.size - a.size).slice(0, 12).map(o => ({ key: o.key, size: o.size }))
    return Response.json({ total, count: all.length, groups, largest })
  } catch (e) {
    return Response.json({ error: `R2 unavailable: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }
}
