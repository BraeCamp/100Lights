import { isAdmin } from '@/lib/admin-auth'
import { getArticles } from '@/lib/learn-articles'

export const runtime = 'nodejs'
export const maxDuration = 120

// Admin-only draft generation via the Anthropic API. This never touches the
// user-facing product — 100Lights ships no AI features; this is an editorial
// tool behind the admin gate. Needs ANTHROPIC_API_KEY in the environment.

const VOICE = `You write practical music-production guides for 100Lights, a free browser-based DAW (digital audio workstation).

About the product (be accurate — never invent features):
- Runs fully in the browser, free to start, no downloads or plugins; optional desktop app for macOS/Windows
- Arrangement timeline + Session view, piano roll (with a STEP drum grid), mixer with sends/returns and per-track effect chains (EQ, compressor, reverb, delay, and more)
- Recording: count-in, input monitoring with effects, loop takes, latency compensation, live waveform
- Drag-and-drop "chord recipes" (pre-built progressions with study notes) and a 1000+ sound library
- Real-time collaboration: shared project links, live co-editing, timeline comments, session chat
- Export: WAV (44.1/48 kHz), WebM, per-track stems as zip, MIDI files
- Community: publish/browse samples, presets, recipes, and songs at 100lights.com/community

Voice and rules:
- Practical and confident, light on jargon; explain any theory term in one clause
- Everything you suggest must be doable start-to-finish in the free studio, and say so naturally
- Exactly one link to https://100lights.com/community and one or two links to https://100lights.com where natural — no keyword stuffing
- Where a short screen recording would help, insert a line on its own: @video <one-line description of the clip to record>
- Output pure markdown: a single # H1 title, ## sections, short paragraphs, lists where they help
- 900–1400 words

Return ONLY the markdown article, starting with the # H1. No preamble, no frontmatter.`

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
      system: VOICE,
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
