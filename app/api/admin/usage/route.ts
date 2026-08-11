import { isAdmin } from '@/lib/admin-auth'
import { usageByUser, usageTotals, usageByProviderUnit, usageRecent } from '@/lib/api-usage'
import { clerkClient } from '@clerk/nextjs/server'

export const runtime = 'nodejs'
export const maxDuration = 20

// GET /api/admin/usage — the cross-provider spend ledger (api_usage), surfaced for
// the admin panel: totals per provider, per-user attribution (with emails), a
// provider×operation×unit breakdown (so exact ElevenLabs credits read distinctly
// from the seconds proxy), and a recent raw feed. Read-only; computed on open.
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })

  const [byUser, totals, byUnit, recent] = await Promise.all([
    usageByUser(), usageTotals(), usageByProviderUnit(), usageRecent(60),
  ])

  // Resolve emails for the per-user rows (null user_id = local/script usage).
  const ids = [...new Set(byUser.map(r => r.user_id).filter(Boolean))] as string[]
  let emails = new Map<string, string>()
  if (ids.length) {
    try {
      const c = await clerkClient()
      emails = new Map((await c.users.getUserList({ userId: ids, limit: 100 })).data
        .map(u => [u.id, u.emailAddresses[0]?.emailAddress ?? '']))
    } catch { /* Clerk down — show raw ids */ }
  }
  const byUserEmail = byUser.map(r => ({
    ...r,
    email: r.user_id ? (emails.get(String(r.user_id)) || '') : '(local / script)',
  }))

  return Response.json({ byUser: byUserEmail, totals, byUnit, recent, at: new Date().toISOString() })
}
