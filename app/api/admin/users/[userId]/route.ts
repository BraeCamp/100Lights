import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { clerkClient } from '@clerk/nextjs/server'
import { logAdmin } from '@/lib/admin-audit'
import { buildTimeline, listNoteEntries } from '@/lib/user-crm'
import { stageOf, healthOf } from '@/lib/lifecycle'
import { emailEnabled } from '@/lib/email'

export const runtime = 'nodejs'

// Human-readable signup method from a Clerk user's connected accounts.
function signupMethod(u: { externalAccounts?: { provider?: string }[]; passwordEnabled?: boolean }): string {
  const prov = u.externalAccounts?.[0]?.provider
  if (prov) return prov.replace(/^oauth_/, '').replace(/\b\w/g, c => c.toUpperCase())
  return u.passwordEnabled ? 'Email + password' : 'Email link'
}

// The sql tag returns a composable thenable (no `.catch`), so guard optional
// queries — a table that doesn't exist yet shouldn't 500 the whole endpoint.
async function safe<T = Record<string, unknown>>(p: Promise<unknown>, fallback: T[]): Promise<T[]> {
  try { return (await p) as T[] } catch { return fallback }
}

// Admin CRM notes/tags — institutional memory that travels with an account,
// separate from anything the user sees.
let notesReady = false
async function ensureNotes() {
  if (notesReady) return
  await sql`CREATE TABLE IF NOT EXISTS user_notes (user_id TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', tags JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  notesReady = true
}

// GET /api/admin/users/[userId] — everything about one account, so "why does
// this person have Pro / how much have they built" is answerable in one place.
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { userId } = await params
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })

  const [subRows, redemptions, projects, community, identity, noteRows, timeline, noteEntries] = await Promise.all([
    safe(sql`SELECT plan, status, stripe_customer_id, stripe_sub_id, current_period_end, gift_plan, gift_until, updated_at, created_at
        FROM subscriptions WHERE user_id = ${userId}`, []),
    safe(sql`SELECT code, kind, grant_days, grant_until, redeemed_at FROM code_redemptions WHERE user_id = ${userId} ORDER BY redeemed_at DESC`, []),
    safe<{ n: number; last_saved: string | null }>(sql`SELECT COUNT(*)::int AS n, MAX(saved_at) AS last_saved FROM projects WHERE user_id = ${userId} AND deleted_at IS NULL`, [{ n: 0, last_saved: null }]),
    safe<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM community_items WHERE user_id = ${userId} AND removed_at IS NULL`, [{ n: 0 }]),
    // Richer Clerk identity — name, avatar, last sign-in, how they signed up.
    (async () => {
      try {
        const u = await (await clerkClient()).users.getUser(userId)
        return {
          email: u.emailAddresses?.[0]?.emailAddress ?? '',
          firstName: u.firstName ?? '', lastName: u.lastName ?? '',
          imageUrl: u.imageUrl ?? '',
          lastSignInAt: u.lastSignInAt ?? null,
          clerkCreatedAt: u.createdAt ?? null,
          signupMethod: signupMethod(u),
        }
      } catch { return null }
    })(),
    (async () => { await ensureNotes(); return safe(sql`SELECT note, tags FROM user_notes WHERE user_id = ${userId}`, []) })(),
    buildTimeline(userId),
    listNoteEntries(userId),
  ])
  const email = identity?.email ?? ''

  const s = subRows[0] as Record<string, unknown> | undefined
  const now = new Date()
  const codeUntil = (redemptions as Record<string, unknown>[])
    .map(r => new Date(String(r.grant_until)))
    .filter(d => d > now)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null

  // "At risk" explanation — mirrors the atrisk segment predicate (a Pro account
  // that's gone quiet) plus payment/dunning risk, and puts the *reason* in
  // words so the admin doesn't have to reverse-engineer the flag.
  const lastSavedRaw = (projects as { last_saved: string | null }[])[0]?.last_saved ?? null
  const lastSaved = lastSavedRaw ? new Date(lastSavedRaw) : null
  const giftPlanVal = s?.gift_plan ? String(s.gift_plan) : null
  const giftUntilVal = s?.gift_until ? new Date(String(s.gift_until)) : null
  const paying = !!s && String(s.plan) === 'pro' && String(s.status) === 'active' && !!s.stripe_sub_id
  const gifted = giftPlanVal === 'pro' && (giftUntilVal === null || giftUntilVal > now)
  const coded = !!codeUntil
  const hasPro = paying || gifted || coded
  const status = s ? String(s.status) : 'none'
  const paymentRisk = !!s && !!s.stripe_sub_id && status !== 'active' && status !== 'trialing' && status !== 'none'
  const daysSinceSave = lastSaved ? Math.floor((now.getTime() - lastSaved.getTime()) / 86_400_000) : null
  const engagementRisk = hasPro && (lastSaved === null || (daysSinceSave ?? 0) >= 30)

  const source = paying ? 'a paying subscription' : gifted ? 'an admin gift' : coded ? 'a redeemed code' : 'Pro'
  const reasons: string[] = []
  if (paymentRisk) reasons.push(`Their Stripe subscription is "${status}" — the payment is failing or the plan is lapsing.`)
  if (engagementRisk) {
    reasons.push(lastSaved === null
      ? `They have Pro (${source}) but have never saved a project — they aren't using what they're paying for.`
      : `They have Pro (${source}) but haven't saved a project in ${daysSinceSave} days (last on ${lastSaved.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}) — likely to churn.`)
  }
  const risk = { atRisk: reasons.length > 0, reasons, lastSaved: lastSaved?.toISOString() ?? null, daysSinceSave }

  // Lifecycle stage + 0–100 health score for this account.
  const createdAt = s?.created_at ? new Date(String(s.created_at)) : null
  const facts = {
    paying, gifted, coded,
    hasStripeSub: !!s?.stripe_sub_id,
    statusHealthy: status === 'active' || status === 'trialing' || status === 'none',
    projectCount: Number((projects as { n: number }[])[0]?.n ?? 0),
    lastSavedDays: daysSinceSave,
    signupDays: createdAt ? Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000) : 0,
    communityCount: Number((community as { n: number }[])[0]?.n ?? 0),
  }
  const lifecycle = { stage: stageOf(facts), health: healthOf(facts) }

  return Response.json({
    risk,
    lifecycle,
    emailConfigured: emailEnabled(),
    userId,
    email,
    identity: identity ? {
      firstName: identity.firstName, lastName: identity.lastName, imageUrl: identity.imageUrl,
      lastSignInAt: identity.lastSignInAt ? new Date(identity.lastSignInAt).toISOString() : null,
      clerkCreatedAt: identity.clerkCreatedAt ? new Date(identity.clerkCreatedAt).toISOString() : null,
      signupMethod: identity.signupMethod,
    } : null,
    timeline,
    noteEntries,
    hasRecord: !!s,
    subscription: s ? {
      plan: String(s.plan), status: String(s.status),
      stripeCustomerId: s.stripe_customer_id ? String(s.stripe_customer_id) : null,
      stripeSubId: s.stripe_sub_id ? String(s.stripe_sub_id) : null,
      currentPeriodEnd: s.current_period_end ? String(s.current_period_end) : null,
      giftPlan: s.gift_plan ? String(s.gift_plan) : null,
      giftUntil: s.gift_until ? String(s.gift_until) : null,
      createdAt: s.created_at ? String(s.created_at) : null,
      updatedAt: s.updated_at ? String(s.updated_at) : null,
    } : null,
    codeUntil: codeUntil?.toISOString() ?? null,
    redemptions: (redemptions as Record<string, unknown>[]).map(r => ({
      code: String(r.code), kind: String(r.kind), grantDays: Number(r.grant_days),
      grantUntil: String(r.grant_until), redeemedAt: String(r.redeemed_at),
    })),
    projectCount: Number((projects as { n: number }[])[0]?.n ?? 0),
    communityCount: Number((community as { n: number }[])[0]?.n ?? 0),
    note: noteRows[0] ? String((noteRows[0] as Record<string, unknown>).note ?? '') : '',
    tags: (noteRows[0] as Record<string, unknown> | undefined)?.tags as string[] ?? [],
  })
}

// PATCH /api/admin/users/[userId] — save admin CRM notes + tags for the account.
export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { userId } = await params
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })
  const b = await req.json().catch(() => ({})) as { note?: string; tags?: string[] }
  const note = (b.note ?? '').slice(0, 4000)
  const tags = Array.isArray(b.tags) ? b.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 20) : []
  await ensureNotes()
  await sql`
    INSERT INTO user_notes (user_id, note, tags, updated_at)
    VALUES (${userId}, ${note}, ${tags.length ? JSON.stringify(tags) : null}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET note = EXCLUDED.note, tags = EXCLUDED.tags, updated_at = NOW()`
  await logAdmin('user.note', userId, { tags })
  return Response.json({ ok: true })
}
