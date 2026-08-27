#!/usr/bin/env node
/**
 * Migration runner.
 *
 *   npm run db:status              show applied / pending
 *   npm run db:migrate -- --dry-run  print what would run, touch nothing
 *   npm run db:migrate             apply pending migrations
 *   npm run db:verify              compare the live schema against db/migrations
 *
 * Applies db/migrations/NNNN_*.sql in filename order, each inside its own
 * transaction, recording it in schema_migrations. Already-applied files are
 * skipped by name, so migrations are append-only: never edit a file that has
 * shipped — add a new one.
 *
 * Uses `pg` directly rather than lib/db.ts because migrations need real
 * multi-statement transactions, which the Neon HTTP driver does not provide.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const DIR = 'db/migrations';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const statusOnly = args.includes('--status');
const verify = args.includes('--verify');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Load it first, e.g.:\n  set -a && source .env.local && set +a');
  process.exit(1);
}

const isRemote = !/@localhost[:/]|@127\.0\.0\.1[:/]/.test(url);
const host = (url.match(/@([^/:?]+)/) || [])[1] || 'unknown';

function files() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
}

const client = new Client({
  connectionString: url,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
});

await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

const { rows } = await client.query('SELECT version FROM schema_migrations ORDER BY version');
const applied = new Set(rows.map(r => r.version));
const all = files();
const pending = all.filter(f => !applied.has(f));

console.log(`database: ${host}${isRemote ? '  (remote)' : '  (local)'}`);
console.log(`migrations: ${all.length} total, ${applied.size} applied, ${pending.length} pending\n`);

for (const f of all) console.log(`  ${applied.has(f) ? '✓' : '·'} ${f}`);

if (verify) {
  const { rows: live } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const liveTables = new Set(live.map(r => r.table_name));
  const declared = new Set();
  for (const f of all) {
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? ([a-z_0-9]+)/gi)) declared.add(m[1].toLowerCase());
  }
  const missing = [...declared].filter(t => !liveTables.has(t)).sort();
  const extra = [...liveTables].filter(t => !declared.has(t) && t !== 'schema_migrations').sort();
  console.log(`\nlive tables: ${liveTables.size}   declared in migrations: ${declared.size}`);
  if (missing.length) console.log(`\nin migrations but NOT in the database (${missing.length}):\n  ${missing.join('\n  ')}`);
  if (extra.length) console.log(`\nin the database but NOT in any migration (${extra.length}):\n  ${extra.join('\n  ')}`);
  if (!missing.length && !extra.length) console.log('\nschema matches migrations.');
  await client.end();
  process.exit(0);
}

if (statusOnly) { await client.end(); process.exit(0); }

if (!pending.length) { console.log('\nnothing to do.'); await client.end(); process.exit(0); }

if (dryRun) {
  console.log(`\n--dry-run: would apply ${pending.length} migration(s); no changes made.`);
  await client.end();
  process.exit(0);
}

for (const f of pending) {
  const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
  process.stdout.write(`\napplying ${f} ... `);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
    await client.query('COMMIT');
    console.log('ok');
  } catch (err) {
    await client.query('ROLLBACK');
    console.log('FAILED (rolled back)');
    console.error(`\n${err.message}\n`);
    await client.end();
    process.exit(1);
  }
}

console.log('\ndone.');
await client.end();
