'use client'

import { useEffect, useState } from 'react'
import { entitlements, isPaid, atLeast, type Plan, type Entitlements } from '@/lib/entitlements'

// Shared client-side plan detection. One fetch, module-cached + de-duped, so
// every gate on a page reads the same answer without N requests. Replaces the
// per-component copies of this logic (FeedCard's useIsPro, Sidebar's fetch…).

let _cache: Plan | null = null
let _inflight: Promise<Plan> | null = null

async function fetchPlan(): Promise<Plan> {
  if (_cache) return _cache
  if (_inflight) return _inflight
  _inflight = fetch('/api/billing/info')
    .then(r => (r.ok ? r.json() : null))
    .then((b: { plan?: string; status?: string } | null): Plan => {
      // The plan the server reports, not a yes/no. This used to collapse to
      // `b.plan === 'pro' ? 'pro' : 'free'`, which meant every Studio and Max
      // subscriber was reported FREE by the one hook seven studio components
      // use to decide what someone has paid for — the exact mistake
      // lib/entitlements.ts warns about, in the hook written to prevent it. It
      // survived because the guard walked lib, app and components, and this
      // lives in hooks.
      const named = String(b?.plan ?? 'free') as Plan
      const known: Plan[] = ['free', 'pro', 'studio', 'max']
      const plan: Plan = b?.status === 'active' && known.includes(named) ? named : 'free'
      _cache = plan
      return plan
    })
    .catch((): Plan => 'free')
    .finally(() => { _inflight = null })
  return _inflight
}

export interface PlanState {
  plan: Plan
  /** Is this a paying customer? True for pro, studio and max — the name is kept
   *  because seven components read it, but it no longer means "exactly pro". */
  isPro: boolean
  /** Does the plan reach at least this tier? For anything gated above pro. */
  atLeast: (needed: Plan) => boolean
  ent: Entitlements
  loading: boolean
}

export function usePlan(): PlanState {
  const [plan, setPlan] = useState<Plan | null>(_cache)

  useEffect(() => {
    let alive = true
    void fetchPlan().then(p => { if (alive) setPlan(p) })
    return () => { alive = false }
  }, [])

  const resolved = plan ?? 'free'
  return {
    plan: resolved,
    isPro: isPaid(resolved),
    atLeast: (needed: Plan) => atLeast(resolved, needed),
    ent: entitlements(resolved),
    loading: plan === null,
  }
}

/** Call after a plan change (checkout return, code redeem) to force a refetch. */
export function clearPlanCache() { _cache = null }
