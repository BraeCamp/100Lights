import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { listObjects } from '@/lib/r2'
import { getProPrice } from '@/lib/stripe'
import { clerkClient } from '@clerk/nextjs/server'

export const runtime = 'nodejs'
export const maxDuration = 20

// GET /api/admin/status — a live health probe of the services 100Lights runs on,
// each with latency, so "is anything broken?" is one glance. Lazy (on open).
export async function GET() {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })

  const check = async (name: string, fn: () => Promise<unknown>) => {
    const t = Date.now()
    try { await fn(); return { name, ok: true, ms: Date.now() - t, error: null as string | null } }
    catch (e) { return { name, ok: false, ms: Date.now() - t, error: (e instanceof Error ? e.message : 'unknown').slice(0, 140) } }
  }

  const services = await Promise.all([
    check('Database · Neon', async () => { await sql`SELECT 1` }),
    check('Object storage · R2', async () => { await listObjects('catalog/', 1) }),
    check('Billing · Stripe', async () => { await getProPrice('monthly') }),
    check('Auth · Clerk', async () => { await (await clerkClient()).users.getUserList({ limit: 1 }) }),
  ])

  return Response.json({ services, checkedAt: new Date().toISOString(), allOk: services.every(s => s.ok) })
}
