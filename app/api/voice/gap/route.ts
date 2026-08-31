import { auth } from '@clerk/nextjs/server'
import { addGap } from '@/lib/voice-gaps-db'

export const runtime = 'nodejs'

// POST /api/voice/gap — record a sentence the built-in commands could not read,
// together with what the assistant decided it meant.
//
// Brae: "Then it executes with AI and sends the system a correction that we can
// work from when I'm making patches."
//
// Written after the assistant has already answered, so nothing here can affect
// whether a command worked. It returns 204 whatever happens for the same
// reason: a studio must never report a successful command as failed because a
// notebook was unavailable.
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return new Response(null, { status: 204 })

  try {
    const body = await req.json() as {
      said?: string; calls?: unknown; say?: string; source?: string; tracks?: unknown
      outcome?: string; turns?: number
    }
    const said = String(body.said ?? '').trim()
    // Nothing to learn from an empty string, and a paragraph is somebody using
    // the studio as a chat window rather than reaching for a command.
    if (said.length < 2 || said.length > 400) return new Response(null, { status: 204 })

    await addGap({
      said,
      calls: Array.isArray(body.calls) ? body.calls.slice(0, 12) : [],
      say: String(body.say ?? '').slice(0, 400),
      source: body.source === 'spoken' ? 'spoken' : 'typed',
      // Names only. What is useful later is that the phrasing referred to a
      // track called "Bass 2"; the rest of the project is not ours to keep in a
      // notebook about wording.
      tracks: Array.isArray(body.tracks) ? body.tracks.slice(0, 40).map(String) : [],
      // Whether it worked, which is the label the queue was missing.
      outcome: String(body.outcome ?? '').slice(0, 200),
      turns: Math.max(1, Math.min(8, Number(body.turns) || 1)),
      userId,
    })
  } catch { /* see above */ }
  return new Response(null, { status: 204 })
}
