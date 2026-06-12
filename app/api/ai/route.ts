/**
 * Anthropic API proxy.
 * Reads the key from ANTHROPIC_API_KEY env var — never from the client.
 */
import { auth } from '@clerk/nextjs/server'

export const runtime = 'edge'

interface AiRequest {
  system?:    string
  prompt:     string
  model?:     string
  maxTokens?: number
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'AI service not configured.' }, { status: 503 })
  }

  let body: AiRequest
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.prompt) {
    return Response.json({ error: 'Missing prompt' }, { status: 400 })
  }

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'content-type':      'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key':         apiKey,
    },
    body: JSON.stringify({
      model:      body.model ?? 'claude-haiku-4-5-20251001',
      max_tokens: body.maxTokens ?? 4096,
      ...(body.system ? { system: body.system } : {}),
      messages: [{ role: 'user', content: body.prompt }],
    }),
  })

  if (!anthropicRes.ok) {
    const err = await anthropicRes.text()
    return Response.json({ error: err }, { status: anthropicRes.status })
  }

  const data = await anthropicRes.json() as {
    content: Array<{ type: string; text: string }>
  }
  const text = data.content.find(b => b.type === 'text')?.text ?? ''
  return Response.json({ content: text })
}
