import { auth } from '@clerk/nextjs/server'
import { getAiPrefs } from '@/lib/user-prefs'
import { putObject } from '@/lib/r2'
import { recordCapture } from '@/lib/generation-capture'

// Intercept an ElevenLabs generation's OUTPUT (stems + prompt/params) for the learning corpus. Called
// fire-and-forget by the generate modal. Skips silently when the user opted out (Settings → AI). Stages
// the audio in R2 under captures/<id>/ and inserts a pending row; the worker analyzes + cleans up.
const sanitize = (s: string) => (s || 'file').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').slice(0, 48)

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if ((await getAiPrefs(userId)).corpusOptOut) return Response.json({ captured: false, reason: 'opted-out' })

  const form = await req.formData().catch(() => null)
  if (!form) return Response.json({ error: 'form-data required' }, { status: 400 })
  const prompt = String(form.get('prompt') || '')
  let params: Record<string, unknown> = {}
  try { params = JSON.parse(String(form.get('params') || '{}')) } catch { /* keep {} */ }
  const model = String(form.get('model') || 'music_v2')

  const id = crypto.randomUUID()
  const stemKeys: Array<{ name: string; key: string }> = []
  let mixKey: string | null = null
  let count = 0
  for (const [field, value] of form.entries()) {
    if (!(value instanceof File)) continue
    if (++count > 12) break                                  // cap: a full stem set + mix
    const bytes = new Uint8Array(await value.arrayBuffer())
    if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) continue
    const key = `captures/${id}/${field === 'mix' ? 'mix' : `stem-${stemKeys.length}`}-${sanitize(value.name)}`
    await putObject(key, bytes, value.type || 'audio/wav')
    if (field === 'mix') mixKey = key
    else stemKeys.push({ name: value.name.replace(/\.[^.]+$/, ''), key })
  }
  if (!stemKeys.length && !mixKey) return Response.json({ captured: false, reason: 'no-audio' })
  await recordCapture({ id, userId, prompt, params, model, stemKeys, mixKey })
  return Response.json({ captured: true, id })
}
