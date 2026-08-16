// Save the 2 EL content pieces as EDITABLE video-module projects in Brae's account
// (braedancampbell@gmail.com), in a folder — each with SEPARATE, SYNCED tracks:
//   • a Video track = the silent visual mp4  (its own media-library entry)
//   • an Audio track = the mix mp3           (its own media-library entry, editable)
// Assets are copied from the content/ keys to user-namespaced <userId>/<id>.<ext> keys and
// registered in user_media so they show in the Media section. Project schema is cloned from a
// known-good video project so the shape is guaranteed valid. Direct DB (no browser needed).
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { S3Client, CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const env = {}
for (const l of readFileSync('/Users/brae/100lights/.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const sql = neon(env.DATABASE_URL)
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })
const BUCKET = env.R2_BUCKET
const USER = 'user_3FElUNjivSIJ9gZsJUKp1496n17'  // braedancampbell@gmail.com

const staged = JSON.parse(readFileSync('/Users/brae/.claude/jobs/22b592f1/tmp/el-account.json', 'utf8'))

// clone a known-good video project as the schema template (keeps aspect/audioMode/modules/
// adjustments/zoomLevel/version/_type exactly right; we only swap media/clips/tracks/id/name)
const donorRows = await sql`SELECT data FROM projects WHERE user_id=${USER} AND data->>'modules' LIKE '%video%' AND data ? 'aspect' ORDER BY saved_at DESC LIMIT 1`
const donor = donorRows[0]?.data
if (!donor) { console.error('no donor video project found'); process.exit(1) }
const TEMPLATE = k => (k in donor ? donor[k] : undefined)

const copy = async (srcKey, destKey, ct) => {
  await s3.send(new CopyObjectCommand({ Bucket: BUCKET, CopySource: encodeURI(`${BUCKET}/${srcKey}`), Key: destKey, ContentType: ct, MetadataDirective: 'REPLACE' }))
}
const exists = async (key) => { try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true } catch { return false } }

// folder
await sql`CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
const folderId = randomUUID()
await sql`INSERT INTO folders (id, user_id, name) VALUES (${folderId}, ${USER}, 'AI Content — Videos')`
console.log('folder created: AI Content — Videos')

for (const s of staged) {
  const secs = s.seconds || 30
  const name = s.title.replace(/#Shorts/gi, '').replace(/[🎻🎧🎬🎼🎹]/g, '').trim()
  if (!(await exists(s.visKey))) { console.error(`  ✗ ${s.slug}: visual missing (${s.visKey})`); continue }
  if (!(await exists(s.audKey))) { console.error(`  ✗ ${s.slug}: audio missing (${s.audKey})`); continue }

  const vidId = randomUUID(), audId = randomUUID()
  const vidKey = `${USER}/${vidId}.mp4`, audKey = `${USER}/${audId}.mp3`
  await copy(s.visKey, vidKey, 'video/mp4')
  await copy(s.audKey, audKey, 'audio/mpeg')

  // register both in the media library (Media section)
  for (const [id, mname, ct, key] of [[vidId, `${name} (visual)`, 'video/mp4', vidKey], [audId, `${name} (audio)`, 'audio/mpeg', audKey]]) {
    await sql`INSERT INTO user_media (id, user_id, name, content_type, duration, r2_key, thumbnail, created_at)
      VALUES (${id}, ${USER}, ${mname}, ${ct}, ${secs}, ${key}, NULL, NOW())
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, duration=EXCLUDED.duration`
  }

  // build the project: silent video track + separate synced audio track
  const projId = randomUUID()
  const media = [
    { id: vidId, name: `${name} (visual)`, r2Key: vidKey, duration: secs, contentType: 'video' },
    { id: audId, name: `${name} (audio)`,  r2Key: audKey, duration: secs, contentType: 'audio' },
  ]
  const tracks = [
    { id: 'v1', label: 'Video', type: 'media', height: 64 },
    { id: 'a1', label: 'Audio', type: 'audio', height: 64, volume: 1 },
  ]
  const clips = [
    { id: randomUUID(), color: '#a78bfa', label: name, inPoint: 0, outPoint: secs, startTime: 0, trackId: 'v1', mediaRefId: vidId, contentType: 'video', captions: [] },
    { id: randomUUID(), color: '#34d399', label: `${name} — audio`, inPoint: 0, outPoint: secs, startTime: 0, trackId: 'a1', mediaRefId: audId, contentType: 'audio', captions: [] },
  ]
  const data = {
    _type: '100lights-project', version: TEMPLATE('version') ?? 1,
    id: projId, name, userId: USER,
    aspect: '9:16', audioMode: 'music', modules: ['video'],
    media, tracks, clips,
    outputs: [], captions: [], chapters: [],
    beatGrid: TEMPLATE('beatGrid') ?? null,
    zoomLevel: TEMPLATE('zoomLevel') ?? 1,
    adjustments: TEMPLATE('adjustments') ?? {},
    savedAt: new Date().toISOString(),
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) + '-' + projId.slice(0, 6)
  await sql`INSERT INTO projects (id, user_id, name, slug, owner_username, saved_at, data, folder_id)
    VALUES (${projId}, ${USER}, ${name}, ${slug}, 'braedancampbell', NOW(), ${JSON.stringify(data)}::jsonb, ${folderId})
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, data=EXCLUDED.data, folder_id=EXCLUDED.folder_id, saved_at=NOW(), deleted_at=NULL`
  console.log(`✓ "${name}" — video+audio project (2 media entries, synced), editable`)
}
console.log('\nDone — 2 editable content projects in "AI Content — Videos" (video + separate synced audio).')
