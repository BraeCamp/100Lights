// ===========================================================================
//  Start a checkout for a plug-in.
//
//  Deliberately does NOT require a 100Lights account. A plug-in licence is
//  bound to an email address and a machine, not to a site login — someone who
//  wants a synth should not have to sign up for a web DAW first. Stripe
//  collects the email, and the webhook mints the licence against it.
//
//  metadata.kind = 'plugin' is what tells the Luz webhook this session is its
//  business. Every endpoint subscribed to checkout.session.completed sees
//  every purchase in the account, so the marker is load-bearing.
// ===========================================================================
import Stripe from 'stripe'
import { pluginBySlug } from '@/lib/plugins-catalog'

export const runtime = 'nodejs'

const siteUrl = () =>
  (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://100lights.com').replace(/\/$/, '')

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey)
    return Response.json({ error: 'Payments are not configured yet.' }, { status: 503 })

  const body = await request.json().catch(() => null)
  const slug = String(body?.slug ?? '')
  const product = pluginBySlug(slug)

  if (!product)
    return Response.json({ error: 'No such plug-in.' }, { status: 404 })

  // Two separate gates, because they fail for different reasons and the buyer
  // deserves to know which. `available` is the deliberate "not yet on sale"
  // switch; a missing price ID means someone forgot to finish the setup.
  if (!product.available)
    return Response.json({ error: `${product.name} is not on sale yet.` }, { status: 409 })

  if (!product.stripePriceId)
    return Response.json(
      { error: `${product.name} has no price configured.` },
      { status: 501 },
    )

  const stripe = new Stripe(secretKey)

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: product.stripePriceId, quantity: 1 }],
      // No customer id: this is a guest purchase keyed on whatever address
      // they type at checkout, which is also where the licence email goes.
      customer_creation: 'always',
      billing_address_collection: 'auto',
      metadata: {
        kind: 'plugin',
        product: product.slug,
        seats: String(product.seats),
      },
      // /store/plugins is the page that exists; there is no per-product route
      // yet, so the slug travels as a query param. Getting this wrong lands a
      // customer on a 404 in the same second they part with their money, which
      // is the worst possible moment to look broken.
      success_url: `${siteUrl()}/store/plugins?purchased=${product.slug}`,
      cancel_url: `${siteUrl()}/store/plugins`,
    })

    return Response.json({ url: session.url })
  } catch (err) {
    console.error('[plugins] checkout failed:', (err as Error).message)
    return Response.json({ error: 'Could not start checkout.' }, { status: 500 })
  }
}
