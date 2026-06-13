import { auth } from '@clerk/nextjs/server'
import { stripe, getProPrice } from '@/lib/stripe'
import { getSubscription } from '@/lib/subscription'

const RETURN_URL = 'https://100lights.com/settings'

async function getOrCreatePortalConfig(): Promise<string> {
  const [configs, proPrice] = await Promise.all([
    stripe.billingPortal.configurations.list({ is_default: true, limit: 1 }),
    getProPrice(),
  ])
  if (configs.data.length > 0) return configs.data[0].id

  const config = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: 'Manage your 100Lights subscription',
      privacy_policy_url: 'https://100lights.com/legal/privacy',
      terms_of_service_url: 'https://100lights.com/legal/terms',
    },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'tax_id'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'always_invoice',
        products: [{ product: proPrice.productId, prices: [proPrice.id] }],
      },
    },
    default_return_url: RETURN_URL,
  })

  return config.id
}

export async function POST() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sub = await getSubscription(userId)
  if (!sub.stripeCustomerId) {
    return Response.json({ error: 'No billing account found' }, { status: 404 })
  }

  const configurationId = await getOrCreatePortalConfig()

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    configuration: configurationId,
    return_url: RETURN_URL,
  })

  return Response.json({ url: portalSession.url })
}
