import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
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

export async function presignUpload(key: string, contentType: string, expiresIn = 3600) {
  return getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: BUCKET(), Key: key, ContentType: contentType }),
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
