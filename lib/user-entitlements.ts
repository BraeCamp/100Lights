// Unified entitlements resolver — the ONE place that answers "what does this
// user own?" across every product: membership plan (subscription + redemption
// codes, via getSubscription), per-module licenses (module_licenses), and the
// Lumens balance (AI credits). Server-only (DB access); the client reads it
// through GET /api/entitlements or the useEntitlements hook.

import { sql } from './db'
import { getSubscription } from './subscription'
import { entitlements, isPaid, type Entitlements, type Plan } from './entitlements'
import { ALL_MODULE_KEYS, type ModuleKey } from './editor-types'
import { CREDITS_ENABLED } from './credits'

export interface ModuleLicense {
  owned: boolean
  /** 'free' (audio is always free) | 'purchased' | 'bundle' (via Pro) | null */
  licenseType: string | null
}

export interface UserEntitlements {
  plan: Plan
  planStatus: string
  features: Entitlements
  modules: Record<ModuleKey, ModuleLicense>
  lumens: { enabled: boolean; balance: number; monthlyGrant: number }
}

export async function getUserEntitlements(userId: string): Promise<UserEntitlements> {
  const sub = await getSubscription(userId)
  // Any paid tier, not pro exactly — see isPaid()'s note.
  const isPro = isPaid(sub.plan) && sub.status === 'active'

  // Module licenses (same semantics as /api/modules/licenses: audio is free
  // for everyone; Pro bundles everything; otherwise per-module purchases).
  let ownedRows: { module_key: string; license_type: string }[] = []
  try {
    ownedRows = await sql`SELECT module_key, license_type FROM module_licenses WHERE user_id = ${userId}` as typeof ownedRows
  } catch { /* table absent in fresh envs — no purchases yet */ }
  const modules = Object.fromEntries(ALL_MODULE_KEYS.map((key: ModuleKey) => {
    const isAudio = key === 'audio'
    const row = ownedRows.find(r => r.module_key === key)
    const owned = isAudio || isPro || !!row
    const licenseType = isAudio ? 'free' : isPro ? 'bundle' : row ? row.license_type : null
    return [key, { owned, licenseType }]
  })) as Record<ModuleKey, ModuleLicense>

  // Lumens balance (0 until the credits system is switched on)
  let balance = 0
  let monthlyGrant = 0
  if (CREDITS_ENABLED) {
    try {
      const rows = await sql`SELECT balance, monthly_grant FROM user_credits WHERE user_id = ${userId}`
      balance = (rows[0]?.balance as number | undefined) ?? 0
      monthlyGrant = (rows[0]?.monthly_grant as number | undefined) ?? 0
    } catch { /* credits table absent */ }
  }

  return {
    plan: sub.plan,
    planStatus: sub.status,
    features: entitlements(sub.plan),
    modules,
    lumens: { enabled: CREDITS_ENABLED, balance, monthlyGrant },
  }
}
