// The 100Lights AI assistant — a music/video-making helper that works WITH the app's modules. It runs
// on Claude (Anthropic) with a set of "action" tools that map to the client's module hooks (window.__video
// / __daw / Lightning Bug). The route (app/api/ai/assist) calls runAssist, meters the tokens against the
// credits system, and returns the assistant's text + the actions for the client to execute. Server-only.

const MODEL = process.env.AI_ASSIST_MODEL || 'claude-sonnet-5'

import { MUSIC_TOOLS, MUSIC_SYSTEM_HINT } from './voice/music-tools'

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
    name: 'apply_effect',
    description: "Grade the video clips with a named look/effect. Ids include: film, noir, warm, cool, blockbuster, neon-noir(neonnoir), bleach, giallo, lean, spotlight, dream, vibrant, punch, muted, golden(golden), icy, dusk, crimson, moody, faded, washed, vintage, bright, mono(B&W), sepia, infrared, negative, thermal, grain, vignette, scanlines, glitch, vhs. Use 'none' to clear.",
    input_schema: {
      type: 'object',
      properties: {
        effect: { type: 'string', description: 'effect id, or "none" to clear' },
        scope: { type: 'string', enum: ['all', 'selected'], description: 'all clips (default) or just the selected one' },
      },
      required: ['effect'],
    },
  },
  {
    name: 'multicam',
    description: 'Auto-switch the spotlight between camera tracks (needs video on 2+ tracks). mode: "speaker" cuts to whoever is talking (analyzes mouth movement + audio), "loudest" to the loudest track, "roundrobin" rotates evenly.',
    input_schema: { type: 'object', properties: { mode: { type: 'string', enum: ['speaker', 'loudest', 'roundrobin'] } } },
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

/**
 * The tools for the module the user is actually in.
 *
 * These used to be one flat list, and it was entirely video: stock footage,
 * multicam, export. Someone speaking a command in Beacon had nothing to call,
 * so the assistant could only describe what it would do. Music is its own set
 * because the two share no verbs — "auto_edit" means nothing to a bassline and
 * "loop_clip" means nothing to a video.
 */
function toolsFor(moduleName: string) {
  return moduleName === 'music' ? MUSIC_TOOLS : TOOLS
}

function systemPrompt(moduleName: string, stateSummary?: string): string {
  if (moduleName === 'music') {
    return [
      'You are the 100Lights assistant, working hands-on inside Beacon, the music studio.',
      'You take actions by calling the provided tools; the app executes them for real on the user\'s song. Prefer doing the work over describing it.',
      MUSIC_SYSTEM_HINT,
      stateSummary ? `Current song: ${stateSummary}` : '',
    ].filter(Boolean).join('\n\n')
  }
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
      tools: toolsFor(opts.module ?? 'video'),
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
