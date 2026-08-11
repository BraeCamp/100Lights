'use client'

// Save background media on the device so the visualizer works offline.
//
// Uses the Cache API (a dedicated cache, separate from the app shell). Saving fetches
// the asset once and stores it; rendering then reads it back as a blob URL, so it
// plays with no network — even a cross-origin CDN clip, as long as the CDN sends CORS
// (same-origin bundled images always work). `downloadToDevice` saves a real file to
// the user's Downloads folder.

const CACHE = '100l-bg-offline'

export async function saveAssets(urls: string[]): Promise<boolean> {
  try {
    const c = await caches.open(CACHE)
    await Promise.all(urls.filter(Boolean).map(u => c.add(u)))
    return true
  } catch { return false }   // e.g. cross-origin without CORS
}

export async function removeAssets(urls: string[]): Promise<void> {
  try { const c = await caches.open(CACHE); await Promise.all(urls.filter(Boolean).map(u => c.delete(u))) } catch { /* off */ }
}

export async function hasAsset(url: string): Promise<boolean> {
  try { const c = await caches.open(CACHE); return !!(await c.match(url)) } catch { return false }
}

/** A local blob URL for a cached asset, or null if it isn't saved. Caller revokes it. */
export async function localUrl(url: string): Promise<string | null> {
  try {
    const c = await caches.open(CACHE)
    const r = await c.match(url)
    if (!r) return null
    return URL.createObjectURL(await r.blob())
  } catch { return null }
}

export async function downloadToDevice(url: string, filename: string): Promise<boolean> {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1500)
    return true
  } catch { return false }
}
