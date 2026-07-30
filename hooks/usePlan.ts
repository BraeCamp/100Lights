'use client'

import { useEffect, useState } from 'react'
import { entitlements, type Plan, type Entitlements } from '@/lib/entitlements'

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
      const plan: Plan = b && b.plan === 'pro' && b.status === 'active' ? 'pro' : 'free'
      _cache = plan
      return plan
    })
    .catch((): Plan => 'free')
    .finally(() => { _inflight = null })
  return _inflight
}

export interface PlanState {
  plan: Plan
  isPro: boolean
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
  return { plan: resolved, isPro: resolved === 'pro', ent: entitlements(resolved), loading: plan === null }
}

/** Call after a plan change (checkout return, code redeem) to force a refetch. */
export function clearPlanCache() { _cache = null }
