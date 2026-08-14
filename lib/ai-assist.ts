// The 100Lights AI assistant — a music/video-making helper that works WITH the app's modules. It runs
// on Claude (Anthropic) with a set of "action" tools that map to the client's module hooks (window.__video
// / __daw / Lightning Bug). The route (app/api/ai/assist) calls runAssist, meters the tokens against the
// credits system, and returns the assistant's text + the actions for the client to execute. Server-only.

const MODEL = process.env.AI_ASSIST_MODEL || 'claude-sonnet-5'

export interface AssistMessage { role: 'user' | 'assistant'; content: string }
export interface AssistAction { name: string; input: Record<string, unknown> }
export interface AssistResult {
  text: string
  actions: AssistAction[]
  usage: { inputTokens: number; outputTokens: number }
  stop: string
}

// Action tools = the things the assistant can DO in a module. The client executes each against the live
// editor (window.__video etc.). Keep names/inputs stable — they're a contract with the client executor.
const TOOLS = [
  {
    name: 'search_and_add_stock',
    description: 'Search the Pexels stock-video library and add matching clips to the video project as footage to edit with. Use for b-roll / backgrounds the user describes (e.g. "city at night", "calm ocean").',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What footage to find, e.g. "misty forest"' },
        count: { type: 'integer', description: 'How many clips to add (1–8, default 4)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'import_audio',
    description: "Import an audio track (from a URL) as the video's soundtrack. Use when the user gives a link to a song, or to pull a track the assistant found.",
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Direct audio URL (mp3/wav/…)' },
        name: { type: 'string', description: 'Optional display name' },
      },
      required: ['url'],
    },
  },
  {
    name: 'auto_edit',
    description: 'Auto-edit the video: cut the footage into a beat-synced montage over the audio bed. Run after there is footage and audio. Cuts land on the beat when the audio has a beat map.',
    input_schema: {
      type: 'object',
      properties: {
        barsPerCut: { type: 'integer', description: 'Cut every N bars (default 2). Lower = faster cuts.' },
        transition: { type: 'string', enum: ['dissolve', 'dip_black', 'wipe_right', 'push', 'none'], description: 'Transition on each cut (default dissolve)' },
      },
    },
  },
  {
    name: 'rename_project',
    description: 'Rename the current project.',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'open_export',
    description: 'Open the export dialog so the user can render/download the finished video.',
    input_schema: { type: 'object', properties: {} },
  },
] as const

function systemPrompt(moduleName: string, stateSummary?: string): string {
  return [
    `You are the 100Lights assistant — you help people make music and videos INSIDE the app, working hands-on with its modules. The user is currently in the ${moduleName} module.`,
    `You can take actions by calling the provided tools; the app executes them for real on the user's project. Prefer doing the work over describing it: if the user asks for a music video of "a rainy city", search_and_add_stock for the footage, import_audio if they gave a track, then auto_edit — then tell them what you did in one or two sentences.`,
    `Only call tools that clearly serve the request. Never invent URLs. Keep replies short and friendly; no preamble. If you can't act, say what you need (e.g. "add an audio track first").`,
    stateSummary ? `Current project state: ${stateSummary}` : '',
  ].filter(Boolean).join('\n\n')
}

/** Run one assistant turn. Returns the reply text, any actions to execute, and token usage. Throws on a
 *  hard API failure so the route can refund + surface an error. */
export async function runAssist(opts: {
  messages: AssistMessage[]
  module?: string
  stateSummary?: string
  maxTokens?: number
}): Promise<AssistResult> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 1200,
      system: systemPrompt(opts.module ?? 'video', opts.stateSummary),
      tools: TOOLS,
      messages: opts.messages.map(m => ({ role: m.role, content: m.content })),
    }),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null)

  if (!res) throw new Error('Could not reach the Anthropic API')
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)

  const data = await res.json() as {
    content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>
    usage?: { input_tokens?: number; output_tokens?: number }
    stop_reason?: string
  }
  const blocks = data.content ?? []
  const text = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim()
  const actions: AssistAction[] = blocks.filter(b => b.type === 'tool_use' && b.name).map(b => ({ name: b.name!, input: b.input ?? {} }))
  return {
    text, actions,
    usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
    stop: data.stop_reason ?? 'end_turn',
  }
}

export { MODEL as AI_ASSIST_MODEL }
