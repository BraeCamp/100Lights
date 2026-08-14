// Build step: scan app/ for every routable page + API route and write lib/site-pages.json (the
// production fallback for the admin site directory, since the source app/ dir isn't in the serverless
// bundle at runtime). KEEP deriveRoute in sync with lib/site-pages.ts.
import { readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PAGE_RE = /^page\.(tsx|ts|jsx|js|mdx)$/
const ROUTE_RE = /^route\.(ts|js)$/

function deriveRoute(relFile) {
  const parts = relFile.split('/'); parts.pop()
  let group = null; const segs = []
  for (const p of parts) {
    if (p.startsWith('_') || p.startsWith('@') || /^\(\.+\)/.test(p)) return null
    if (/^\(.+\)$/.test(p)) { group = group ?? p; continue }
    segs.push(p)
  }
  const dynamic = segs.some(s => s.includes('['))
  const route = '/' + segs.join('/')
  return { route: route === '/' ? '/' : route.replace(/\/$/, ''), dynamic, group }
}

function walk(dir, appRoot, out) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(join(dir, e.name), appRoot, out); continue }
    const isPage = PAGE_RE.test(e.name), isRoute = ROUTE_RE.test(e.name)
    if (!isPage && !isRoute) continue
    const rel = join(dir, e.name).slice(appRoot.length + 1)
    const d = deriveRoute(rel)
    if (!d) continue
    out.push({ route: d.route, file: 'app/' + rel, kind: isPage ? 'page' : 'api', dynamic: d.dynamic, group: d.group, section: d.route === '/' ? 'home' : d.route.split('/')[1] })
  }
}

const appRoot = join(ROOT, 'app')
const out = []
walk(appRoot, appRoot, out)
out.sort((a, b) => a.route.localeCompare(b.route))
writeFileSync(join(ROOT, 'lib', 'site-pages.json'), JSON.stringify(out, null, 0) + '\n')
console.log(`[gen-site-pages] wrote ${out.length} routes → lib/site-pages.json`)
