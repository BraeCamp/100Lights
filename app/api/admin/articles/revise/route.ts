import { isAdmin } from '@/lib/admin-auth'
import { ARTICLE_VOICE } from '@/lib/article-voice'

export const runtime = 'nodejs'
export const maxDuration = 120

// Admin-only: revise an existing article per a natural-language instruction
// ("add a section on EQ", "cut the intro in half", "make it more casual").
// Returns the full rewritten markdown. Admin-only editorial tool — the
// product ships no AI.
export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return Response.json({ error: 'ANTHROPIC_API_KEY is not set — add it to the environment to enable AI edits.' }, { status: 501 })

  let body: { body?: string; instruction?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const draft = body.body ?? ''
  const instruction = body.instruction?.trim()
  if (!instruction) return Response.json({ error: 'Tell me what to change' }, { status: 400 })
  if (!draft.trim()) return Response.json({ error: 'Nothing to revise yet' }, { status: 400 })

  const system = `${ARTICLE_VOICE}

You are now REVISING an existing article, not writing a new one. Apply the editor's instruction and return the COMPLETE updated article in markdown.

Preservation rules (critical):
- Keep everything the instruction doesn't ask you to change, verbatim where possible.
- NEVER remove or alter existing @video, @audio(...), or @sound(...) lines unless the instruction explicitly says to — they are embedded media the editor placed.
- Keep the same # H1 title unless the instruction changes the topic.
- Return ONLY the full markdown, starting with the # H1. No commentary, no explanation of what you changed.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 5000,
      system,
      messages: [{
        role: 'user',
        content: `Editor's instruction: ${instruction}\n\n--- CURRENT ARTICLE ---\n${draft}`,
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

  return Response.json({ body: markdown })
}
