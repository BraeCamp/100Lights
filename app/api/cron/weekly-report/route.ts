import { sql } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { saveWeeklyReport } from '@/lib/platform-flags'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Gather context (same queries as the advisor route)
  const fallback0 = [{ cnt: 0 }]
  const [users, proUsers, newThisWeek, projects, podcastProjects, usageRows] = await Promise.all([
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions`.catch(() => fallback0),
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE plan = 'pro' AND status = 'active'`.catch(() => fallback0),
    sql`SELECT COUNT(*)::int AS cnt FROM subscriptions WHERE updated_at > NOW() - INTERVAL '7 days'`.catch(() => fallback0),
    sql`SELECT COUNT(*)::int AS cnt FROM projects WHERE deleted_at IS NULL`.catch(() => fallback0),
    sql`SELECT COUNT(*)::int AS cnt FROM projects WHERE deleted_at IS NULL AND data->>'audioMode' = 'podcast'`.catch(() => fallback0),
    sql`SELECT action, SUM(count)::int AS total FROM usage WHERE reset_at > NOW() GROUP BY action`.catch(() => []),
  ])

  let mrr = 0
  try {
    const priceList = await stripe.prices.list({ lookup_keys: ['pro_monthly'], active: true, limit: 1 })
    if (priceList.data[0]) {
      mrr = Number(proUsers[0]?.cnt ?? 0) * ((priceList.data[0].unit_amount ?? 0) / 100)
    }
  } catch {}

  const totalUsers = Number(users[0]?.cnt ?? 0)
  const proCount   = Number(proUsers[0]?.cnt ?? 0)
  const today      = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const prompt = `You are reviewing the weekly growth metrics for 100Lights, a SaaS creative platform (audio DAW, podcast editor, video, image editing).

## This Week's Metrics · ${today}
- Total users: ${totalUsers}
- Pro subscribers: ${proCount} (${totalUsers > 0 ? ((proCount / totalUsers) * 100).toFixed(1) : '0'}% conversion)
- Estimated MRR: $${mrr.toFixed(0)}
- New users this week: ${Number(newThisWeek[0]?.cnt ?? 0)}
- Total projects: ${Number(projects[0]?.cnt ?? 0)}
- Podcast projects: ${Number(podcastProjects[0]?.cnt ?? 0)}
- AI generations this period: ${Number((usageRows as { action: string; total: number }[]).find(r => r.action === 'ai_generate')?.total ?? 0)}

Write a concise weekly growth report (max 400 words) for the solo founder. Cover:
1. What changed this week vs expectations
2. The single most important metric to watch
3. The one action to take this week

Be direct. No fluff. Format in markdown.`

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return new Response('No API key', { status: 503 })

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'content-type':      'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key':         apiKey,
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) return new Response('AI error', { status: res.status })

  const data = await res.json() as { content: Array<{ type: string; text: string }> }
  const content = data.content.find(b => b.type === 'text')?.text ?? ''

  await saveWeeklyReport(content)

  return Response.json({ ok: true, length: content.length })
}
