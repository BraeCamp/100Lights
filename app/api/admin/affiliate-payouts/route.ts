import { isAdmin } from '@/lib/admin-auth'
import { payAllOwedViaConnect } from '@/lib/affiliate-payouts'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// POST /api/admin/affiliate-payouts — pay every affiliate with a positive
// balance and a ready Connect account, in one batch. Returns paid + skipped.
export async function POST() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const result = await payAllOwedViaConnect()
  await logAdmin('affiliate.payout_batch', null, { count: result.paid.length, total: result.totalPaid })
  return Response.json(result)
}
