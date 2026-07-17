import { isAdmin } from '@/lib/admin-auth'
import { getArticles } from '@/lib/learn-articles'
import { ARTICLE_VOICE } from '@/lib/article-voice'

export const runtime = 'nodejs'
export const maxDuration = 120

// Admin-only draft generation via the Anthropic API. This never touches the
// user-facing product — 100Lights ships no AI features; this is an editorial
// tool behind the admin gate. Needs ANTHROPIC_API_KEY in the environment.


export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return Response.json({ error: 'ANTHROPIC_API_KEY is not set — add it to the environment to enable generation.' }, { status: 501 })

  let body: { topic?: string; notes?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const topic = body.topic?.trim()
  if (!topic) return Response.json({ error: 'Topic required' }, { status: 400 })

  const existing = (await getArticles({ includeDrafts: true })).map(a => a.title).join('; ')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 4000,
      system: ARTICLE_VOICE,
      messages: [{
        role: 'user',
        content: `Write a guide on: ${topic}\n${body.notes?.trim() ? `Extra direction from the editor: ${body.notes.trim()}\n` : ''}Existing articles (do not duplicate their angles): ${existing || 'none yet'}`,
      }],
    }),
    signal: AbortSignal.timeout(110_000),
  }).catch(() => null)

  if (!res) return Response.json({ error: 'Could not reach the Anthropic API' }, { status: 502 })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return Response.json({ error: `Anthropic API error ${res.status}: ${detail.slice(0, 200)}` }, { status: 502 })
  }
  const data = await res.json() as { content?: Array<{ type: string; text?: string }> }
  const markdown = (data.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('\n').trim()
  if (!markdown) return Response.json({ error: 'Empty response from the model' }, { status: 502 })

  // Derive title/description suggestions from the markdown
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? topic
  const firstPara = markdown.split(/\n\s*\n/).find(b => !b.trim().startsWith('#'))?.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`]/g, '').trim() ?? ''
  const description = firstPara.length > 160 ? `${firstPara.slice(0, 157)}…` : firstPara
  const slug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80)

  return Response.json({ title, description, slug, body: markdown })
}
