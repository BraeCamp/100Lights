import { cookies } from 'next/headers'
import { setFlags } from '@/lib/platform-flags'
import { getFlags } from '@/lib/platform-flags'

export const runtime = 'nodejs'

async function isAdmin() {
  const jar = await cookies()
  const token = jar.get('admin_auth')?.value
  return !!token && token === process.env.ADMIN_CODE
}

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
