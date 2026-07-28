import { auth, clerkClient } from '@clerk/nextjs/server'

export const runtime = 'nodejs'

// POST /api/account/delete — self-serve account deletion. Deleting the Clerk
// user fires the `user.deleted` webhook (handleClerkEvent), which cancels any
// live Stripe subscription and purges all of the user's data. Requires an
// explicit typed confirmation so it can't fire by accident.
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Not signed in.' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { confirm?: string }
  if (body.confirm !== 'DELETE') {
    return Response.json({ error: 'Type DELETE to confirm.' }, { status: 400 })
  }

  try {
    await (await clerkClient()).users.deleteUser(userId)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Deletion failed — try again.' }, { status: 500 })
  }
}
