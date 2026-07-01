import { isAdmin } from '@/lib/admin-auth'
import { setFlags, getFlags } from '@/lib/platform-flags'

export const runtime = 'nodejs'

export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  return Response.json(await getFlags())
}

export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const body = await req.json().catch(() => ({}))
  await setFlags(body)
  return Response.json({ ok: true })
}
