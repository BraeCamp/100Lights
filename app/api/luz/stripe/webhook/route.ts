import Stripe from 'stripe';
import { issueLicenseForOrder } from '@/lib/luz-license';

export const runtime = 'nodejs';

// Next gives us the raw body via request.text(), which is what Stripe's
// signature is computed over.
export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret)
    return Response.json({ error: 'Stripe is not configured.' }, { status: 503 });

  const stripe = new Stripe(secretKey);
  const raw = await request.text();
  const signature = request.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, webhookSecret);
  } catch (err) {
    console.error('Stripe signature check failed:', (err as Error).message);
    return Response.json({ error: 'Bad signature.' }, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.payment_status !== 'paid')
        return Response.json({ received: true, skipped: 'not paid yet' });

      const email = session.customer_details?.email ?? session.customer_email;
      if (!email) return Response.json({ received: true, skipped: 'no email' });

      const { license, created } = await issueLicenseForOrder({
        email,
        owner: session.customer_details?.name ?? '',
        orderRef: session.id,
        seats: session.metadata?.seats ?? undefined,
        product: session.metadata?.product ?? 'luz',
      });

      if (created && process.env.LUZ_LICENSE_WEBHOOK_URL) {
        await fetch(process.env.LUZ_LICENSE_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, name: license.owner, key: license.key,
                                 product: license.product, orderRef: license.order_ref }),
        }).catch((e) => console.error('Licence delivery hook failed:', e.message));
      }
    }

    return Response.json({ received: true });
  } catch (err) {
    console.error(err);
    // 500 makes Stripe retry, which is right for a transient failure.
    return Response.json({ error: 'Could not fulfil that order.' }, { status: 500 });
  }
}
