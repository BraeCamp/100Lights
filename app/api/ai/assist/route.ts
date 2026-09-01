import { testUserId } from '@/lib/api-user'
import { auth } from '@clerk/nextjs/server'
import { CREDITS_ENABLED, CREDIT_COSTS, getCredits, spendCredits } from '@/lib/credits'
import { aiCreditsForTokens, LUMENS_NAME } from '@/lib/credit-tiers'
import { getSubscription } from '@/lib/subscription'
import { isPaid, type Plan } from '@/lib/entitlements'
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
  const testUser = testUserId(req)
  const userId = clerkId ?? (testUser ? `test-${testUser}` : null)
  if (!userId) return Response.json({ error: 'Sign in to use the AI assistant.' }, { status: 401 })
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: 'The AI assistant is not configured (ANTHROPIC_API_KEY).' }, { status: 501 })

  let body: { messages?: AssistMessage[]; module?: string; stateSummary?: string; recent?: string }
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  // ⚠️ Content is a string OR an array of blocks. The string-only filter this
  // replaces would have silently DROPPED every tool_use and tool_result turn —
  // and a conversation missing the assistant's tool_use but carrying its
  // tool_result is rejected by the API, so the loop would have failed on its
  // second turn with an error about an orphaned result.
  const messages = (body.messages ?? []).filter(m =>
    (m.role === 'user' || m.role === 'assistant') &&
    (typeof m.content === 'string' ? !!m.content.trim() : Array.isArray(m.content) && m.content.length > 0))
  if (!messages.length) return Response.json({ error: 'No message' }, { status: 400 })
  if (messages.length > 40) messages.splice(0, messages.length - 40)   // cap history the model sees

  // Gate on balance (usage-based: we bill the REAL token cost after the call, but require a floor to
  // start so an empty account can't run up work). No-op until CREDITS_ENABLED.
  if (CREDITS_ENABLED) {
    const { balance, ok } = await getCredits(userId)
    // Only refuse on an answer we actually got. A failed read used to come back
    // as `balance: 0` and was indistinguishable from an empty account, so a
    // database blip told a paying customer they were out of credits and stopped
    // them working — the worst of both, since it is both wrong and alarming.
    //
    // When the balance cannot be read the call goes ahead. The real cost is
    // billed AFTER the call either way, so the exposure is one assistant turn
    // on an account we could not check, against locking somebody out of a
    // feature they have paid for because a query timed out.
    if (ok && balance < CREDIT_COSTS.aiAssist) {
      // ── A paying account reading zero is a fault, not a bill ────────────
      //
      // Brae, on Max with 1,250,000 Lumens in the table: "It still says that
      // I'm out of AI credits."
      //
      // A subscriber's balance being zero is not the ordinary end of a
      // spending account — it means the row is missing, or unreachable, or on
      // an account other than the one signed in. Every one of those is our
      // problem, and every one of them presents to the person as being told
      // they have run out of something they just paid for.
      //
      // So the plan is checked before refusing. Somebody on a paid plan is let
      // through: the turn is billed afterwards like any other, so the exposure
      // is one assistant turn against locking a paying customer out of the
      // feature they are paying for. Only a genuinely free account with a
      // genuinely empty balance is refused, which is the case the gate was
      // written for.
      const sub = await getSubscription(userId).catch(() => null)
      const paid = sub ? isPaid(sub.plan as Plan) : false
      if (!paid) {
        return Response.json({
          error: `Out of ${LUMENS_NAME}. Top up or upgrade to keep going.`,
          needCredits: true,
          balance,
        }, { status: 402 })
      }
      console.warn(
        `[assist] ${userId} is on ${sub?.plan} but reads ${balance} ${LUMENS_NAME} — `
        + 'letting the turn through; the credit row is missing or on another account.',
      )
    }
  }

  let result
  try {
    result = await runAssist({
      messages, module: body.module, stateSummary: body.stateSummary,
      // Capped here rather than trusted: this arrives from the browser, and a
      // caller that sent a novel would be paying for it on every utterance.
      recent: typeof body.recent === 'string' ? body.recent.slice(0, 2000) : undefined,
    })
  } catch (e) {
    return Response.json({ error: (e as Error).message || 'The assistant failed. No credits were charged.' }, { status: 502 })
  }

  // Ledger (always) + usage-based charge (only when billing is live).
  //
  // ⚠️ Cached tokens are reported SEPARATELY and are not in input_tokens, so
  // billing on input_tokens alone would charge nothing at all for a cache read
  // and would miss the 25% premium a cache write costs. Both are real money, at
  // their real rates: a read is a tenth of an input token, a write is a quarter
  // more than one. Getting this wrong in our favour would be overcharging; the
  // way it would have gone wrong here is undercharging, which is just as much a
  // wrong number in the ledger.
  const u = result.usage
  const effectiveInput = u.inputTokens + u.cacheWriteTokens * 1.25 + u.cacheReadTokens * 0.1
  const credits = aiCreditsForTokens(effectiveInput, u.outputTokens)
  recordUsage({
    userId, provider: 'anthropic', operation: 'ai-assist', unitType: 'tokens',
    inputTokens: u.inputTokens, outputTokens: u.outputTokens,
    units: u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens,
    metadata: {
      model: AI_ASSIST_MODEL, credits, actions: result.actions.map(a => a.name),
      cacheRead: u.cacheReadTokens, cacheWrite: u.cacheWriteTokens,
    },
  })
  let balance: number | undefined
  if (CREDITS_ENABLED) {
    const spend = await spendCredits(userId, credits, 'ai-assist')
    balance = spend.balance   // if the balance couldn't cover a big turn it drains to what's left; the floor bounds this
  }

  return Response.json({ message: result.text, actions: result.actions, stop: result.stop, credits, balance })
}
