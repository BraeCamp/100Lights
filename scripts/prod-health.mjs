// Read-only production health snapshot. Connects to PROD_DATABASE_URL, lists tables + row counts,
// and pulls key business metrics where those tables exist. Prints NO secrets, NO PII (only counts/sums).
// Run from the project root:  node scripts/prod-health.mjs    (throwaway diagnostic — safe to delete)
import { readFileSync } from 'node:fs'
import pg from 'pg'
const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url),'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g,'')
}
const c = new pg.Client({ connectionString: env.PROD_DATABASE_URL, ssl:{ rejectUnauthorized:false }, connectionTimeoutMillis: 10000 })
await c.connect()
const q = (s,p) => c.query(s,p).then(r=>r.rows).catch(e=>({__err:e.message}))
const has = async (t) => (await q(`select 1 from information_schema.tables where table_schema='public' and table_name=$1`,[t])).length>0

const tables = (await q(`select table_name from information_schema.tables where table_schema='public' order by table_name`)).map(r=>r.table_name)
console.log(`=== PROD DB: ${tables.length} tables ===`)
const counts = {}
for (const t of tables) { const r = await q(`select count(*)::int n from "${t}"`); counts[t] = r.__err? 'ERR' : r[0].n }
for (const t of tables) console.log(`  ${String(counts[t]).padStart(7)}  ${t}`)

console.log(`\n=== Key metrics ===`)
if (await has('user_credits')) {
  const r = (await q(`select count(*)::int users, coalesce(sum(balance),0)::int total_balance, count(*) filter (where balance>0)::int with_balance, coalesce(sum(monthly_grant),0)::int granted from user_credits`))[0]
  console.log(`credits: ${r.users} accounts, ${r.with_balance} with balance>0, ${r.total_balance} outstanding, ${r.granted} monthly-granted`)
}
if (await has('credit_ledger')) {
  const r = (await q(`select count(*)::int entries, coalesce(sum(case when delta<0 then -delta else 0 end),0)::int spent, coalesce(sum(case when delta>0 then delta else 0 end),0)::int added from credit_ledger`))[0]
  const recent = (await q(`select reason, count(*)::int n from credit_ledger where created_at > now() - interval '30 days' group by reason order by n desc limit 6`))
  console.log(`ledger: ${r.entries} entries, ${r.spent} spent, ${r.added} added | 30d by reason: ${recent.map?recent.map(x=>`${x.reason}=${x.n}`).join(', '):''||'none'}`)
}
for (const t of ['subscription','subscriptions']) if (await has(t)) {
  const byPlan = await q(`select plan, status, count(*)::int n from "${t}" group by plan,status order by n desc`)
  console.log(`${t}: ${byPlan.map?byPlan.map(x=>`${x.plan}/${x.status}=${x.n}`).join(', '):''||'empty'}`)
}
for (const t of ['projects','project']) if (await has(t)) {
  const r = (await q(`select count(*)::int total, count(*) filter (where updated_at > now() - interval '7 days')::int active7d from "${t}"`))[0]
  if (!r.__err) console.log(`${t}: ${r.total} total, ${r.active7d} touched in last 7d`)
}

console.log(`\n=== Freshness ===`)
for (const t of ['user_credits','credit_ledger','subscription','projects']) if (await has(t)) {
  const col = (await q(`select column_name from information_schema.columns where table_schema='public' and table_name=$1 and column_name in ('created_at','updated_at') order by column_name desc limit 1`,[t]))[0]?.column_name
  if (col) { const r = (await q(`select max("${col}") m from "${t}"`))[0]; console.log(`  ${t}.${col} latest: ${r.m||'—'}`) }
}
await c.end()
