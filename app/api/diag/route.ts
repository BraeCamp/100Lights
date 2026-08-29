// Where the studio's errors land on disk.
//
// Brae: "Can we have all of those rendering errors load to a part of the
// program that you can access and use whenever I have you correct?"
//
// The browser cannot write a file, so the journal posts here and this appends
// to `.diag/errors.jsonl` in the repo. That is the whole point: a failing run
// leaves a file that can be read directly, instead of a person being asked to
// reproduce the problem and copy a console.
//
// LOCAL ONLY, and deliberately so. This writes to the filesystem, which a
// deployed server should never accept from the public, and on a serverless host
// the filesystem is ephemeral anyway. In production the same events still reach
// `window.__diag()` and ride along inside `__dawDiagnose()`, which is the path
// that already works for a real user.

import { NextResponse } from 'next/server'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ENABLED = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DAW_HOOKS === '1'
const DIR = join(process.cwd(), '.diag')
const FILE = join(DIR, 'errors.jsonl')
/** One line is a whole event; a runaway page must not fill the disk. */
const MAX_EVENTS = 200

export async function POST(req: Request) {
  if (!ENABLED) return NextResponse.json({ ok: false, reason: 'disabled' }, { status: 404 })
  try {
    const body = await req.json() as { events?: unknown[] }
    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : []
    if (!events.length) return NextResponse.json({ ok: true, wrote: 0 })
    await mkdir(DIR, { recursive: true })
    await appendFile(FILE, events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8')
    return NextResponse.json({ ok: true, wrote: events.length })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'write failed' }, { status: 500 })
  }
}

export async function GET() {
  if (!ENABLED) return NextResponse.json({ ok: false, reason: 'disabled' }, { status: 404 })
  try {
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(FILE, 'utf8').catch(() => '')
    const lines = raw.split('\n').filter(Boolean).slice(-MAX_EVENTS)
    return NextResponse.json({ ok: true, path: FILE, count: lines.length, events: lines.map(l => JSON.parse(l)) })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'read failed' }, { status: 500 })
  }
}
