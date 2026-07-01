import { cookies } from 'next/headers'
import { isAdminEmail } from '@/lib/admin-auth'

const COOKIE = 'admin_auth'
const MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export async function POST(req: Request) {
  if (!await isAdminEmail()) {
    return Response.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { code } = await req.json().catch(() => ({ code: '' }))
  const expected = process.env.ADMIN_CODE

  if (!expected || code !== expected) {
    return Response.json({ error: 'Invalid code' }, { status: 401 })
  }

  const jar = await cookies()
  jar.set(COOKIE, expected, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   MAX_AGE,
    path:     '/',
  })

  return Response.json({ ok: true })
}

export async function DELETE() {
  const jar = await cookies()
  // Clear both path variants so old and new cookies are purged
  jar.set(COOKIE, '', { maxAge: 0, path: '/' })
  jar.set(COOKIE, '', { maxAge: 0, path: '/admin' })
  return Response.json({ ok: true })
}
