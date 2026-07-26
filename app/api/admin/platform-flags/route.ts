import { isAdmin } from '@/lib/admin-auth'
import { setFlags, getFlags, type PlatformFlags } from '@/lib/platform-flags'
import { LAUNCH_MODULES } from '@/lib/editor-types'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  return Response.json(await getFlags())
}

export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  // Validate before persisting. An empty/bogus enabledModules would leave every
  // user with an empty module picker — the whole product bricked for everyone.
  if (body.enabledModules !== undefined) {
    const mods = body.enabledModules
    if (!Array.isArray(mods) || mods.length === 0 || !mods.every(m => (LAUNCH_MODULES as readonly string[]).includes(m as string))) {
      return Response.json({ error: 'enabledModules must be a non-empty list of valid modules' }, { status: 400 })
    }
  }
  if (body.enabledAudioModes !== undefined) {
    const modes = body.enabledAudioModes
    if (!Array.isArray(modes) || !modes.every(m => m === 'music' || m === 'podcast')) {
      return Response.json({ error: 'enabledAudioModes must be a list of music/podcast' }, { status: 400 })
    }
  }
  if (body.communityScale !== undefined && body.communityScale !== 'small' && body.communityScale !== 'large') {
    return Response.json({ error: 'communityScale must be small or large' }, { status: 400 })
  }

  await setFlags(body as Partial<PlatformFlags>)
  await logAdmin('flags.update', null, body)
  return Response.json({ ok: true })
}
