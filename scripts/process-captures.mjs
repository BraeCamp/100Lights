// Phase 2 worker: process pending generation_captures. Pull from Neon, download the staged stems/mix
// from R2, run music-learn analyzeSong → recordToCorpus, mark the row processed, and DELETE the R2
// staging (so R2 only ever holds not-yet-processed captures). Run on a machine with ffmpeg (music-learn
// decodes non-WAV via ffmpeg). Run:  node scripts/process-captures.mjs [--limit=20] [--keep]
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { analyzeSong, recordToCorpus } from '../lib/music-learn.mjs'

const env = {}
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const argv = process.argv.slice(2)
const LIMIT = Number((argv.find(a => a.startsWith('--limit=')) || '--limit=20').split('=')[1]) || 20
const KEEP = argv.includes('--keep')   // don't delete R2 staging (debug)

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })

async function download(key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }))
  const chunks = []; for await (const c of r.Body) chunks.push(c); return Buffer.concat(chunks)
}
const del = key => s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key })).catch(() => {})

const rows = (await pool.query(`SELECT * FROM generation_captures WHERE status='pending' ORDER BY created_at LIMIT $1`, [LIMIT])).rows
console.log(`${rows.length} pending capture(s)`)
let ok = 0, fail = 0
for (const row of rows) {
  const dir = mkdtempSync(join(tmpdir(), 'cap-'))
  try {
    const stemMeta = typeof row.stem_keys === 'string' ? JSON.parse(row.stem_keys) : (row.stem_keys || [])
    const stems = []
    for (let i = 0; i < stemMeta.length; i++) {
      // ".dat" so music-learn's loadMono ffmpeg-decodes it (ffmpeg detects the real format from content).
      const p = join(dir, `stem-${i}.dat`)
      writeFileSync(p, await download(stemMeta[i].key))
      stems.push({ name: stemMeta[i].name, wavPath: p })
    }
    let mixPath = null
    if (row.mix_key) { mixPath = join(dir, 'mix.dat'); writeFileSync(mixPath, await download(row.mix_key)) }
    if (!stems.length) throw new Error('no stems to analyze')

    const analysis = await analyzeSong({ stems, mixPath })
    recordToCorpus({
      title: (row.prompt || 'capture').slice(0, 40), prompt: row.prompt, params: row.params || {},
      analysis, mixPath, stemPaths: stems, model: row.model,
      requestInfo: { source: 'user-generation', captureId: row.id, userId: row.user_id },
    })
    await pool.query(`UPDATE generation_captures SET status='processed', processed_at=NOW() WHERE id=$1`, [row.id])
    if (!KEEP) { for (const s of stemMeta) await del(s.key); if (row.mix_key) await del(row.mix_key) }
    console.log(`✓ ${row.id}: ${analysis.summary}`); ok++
  } catch (e) {
    await pool.query(`UPDATE generation_captures SET status='failed', error=$2, processed_at=NOW() WHERE id=$1`, [row.id, String(e.message).slice(0, 300)])
    console.error(`✗ ${row.id}: ${e.message}`); fail++
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
await pool.end()
console.log(`done — ${ok} processed, ${fail} failed`)
