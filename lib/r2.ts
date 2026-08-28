import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
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

export async function putObject(key: string, body: Uint8Array | ArrayBuffer, contentType: string) {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body)
  await client().send(new PutObjectCommand({ Bucket: BUCKET(), Key: key, Body: bytes, ContentType: contentType }))
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
