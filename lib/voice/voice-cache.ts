// ── Paid for once, by whoever says it first ─────────────────────────────────
//
// Brae: "Can't we record the response and just play it off of our system so
// that we aren't paying at all after one person uses something once?"
//
// Yes, and the correction matters: the cost model I gave was per-user, and it
// should not have been. A recording of "Drums: muted." is the same recording for
// everybody. Cached in one browser it saves that browser; cached on the server
// it is bought once and then belongs to the product.
//
// That changes the shape of the bill entirely. Per user it was a running cost
// that scaled with how many people used it. Shared, it is a FIXED cost that
// scales with how many distinct sentences exist — and there are not many,
// because the studio speaks from a script of about a hundred and forty shapes.
// A new user costs nothing except the handful of their track names nobody has
// used before.
//
// The key is the text itself. Two people on opposite sides of the world muting a
// track called Drums produce the same bytes and get the same file, without
// anything having to know they are related.

/** Where a phrase lives, given the words and the voice saying them. */
export function voiceKey(text: string, voiceId: string): string {
  return `voice/${voiceId}/${hashText(text)}.mp3`
}

/**
 * The text, reduced to what actually matters for identity.
 *
 * "Drums: muted." and "drums:  muted" are the same recording, and treating them
 * as different is paying twice for one file. Case and spacing go; punctuation
 * stays, because it changes how a sentence is read aloud.
 */
export function normaliseSpoken(text: string): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * A stable key for a string.
 *
 * FNV-1a rather than a crypto hash: this is a cache key, not a secret, and it
 * has to produce the same value in the browser and on the server without either
 * of them importing a hashing library. Collisions would serve the wrong audio,
 * so it is 64 bits, taken as two independent 32-bit passes.
 */
export function hashText(text: string): string {
  const s = normaliseSpoken(text)
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a ^= c
    a = Math.imul(a, 0x01000193) >>> 0
    b ^= c + i
    b = Math.imul(b, 0x85ebca6b) >>> 0
  }
  return (a.toString(36) + b.toString(36)).padStart(13, '0')
}

/**
 * Is this something the studio would ever say?
 *
 * The endpoint is open to any signed-in account, so without this it is a
 * text-to-speech API somebody else is paying for. It cannot verify an exact
 * sentence — most of them contain a track name that only the caller knows — so
 * it checks the SHAPE: short, one sentence, no markup, and made of the
 * characters a read-back is made of.
 *
 * Deliberately conservative. Anything refused here falls back to the browser's
 * own voice, which is free and always available, so the cost of being wrong is
 * that one sentence sounds worse.
 */
export function looksSpeakable(text: string): boolean {
  const t = String(text ?? '').trim()
  if (t.length < 2 || t.length > 240) return false
  // A read-back is one or two sentences. Anything longer is somebody using this
  // as a general-purpose narrator.
  if ((t.match(/[.!?]/g) ?? []).length > 3) return false
  if (/[<>{}\\|`~^]/.test(t)) return false
  if (/https?:\/\//i.test(t)) return false
  // Mostly letters. A string that is largely digits or symbols is not a
  // sentence, and rendering it is neither useful nor cheap.
  const letters = (t.match(/[a-z]/gi) ?? []).length
  return letters >= t.length * 0.5
}

/** How many misses one account may cause in a day.
 *
 *  A hit is free and unlimited — that is the whole point. A MISS spends money,
 *  so it is bounded per account: enough that nobody working normally will ever
 *  see it, few enough that a script cannot run up a bill. */
export const MISS_BUDGET_PER_DAY = 250
