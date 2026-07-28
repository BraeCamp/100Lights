import crypto from 'crypto'

// Opt-in field-level encryption for sensitive tax data (a TIN/SSN). The key
// comes from env AFFILIATE_TAX_KEY (32 bytes, hex or base64). When it isn't set,
// encryptField returns null so callers degrade gracefully — the app simply does
// not retain the TIN (the recommended default; the e-file service collects it).

function getKey(): Buffer | null {
  const raw = process.env.AFFILIATE_TAX_KEY
  if (!raw) return null
  try {
    const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
    return buf.length === 32 ? buf : null
  } catch { return null }
}

export function fieldEncryptionAvailable(): boolean {
  return getKey() !== null
}

/** AES-256-GCM → base64(iv|tag|ciphertext). Null when no key or empty input. */
export function encryptField(plain: string): string | null {
  const key = getKey()
  if (!key || !plain) return null
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')
}

export function decryptField(blob: string | null | undefined): string | null {
  const key = getKey()
  if (!key || !blob) return null
  try {
    const raw = Buffer.from(blob, 'base64')
    const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    d.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
  } catch {
    return null
  }
}
