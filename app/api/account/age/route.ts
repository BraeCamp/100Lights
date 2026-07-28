import { auth } from '@clerk/nextjs/server'
import { getAgeStatus, submitAge } from '@/lib/age-gate'

export const runtime = 'nodejs'

// GET /api/account/age — has this user confirmed 13+, and are they blocked?
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ confirmed: true, blocked: false }) // guests aren't gated
  return Response.json(await getAgeStatus(userId))
}

// POST /api/account/age — record the user's birth date. Body: { birthdate }
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Not signed in.' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { birthdate?: string }
  const result = await submitAge(userId, body.birthdate ?? '')
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
  return Response.json({ ok: true, blocked: result.blocked })
}
