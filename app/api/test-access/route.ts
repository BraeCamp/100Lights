import { NextResponse } from 'next/server'

// Gate for the /test sound-lab sandbox. Reuses the app's existing admin key
// (ADMIN_CODE — the same one the admin panel uses), so there's no new env var to
// set. The code lives only in the server env, never shipped to the client; a
// correct code unlocks the page for the session (the page is also noindex).
export async function POST(req: Request) {
  const { code } = await req.json().catch(() => ({}))
  const expected = process.env.ADMIN_CODE
  if (expected && typeof code === 'string' && code === expected) {
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ ok: false }, { status: 401 })
}
