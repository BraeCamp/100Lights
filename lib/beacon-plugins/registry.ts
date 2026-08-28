'use client'
// ============================================================================
//  Beacon plugin registry — what plugins exist and where they came from.
//
//  Three sources, all ending up in one list:
//    builtin  shipped with Beacon under /plugins/<id>/
//    url      a manifest URL the user pasted in, remembered locally
//    bridge   a real AU/VST3/CLAP reported by the Beacon Bridge
//
//  Scanning never throws. A plugin that fails to load becomes a descriptor
//  with an `error` on it, so the picker can show it greyed out with the reason
//  instead of silently omitting it — "my synth vanished" is a much worse bug
//  report than "my synth says it needs a newer Beacon".
// ============================================================================

import {
  validateManifest,
  type PluginDescriptor,
  type PluginManifest,
} from './types'

/** Plugins that ship with Beacon. Each is a folder under public/plugins/. */
const BUILTIN_IDS = [
  'app.100lights.luz',
  'app.100lights.example',
] as const

const USER_PLUGINS_KEY = 'beacon.plugins.urls'

let cache: PluginDescriptor[] | null = null
let scanning: Promise<PluginDescriptor[]> | null = null
const listeners = new Set<() => void>()

// ---------------------------------------------------------------------------

function notify(): void {
  for (const fn of listeners) {
    try { fn() } catch { /* a broken listener must not break the scan */ }
  }
}

export function onRegistryChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function absolute(url: string): string {
  if (typeof window === 'undefined') return url
  try { return new URL(url, window.location.origin).toString() } catch { return url }
}

/** The folder a manifest lives in, which every other path is relative to. */
export function baseOf(manifestUrl: string): string {
  const i = manifestUrl.lastIndexOf('/')
  return i >= 0 ? manifestUrl.slice(0, i + 1) : manifestUrl
}

/** Resolve a manifest-relative path (processor, wasm, ui, icon). */
export function resolveAsset(descriptor: PluginDescriptor, path: string): string {
  return new URL(path, descriptor.baseUrl).toString()
}

// ---------------------------------------------------------------------------

function readUserUrls(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(USER_PLUGINS_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

function writeUserUrls(urls: string[]): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(USER_PLUGINS_KEY, JSON.stringify(urls)) } catch { /* private mode */ }
}

export function getUserPluginUrls(): string[] {
  return readUserUrls()
}

/** Add a plugin by manifest URL. Returns the descriptor, loaded or failed. */
export async function addPluginUrl(url: string): Promise<PluginDescriptor> {
  const clean = url.trim()
  const descriptor = await loadManifest(clean, 'url')

  if (!descriptor.error) {
    const urls = readUserUrls()
    if (!urls.includes(clean)) writeUserUrls([...urls, clean])
    cache = null
    notify()
  }
  return descriptor
}

export function removePluginUrl(url: string): void {
  writeUserUrls(readUserUrls().filter(u => u !== url))
  cache = null
  notify()
}

// ---------------------------------------------------------------------------

async function loadManifest(manifestUrl: string, source: 'builtin' | 'url'): Promise<PluginDescriptor> {
  const abs = absolute(manifestUrl)
  const fallback: PluginDescriptor = {
    id: abs,
    name: abs.split('/').filter(Boolean).slice(-2, -1)[0] ?? 'Unknown plugin',
    vendor: '',
    version: '',
    kind: 'instrument',
    source,
    baseUrl: baseOf(abs),
    manifest: null,
  }

  try {
    const res = await fetch(abs, { cache: 'no-cache' })
    if (!res.ok) return { ...fallback, error: `The manifest could not be fetched (${res.status}).` }

    const json = (await res.json()) as unknown
    const checked = validateManifest(json)
    if (!checked.ok) return { ...fallback, error: checked.error }

    const m: PluginManifest = checked.manifest
    return {
      id: m.id,
      name: m.name,
      vendor: m.vendor,
      version: m.version,
      kind: m.kind,
      source,
      baseUrl: baseOf(abs),
      manifest: m,
    }
  } catch (err) {
    return { ...fallback, error: err instanceof Error ? err.message : 'The manifest could not be read.' }
  }
}

// ---------------------------------------------------------------------------

/** Every plugin Beacon can see. Cached; call rescan() to refresh. */
export async function listPlugins(): Promise<PluginDescriptor[]> {
  if (cache) return cache
  if (scanning) return scanning

  scanning = (async () => {
    const jobs: Array<Promise<PluginDescriptor>> = []

    for (const id of BUILTIN_IDS)
      jobs.push(loadManifest(`/plugins/${id}/beacon-plugin.json`, 'builtin'))

    for (const url of readUserUrls())
      jobs.push(loadManifest(url, 'url'))

    const found = await Promise.all(jobs)

    // Bridge plugins are added by the bridge module when it connects; it calls
    // mergeBridgePlugins() rather than going through here, because a native
    // scan is slow and must not block the built-in list from appearing.
    const merged = [...found, ...bridgePlugins]

    // A user-added URL that duplicates a built-in id loses: built-ins are the
    // ones we can guarantee.
    const seen = new Set<string>()
    const unique: PluginDescriptor[] = []
    for (const d of merged) {
      if (d.error) { unique.push(d); continue }
      if (seen.has(d.id)) continue
      seen.add(d.id)
      unique.push(d)
    }

    cache = unique
    scanning = null
    return unique
  })()

  return scanning
}

export function rescan(): void {
  cache = null
  scanning = null
  notify()
}

/** Synchronous peek at the last scan. Empty until listPlugins() has run. */
export function cachedPlugins(): PluginDescriptor[] {
  return cache ?? []
}

export async function findPlugin(id: string): Promise<PluginDescriptor | null> {
  const all = await listPlugins()
  return all.find(p => p.id === id && !p.error) ?? null
}

// ---------------------------------------------------------------------------
//  Bridge plugins
// ---------------------------------------------------------------------------

let bridgePlugins: PluginDescriptor[] = []

/** Called by the bridge client when a native scan completes. */
export function mergeBridgePlugins(list: PluginDescriptor[]): void {
  bridgePlugins = list
  cache = null
  notify()
}

export function clearBridgePlugins(): void {
  if (bridgePlugins.length === 0) return
  bridgePlugins = []
  cache = null
  notify()
}
