import { createHmac, timingSafeEqual } from 'crypto'

// Signed draft-preview tokens: a stable, unguessable token per slug so an author
// (or anyone the admin hands the link to) can preview an unpublished article
// without being an admin. Server-only. Low stakes — it gates unpublished
// marketing copy, not sensitive data — so a slug-scoped HMAC is enough.

const SECRET = process.env.ARTICLE_PREVIEW_SECRET || process.env.ADMIN_CODE || 'insecure-dev-preview-secret'

export function signPreviewToken(slug: string): string {
  return createHmac('sha256', SECRET).update(`article-preview:${slug}`).digest('hex').slice(0, 32)
}

export function verifyPreviewToken(slug: string, token: string | undefined | null): boolean {
  if (!token) return false
  const expected = signPreviewToken(slug)
  if (token.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  } catch {
    return false
  }
}

/** Absolute shareable preview URL for a slug. */
export function previewUrl(slug: string): string {
  return `https://100lights.com/learn/preview/${slug}?token=${signPreviewToken(slug)}`
}
