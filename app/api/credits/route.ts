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
    // ── Enough to tell the three "out of credits" causes apart ─────────────
    //
    // A balance of 0 has three completely different explanations and they were
    // impossible to distinguish from outside: the account really is empty, the
    // balance could not be read (which used to return 0 and say "out of
    // credits"), or the credits are sitting on a DIFFERENT account from the one
    // signed in — which is easy to do when they were granted by looking a user
    // up by email.
    //
    // The user id is the signed-in user's own, shown to that user only, so
    // opening this page answers "is this the account the credits are on"
    // without anybody having to read a database.
    ok: c.ok,
    userId,
  })
}
