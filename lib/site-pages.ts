// Enumerate EVERY routable page + API route in the app/ tree (indexable or not) for the admin site
// directory. In dev we scan the real filesystem (always fresh); in production the source app/ dir
// isn't in the serverless bundle, so we fall back to a build-generated manifest (lib/site-pages.json,
// written by scripts/gen-site-pages.mjs — keep its deriveRoute in sync with this file).
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import generated from '@/lib/site-pages.json'

export interface PageEntry {
  route: string          // URL, e.g. '/', '/lightningbug', '/learn/[slug]'
  file: string           // source path, e.g. 'app/(app)/admin/pages/page.tsx'
  kind: 'page' | 'api'   // page.* vs route.*
  dynamic: boolean       // has a [param] / [...catchall] segment
  group: string | null   // route group folder like '(app)', if any
  section: string        // first URL segment (for grouping), or 'home'
}

const PAGE_RE = /^page\.(tsx|ts|jsx|js|mdx)$/
const ROUTE_RE = /^route\.(ts|js)$/
const SKIP_DIRS = new Set(['node_modules'])

// Turn a file path relative to app/ into a route. Returns null when the file isn't routable
// (private _folder, parallel @slot, intercepting (.) route). KEEP IN SYNC with gen-site-pages.mjs.
export function deriveRoute(relFile: string): { route: string; dynamic: boolean; group: string | null } | null {
  const parts = relFile.split('/')
  parts.pop() // drop page.tsx / route.ts
  let group: string | null = null
  const segs: string[] = []
  for (const p of parts) {
    if (p.startsWith('_')) return null                 // private folder — not routed
    if (p.startsWith('@')) return null                 // parallel-route slot — no URL segment
    if (/^\(\.+\)/.test(p)) return null                // intercepting route — skip
    if (/^\(.+\)$/.test(p)) { group = group ?? p; continue }  // route group — no URL segment
    segs.push(p)
  }
  const dynamic = segs.some(s => s.includes('['))
  const route = '/' + segs.join('/')
  return { route: route === '/' ? '/' : route.replace(/\/$/, ''), dynamic, group }
}

function walk(dir: string, appRoot: string, out: PageEntry[]) {
  let entries: import('node:fs').Dirent[]
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), appRoot, out); continue }
    const isPage = PAGE_RE.test(e.name), isRoute = ROUTE_RE.test(e.name)
    if (!isPage && !isRoute) continue
    const rel = join(dir, e.name).slice(appRoot.length + 1)
    const d = deriveRoute(rel)
    if (!d) continue
    out.push({ route: d.route, file: 'app/' + rel, kind: isPage ? 'page' : 'api', dynamic: d.dynamic, group: d.group, section: d.route === '/' ? 'home' : d.route.split('/')[1] })
  }
}

export function scanPagesLive(): PageEntry[] {
  const appRoot = join(process.cwd(), 'app')
  const out: PageEntry[] = []
  walk(appRoot, appRoot, out)
  return out
}

/** All routable pages + API routes. Live filesystem in dev; build-generated manifest in production. */
export function getSitePages(): { pages: PageEntry[]; source: 'live' | 'manifest' } {
  if (process.env.NODE_ENV !== 'production') {
    const live = scanPagesLive()
    if (live.length) return { pages: live, source: 'live' }
  }
  return { pages: generated as PageEntry[], source: 'manifest' }
}
