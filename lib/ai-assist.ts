// The 100Lights AI assistant — a music/video-making helper that works WITH the app's modules. It runs
// on Claude (Anthropic) with a set of "action" tools that map to the client's module hooks (window.__video
// / __daw / Lightning Bug). The route (app/api/ai/assist) calls runAssist, meters the tokens against the
// credits system, and returns the assistant's text + the actions for the client to execute. Server-only.

const MODEL = process.env.AI_ASSIST_MODEL || 'claude-sonnet-5'

import { MUSIC_TOOLS, MUSIC_SYSTEM_HINT } from './voice/music-tools'

/**
 * A turn's content.
 *
 * It used to be a plain string, which is all a one-shot exchange needs: ask,
 * get tool calls back, execute them, forget. That shape is also exactly what
 * made the assistant unable to check its own work — a tool result has nowhere
 * to go in a conversation made of strings, so the model never learned whether
 * anything it did worked, and could never read the song before acting on it.
 *
 * Blocks are what a tool loop is made of: the assistant's turn carries the
 * tool_use it emitted, and the reply carries a tool_result per id.
 */
export type AssistBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export interface AssistMessage { role: 'user' | 'assistant'; content: string | AssistBlock[] }
/** `id` pairs the call with the tool_result that reports how it went. */
export interface AssistAction { name: string; input: Record<string, unknown>; id?: string }
export interface AssistResult {
  text: string
  actions: AssistAction[]
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
  stop: string
  /** The assistant's turn verbatim, to be echoed back when replying with results. */
  raw: AssistBlock[]
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

/**
 * The unchanging half of the system prompt.
 *
 * Split from the song's state on purpose: everything up to and including this
 * text is identical on every request, which is what makes it cacheable. The
 * state summary changes with every edit and so must come after the cache
 * breakpoint, or it would invalidate the prefix each time and the cache would
 * never be read.
 */
function staticSystem(moduleName: string): string {
  if (moduleName === 'music') {
    return [
      'You are the 100Lights assistant, working hands-on inside Beacon, the music studio.',
      'You take actions by calling the provided tools; the app executes them for real on the user\'s song. Prefer doing the work over describing it.',
      MUSIC_SYSTEM_HINT,
      LOOP_HINT,
    ].filter(Boolean).join('\n\n')
  }
  return staticSystemOther(moduleName)
}

/**
 * What changes now that results come back.
 *
 * Worth stating plainly, because the previous prompt was written for a model
 * that got exactly one turn and had to guess at everything it could not see.
 */
const LOOP_HINT = [
  'You will be told what each tool call did. If a call fails, the reason comes back — fix it and try again rather than giving up or repeating it unchanged.',
  'You can look before you act: `describe` answers questions about the song, and its answer comes back to you, so use it when a request depends on something you were not told (which track is loudest, what is on a chain).',
  'When the work is done, reply with one short sentence saying what actually changed — from the results you were given, not from what you intended.',
].join(' ')

function staticSystemOther(moduleName: string): string {
  return [
    `You are the 100Lights assistant — you help people make music and videos INSIDE the app, working hands-on with its modules. The user is currently in the ${moduleName} module.`,
    `You can take actions by calling the provided tools; the app executes them for real on the user's project. Prefer doing the work over describing it: if the user asks for a music video of "a rainy city", search_and_add_stock for the footage, import_audio if they gave a track, then auto_edit — then tell them what you did in one or two sentences.`,
    `Only call tools that clearly serve the request. Never invent URLs. Keep replies short and friendly; no preamble. If you can't act, say what you need (e.g. "add an audio track first").`,
  ].filter(Boolean).join('\n\n')
}

/**
 * System as blocks, with one cache breakpoint at the end of the static half.
 *
 * The cached prefix is tools + static system — 37 tool schemas and the prompt,
 * re-sent identically on every single utterance and, until now, paid for in
 * full every single time. The song's state sits after the breakpoint because
 * it is different on every request by definition.
 */
function systemBlocks(moduleName: string, stateSummary?: string, recent?: string,
                      hint?: { matched?: string; confidence?: number; calls?: string[] }) {
  const blocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral'; ttl?: string } }> = [
    // ⚠️ ONE HOUR, not the default five minutes.
    //
    // Brae: "people might like this so much that they use several hundred
    // commands an hour and that could get pricey very quickly."
    //
    // The prefix is ~13,900 tokens of tool schemas and prompt, re-sent on every
    // utterance. Read from cache it costs a tenth of that; written it costs
    // more than the whole thing. So the entire bill turns on the HIT RATE, and
    // the five-minute default loses the cache during any ordinary pause —
    // listening back to a section, reading, thinking. Somebody working steadily
    // with gaps longer than five minutes was paying a full cache WRITE on
    // nearly every command: about 5.4M billed input tokens across 300 commands,
    // against 500k when the cache holds.
    //
    // An hour costs 2x to write instead of 1.25x, and that is paid ONCE per
    // session rather than on most commands. Verified live against the API
    // before committing to it — the response reports the tokens under
    // `cache_creation.ephemeral_1h_input_tokens`, so it is genuinely honoured
    // and not silently downgraded.
    { type: 'text', text: staticSystem(moduleName), cache_control: { type: 'ephemeral', ttl: '1h' } },
  ]
  if (stateSummary) {
    blocks.push({ type: 'text', text: `${moduleName === 'music' ? 'Current song' : 'Current project state'}: ${stateSummary}` })
  }
  // ⚠️ AFTER THE BREAKPOINT, with the song state, because it changes every
  // time. What was asked a moment ago is context this conversation no longer
  // carries: the message array is cleared whenever a command succeeds, so
  // without these lines every finished command left no trace and a follow-up
  // like "do that to the bass as well" had nothing to point at.
  if (recent) {
    blocks.push({ type: 'text', text:
      `Recent commands in this session, oldest first. Use them to resolve `
      + `references like "that one", "again", "the same thing", and to remember `
      + `what you last asked about:\n${recent}` })
  }
  // ⚠️ WHAT THE RULES THOUGHT — AS ADVICE, NEVER AS AN INSTRUCTION.
  //
  // Brae: "the AI has so many rules that it follows that it doesn't actually
  // know what to do... let's stay away from rules and focus on giving it
  // recommendations and context."
  //
  // The hundred hand-written rules know a great deal about this app — which
  // words name a track, how people phrase things here — and until now that
  // knowledge either ACTED (pre-empting the model, which is what made it run
  // the wrong command) or was thrown away. Offered as a reading to consider, it
  // is worth having and costs nothing to disagree with.
  if (hint?.calls?.length) {
    blocks.push({ type: 'text', text:
      `The built-in rules read this sentence as ${hint.calls.join(', ')} `
      + `(rule "${hint.matched}", confidence ${(hint.confidence ?? 0).toFixed(2)}). `
      + `That is a SUGGESTION from a pattern matcher that cannot see the song, the `
      + `selection or the conversation — you can. Use it if it agrees with what you `
      + `read, ignore it if it does not.` })
  }
  return blocks
}

/** Run one assistant turn. Returns the reply text, any actions to execute, and token usage. Throws on a
 *  hard API failure so the route can refund + surface an error. */
export async function runAssist(opts: {
  messages: AssistMessage[]
  module?: string
  stateSummary?: string
  /** A few lines of what was asked recently — see recentContext(). */
  recent?: string
  /** What the local rules made of this sentence, offered as advice. */
  hint?: { matched?: string; confidence?: number; calls?: string[] }
  maxTokens?: number
}): Promise<AssistResult> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      // Explicit rather than assumed. The parameter is accepted without it, but
      // a request that silently falls back to five minutes would look identical
      // in every way except the bill.
      'anthropic-beta': 'extended-cache-ttl-2025-04-11',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 1200,
      system: systemBlocks(opts.module ?? 'video', opts.stateSummary, opts.recent, opts.hint),
      tools: toolsFor(opts.module ?? 'video'),
      messages: opts.messages.map(m => ({ role: m.role, content: m.content })),
    }),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null)

  if (!res) throw new Error('Could not reach the Anthropic API')
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)

  const data = await res.json() as {
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
    stop_reason?: string
  }
  const blocks = data.content ?? []
  const text = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim()
  const actions: AssistAction[] = blocks
    .filter(b => b.type === 'tool_use' && b.name)
    .map(b => ({ name: b.name!, input: b.input ?? {}, id: b.id }))
  return {
    text, actions,
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: data.usage?.cache_creation_input_tokens ?? 0,
    },
    stop: data.stop_reason ?? 'end_turn',
    raw: blocks as AssistBlock[],
  }
}

export { MODEL as AI_ASSIST_MODEL }
