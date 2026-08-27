#!/usr/bin/env node
/**
 * Extracts every piece of DDL the application executes at runtime and emits it
 * as one ordered SQL file.
 *
 * Background: this codebase had no migrations. 70 tables were created by ~40
 * differently-named ensure() functions scattered across lib/ and app/api/,
 * plus 47 ALTER TABLE statements, all running on cold start. db/schema.sql
 * described only 8 of those tables and had drifted.
 *
 * This script is how db/migrations/0001_baseline.sql was generated, and how to
 * regenerate it if any runtime DDL is still left in the tree:
 *
 *     npm run db:extract
 *
 * It is a code-reading tool, not a database tool — it never connects to a
 * database. Verify its output against the real schema before trusting it on a
 * fresh database (see db/migrations/README.md).
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SRC = ['lib', 'app'];

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.next', '.git'].includes(e.name)) continue;
      walk(p);
    } else if (/\.ts$/.test(e.name)) files.push(p);
  }
})(ROOT) ;

function collect() {
  const out = { extension: [], create: [], index: [], alter: [], other: [], interpolated: [] };
  for (const f of files.filter(f => SRC.some(d => path.relative(ROOT, f).startsWith(d + path.sep)))) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    // Every sql`...` tagged template in the file.
    const re = /sql`([\s\S]*?)`/g;
    let m;
    while ((m = re.exec(src))) {
      const body = m[1];
      const head = body.trim().slice(0, 24).toUpperCase();
      if (!/^(CREATE|ALTER|DROP)\b/.test(head)) continue;
      const stmt = body.trim().replace(/\s+$/, '');
      const entry = { stmt, from: rel };
      if (stmt.includes('${')) { out.interpolated.push(entry); continue; }
      // Extensions must be emitted before any table that uses their types
      // (track_embeddings.embedding is vector(512), which needs pgvector).
      if (/^CREATE\s+EXTENSION/i.test(stmt)) out.extension.push(entry);
      else if (/^CREATE\s+TABLE/i.test(stmt)) out.create.push(entry);
      else if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(stmt)) out.index.push(entry);
      else if (/^ALTER\s+TABLE/i.test(stmt)) out.alter.push(entry);
      else out.other.push(entry);
    }
  }
  return out;
}

const d = collect();

// db/schema.sql was the original hand-maintained schema. It went stale (it
// described 8 of ~70 tables), BUT three tables live there and nowhere else:
// projects, subscriptions and usage have no CREATE TABLE anywhere in the
// application code — only ALTERs that assume they already exist. Without these
// the baseline cannot build a fresh database, so they are folded in here.
const LEGACY = 'db/schema.legacy.sql';
if (fs.existsSync(LEGACY)) {
  const legacy = fs.readFileSync(LEGACY, 'utf8');
  const created = new Set(d.create.map(e => (e.stmt.match(/CREATE TABLE(?: IF NOT EXISTS)? ([a-z_0-9]+)/i) || [])[1]?.toLowerCase()));
  // Split the legacy file into top-level statements.
  for (const raw of legacy.split(/;\s*(?:\n|$)/)) {
    const stmt = raw.replace(/^(?:\s*(?:--[^\n]*)?\n)+/, '').trim();
    if (!/^CREATE TABLE/i.test(stmt)) continue;
    const name = (stmt.match(/CREATE TABLE(?: IF NOT EXISTS)? ([a-z_0-9]+)/i) || [])[1]?.toLowerCase();
    if (!name || created.has(name)) continue;
    d.create.push({ stmt, from: `${LEGACY} (only definition anywhere)` });
    created.add(name);
  }
  // Legacy indexes for those tables too.
  for (const raw of legacy.split(/;\s*(?:\n|$)/)) {
    const stmt = raw.replace(/^(?:\s*(?:--[^\n]*)?\n)+/, '').trim();
    if (!/^CREATE (UNIQUE )?INDEX/i.test(stmt)) continue;
    const on = (stmt.match(/\bON\s+([a-z_0-9]+)/i) || [])[1]?.toLowerCase();
    if (on && ['projects', 'subscriptions', 'usage'].includes(on)) {
      d.index.push({ stmt, from: `${LEGACY} (only definition anywhere)` });
    }
  }
}

// Dedupe identical statements (several modules create the same table).
const seen = new Set();
const dedupe = list => list.filter(e => {
  const k = e.stmt.replace(/\s+/g, ' ').toLowerCase();
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const extension = dedupe(d.extension);
const create = dedupe(d.create);
const index = dedupe(d.index);
const alter = dedupe(d.alter);
const other = dedupe(d.other);

const tableOf = s => (s.match(/(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE)\s+([a-z_0-9."]+)/i) || [])[1] || '?';

let sqlOut = '';
const section = (title, list) => {
  if (!list.length) return;
  sqlOut += `\n-- ${'─'.repeat(74)}\n-- ${title}\n-- ${'─'.repeat(74)}\n`;
  for (const e of list) sqlOut += `\n-- from ${e.from}\n${e.stmt.replace(/\n\s{4}/g, '\n  ')};\n`;
};

// Order matters and was established by applying this file to a real Postgres:
//   extensions  → types the tables reference (pgvector for track_embeddings)
//   tables      → the base relations
//   alters      → columns added after the original CREATE (e.g. affiliates.tax_token)
//   indexes     → LAST, because several index columns are added by those alters
section(`Extensions (${extension.length}) — must precede tables using their types`, extension);
section(`Tables (${create.length})`, create);
section(`Column & constraint changes (${alter.length})`, alter);
section(`Indexes (${index.length}) — after the alters that add their columns`, index);
section(`Other DDL (${other.length})`, other);

const header = `-- 100Lights baseline schema
--
-- GENERATED by scripts/db/extract-schema.mjs from the DDL the application
-- executed at runtime. Do not hand-edit; add a new numbered migration instead.
--
-- Extensions: ${extension.length}   Tables: ${create.length}   Indexes: ${index.length}   Alters: ${alter.length}
-- Statements needing manual review (contain \${} interpolation): ${d.interpolated.length}
`;

fs.mkdirSync('db/migrations', { recursive: true });
fs.writeFileSync('db/migrations/0001_baseline.sql', header + sqlOut);

console.log(`extensions ${extension.length}  tables ${create.length}  indexes ${index.length}  alters ${alter.length}  other ${other.length}`);
if (d.interpolated.length) {
  console.log(`\n${d.interpolated.length} interpolated DDL statement(s) NOT included — review by hand:`);
  for (const e of d.interpolated) console.log(`  ${e.from}: ${e.stmt.replace(/\s+/g, ' ').slice(0, 100)}`);
}
console.log('\nwrote db/migrations/0001_baseline.sql');
