import { auth } from '@clerk/nextjs/server'
import { getAiPrefs, setAiCorpusOptOut } from '@/lib/user-prefs'

// GET current AI prefs; POST { corpusOptOut } to change the ElevenLabs-corpus opt-out. The capture
// pipeline (Phase 2) checks getAiPrefs(userId).corpusOptOut before analyzing a user's generation.
export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json(await getAiPrefs(userId))
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { corpusOptOut?: boolean }
  if (typeof body.corpusOptOut !== 'boolean') return Response.json({ error: 'corpusOptOut boolean required' }, { status: 400 })
  await setAiCorpusOptOut(userId, body.corpusOptOut)
  return Response.json({ corpusOptOut: body.corpusOptOut })
}
