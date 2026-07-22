// IndexNow: ping Bing/Yandex the instant a page publishes so they crawl it in
// minutes instead of days. (Google ignores IndexNow — that's Search Console's
// job.) The key is public, hosted at /<key>.txt, and verifies we own the host.

const KEY = 'cbfcec260139c8b5b98f5a3e2490688e'
const HOST = '100lights.com'

/** Submit one or more absolute URLs. Best-effort — never throws into a request. */
export async function submitToIndexNow(urls: string[]): Promise<void> {
  const list = urls.filter(u => u.startsWith('https://100lights.com'))
  if (list.length === 0) return
  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: list }),
    })
  } catch { /* best-effort; a failed ping is harmless */ }
}
