import { isAdmin } from '@/lib/admin-auth'
import { getArticles } from '@/lib/learn-articles'
import { submitToIndexNow } from '@/lib/indexnow'

export const runtime = 'nodejs'

// Manually resubmit everything to IndexNow (Bing/Yandex). Useful after a batch
// of scheduled articles goes live, since scheduling has no server-side event.
const CORE = ['', '/learn', '/tools', '/community', '/download'].map(p => `https://100lights.com${p}`)
const TOOLS = ['tuner', 'metronome', 'chord-progressions', 'chord-identifier', 'circle-of-fifths', 'scales', 'ear-training', 'vocal-range', 'delay-calculator']
  .map(t => `https://100lights.com/tools/${t}`)

export async function POST() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const published = await getArticles({ includeDrafts: false })
  const urls = [...CORE, ...TOOLS, ...published.map(a => `https://100lights.com/learn/${a.slug}`)]
  await submitToIndexNow(urls)
  return Response.json({ ok: true, submitted: urls.length })
}
