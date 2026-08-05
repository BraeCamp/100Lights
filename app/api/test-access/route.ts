import { NextResponse } from 'next/server'

// Gate for the /test sound-lab sandbox. The code lives only in the server env
// (TEST_ACCESS_CODE) — never shipped to the client. A correct code unlocks the
// page for the session; there's nothing sensitive behind it, it just keeps the
// prototype out of casual/crawler reach (the page is also noindex).
export async function POST(req: Request) {
  const { code } = await req.json().catch(() => ({}))
  const expected = process.env.TEST_ACCESS_CODE
  if (expected && typeof code === 'string' && code === expected) {
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ ok: false }, { status: 401 })
}
