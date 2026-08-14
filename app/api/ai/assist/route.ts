import { auth } from '@clerk/nextjs/server'
import { CREDITS_ENABLED, CREDIT_COSTS, getCredits, spendCredits } from '@/lib/credits'
import { aiCreditsForTokens } from '@/lib/credit-tiers'
import { recordUsage } from '@/lib/api-usage'
import { runAssist, AI_ASSIST_MODEL, type AssistMessage } from '@/lib/ai-assist'

export const runtime = 'nodejs'
export const maxDuration = 90

// The 100Lights AI assistant endpoint. Auth-gated; usage-billed against the credits system (a no-op
// until CREDITS_ENABLED). Returns the assistant's reply + the actions for the client to run against the
// module (window.__video / __daw …). Needs ANTHROPIC_API_KEY. See lib/ai-assist.
export async function POST(req: Request) {
  const { userId: clerkId } = await auth()
  // DEV_OPEN test user (dev builds only) — lets headless tools exercise the assistant. Inert in prod.
  const testUser = process.env.DEV_OPEN === '1' && process.env.NODE_ENV !== 'production' ? req.headers.get('x-test-user') : null
  const userId = clerkId ?? (testUser ? `test-${testUser}` : null)
  if (!userId) return Response.json({ error: 'Sign in to use the AI assistant.' }, { status: 401 })
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: 'The AI assistant is not configured (ANTHROPIC_API_KEY).' }, { status: 501 })

  let body: { messages?: AssistMessage[]; module?: string; stateSummary?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const messages = (body.messages ?? []).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
  if (!messages.length) return Response.json({ error: 'No message' }, { status: 400 })
  if (messages.length > 40) messages.splice(0, messages.length - 40)   // cap history the model sees

  // Gate on balance (usage-based: we bill the REAL token cost after the call, but require a floor to
  // start so an empty account can't run up work). No-op until CREDITS_ENABLED.
  if (CREDITS_ENABLED) {
    const { balance } = await getCredits(userId)
    if (balance < CREDIT_COSTS.aiAssist) {
      return Response.json({ error: 'Not enough credits for the AI assistant. Top up or upgrade to keep going.', needCredits: true, balance }, { status: 402 })
    }
  }

  let result
  try {
    result = await runAssist({ messages, module: body.module, stateSummary: body.stateSummary })
  } catch (e) {
    return Response.json({ error: (e as Error).message || 'The assistant failed. No credits were charged.' }, { status: 502 })
  }

  // Ledger (always) + usage-based charge (only when billing is live).
  const credits = aiCreditsForTokens(result.usage.inputTokens, result.usage.outputTokens)
  recordUsage({
    userId, provider: 'anthropic', operation: 'ai-assist', unitType: 'tokens',
    inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
    units: result.usage.inputTokens + result.usage.outputTokens,
    metadata: { model: AI_ASSIST_MODEL, credits, actions: result.actions.map(a => a.name) },
  })
  let balance: number | undefined
  if (CREDITS_ENABLED) {
    const spend = await spendCredits(userId, credits, 'ai-assist')
    balance = spend.balance   // if the balance couldn't cover a big turn it drains to what's left; the floor bounds this
  }

  return Response.json({ message: result.text, actions: result.actions, stop: result.stop, credits, balance })
}
