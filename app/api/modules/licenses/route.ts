import { auth } from '@clerk/nextjs/server'
import { sql } from '@/lib/db'
import { getSubscription } from '@/lib/subscription'
import { ALL_MODULE_KEYS, type ModuleKey } from '@/lib/editor-types'

export const runtime = 'nodejs'

let tableReady = false
async function ensureTable() {
  if (tableReady) return
  await sql`
    CREATE TABLE IF NOT EXISTS module_licenses (
      user_id TEXT NOT NULL,
      module_key TEXT NOT NULL,
      license_type TEXT NOT NULL CHECK (license_type IN ('free', 'purchased', 'bundle')),
      purchased_at TIMESTAMPTZ DEFAULT NOW(),
      stripe_payment_intent_id TEXT,
      PRIMARY KEY (user_id, module_key)
    )
  `
  tableReady = true
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureTable()

  const [sub, rows] = await Promise.all([
    getSubscription(userId),
    sql`SELECT module_key, license_type FROM module_licenses WHERE user_id = ${userId}`,
  ])

  const isPro = sub.plan === 'pro' && sub.status === 'active'
  const ownedKeys = new Set(rows.map(r => r.module_key as string))

  const licenses = Object.fromEntries(
    ALL_MODULE_KEYS.map((key: ModuleKey) => {
      const isAudio = key === 'audio'
      const owned = isAudio || isPro || ownedKeys.has(key)
      const row = rows.find(r => r.module_key === key)
      const licenseType = isAudio
        ? 'free'
        : isPro
        ? 'bundle'
        : row
        ? (row.license_type as string)
        : null
      return [key, { owned, licenseType }]
    }),
  ) as Record<ModuleKey, { owned: boolean; licenseType: string | null }>

  return Response.json({ licenses })
}
