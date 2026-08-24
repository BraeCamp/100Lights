// Run a table's CREATE TABLE IF NOT EXISTS once per process.
//
// Four routes had each written the same `let ready = false; async function
// ensureSchema()` guard. The pattern is fine; four copies of it is just noise,
// and a copy that forgets to set its flag re-runs DDL on every request.

/**
 * Wrap schema setup so it runs at most once, and so a failure does not leave it
 * permanently "ready".
 *
 * Concurrent callers share the in-flight promise rather than each starting
 * their own CREATE TABLE — the reason to hand back the promise instead of
 * early-returning is the same one that bit the preset buffer loader: a bare
 * return resolves instantly while the real work is still going.
 */
export function onceSchema(setup: () => Promise<void>): () => Promise<void> {
  let done = false
  let inflight: Promise<void> | null = null
  return () => {
    if (done) return Promise.resolve()
    if (inflight) return inflight
    inflight = setup()
      .then(() => { done = true })
      .catch(err => { inflight = null; throw err })
      .finally(() => { if (done) inflight = null })
    return inflight
  }
}
