// ---------------------------------------------------------------------------
//  Send the real purchase email to yourself.
//
//    npx tsx --env-file=.env.local scripts/test-purchase-email.mts you@example.com
//
//  Goes through the same module the Stripe webhook calls, so what lands in the
//  inbox is exactly what a customer gets — not an approximation of it.
// ---------------------------------------------------------------------------
import { sendPluginPurchaseEmail } from '../lib/luz-email'
import { LUZ } from '../lib/plugins-catalog'

const to = process.argv[2]
if (!to) {
  console.error('usage: npx tsx --env-file=.env.local scripts/test-purchase-email.mts <email>')
  process.exit(1)
}

const ok = await sendPluginPurchaseEmail({
  email: to,
  key: 'LUZ-TEST-0000-0000-DEMO',
  productName: LUZ.name,
  seats: LUZ.seats,
  downloadUrl: LUZ.downloadUrl ?? '',
  checksum: LUZ.checksum,
})

console.log(ok ? `sent to ${to}` : 'NOT SENT — check RESEND_API_KEY and EMAIL_FROM')
process.exit(ok ? 0 : 1)
