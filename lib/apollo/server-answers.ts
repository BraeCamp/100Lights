// What the server said about each part, and what to ask it next — the pure
// half of server loading, so it can be tested without a browser.
//
// ⚠️ THE RECORD, 2026-09-04 09:56, production: twenty parts rendered and
// stored, then thirty-two requests for the same parts in the next minute. The
// browser was refused every one of them on the hop to storage — the bucket's
// cross-origin rules list 100lights.com and localhost and not www.100lights.com
// — and nothing remembered that, so every scheduler pass asked again, four at
// a time, forever. "Rendering with server loading keeps failing."

export type ServerAnswer = { how: 'served' | 'refused' | 'failed'; at: number; why?: string }

/** A failure is retried, but not before this. */
export const SERVER_RETRY_MS = 90_000

/**
 * Which parts to ask the server for, given what it has already said.
 *
 * A refusal is asked once — the answer is a property of the part, not of the
 * moment. A failure is retried, but not before SERVER_RETRY_MS. A part that
 * was served and has since been evicted is asked again freely — storage has
 * it and a GET is cheap.
 */
export function serverAskQueue<T extends { key: string }>(
  wanted: T[],
  have: (key: string) => boolean,
  answered: Map<string, ServerAnswer>,
  now = Date.now(),
  retryMs = SERVER_RETRY_MS,
): T[] {
  return wanted.filter(w => {
    if (have(w.key)) return false
    const a = answered.get(w.key)
    if (!a) return true
    if (a.how === 'refused') return false
    if (a.how === 'failed') return now - a.at > retryMs
    return true
  })
}

/**
 * Why a fetch threw, given a probe of the studio's own route that did NOT
 * follow the redirect: if the route answered with a redirect, the route is
 * fine and what the browser refused was the hop to storage — which is what a
 * cross-origin rule on the bucket that does not list this site looks like
 * from here. The difference matters because one is fixed in a dashboard and
 * the other is an outage, and "Failed to fetch" says neither.
 */
export function explainServerFetchFailure(
  err: unknown,
  probe: { type: string; status: number } | null,
  origin: string,
): string {
  if (probe && (probe.type === 'opaqueredirect' || probe.status === 0)) {
    return `the browser was refused the render by storage — its cross-origin rules do not allow ${origin}`
  }
  return String(err instanceof Error ? err.message : err).slice(0, 90)
}
