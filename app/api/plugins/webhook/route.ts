import Stripe from 'stripe';
import { issueLicenseForOrder } from '@/lib/luz-license';
import { sendPluginPurchaseEmail } from '@/lib/plugin-email';
import { pluginBySlug } from '@/lib/plugins-catalog';

export const runtime = 'nodejs';

// Next gives us the raw body via request.text(), which is what Stripe's
// signature is computed over.
export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  // Every Stripe webhook ENDPOINT gets its own signing secret, and this is a
  // second endpoint alongside whichever one the rest of the site already uses.
  // Sharing STRIPE_WEBHOOK_SECRET between them means one of the two always
  // fails its signature check — silently, because a rejected webhook looks
  // identical to one that was never sent. Set PLUGINS_STRIPE_WEBHOOK_SECRET to
  // this endpoint's own whsec_; the fallback only helps if you deliberately
  // point a single endpoint at both.
  const webhookSecret =
    process.env.PLUGINS_STRIPE_WEBHOOK_SECRET ?? process.env.STRIPE_WEBHOOK_SECRET;

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

      // Only plugin purchases mint a plug-in licence. This endpoint lives in
      // the same Stripe account as memberships, Lumens and module purchases,
      // and Stripe sends checkout.session.completed for ALL of them to EVERY
      // endpoint subscribed to it. Without this guard, buying credits would
      // also mint a Luz licence and email it to the customer — a stranger's
      // top-up would hand them the synth for free.
      if (session.metadata?.kind !== 'plugin')
        return Response.json({ received: true, skipped: 'not a plugin purchase' });

      const email = session.customer_details?.email ?? session.customer_email;
      if (!email) return Response.json({ received: true, skipped: 'no email' });

      // Which plug-in was bought is carried on the session, not baked into
      // this route. One endpoint and one signing secret serve every product
      // we will ever sell; adding a plug-in is a catalog entry, not a new
      // webhook, a new secret and another redeploy.
      const slug = session.metadata?.product ?? 'luz';
      const catalogEntry = pluginBySlug(slug);

      const { license, created } = await issueLicenseForOrder({
        keyPrefix: catalogEntry?.keyPrefix,
        email,
        owner: session.customer_details?.name ?? '',
        orderRef: session.id,
        seats: session.metadata?.seats ?? undefined,
        product: session.metadata?.product ?? 'luz',
      });

      // Deliver the key. This is the whole point of the purchase: a customer
      // who pays and receives nothing has been robbed, however good the code
      // upstream of here is. So a failure to send is logged loudly AND
      // answered with a 500, which makes Stripe retry the webhook rather than
      // letting the failure disappear into a 200.
      if (created) {
        const product = catalogEntry ?? pluginBySlug(license.product);
        if (!product) {
          console.error(
            `[plugins] licence issued for unknown product "${slug}" — order ` +
            `${session.id}, ${email}, key ${license.key}. Add it to the catalog.`,
          );
          return Response.json({ error: 'Unknown product.' }, { status: 500 });
        }
        const sent = await sendPluginPurchaseEmail({
          email,
          key: license.key,
          productName: product.name,
          seats: license.seats_allowed,
          downloadUrl: product.downloadUrl ?? '',
          checksum: product.checksum,
        });

        if (!sent) {
          console.error(
            `[plugins] LICENCE ISSUED BUT NOT DELIVERED — order ${session.id}, ` +
            `${email}, key ${license.key}. Send it by hand.`,
          );
          return Response.json({ error: 'Licence issued but delivery failed.' }, { status: 500 });
        }
      }

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
