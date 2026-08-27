// Do the API routes work when called from inside the page (same origin,
// real browser headers) rather than from curl?
import { chromium } from 'playwright'
const BASE = process.argv[2] || 'https://www.100lights.com'
const b = await chromium.launch()
const p = await b.newPage()
await p.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'commit', timeout: 90000 })
await p.waitForTimeout(9000)
const out = await p.evaluate(async () => {
  const paths = ['/api/catalog', '/api/usage', '/api/projects', '/api/announcements']
  const res = {}
  for (const path of paths) {
    try {
      const r = await fetch(path, { cache: 'no-store' })
      const text = (await r.text()).slice(0, 90)
      res[path] = `${r.status} ${text.replace(/\s+/g, ' ')}`
    } catch (e) { res[path] = 'threw: ' + e.message }
  }
  return res
})
console.log(out)
await b.close()
