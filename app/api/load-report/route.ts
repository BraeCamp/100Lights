import { auth } from '@clerk/nextjs/server'
import { addLoadReport } from '@/lib/load-reports-db'

export const runtime = 'nodejs'

// POST /api/load-report — how a song's loading actually went on this machine.
//
// Written after the fact and never read back by the client, so nothing here can
// affect whether a song loads. It returns 204 whatever happens, for the same
// reason the voice-gap route does: a studio must never report a failure because
// the place we keep notes was unavailable.
export async function POST(req: Request) {
  const { userId } = await auth()

  try {
    const b = await req.json() as Record<string, unknown>
    const n = (v: unknown, cap = 1e9) => Math.max(0, Math.min(cap, Number(v) || 0))
    await addLoadReport({
      ts: Date.now(),
      userId: userId ?? '',
      projectId: String(b.projectId ?? '').slice(0, 80),
      projectName: String(b.projectName ?? '').slice(0, 200),
      wanted: n(b.wanted, 100_000),
      done: n(b.done, 100_000),
      elapsedMs: n(b.elapsedMs, 24 * 60 * 60 * 1000),
      errors: n(b.errors, 100_000),
      silent: n(b.silent, 100_000),
      setAside: n(b.setAside, 100_000),
      givenUp: n(b.givenUp, 100_000),
      playInterruptions: n(b.playInterruptions, 100_000),
      pausedMs: n(b.pausedMs, 24 * 60 * 60 * 1000),
      outcome: String(b.outcome ?? 'ok'),
      device: String(b.device ?? '').slice(0, 200),
      // Capped hard: this is a diagnosis, not a transcript, and an unbounded
      // array from a client is somebody else's disk.
      events: Array.isArray(b.events) ? b.events.slice(0, 60) : [],
    })
  } catch { /* see above */ }
  return new Response(null, { status: 204 })
}
