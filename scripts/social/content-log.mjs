#!/usr/bin/env node
// Content-performance logger for the social test. Capture signal from post #1: tag each Short by
// format/hook, bulk-import each platform's analytics CSV, then rank which format is actually retaining.
// Disposable corpus — `purge` wipes it once the learning is used.
//
//   node scripts/social/content-log.mjs log --id=abc --format=multi-genre --hook=interactive \
//        --platform=youtube --title="Same melody 6 genres" --length=45 --views=1200 \
//        --completion=68 --hook3s=82 --avgview=31 --subs=14 --likes=90
//   node scripts/social/content-log.mjs import analytics.csv [--platform=youtube]   # bulk metrics from an analytics export
//   node scripts/social/content-log.mjs tag id1=multi-genre:interactive id2=tip:value-upfront   # add format:hook tags
//   node scripts/social/content-log.mjs rank        # which format wins (subs/1k, completion)
//   node scripts/social/content-log.mjs list        # recent posts
//   node scripts/social/content-log.mjs export [out.csv]
//   node scripts/social/content-log.mjs purge --yes  # wipe the corpus
//
// Reads DATABASE_URL from env or .env.local.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
if (!process.env.DATABASE_URL) {
  try { for (const l of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch { /* no .env.local */ }
}
const sql = neon(process.env.DATABASE_URL)
const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const num = v => (v == null || v === '' ? null : Number(String(v).replace(/[^0-9.\-]/g, '')))

async function ensure() {
  await sql`CREATE TABLE IF NOT EXISTS content_perf (
    id TEXT PRIMARY KEY, platform TEXT NOT NULL DEFAULT 'youtube', format_tag TEXT, hook_type TEXT, title TEXT,
    length_s REAL, posted_at TIMESTAMPTZ, views BIGINT DEFAULT 0, avg_pct_viewed REAL, first3s_retention REAL,
    avg_view_s REAL, likes INTEGER DEFAULT 0, comments INTEGER DEFAULT 0, shares INTEGER DEFAULT 0,
    subs_gained INTEGER DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
}

async function upsert(p) {
  await sql`INSERT INTO content_perf (id, platform, format_tag, hook_type, title, length_s, posted_at, views, avg_pct_viewed, first3s_retention, avg_view_s, likes, comments, shares, subs_gained, notes, updated_at)
    VALUES (${p.id}, ${p.platform ?? 'youtube'}, ${p.format ?? null}, ${p.hook ?? null}, ${p.title ?? null}, ${p.length ?? null}, ${p.postedAt ?? null},
      ${p.views ?? 0}, ${p.completion ?? null}, ${p.hook3s ?? null}, ${p.avgview ?? null}, ${p.likes ?? 0}, ${p.comments ?? 0}, ${p.shares ?? 0}, ${p.subs ?? 0}, ${p.notes ?? null}, NOW())
    ON CONFLICT (id) DO UPDATE SET platform=EXCLUDED.platform, format_tag=COALESCE(EXCLUDED.format_tag, content_perf.format_tag),
      hook_type=COALESCE(EXCLUDED.hook_type, content_perf.hook_type), title=COALESCE(EXCLUDED.title, content_perf.title),
      length_s=COALESCE(EXCLUDED.length_s, content_perf.length_s), views=EXCLUDED.views, avg_pct_viewed=EXCLUDED.avg_pct_viewed,
      first3s_retention=EXCLUDED.first3s_retention, avg_view_s=EXCLUDED.avg_view_s, likes=EXCLUDED.likes, comments=EXCLUDED.comments,
      shares=EXCLUDED.shares, subs_gained=EXCLUDED.subs_gained, updated_at=NOW()`
}

// ── minimal CSV parse (handles quoted fields) ────────────────────────────────
function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else q = false } else field += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') { if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = '' } if (c === '\r' && text[i + 1] === '\n') i++ }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}
const dur = s => { const m = String(s).split(':').map(Number); return m.length === 3 ? m[0] * 3600 + m[1] * 60 + m[2] : m.length === 2 ? m[0] * 60 + m[1] : Number(s) || null }
// map a header to a field by fuzzy contains
function colIndex(headers, ...needles) { return headers.findIndex(h => needles.some(n => h.toLowerCase().includes(n))) }

async function main() {
  await ensure()
  if (cmd === 'log') {
    const id = flag('id') || `post-${Date.now()}`
    await upsert({ id, platform: flag('platform', 'youtube'), format: flag('format'), hook: flag('hook'), title: flag('title'),
      length: num(flag('length')), postedAt: flag('posted') || null, views: num(flag('views')), completion: num(flag('completion')),
      hook3s: num(flag('hook3s')), avgview: num(flag('avgview')), likes: num(flag('likes')), comments: num(flag('comments')),
      shares: num(flag('shares')), subs: num(flag('subs')), notes: flag('notes') })
    console.log(`✓ logged ${id}`)
  } else if (cmd === 'import') {
    const file = argv[1]; if (!file) { console.error('usage: import <analytics.csv> [--platform=]'); process.exit(1) }
    const rows = parseCsv(readFileSync(file, 'utf8')).filter(r => r.length > 1)
    const H = rows[0]
    const ci = { id: colIndex(H, 'content', 'video id', 'id'), title: colIndex(H, 'title'), views: colIndex(H, 'views'),
      completion: colIndex(H, 'average percentage', 'avg %', 'completion'), avgview: colIndex(H, 'average view duration', 'avg view'),
      subs: colIndex(H, 'subscriber'), likes: colIndex(H, 'like'), comments: colIndex(H, 'comment'), shares: colIndex(H, 'share') }
    let n = 0
    for (const r of rows.slice(1)) {
      const id = ci.id >= 0 ? r[ci.id] : null; if (!id || /^total$/i.test(id)) continue
      await upsert({ id, platform: flag('platform', 'youtube'), title: ci.title >= 0 ? r[ci.title] : null, views: num(r[ci.views]),
        completion: num(r[ci.completion]), avgview: ci.avgview >= 0 ? dur(r[ci.avgview]) : null, subs: num(r[ci.subs]),
        likes: num(r[ci.likes]), comments: num(r[ci.comments]), shares: num(r[ci.shares]) })
      n++
    }
    console.log(`✓ imported ${n} rows (metrics). Now tag formats: content-log.mjs tag <id>=<format>:<hook> …`)
  } else if (cmd === 'tag') {
    let n = 0
    for (const pair of argv.slice(1)) {
      const m = pair.match(/^(.+?)=([^:]+)(?::(.+))?$/); if (!m) continue
      await sql`UPDATE content_perf SET format_tag=${m[2]}, hook_type=${m[3] ?? null}, updated_at=NOW() WHERE id=${m[1]}`
      n++
    }
    console.log(`✓ tagged ${n}`)
  } else if (cmd === 'rank') {
    const rows = await sql`SELECT format_tag, COUNT(*)::int posts, ROUND(AVG(avg_pct_viewed)::numeric,1) completion,
      ROUND(AVG(first3s_retention)::numeric,1) hook3s, SUM(views)::bigint views, SUM(subs_gained)::int subs,
      ROUND((SUM(subs_gained)::numeric/NULLIF(SUM(views),0))*1000,2) subs_per_1k
      FROM content_perf WHERE format_tag IS NOT NULL GROUP BY format_tag ORDER BY subs_per_1k DESC NULLS LAST, completion DESC NULLS LAST`
    console.table(rows)
  } else if (cmd === 'list') {
    console.table(await sql`SELECT id, platform, format_tag, hook_type, views, avg_pct_viewed completion, subs_gained subs, title FROM content_perf ORDER BY posted_at DESC NULLS LAST, created_at DESC LIMIT 40`)
  } else if (cmd === 'export') {
    const rows = await sql`SELECT * FROM content_perf ORDER BY created_at DESC`
    if (!rows.length) { console.log('(empty)'); return }
    const cols = Object.keys(rows[0])
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => { const v = r[c] ?? ''; return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v }).join(','))].join('\n')
    const out = argv[1] || join(ROOT, 'content-posts.csv'); writeFileSync(out, csv); console.log(`✓ exported ${rows.length} rows → ${out}`)
  } else if (cmd === 'purge') {
    if (!argv.includes('--yes')) { console.log('This wipes the whole content corpus. Re-run with --yes to confirm.'); return }
    const r = await sql`DELETE FROM content_perf`; console.log(`✓ purged (${(r.length ?? 0)} rows).`)
  } else {
    console.log('commands: log | import <csv> | tag <id>=<format>:<hook> … | rank | list | export [csv] | purge --yes')
  }
}
main().catch(e => { console.error(e); process.exit(1) })
