import { presignDownload, putObject } from '@/lib/r2'
import { getPost, setStatus, type ContentPost, type Platform } from './store'
import { uploadToYouTube, youtubeConfigured } from './youtube'
import { bufferChannelId, bufferConfigured, bufferCreatePost } from './buffer'
import { webmToMp4 } from './transcode'

// Publish orchestrator — the pipeline's publish step, in-app. Enforces the
// approval gate (nothing publishes unless status='approved', except a dry run),
// fans out to each selected platform, and records per-platform results so a
// partial failure is visible and re-runnable. Admin-only by construction: the
// only callers are admin-guarded API routes.

async function fetchBytes(key: string): Promise<Uint8Array> {
  const url = await presignDownload(key, 600)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not fetch video from storage (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function publishPost(
  id: string,
  opts: { dryRun?: boolean; visibility?: string } = {},
): Promise<ContentPost> {
  const post = await getPost(id)
  if (!post) throw new Error('Post not found')
  if (post.status !== 'approved' && !opts.dryRun) {
    throw new Error(`Post is "${post.status}", not "approved" — approve it before publishing`)
  }

  const results: ContentPost['results'] = { ...post.results }
  const bytes = await fetchBytes(post.videoKey)
  let mp4Url: string | null = null // lazily produced for the Buffer platforms

  const ensureMp4Url = async (): Promise<string> => {
    if (mp4Url) return mp4Url
    const mp4 = post.videoType === 'video/mp4' ? bytes : await webmToMp4(bytes)
    const key = `content/${post.id}.mp4`
    await putObject(key, mp4, 'video/mp4')
    mp4Url = await presignDownload(key, 3600)
    return mp4Url
  }

  for (const platform of post.platforms as Platform[]) {
    try {
      if (platform === 'youtube') {
        if (!youtubeConfigured() && !opts.dryRun) throw new Error('YouTube not configured (set YT_* env vars)')
        const r = await uploadToYouTube({
          bytes, contentType: post.videoType,
          title: post.title, description: post.caption,
          privacy: opts.visibility ?? 'private', dryRun: opts.dryRun,
        })
        results.youtube = { id: r.id, url: r.url }
      } else {
        // instagram | tiktok — via Buffer, which needs a public mp4 URL.
        if (!bufferConfigured(platform) && !opts.dryRun) throw new Error(`${platform} not configured (set BUFFER_* env vars)`)
        const channelId = bufferChannelId(platform) || 'dry-run-channel'
        const videoUrl = opts.dryRun ? '(dry run — no upload)' : await ensureMp4Url()
        const r = await bufferCreatePost({ channelId, text: post.caption, videoUrl, dryRun: opts.dryRun })
        results[platform] = { id: r.id }
      }
    } catch (err) {
      results[platform] = { error: (err as Error).message }
    }
  }

  const anyOk = Object.values(results).some(r => r.id && !r.error)
  const anyErr = Object.values(results).some(r => r.error)
  if (opts.dryRun) {
    // A dry run never changes state — it just reports what would happen.
    return { ...post, results }
  }
  const status = anyOk && !anyErr ? 'published' : anyOk ? 'published' : 'failed'
  const error = anyErr ? Object.entries(results).filter(([, r]) => r.error).map(([p, r]) => `${p}: ${r.error}`).join('; ') : null
  const updated = await setStatus(id, status, { results, error, publishedAt: anyOk ? new Date().toISOString() : null })
  return updated ?? { ...post, results, status }
}
