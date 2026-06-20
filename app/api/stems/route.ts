import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { createPrediction, getPrediction } from '@/lib/replicate'
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Demucs htdemucs model on Replicate — 4 stems: drums, bass, vocals, other
const DEMUCS_VERSION = 'cjwbw/demucs:d30b9aed23df6ae13e25c8f6a03dc33c0aa50e46e96d3c60fc94f1e4cec87fac'

function r2() {
  return new S3Client({
    region:      'auto',
    endpoint:    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

const BUCKET = process.env.R2_BUCKET!

// POST /api/stems — upload audio, kick off Demucs, return prediction id
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('audio') as File | null
  if (!file) return NextResponse.json({ error: 'No audio file' }, { status: 400 })

  // Upload the source file to R2 so Replicate can fetch it via a signed URL
  const key        = `stems-input/${userId}/${Date.now()}-${file.name.replace(/[^a-z0-9._-]/gi, '_')}`
  const arrayBuf   = await file.arrayBuffer()
  await r2().send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        Buffer.from(arrayBuf),
    ContentType: file.type || 'audio/mpeg',
  }))

  // Signed URL valid for 2 hours — enough for Replicate to download it
  const signedUrl = await getSignedUrl(r2(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 7200 })

  const prediction = await createPrediction(DEMUCS_VERSION, {
    audio:  signedUrl,
    model:  'htdemucs',   // 4 stems: drums, bass, vocals, other
    stem:   'none',        // separate all stems
    mp3:    true,
    mp3_bitrate: 320,
    float32: false,
    clip_mode: 'rescale',
    shifts: 1,
    overlap: 0.25,
    jobs: 0,
  })

  return NextResponse.json({ predictionId: prediction.id, status: prediction.status })
}

// GET /api/stems?id=<predictionId> — poll status
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const prediction = await getPrediction(id)

  if (prediction.status === 'succeeded') {
    // Replicate Demucs returns an array of URLs: [drums, bass, other, vocals] (order may vary)
    // The output filenames contain the stem name, e.g. "htdemucs/drums.mp3"
    const urls = prediction.output as string[]
    const stems: Record<string, string> = {}
    for (const url of urls ?? []) {
      const name = url.split('/').pop()?.replace(/\.\w+$/, '').toLowerCase() ?? 'track'
      stems[name] = url
    }
    return NextResponse.json({ status: 'succeeded', stems })
  }

  return NextResponse.json({ status: prediction.status, error: prediction.error })
}
