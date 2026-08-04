#!/usr/bin/env node
// ── Replay CLI ───────────────────────────────────────────────────────────────
// Regenerate manifest.json for an existing session directory from its stored
// logs (session.json + events.jsonl + roi.jsonl), WITHOUT re-running music
// generation. Use this to migrate old sessions after the schema changes.
//
//   node lib/session-capture/replay.mjs <sessionDir> [<sessionDir> ...]
//   node lib/session-capture/replay.mjs --all ./sessions      (every session under a root)
//   node lib/session-capture/replay.mjs <dir> --check          (validate only, write nothing)

import { existsSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { assembleManifest, validateManifest, readSessionLogs } from './session-recorder.mjs'
import { SCHEMA_VERSION } from './manifest-schema.mjs'

function replayOne(dir, { check } = {}) {
  if (!existsSync(join(dir, 'session.json'))) throw new Error(`${dir}: no session.json (not a session directory)`)
  const logs = readSessionLogs(dir)
  const manifest = assembleManifest(logs)
  validateManifest(manifest) // throws loudly on failure
  if (!check) writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

// Session dirs are the completed `<name>/` and `<name>.failed/` (skip `.partial`).
function findSessions(root) {
  return readdirSync(root)
    .filter(n => !n.endsWith('.partial'))
    .map(n => join(root, n))
    .filter(p => { try { return statSync(p).isDirectory() && existsSync(join(p, 'session.json')) } catch { return false } })
}

function main() {
  const argv = process.argv.slice(2)
  const check = argv.includes('--check')
  const rest = argv.filter(a => a !== '--check')
  let dirs
  if (rest[0] === '--all') {
    const root = rest[1]
    if (!root) { console.error('usage: replay.mjs --all <root>'); process.exit(1) }
    dirs = findSessions(root)
  } else {
    dirs = rest
  }
  if (!dirs.length) { console.error('usage: replay.mjs <sessionDir> [...] | --all <root> [--check]'); process.exit(1) }

  let ok = 0, bad = 0
  for (const dir of dirs) {
    try {
      const m = replayOne(dir, { check })
      ok++
      console.log(`✓ ${dir} — schema v${m.schema_version}${m.schema_version !== SCHEMA_VERSION ? ' (!)' : ''} · ${m.events.length} events · ${m.outcome}${check ? ' [check]' : ''}`)
    } catch (err) {
      bad++
      console.error(`✗ ${dir} — ${err.message}`)
    }
  }
  console.log(`\n${ok} ok, ${bad} failed`)
  if (bad) process.exit(1)
}

main()
