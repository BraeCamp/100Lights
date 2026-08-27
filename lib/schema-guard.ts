/**
 * Kill switch for the runtime DDL that predates db/migrations.
 *
 * This codebase creates its schema lazily: ~40 ensure()-style functions run
 * CREATE TABLE IF NOT EXISTS / ALTER TABLE on first use. Each memoises with a
 * module-level flag, but that flag is per-process — so on serverless every cold
 * container pays for the DDL again, and per lib/perf notes the real Neon cost is
 * queries-per-cold-start.
 *
 * Once db/migrations/0001_baseline.sql has been applied to an environment, that
 * work is pure waste. Set SCHEMA_MANAGED=1 there and every ensure() short-circuits.
 *
 *   SCHEMA_MANAGED unset  → ensure() runs the DDL (current behaviour, safe default)
 *   SCHEMA_MANAGED=1      → ensure() returns immediately; migrations own the schema
 *
 * Rollback is unsetting one environment variable. See db/migrations/README.md
 * for the cutover order.
 */
export const schemaManaged = process.env.SCHEMA_MANAGED === '1'
