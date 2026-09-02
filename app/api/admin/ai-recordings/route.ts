import { isAdmin } from '@/lib/admin-auth'
import { listAllObjects, objectInfo, presignDownload } from '@/lib/r2'

export const runtime = 'nodejs'

/**
 * Every recording the studio has bought, grouped by the voice that said it.
 *
 * Brae: "Allow me to hear the recordings from a new AI recordings section of
 * Admin. Separate by voice."
 *
 * ⚠️ THE VOICE PHRASES PANEL ANSWERS A DIFFERENT QUESTION. It lists what the
 * studio CAN say and ticks off which of those have been bought — for ONE voice,
 * the one in the environment. This lists what actually EXISTS in storage, for
 * every voice, and hands back something you can press play on. Auditioning a
 * voice before spending the rest of a budget on it is the whole point.
 *
 * ⚠️ The voice id comes from the KEY, not from a list of voices we keep. Keys
 * are `voice/<voiceId>/<hash>.mp3` (see voiceKey), so storage is already the
 * index and a voice recorded tomorrow appears here without anything being
 * registered anywhere.
 */
export async function GET(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })

  const url = new URL(req.url)
  // One voice's audio at a time: presigning every object in the bucket on every
  // open would be slow and mostly wasted, since you listen to one voice.
  const want = url.searchParams.get('voice')

  let objects: { key: string; size: number; modified: string | null }[] = []
  try {
    objects = await listAllObjects('voice/')
  } catch (err) {
    // Storage unreachable is not the same as "no recordings", and saying so is
    // the difference between a fixable problem and an apparently empty page.
    return Response.json({
      error: `Could not read storage: ${err instanceof Error ? err.message : String(err)}`,
      voices: [],
    }, { status: 200 })
  }

  const byVoice = new Map<string, { key: string; size: number; at: string }[]>()
  for (const o of objects) {
    const m = /^voice\/([^/]+)\/[^/]+\.mp3$/.exec(o.key)
    if (!m) continue
    const list = byVoice.get(m[1]) ?? []
    list.push({ key: o.key, size: o.size ?? 0, at: o.modified ?? '' })
    byVoice.set(m[1], list)
  }

  const voices = [...byVoice.entries()]
    .map(([voiceId, items]) => ({
      voiceId,
      count: items.length,
      // ⚠️ One ElevenLabs credit is one character, so bytes are not the bill.
      // Size is here because it is what storage costs, and the two get confused.
      bytes: items.reduce((n, i) => n + i.size, 0),
      newest: items.reduce((a, b) => (a > b.at ? a : b.at), ''),
    }))
    .sort((a, b) => b.count - a.count)

  if (!want) return Response.json({ voices })

  // ⚠️ The phrase text lives in the object's METADATA, not in the key — the key
  // is a hash, deliberately, so the same sentence is one file. Reading it costs
  // a HEAD per object, which is why it happens only for the voice being opened.
  const items = byVoice.get(want) ?? []
  const rows = await Promise.all(items.slice(0, 400).map(async it => {
    let phrase = ''
    try {
      const info = await objectInfo(it.key)
      const raw = info?.meta?.phrase
      if (raw) phrase = decodeURIComponent(raw)
    } catch { /* metadata missing — the audio is still playable */ }
    let url = ''
    try { url = await presignDownload(it.key, 3600) } catch { /* not playable */ }
    return { key: it.key, phrase, url, bytes: it.size, at: it.at }
  }))

  rows.sort((a, b) => (a.phrase || a.key).localeCompare(b.phrase || b.key))
  return Response.json({ voices, voiceId: want, rows })
}
