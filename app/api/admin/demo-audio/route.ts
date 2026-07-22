import { isAdmin } from '@/lib/admin-auth'
import { listOverrides } from '@/lib/demo-audio-store'
import { CLIP_IDS } from '@/lib/demo-audio'

export const runtime = 'nodejs'

// Which clips currently have an uploaded replacement (admin only).
export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  return Response.json({ clips: CLIP_IDS, overrides: await listOverrides() })
}
