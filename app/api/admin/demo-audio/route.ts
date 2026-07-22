import { isAdmin } from '@/lib/admin-auth'
import { getDemoSettings, saveDemoSettings } from '@/lib/demo-audio-store'
import { withDefaults } from '@/lib/demo-audio'

export const runtime = 'nodejs'

// Read/write the demo-audio tuner settings. Admin only.
export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  return Response.json({ settings: await getDemoSettings() })
}

export async function PUT(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  let body: unknown
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const settings = withDefaults((body as { settings?: unknown })?.settings as Parameters<typeof withDefaults>[0])
  await saveDemoSettings(settings)
  return Response.json({ ok: true, settings })
}
