// ---------------------------------------------------------------------------
//  Issue a licence to someone without a purchase.
//
//    npx tsx --env-file=.env.local scripts/grant-license.mts <email> [slug] [--email-it]
//
//  For the owner's own machines, support replacements, review copies and
//  competition prizes. Idempotent on the order_ref, so running it twice for the
//  same person and product returns the key they already have rather than
//  quietly minting a second one and burning a seat allowance.
//
//  Pass --email-it to also send the normal purchase email, which is the right
//  thing for a review copy: they get the same download link and instructions a
//  customer would.
// ---------------------------------------------------------------------------
import { sql } from '../lib/db'
import { generateLicenseKey } from '../lib/luz-license'
import { pluginBySlug, PLUGINS } from '../lib/plugins-catalog'
import { sendPluginPurchaseEmail } from '../lib/plugin-email'

const args = process.argv.slice(2)
const email = args.find(a => a.includes('@'))
const slug = args.find(a => !a.startsWith('--') && !a.includes('@')) ?? 'luz'
const alsoEmail = args.includes('--email-it')

if (!email) {
  console.error('usage: npx tsx --env-file=.env.local scripts/grant-license.mts <email> [slug] [--email-it]')
  console.error('slugs: ' + PLUGINS.map(p => p.slug).join(', '))
  process.exit(1)
}

const product = pluginBySlug(slug)
if (!product) {
  console.error(`No plug-in "${slug}". Known: ` + PLUGINS.map(p => p.slug).join(', '))
  process.exit(1)
}

// Stable, so a second run finds the first grant instead of making another.
const orderRef = `grant:${product.slug}:${email.toLowerCase()}`

const existing = (await sql`
  SELECT key, seats_allowed FROM luz_licenses WHERE order_ref = ${orderRef} LIMIT 1
`) as Array<{ key: string; seats_allowed: number }>

let key: string
let seats: number

if (existing.length > 0) {
  key = existing[0].key
  seats = existing[0].seats_allowed
  console.log(`\n  Already granted — reusing the existing licence.`)
} else {
  key = generateLicenseKey(product.keyPrefix)
  seats = product.seats
  await sql`
    INSERT INTO luz_licenses (key, product, owner, email, order_ref, seats_allowed, note)
    VALUES (${key}, ${product.slug}, '', ${email.toLowerCase()}, ${orderRef}, ${seats},
            'granted, not purchased')
  `
  console.log(`\n  Granted a new licence.`)
}

console.log(`\n  product   ${product.name}`)
console.log(`  email     ${email}`)
console.log(`  seats     ${seats}`)
console.log(`  key       ${key}\n`)

if (alsoEmail) {
  const sent = await sendPluginPurchaseEmail({
    email,
    key,
    productName: product.name,
    seats,
    downloadUrl: product.downloadUrl ?? '',
    checksum: product.checksum,
  })
  console.log(sent ? '  emailed it too.\n' : '  EMAIL FAILED — the licence exists, the message did not send.\n')
}

console.log('  Paste the key into the plug-in: add it to a track, open its Cloud')
console.log('  page, and enter the key there. Activation needs /api/luz to be live.\n')
process.exit(0)
