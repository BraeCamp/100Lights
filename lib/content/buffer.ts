// Buffer GraphQL client (Instagram + TikTok route) — ported from buffer_client.py.
// Buffer needs a PUBLIC video URL it can fetch (we hand it a presigned R2 URL).
// One request per operation to respect the free-tier budget.

const API_URL = 'https://api.buffer.com'

export class MissingCredentials extends Error {}

export function bufferChannelId(platform: 'instagram' | 'tiktok'): string | undefined {
  return platform === 'instagram' ? process.env.BUFFER_IG_CHANNEL_ID : process.env.BUFFER_TIKTOK_CHANNEL_ID
}

export function bufferConfigured(platform: 'instagram' | 'tiktok'): boolean {
  return !!(process.env.BUFFER_API_KEY && bufferChannelId(platform))
}

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const key = process.env.BUFFER_API_KEY
  if (!key) throw new MissingCredentials('BUFFER_API_KEY not set')
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Buffer HTTP ${res.status}: ${await res.text()}`)
  const out = await res.json()
  if (out.errors) throw new Error(`Buffer GraphQL error: ${JSON.stringify(out.errors)}`)
  return out.data
}

const CREATE_POST = `
mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id } }
    ... on PostActionError { message }
  }
}`

export async function bufferCreatePost(opts: {
  channelId: string; text: string; videoUrl: string; dryRun?: boolean
}): Promise<{ id: string }> {
  if (opts.dryRun) return { id: 'dry-run-post-id' }
  const data = await gql(CREATE_POST, {
    input: {
      channelId: opts.channelId,
      text: opts.text,
      schedulingType: 'automatic',
      mode: 'addToQueue',
      assets: [{ video: { url: opts.videoUrl } }],
    },
  })
  const result = data.createPost as { post?: { id: string }; message?: string }
  if (result.message && !result.post) throw new Error(`Buffer createPost failed: ${result.message}`)
  return { id: result.post!.id }
}
