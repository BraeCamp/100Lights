import { stripe } from '@/lib/stripe'
import { sql } from '@/lib/db'
import { redirect } from 'next/navigation'

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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('session_id')
  const moduleKey = searchParams.get('module')

  if (!sessionId || !moduleKey) {
    redirect('/launcher')
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)

    if (session.payment_status !== 'paid') {
      redirect('/launcher')
    }

    const userId = session.metadata?.userId
    if (!userId) {
      redirect('/launcher')
    }

    await ensureTable()

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null)

    await sql`
      INSERT INTO module_licenses (user_id, module_key, license_type, stripe_payment_intent_id)
      VALUES (${userId}, ${moduleKey}, 'purchased', ${paymentIntentId})
      ON CONFLICT (user_id, module_key) DO NOTHING
    `
  } catch {
    redirect('/launcher')
  }

  redirect(`/launcher?activated=${moduleKey}`)
}
