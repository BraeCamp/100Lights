'use client'

// Whether to keep rendered audio on disk, and when it is safe to write it.
//
// Brae's shape for this, and it is the right one:
//
//   "it should play with persistent storage or without it. After detecting what
//    it needs to do, the program needs to figure it out… we still have the
//    option of loading procedurally so that the song can load slightly in front
//    of the playhead. It should only be loading into persistent storage if the
//    song is paused and only after detecting how fast it can load without
//    slowing down the browser. With the app, persistent storage will be a given."
//
// Three separate questions, which were previously answered by one hard-coded
// "always write":
//
//   CAN we keep it?     A browser in private mode, or one that has already
//                       refused the quota, will throw on every write — and each
//                       failure costs the conversion work before it fails.
//   SHOULD we, now?     Writing competes with playback for the main thread. A
//                       write while the transport is running is a stutter; the
//                       same write while paused costs nothing anyone can hear.
//   How MUCH at once?   A machine that takes 40ms per clip cannot take the same
//                       burst as one that takes 4ms.
//
// Playback never depends on any of it. When storage is unavailable the studio
// renders ahead of the playhead exactly as it does on a first open — that path
// is not a fallback bolted on for this, it is the normal path with the cache
// permanently missing.

export type StorageMode =
  /** Keep renders on disk; a second open is nearly instant. */
  | 'persistent'
  /** Disk is available but may be evicted under pressure — still worth using. */
  | 'best-effort'
  /** No disk. Render ahead of the playhead every time, and never try to write. */
  | 'none'

export interface StoragePolicy {
  mode: StorageMode
  /** Why, in words, for the interface and for support. */
  reason: string
  /** Roughly how much we may keep, if the browser will say. */
  quotaBytes: number | null
}

let cached: StoragePolicy | null = null
let probing: Promise<StoragePolicy> | null = null

/** Running inside the packaged app rather than a browser tab. */
function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as Window & { Capacitor?: unknown; electronAPI?: unknown }
  return !!w.Capacitor || !!w.electronAPI
}

/**
 * What this device will let us keep. Probed once, then remembered — the answer
 * does not change within a session, and `estimate()` is not free.
 */
export function storagePolicy(): Promise<StoragePolicy> {
  if (cached) return Promise.resolve(cached)
  if (probing) return probing
  probing = (async (): Promise<StoragePolicy> => {
    const settle = (p: StoragePolicy) => { cached = p; return p }

    if (typeof indexedDB === 'undefined') {
      return settle({ mode: 'none', reason: 'this browser has no local database', quotaBytes: null })
    }

    // In the app there is no quota negotiation to do and no private mode to
    // fall foul of — storage is ours. Skip the probe and say so.
    if (isNativeShell()) {
      return settle({ mode: 'persistent', reason: 'running in the app', quotaBytes: null })
    }

    let quotaBytes: number | null = null
    try {
      const est = await navigator.storage?.estimate?.()
      if (est?.quota != null) quotaBytes = est.quota
    } catch { /* not offered */ }

    // A quota this small is private browsing or a device with nothing left. The
    // writes would fail one at a time, each after doing the conversion work.
    if (quotaBytes != null && quotaBytes < 32 * 1024 * 1024) {
      return settle({ mode: 'none', reason: 'there is almost no room on this device', quotaBytes })
    }

    try {
      if (await navigator.storage?.persisted?.()) {
        return settle({ mode: 'persistent', reason: 'this browser keeps our audio between visits', quotaBytes })
      }
      // Ask once. Granted silently in installed contexts and where the site is
      // used often; declined elsewhere, which is not a problem — best-effort
      // storage still survives a reload, it is only evicted under pressure.
      if (await navigator.storage?.persist?.()) {
        return settle({ mode: 'persistent', reason: 'this browser agreed to keep our audio', quotaBytes })
      }
    } catch { /* not offered */ }

    return settle({ mode: 'best-effort', reason: 'audio is kept until the browser needs the space', quotaBytes })
  })()
  return probing
}

// ── When a write is free ────────────────────────────────────────────────────
//
// The rule is Brae's: write while the song is PAUSED. While it plays, the main
// thread belongs to playback, and a burst of Int16 conversions there is heard.
// Renders that land during playback are not thrown away — they are already in
// memory and already audible — they simply wait for a quiet moment before being
// written down.

let transportPlaying = false
export function setStorageTransportPlaying(playing: boolean): void {
  transportPlaying = playing
  if (!playing) void flushPending()
}

type Pending = { stamp: string; buf: AudioBuffer }
const pending: Pending[] = []
let flushing = false

/** How long the last few writes took, so the burst size fits the machine. */
let msPerWrite = 0
const learnWrite = (ms: number) => { msPerWrite = msPerWrite ? msPerWrite * 0.7 + ms * 0.3 : ms }

/**
 * How many clips to write in one go.
 *
 * Measured, not assumed: a fast machine writes a clip in a couple of
 * milliseconds and can take a dozen without anyone noticing, while a slow one
 * takes 40ms and should do two. The budget is ~120ms of work per burst, which
 * is short enough to sit between frames.
 */
function burstSize(): number {
  if (!msPerWrite) return 2          // learn from a small one first
  return Math.max(1, Math.min(12, Math.floor(120 / msPerWrite)))
}

let writer: ((stamp: string, buf: AudioBuffer) => Promise<void>) | null = null
/** Injected so this module does not depend on the store, or on a browser. */
export function setCombineWriter(fn: (stamp: string, buf: AudioBuffer) => Promise<void>): void {
  writer = fn
}

/**
 * Keep this render for next time — when that is free to do.
 *
 * Returns immediately. Nothing waits on the write: the clip is already playable
 * the moment it is in memory, and persisting it only matters to the NEXT visit.
 */
export async function keepForNextTime(stamp: string, buf: AudioBuffer): Promise<void> {
  const policy = await storagePolicy()
  if (policy.mode === 'none') return
  pending.push({ stamp, buf })
  if (!transportPlaying) void flushPending()
}

async function flushPending(): Promise<void> {
  if (flushing || !writer) return
  flushing = true
  try {
    while (pending.length && !transportPlaying) {
      const burst = pending.splice(0, burstSize())
      const t = performance.now()
      let done = 0
      for (const p of burst) {
        // Checked per WRITE, not per burst. The loop condition above only ran
        // between bursts, so pressing play in the middle of one let the whole
        // burst finish — and saveCombined converts both channels to Int16
        // synchronously before its first await, so that is heard.
        //
        // A CPU profile put `transaction` (483ms) and `put` (105ms) at the top
        // of the main thread DURING playback, above everything the transport
        // itself does. Whatever has not been written yet goes back on the queue
        // and waits for the pause; it costs nothing to defer, because these
        // writes only matter to the NEXT visit.
        if (transportPlaying) break
        try { await writer(p.stamp, p.buf) } catch { /* a failed write costs nothing that matters */ }
        done++
      }
      if (done < burst.length) pending.unshift(...burst.slice(done))
      if (done) learnWrite((performance.now() - t) / done)
      // Hand the browser a turn between bursts, always — this runs while the
      // user is doing something else, and "paused" does not mean "idle".
      await new Promise(r => setTimeout(r, 0))
    }
  } finally { flushing = false }
}

/** For diagnostics: what is waiting, and how fast writing has been. */
export function storageStats(): { pending: number; msPerWrite: number; burst: number } {
  return { pending: pending.length, msPerWrite: Math.round(msPerWrite * 10) / 10, burst: burstSize() }
}
