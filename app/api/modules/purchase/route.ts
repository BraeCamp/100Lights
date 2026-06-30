import { auth } from '@clerk/nextjs/server'
import { stripe } from '@/lib/stripe'

export const runtime = 'nodejs'

const MODULE_PRICES: Record<string, { amount: number; name: string }> = {
  video:       { amount: 7900,  name: 'Video Editor' },
  image:       { amount: 3900,  name: 'Image Editor' },
  audio_pro:   { amount: 4900,  name: 'Audio Pro' },
  all_creative: { amount: 12900, name: 'All Creative' },
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://100lights.com'

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { moduleKey?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const moduleKey = body.moduleKey
  if (!moduleKey || !MODULE_PRICES[moduleKey]) {
    return Response.json({ error: 'Unknown module key' }, { status: 400 })
  }

  const { amount, name } = MODULE_PRICES[moduleKey]

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `100Lights — ${name}` },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    metadata: { userId, moduleKey },
    success_url: `${BASE_URL}/api/modules/confirm?session_id={CHECKOUT_SESSION_ID}&module=${moduleKey}`,
    cancel_url: `${BASE_URL}/launcher`,
  })

  return Response.json({ url: session.url })
}
