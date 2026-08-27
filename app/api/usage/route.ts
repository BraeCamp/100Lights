import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { getSubscription, getPlanLimits } from '@/lib/subscription'
import { storageUsage } from '@/lib/storage-usage'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sub = await getSubscription(userId)
  const limits = getPlanLimits(sub.plan)

  // One shared definition of space used — media AND project data. See
  // lib/storage-usage.ts for why projects count.
  const usage = await storageUsage(userId)

  return Response.json({
    plan: sub.plan,
    storage: {
      usedBytes: usage.totalBytes,
      mediaBytes: usage.mediaBytes,
      projectBytes: usage.projectBytes,
      limitBytes: limits.storageMb * 1024 * 1024,
    },
  })
}
