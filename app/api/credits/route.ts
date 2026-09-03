import { auth } from '@clerk/nextjs/server'
import { getCredits, ensureOwnerCredits, CREDITS_ENABLED, FREE_TRANSCRIBE_SECONDS } from '@/lib/credits'
import { isOwnerAccount } from '@/lib/subscription'
import { isAdmin } from '@/lib/admin-auth'

/** The host and database name the server is actually connected to — never the
 *  credentials. Parsed defensively: a malformed URL must not take the route
 *  down, since this is a diagnostic hanging off a page people use. */
function dbHost(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? '')
    return u.hostname + u.pathname
  } catch { return '(unset or unparseable)' }
}

// Current AI-credit balance for the signed-in user (shared across every 100Lights app).
// Fails soft to zeros so the UI never crashes. Mirrors app/api/billing/info + app/api/usage.
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  // ⚠️ Before reading, not after: the owner reading 0 in a database that has
  // never seen their grant is the bug being fixed, and the fix has to happen
  // where the number is fetched or the screen still says zero.
  if (await isOwnerAccount(userId)) await ensureOwnerCredits(userId)
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
    // ── Which database is this answer coming from? ────────────────────────
    //
    // The one question left after "is it the right account". A balance granted
    // in one database and read from another is invisible from both ends: the
    // grant succeeds, the read succeeds, and they disagree. Vercel's API
    // returns the value encrypted, so it could not be compared from outside —
    // this asks the running server instead, which is the only place that knows.
    //
    // HOST AND DATABASE NAME ONLY, and only for an admin. Enough to compare
    // against the connection a grant was made on; nothing that could be used to
    // connect.
    ...(await isAdmin() ? { db: dbHost() } : {}),
  })
}
