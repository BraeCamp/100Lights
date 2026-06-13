import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { getSubscription, getPlanLimits } from '@/lib/subscription'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const [sub, rows] = await Promise.all([
    getSubscription(userId),
    sql`SELECT action, count, reset_at FROM usage WHERE user_id = ${userId}`,
  ])

  const limits = getPlanLimits(sub.plan)
  const now = new Date()

  function getCount(action: string) {
    const row = rows.find(r => r.action === action)
    if (!row) return 0
    if (new Date(row.reset_at as string) <= now) return 0
    return Number(row.count)
  }

  return Response.json({
    plan: sub.plan,
    aiGenerations: { used: getCount('ai_generate'), limit: limits.aiGenerationsPerMonth },
    transcriptions: { used: getCount('transcribe'), limit: limits.transcriptionsPerMonth },
  })
}
