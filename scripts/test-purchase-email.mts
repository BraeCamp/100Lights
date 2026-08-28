// ---------------------------------------------------------------------------
//  Send the real purchase email to yourself.
//
//    npx tsx --env-file=.env.local scripts/test-purchase-email.mts you@example.com
//
//  Goes through the same module the Stripe webhook calls, so what lands in the
//  inbox is exactly what a customer gets — not an approximation of it.
// ---------------------------------------------------------------------------
import { sendPluginPurchaseEmail } from '../lib/plugin-email'
import { pluginBySlug, PLUGINS } from '../lib/plugins-catalog'

const to = process.argv[2]
const slug = process.argv[3] ?? 'luz'
if (!to) {
  console.error('usage: npx tsx --env-file=.env.local scripts/test-purchase-email.mts <email> [slug]')
  console.error('slugs: ' + PLUGINS.map(p => p.slug).join(', '))
  process.exit(1)
}

const product = pluginBySlug(slug)
if (!product) {
  console.error(`No plug-in "${slug}". Known: ` + PLUGINS.map(p => p.slug).join(', '))
  process.exit(1)
}

const ok = await sendPluginPurchaseEmail({
  email: to,
  key: `${product.keyPrefix}-TEST-0000-0000-DEMO`,
  productName: product.name,
  seats: product.seats,
  downloadUrl: product.downloadUrl ?? '',
  checksum: product.checksum,
})

console.log(ok ? `sent to ${to}` : 'NOT SENT — check RESEND_API_KEY and EMAIL_FROM')
process.exit(ok ? 0 : 1)
