// Shared branded shell for every transactional email. Callers supply the inner
// content (bodyHtml); this wraps it in a consistent 100Lights header, card, and
// footer. Email-safe: div-based with fully inline styles, light background
// (dark-mode rendering in mail clients is inconsistent), no external CSS.
//
// Logo: emails can't use SVG or local files, so we point at a hosted PNG.
// Defaults to the existing app icon; override with EMAIL_LOGO_URL (e.g. a
// wordmark you drop in public/).

const LOGO_URL = process.env.EMAIL_LOGO_URL ?? 'https://100lights.com/icon-512.png'
const SITE = 'https://100lights.com'

export interface EmailContent {
  heading: string
  /** Inner HTML — paragraphs, lists, CTAs (use emailButton / emailP). */
  bodyHtml: string
  /** Hidden inbox-preview text. */
  preheader?: string
}

export function emailP(text: string): string {
  return `<p style="font-size:15px;line-height:1.65;color:#3a3550;margin:0 0 16px">${text}</p>`
}

export function emailButton(href: string, label: string): string {
  return `<p style="margin:4px 0 20px"><a href="${href}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px">${label}</a></p>`
}

export function renderEmail({ heading, bodyHtml, preheader }: EmailContent): string {
  return `<div style="margin:0;padding:0;background:#f4f2fa">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>` : ''}
  <div style="background:#f4f2fa;padding:28px 16px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto">

      <!-- header -->
      <div style="text-align:center;padding:0 0 20px">
        <a href="${SITE}" style="text-decoration:none;display:inline-flex;align-items:center;gap:9px">
          <img src="${LOGO_URL}" width="34" height="34" alt="100Lights" style="border-radius:8px;vertical-align:middle" />
          <span style="font-size:19px;font-weight:800;color:#1b1922;letter-spacing:-0.01em">100Lights</span>
        </a>
      </div>

      <!-- card -->
      <div style="background:#ffffff;border:1px solid #e7e2f1;border-radius:16px;padding:30px 28px">
        <h1 style="font-size:21px;line-height:1.3;font-weight:800;color:#1b1922;margin:0 0 16px">${heading}</h1>
        ${bodyHtml}
      </div>

      <!-- footer -->
      <div style="text-align:center;padding:20px 8px 4px">
        <p style="font-size:12px;color:#8a86a0;margin:0 0 6px">100Lights — the music studio in your browser.</p>
        <p style="font-size:12px;color:#a5a1b5;margin:0">
          <a href="${SITE}" style="color:#8a86a0;text-decoration:none">100lights.com</a> ·
          <a href="${SITE}/learn" style="color:#8a86a0;text-decoration:none">Learn</a> ·
          <a href="${SITE}/community" style="color:#8a86a0;text-decoration:none">Community</a>
        </p>
      </div>

    </div>
  </div>
</div>`
}
