import { auth } from '@clerk/nextjs/server'
import { getCredits, CREDITS_ENABLED, FREE_TRANSCRIBE_SECONDS } from '@/lib/credits'

// Current AI-credit balance for the signed-in user (shared across every 100Lights app).
// Fails soft to zeros so the UI never crashes. Mirrors app/api/billing/info + app/api/usage.
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const c = await getCredits(userId)
  return Response.json({
    balance: c.balance,
    monthlyGrant: c.monthlyGrant,
    freeTranscribeUsed: c.freeTranscribeUsed,
    freeTranscribeSeconds: FREE_TRANSCRIBE_SECONDS,
    metered: CREDITS_ENABLED,   // false = nothing is billed yet (everything works free)
  })
}
