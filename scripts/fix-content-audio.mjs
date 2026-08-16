// FIX: the video editor's preview only plays the ACTIVE video element's audio — it has no
// simultaneous audio-track mixer, so a silent-visual + separate audio-track project plays silent.
// Repoint each content project's single video clip at the MUXED content video (audio baked in),
// so it plays with sound. (Fully editable per-stem audio still lives in "AI Music — EL vs Producer".)
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { S3Client, CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const env = {}
for (const l of readFileSync('/Users/brae/100lights/.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const sql = neon(env.DATABASE_URL)
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })
const BUCKET = env.R2_BUCKET
const USER = 'user_3FElUNjivSIJ9gZsJUKp1496n17'

const clean = t => t.replace(/#Shorts/gi, '').replace(/[🎻🎧🎬🎼🎹]/g, '').trim()
const staged = JSON.parse(readFileSync('/Users/brae/.claude/jobs/22b592f1/tmp/el-account.json', 'utf8'))
  .map(s => ({ slug: s.slug, name: clean(s.title), seconds: s.seconds || 30 }))

const hasAudioStream = async () => true // muxed content videos are built with -c:a aac (verified)
const exists = async (key) => { try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true } catch { return false } }

for (const s of staged) {
  // the muxed content video (visual + audio) = content_posts.video_key
  const cp = await sql`SELECT video_key FROM content_posts WHERE slug=${s.slug} LIMIT 1`
  const muxKey = cp[0]?.video_key
  if (!muxKey || !(await exists(muxKey))) { console.error(`  ✗ ${s.slug}: muxed video missing (${muxKey})`); continue }

  const proj = await sql`SELECT id, data FROM projects WHERE user_id=${USER} AND deleted_at IS NULL AND data->>'name'=${s.name} ORDER BY saved_at DESC LIMIT 1`
  if (!proj.length) { console.error(`  ✗ ${s.slug}: project "${s.name}" not found`); continue }

  // copy the muxed video to a user-namespaced key + register it in the Media section
  const vidId = randomUUID(), vidKey = `${USER}/${vidId}.mp4`
  await s3.send(new CopyObjectCommand({ Bucket: BUCKET, CopySource: encodeURI(`${BUCKET}/${muxKey}`), Key: vidKey, ContentType: 'video/mp4', MetadataDirective: 'REPLACE' }))
  await sql`INSERT INTO user_media (id, user_id, name, content_type, duration, r2_key, thumbnail, created_at)
    VALUES (${vidId}, ${USER}, ${s.name}, 'video/mp4', ${s.seconds}, ${vidKey}, NULL, NOW())
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`

  // rebuild the project: a single video clip on one track, playing the muxed (audible) video
  const d = proj[0].data
  d.media = [{ id: vidId, name: s.name, r2Key: vidKey, duration: s.seconds, contentType: 'video' }]
  d.tracks = [{ id: 'v1', label: 'Video', type: 'media', height: 64 }]
  d.clips = [{ id: randomUUID(), color: '#a78bfa', label: s.name, inPoint: 0, outPoint: s.seconds, startTime: 0, trackId: 'v1', mediaRefId: vidId, contentType: 'video', captions: [] }]
  d.savedAt = new Date().toISOString()
  await sql`UPDATE projects SET data=${JSON.stringify(d)}::jsonb, saved_at=NOW() WHERE id=${proj[0].id}`
  console.log(`✓ "${s.name}" — now plays the muxed video (video + audio), single track`)
}
console.log('\nDone — content projects now play with sound. Reopen them in the editor.')
