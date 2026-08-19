import { auth } from '@clerk/nextjs/server'
import { getUserEntitlements } from '@/lib/user-entitlements'

export const runtime = 'nodejs'

// GET /api/entitlements — the unified "what do I own?" answer: membership plan
// (+ redemption codes), per-module licenses, and the Lumens balance. Signed-out
// callers get the free-plan shape so client gates never need a special case.
export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    const { entitlements } = await import('@/lib/entitlements')
    return Response.json({
      plan: 'free', planStatus: 'signed-out', features: entitlements('free'),
      modules: { audio: { owned: true, licenseType: 'free' }, video: { owned: false, licenseType: null }, image: { owned: false, licenseType: null } },
      lumens: { enabled: false, balance: 0, monthlyGrant: 0 },
    })
  }
  // Infinity is not valid JSON — encode as null (client treats null as unlimited)
  const ent = await getUserEntitlements(userId)
  const json = JSON.parse(JSON.stringify(ent, (_k, v) => (v === Infinity ? null : v)))
  return Response.json(json)
}
