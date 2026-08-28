// ===========================================================================
//  The email a customer gets after buying a plug-in.
//
//  Uses the app's existing transactional email — same Resend key, same layout,
//  same suppression list as everything else 100Lights sends. There is one mail
//  system, not one per product.
//
//  The installer is NOT attached. It is 40 MB; Gmail rejects attachments over
//  25 MB, and a signed installer that arrives mangled by a mail server is
//  worse than no installer at all. Every plug-in vendor sends a link, and so
//  do we. The link is also how a customer reinstalls in two years.
// ===========================================================================
import { sendEmail } from '@/lib/email'
import { renderEmail, emailP, emailButton } from '@/lib/email-layout'

export interface PluginPurchase {
  email: string
  /** Licence key, in its display form: LUZ-XXXX-XXXX-XXXX-XXXX */
  key: string
  /** Product name as the buyer knows it. */
  productName: string
  seats: number
  downloadUrl: string
  /** sha256 of the installer, so a careful buyer can verify what they got. */
  checksum?: string
}

/** Monospace, generously spaced, and selectable — people copy this by hand. */
function keyBlock(key: string): string {
  return `<p style="margin:0 0 20px">
    <span style="display:inline-block;padding:14px 20px;border-radius:10px;background:#efecf9;
                 border:1px solid #d9d3f0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
                 font-size:18px;font-weight:700;letter-spacing:.06em;color:#2a2440">${key}</span>
  </p>`
}

export function renderPluginPurchaseEmail(p: PluginPurchase): { subject: string; html: string; text: string } {
  const subject = `Your ${p.productName} licence key`

  const html = renderEmail({
    heading: `${p.productName} is yours`,
    preheader: `Your licence key and download link for ${p.productName}`,
    bodyHtml:
      emailP('Thank you for buying it. Here is your licence key:') +
      keyBlock(p.key) +
      emailButton(p.downloadUrl, `Download ${p.productName} for macOS`) +
      emailP(
        '<strong>Installing:</strong> open the downloaded installer and follow it. ' +
        'It places the plug-in where your DAW already looks, so the next time you ' +
        'start Logic, Ableton Live, Reaper, Bitwig or any other host, it will be there.',
      ) +
      emailP(
        '<strong>Activating:</strong> add the plug-in to a track, open its Cloud page, ' +
        `and paste the key above. Your licence covers <strong>${p.seats} machines</strong>, ` +
        'and you can move a seat between computers whenever you like.',
      ) +
      emailP(
        'Until it is activated the plug-in runs in demo mode — everything works, and ' +
        'the sound dips briefly every 45 seconds. If you hear that, the key has not been ' +
        'entered yet.',
      ) +
      (p.checksum
        ? emailP(
            '<span style="font-size:12px;color:#7a7590">SHA-256 of the installer: ' +
            `<span style="font-family:ui-monospace,monospace">${p.checksum}</span></span>`,
          )
        : '') +
      emailP(
        '<span style="font-size:13px;color:#7a7590">Keep this email — the key is how you ' +
        'reinstall later. Just reply if anything goes wrong; a person reads it.</span>',
      ),
  })

  // A plain-text part is not decoration: some clients show it instead of the
  // HTML, and a customer whose key only existed in an HTML table cannot buy
  // their way out of that.
  const text = [
    `${p.productName} is yours.`,
    '',
    `Licence key:  ${p.key}`,
    `Download:     ${p.downloadUrl}`,
    p.checksum ? `SHA-256:      ${p.checksum}` : '',
    '',
    'Installing: open the installer and follow it. It puts the plug-in where',
    'your DAW already looks, so it will appear next time you start your host.',
    '',
    `Activating: add the plug-in to a track, open its Cloud page and paste the`,
    `key above. Your licence covers ${p.seats} machines.`,
    '',
    'Until activated it runs in demo mode: everything works, but the sound dips',
    'briefly every 45 seconds. If you hear that, the key is not entered yet.',
    '',
    'Keep this email — the key is how you reinstall later. Reply if anything',
    'goes wrong; a person reads it.',
  ].filter(Boolean).join('\n')

  return { subject, html, text }
}

/** Returns false when email is not configured or the send failed. The caller
 *  decides what to do about it — for a purchase, that means shouting. */
export async function sendPluginPurchaseEmail(p: PluginPurchase): Promise<boolean> {
  const { subject, html, text } = renderPluginPurchaseEmail(p)
  return sendEmail({ to: p.email, subject, html, text, role: 'support' })
}
