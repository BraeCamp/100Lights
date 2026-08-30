import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

function client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

const BUCKET = () => process.env.R2_BUCKET!

export async function presignUpload(key: string, contentType: string, expiresIn = 3600, contentLength?: number) {
  // When a byte length is given, sign it into the URL: R2 then rejects any PUT
  // whose real body length differs, so the client-declared size (used by the
  // storage-cap accounting) can't be under-reported to sneak past the limit.
  return getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: BUCKET(), Key: key, ContentType: contentType, ...(contentLength && contentLength > 0 ? { ContentLength: contentLength } : {}) }),
    { expiresIn },
  )
}

export async function presignDownload(key: string, expiresIn = 3600) {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: BUCKET(), Key: key }),
    { expiresIn },
  )
}

/**
 * A cacheable 302 to a signed URL, with the two lifetimes tied together.
 *
 * These are separate clocks and they were set independently: the signature
 * lasted 900s while the redirect was cached `s-maxage=3600, swr=300`. A CDN may
 * serve that cached redirect for 3,900 seconds — so for most of every hour it
 * handed out an already-expired signature and R2 answered
 * `403 ExpiredRequest`. Intermittent dead audio, on a URL that had worked
 * minutes earlier, which is close to the worst thing to debug.
 *
 * Deriving one from the other is the point: a signature that outlives the
 * longest the CDN could still be serving the redirect, by a wide margin.
 */
export async function presignedRedirect(key: string, cacheSeconds = 3600, staleSeconds = 300) {
  const servableFor = cacheSeconds + staleSeconds
  const url = await presignDownload(key, servableFor * 4)
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Cache-Control': `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${staleSeconds}`,
    },
  })
}

export async function putObject(
  key: string,
  body: Uint8Array | ArrayBuffer,
  contentType: string,
  /**
   * Small facts to store alongside the object.
   *
   * Used by the voice cache, whose keys are hashes: without this, storage holds
   * a few hundred recordings and nothing anywhere can say what any of them
   * SAYS. Values are percent-encoded because S3 metadata is ASCII-only and a
   * track name is not — an unencoded "Café" fails the whole upload.
   */
  meta?: Record<string, string>,
) {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body)
  await client().send(new PutObjectCommand({
    Bucket: BUCKET(), Key: key, Body: bytes, ContentType: contentType,
    Metadata: meta && Object.fromEntries(
      Object.entries(meta).map(([k, v]) => [k, encodeURIComponent(v)]),
    ),
  }))
}

/**
 * Everything stored about one object, metadata included.
 *
 * ListObjectsV2 does not return metadata — only keys, sizes and dates — so
 * reading what a hash-keyed object says costs one HEAD each. Fine for an admin
 * panel that scans on open; not something to do per request.
 */
export async function objectInfo(key: string): Promise<
  { size: number; modified?: Date; meta: Record<string, string> } | null
> {
  try {
    const r = await client().send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }))
    const meta: Record<string, string> = {}
    for (const [k, v] of Object.entries(r.Metadata ?? {})) {
      // Percent-decoding can throw on a malformed value; a bad metadata string
      // should cost that one field, not the whole listing.
      try { meta[k] = decodeURIComponent(v) } catch { meta[k] = v }
    }
    return { size: r.ContentLength ?? 0, modified: r.LastModified, meta }
  } catch {
    return null
  }
}

/**
 * Is this object already there?
 *
 * A HEAD rather than a GET, because the answer is one bit and the object may be
 * megabytes. Used by the voice cache, where the whole point is to find out
 * whether something has been paid for already WITHOUT paying to find out.
 */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await client().send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }))
    return true
  } catch {
    // 404 is the ordinary answer here and not worth distinguishing from a
    // transient fault: both mean "cannot serve it from the cache", and the
    // caller's fallback is the same either way.
    return false
  }
}

export async function deleteObject(key: string) {
  await client().send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }))
}

export async function deleteObjects(keys: string[]) {
  if (keys.length === 0) return
  await client().send(new DeleteObjectsCommand({
    Bucket: BUCKET(),
    Delete: { Objects: keys.map(Key => ({ Key })), Quiet: true },
  }))
}

/** Objects under a key prefix, newest-agnostic. Used to browse article audio
 *  in the admin panel; keeps the S3 SDK contained to this module. */
export async function listObjects(prefix: string, maxKeys = 200) {
  const res = await client().send(new ListObjectsV2Command({
    Bucket: BUCKET(), Prefix: prefix, MaxKeys: maxKeys,
  }))
  return (res.Contents ?? [])
    .filter(o => o.Key && !o.Key.endsWith('/'))
    .map(o => ({ key: o.Key!, size: o.Size ?? 0, modified: o.LastModified?.toISOString() ?? null }))
}

/** Every object under a prefix, following pagination — so an admin asset list
 *  doesn't silently stop at 200 keys once the prefix grows past one page. */
export async function listAllObjects(prefix: string) {
  const out: { key: string; size: number; modified: string | null }[] = []
  let token: string | undefined
  do {
    const res = await client().send(new ListObjectsV2Command({
      Bucket: BUCKET(), Prefix: prefix, MaxKeys: 1000, ContinuationToken: token,
    }))
    for (const o of res.Contents ?? []) {
      if (o.Key && !o.Key.endsWith('/')) out.push({ key: o.Key, size: o.Size ?? 0, modified: o.LastModified?.toISOString() ?? null })
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
  return out
}
