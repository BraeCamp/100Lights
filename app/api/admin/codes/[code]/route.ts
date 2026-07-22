import { isAdmin } from '@/lib/admin-auth'
import { setCodeActive, deleteCode } from '@/lib/codes'

export const runtime = 'nodejs'

// PATCH /api/admin/codes/[code] — toggle active state. Body: { active: boolean }
export async function PATCH(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { code } = await params
  const body = await req.json().catch(() => ({})) as { active?: boolean }
  if (typeof body.active !== 'boolean') {
    return Response.json({ error: 'active (boolean) required' }, { status: 400 })
  }
  const ok = await setCodeActive(decodeURIComponent(code), body.active)
  if (!ok) return Response.json({ error: 'Code not found' }, { status: 404 })
  return Response.json({ ok: true })
}

// DELETE /api/admin/codes/[code] — remove the code (already-granted time stays).
export async function DELETE(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { code } = await params
  const ok = await deleteCode(decodeURIComponent(code))
  if (!ok) return Response.json({ error: 'Code not found' }, { status: 404 })
  return Response.json({ ok: true })
}
