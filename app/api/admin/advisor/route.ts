import { cookies } from 'next/headers'
import { sql } from '@/lib/db'
import { stripe } from '@/lib/stripe'

export const runtime = 'nodejs'

async function isAdmin(): Promise<boolean> {
  const jar = await cookies()
  const token = jar.get('admin_auth')?.value
  return !!token && token === process.env.ADMIN_CODE
}

async function gatherContext() {
  const [
    users, proUsers, newThisWeek, newThisMonth,
    projects, podcastProjects, projectsThisWeek,
    usageRows, moduleRows, churnRows,
  ] = await Promise.all([
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions`,
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE plan = 'pro' AND status = 'active'`,
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE updated_at > NOW() - INTERVAL '7 days'`,
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE updated_at > NOW() - INTERVAL '30 days'`,
    sql`SELECT COUNT(*)::int AS cnt FROM projects WHERE deleted_at IS NULL`,
    sql`SELECT COUNT(*)::int AS cnt FROM projects WHERE deleted_at IS NULL AND data->>'audioMode' = 'podcast'`,
    sql`SELECT COUNT(*)::int AS cnt FROM projects WHERE deleted_at IS NULL AND saved_at > NOW() - INTERVAL '7 days'`,
    sql`SELECT action, SUM(count)::int AS total FROM usage WHERE reset_at > NOW() GROUP BY action`,
    sql`SELECT module_key, COUNT(*)::int AS cnt FROM module_licenses WHERE license_type = 'purchased' GROUP BY module_key`.catch(() => []),
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE plan = 'free' AND status = 'active' AND updated_at < NOW() - INTERVAL '30 days'`.catch(() => [{ cnt: 0 }]),
  ])

  let mrr = 0
  let priceAmount = 0
  try {
    const priceList = await stripe.prices.list({ lookup_keys: ['pro_monthly'], active: true, limit: 1 })
    if (priceList.data[0]) {
      priceAmount = (priceList.data[0].unit_amount ?? 0) / 100
      mrr = Number(proUsers[0]?.cnt ?? 0) * priceAmount
    }
  } catch {}

  const totalUsers = Number(users[0]?.cnt ?? 0)
  const proCount   = Number(proUsers[0]?.cnt ?? 0)

  return {
    totalUsers,
    proUsers:         proCount,
    freeUsers:        totalUsers - proCount,
    newThisWeek:      Number(newThisWeek[0]?.cnt ?? 0),
    newThisMonth:     Number(newThisMonth[0]?.cnt ?? 0),
    totalProjects:    Number(projects[0]?.cnt ?? 0),
    podcastProjects:  Number(podcastProjects[0]?.cnt ?? 0),
    projectsThisWeek: Number(projectsThisWeek[0]?.cnt ?? 0),
    dormantFreeUsers: Number(churnRows[0]?.cnt ?? 0),
    transcriptions:   Number(usageRows.find(r => r.action === 'transcribe')?.total ?? 0),
    aiGenerations:    Number(usageRows.find(r => r.action === 'ai_generate')?.total ?? 0),
    modulePurchases:  Object.fromEntries((moduleRows as { module_key: string; cnt: number }[]).map(r => [r.module_key, Number(r.cnt)])),
    mrr,
    priceAmount,
    conversionRate:   totalUsers > 0 ? ((proCount / totalUsers) * 100).toFixed(1) : '0',
  }
}

export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })

  const { messages } = await req.json().catch(() => ({ messages: [] })) as { messages: { role: string; content: string }[] }
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response('Bad Request', { status: 400 })
  }

  const ctx = await gatherContext()
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const system = `You are an AI business advisor embedded in the admin panel of 100Lights — a SaaS creative platform for audio, video, and image editing. The owner (Brae) is the sole operator. Your job is to give direct, specific, actionable advice on marketing, user acquisition, compliance, growth, and product strategy.

## Platform Summary
100Lights is a browser-based + desktop (Electron) creative suite with three modules:
- **Audio** — DAW for beat production / music composition + a full Podcast Editor (recording, chapter markers, iTunes-compatible RSS feed export, Spotify-ready)
- **Video** — Timeline video editor
- **Image** — Layer-based canvas editor with effects and export

**Pricing:** Free tier (limited projects/features) + Pro at $${ctx.priceAmount}/month via Stripe. Individual module one-time purchases also available.

## Live Metrics · ${today}
| Metric | Value |
|---|---|
| Total registered users | ${ctx.totalUsers} |
| Active Pro subscribers | ${ctx.proUsers} |
| Free users | ${ctx.freeUsers} |
| Conversion rate (free→pro) | ${ctx.conversionRate}% |
| Estimated MRR | $${ctx.mrr.toFixed(0)} |
| New users this week | ${ctx.newThisWeek} |
| New users this month | ${ctx.newThisMonth} |
| Total projects created | ${ctx.totalProjects} |
| Podcast projects | ${ctx.podcastProjects} |
| Projects created this week | ${ctx.projectsThisWeek} |
| Dormant free users (>30 days inactive) | ${ctx.dormantFreeUsers} |
| AI generations (this period) | ${ctx.aiGenerations} |
| Transcriptions (this period) | ${ctx.transcriptions} |
| Module purchases by type | ${JSON.stringify(ctx.modulePurchases)} |

## Advisor Guidelines
- Be direct and specific — name real channels, tactics, tools, numbers, and benchmarks
- When asked about compliance, cite the actual regulation or platform policy requirement
- When asked about marketing, provide actual copy examples, channel strategies, or step-by-step tactics
- When interpreting metrics, call out what's good, what's concerning, and what the priority action should be
- Assume Brae can implement technical changes but has limited marketing bandwidth (solo founder)
- All cost estimates should assume bootstrap/low-budget unless specified otherwise`

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return new Response('AI not configured', { status: 503 })

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type':      'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key':         apiKey,
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      stream:     true,
      system,
      messages,
    }),
  })

  if (!anthropicRes.ok) {
    return new Response(await anthropicRes.text(), { status: anthropicRes.status })
  }

  return new Response(anthropicRes.body, {
    headers: {
      'content-type':    'text/event-stream',
      'cache-control':   'no-cache',
      'x-accel-buffering': 'no',
    },
  })
}
