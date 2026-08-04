// Direct YouTube upload via the Data API — ported from the pipeline's youtube.py.
// Reads credentials from env (never a checked-in file): YT_CLIENT_ID,
// YT_CLIENT_SECRET, YT_REFRESH_TOKEN.
//
// Non-negotiable (carried over verbatim): status.containsSyntheticMedia is
// hardcoded true on every upload — this content is AI-assisted and the disclosure
// is not parameterizable. Do not add a flag to turn it off.

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos'

export class MissingCredentials extends Error {}

export function youtubeConfigured(): boolean {
  return !!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_REFRESH_TOKEN)
}

async function accessToken(): Promise<string> {
  const client_id = process.env.YT_CLIENT_ID
  const client_secret = process.env.YT_CLIENT_SECRET
  const refresh_token = process.env.YT_REFRESH_TOKEN
  if (!client_id || !client_secret) throw new MissingCredentials('YT_CLIENT_ID / YT_CLIENT_SECRET not set')
  if (!refresh_token) throw new MissingCredentials('YT_REFRESH_TOKEN not set — run the pipeline authorize flow once')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: 'refresh_token' }),
  })
  if (!res.ok) throw new Error(`YouTube token refresh failed: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token as string
}

function buildBody(title: string, description: string, privacy: string) {
  return {
    snippet: { title: title.slice(0, 100), description: description.slice(0, 4900), categoryId: '10' }, // Music
    status: {
      privacyStatus: ['public', 'unlisted', 'private'].includes(privacy) ? privacy : 'private',
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true, // unconditional — do not parameterize
    },
  }
}

export async function uploadToYouTube(opts: {
  bytes: Uint8Array; contentType: string; title: string; description: string
  privacy?: string; dryRun?: boolean
}): Promise<{ id: string; url: string }> {
  const body = buildBody(opts.title, opts.description, opts.privacy ?? 'private')
  if (opts.dryRun) return { id: 'dry-run-video-id', url: '(dry run — nothing uploaded)' }

  const token = await accessToken()
  const auth = { Authorization: `Bearer ${token}` }
  // Resumable upload: initiate, then PUT the bytes.
  const init = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json', 'X-Upload-Content-Type': opts.contentType },
    body: JSON.stringify(body),
  })
  if (!init.ok) throw new Error(`YouTube init failed: ${init.status} ${await init.text()}`)
  const sessionUri = init.headers.get('location')
  if (!sessionUri) throw new Error('YouTube did not return a resumable session URI')

  const up = await fetch(sessionUri, { method: 'PUT', headers: { ...auth, 'Content-Type': opts.contentType }, body: new Blob([opts.bytes as BlobPart], { type: opts.contentType }) })
  if (!up.ok) throw new Error(`YouTube upload failed: ${up.status} ${await up.text()}`)
  const id = (await up.json()).id as string
  return { id, url: `https://youtube.com/shorts/${id}` }
}
