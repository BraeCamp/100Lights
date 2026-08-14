// Control-plane AGENT mode. Instead of streaming one hard-coded station, this box registers with the
// 100Lights control plane, asks what it should be running, and reconciles: it spawns a child streamer
// (stream.mjs) per assigned broadcast and kills ones no longer assigned — reporting each stream's
// status back every cycle. Start/stop is driven entirely from the admin's Broadcasts dashboard.
//
// This is how it scales: run this on N boxes and the control plane spreads the live broadcasts across
// them (each claims up to CAPACITY). Stream KEYS live here (per-slug env), never in the app/DB.
//
// Env:
//   CONTROL_URL   base URL of the app (e.g. https://100lights.com)
//   AGENT_TOKEN   shared secret == the app's BROADCAST_AGENT_TOKEN
//   WORKER_ID     stable id for this box (default: hostname)
//   CAPACITY      max simultaneous streams (default 2)
//   BASE_URL      page origin to stream (default = CONTROL_URL)
//   KEYS          JSON map of slug→streamKey, e.g. {"cinematic":"xxxx","study-lofi":"yyyy"}
//                 …or per-slug: KEY_CINEMATIC=xxxx  KEY_STUDY_LOFI=yyyy
import { spawn } from 'node:child_process'
import { hostname } from 'node:os'

const env = process.env
const CONTROL_URL = (env.CONTROL_URL || 'https://100lights.com').replace(/\/$/, '')
const TOKEN = env.AGENT_TOKEN || ''
const WORKER_ID = env.WORKER_ID || hostname() || 'worker'
// One stream per container (each has its own Xvfb + audio sink). Scale by running MORE agent
// containers, each a worker the control plane can assign to. (Multi-stream-per-box = per-child
// displays; a documented later enhancement.)
const CAPACITY = Math.max(1, parseInt(env.CAPACITY || '1', 10))
const BASE_URL = (env.BASE_URL || CONTROL_URL).replace(/\/$/, '')
const POLL_MS = 10000
const LIVE_AFTER_MS = 8000   // a child alive this long is considered "live"

if (!TOKEN) { console.error('[agent] AGENT_TOKEN required'); process.exit(1) }

const log = (...a) => console.log(`[agent ${new Date().toISOString()}]`, ...a)
const keyFor = (slug) => {
  try { const m = JSON.parse(env.KEYS || '{}'); if (m[slug]) return m[slug] } catch {}
  return env[`KEY_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] || null
}

/** slug → { proc, startedAt, status, error } */
const children = new Map()

function startChild(slug) {
  const key = keyFor(slug)
  if (!key) { children.set(slug, { proc: null, startedAt: Date.now(), status: 'error', error: 'no stream key on this worker' }); log('no key for', slug); return }
  log('starting', slug)
  const proc = spawn('node', ['stream.mjs'], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...env, STATION: slug, BROADCAST_ID: '', STREAM_KEY: key, BASE_URL } })
  const rec = { proc, startedAt: Date.now(), status: 'starting', error: null }
  proc.on('exit', code => { if (children.get(slug) === rec) { rec.status = 'error'; rec.error = `exited (${code})`; rec.proc = null } })
  children.set(slug, rec)
}
function stopChild(slug) {
  const rec = children.get(slug); if (!rec) return
  log('stopping', slug); try { rec.proc?.kill('SIGTERM') } catch {}
  children.delete(slug)
}

function reports() {
  const now = Date.now()
  return [...children.entries()].map(([slug, r]) => ({
    slug,
    status: r.status === 'error' ? 'error' : (r.proc && now - r.startedAt > LIVE_AFTER_MS ? 'live' : 'starting'),
    error: r.error || undefined,
  }))
}

async function tick() {
  let assignments = []
  try {
    const r = await fetch(`${CONTROL_URL}/api/broadcast/agent/sync`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-agent-token': TOKEN },
      body: JSON.stringify({ workerId: WORKER_ID, capacity: CAPACITY, reports: reports() }),
    })
    if (!r.ok) { log('sync HTTP', r.status); return }
    const d = await r.json(); assignments = Array.isArray(d.assignments) ? d.assignments : []
  } catch (e) { log('sync failed', String(e)); return }

  const want = new Set(assignments)
  // start newly-assigned (that aren't already running healthily)
  for (const slug of want) {
    const rec = children.get(slug)
    if (!rec || (rec.status === 'error' && Date.now() - rec.startedAt > 15000)) { if (rec) stopChild(slug); startChild(slug) }
  }
  // stop anything no longer assigned
  for (const slug of [...children.keys()]) if (!want.has(slug)) stopChild(slug)
}

log(`agent ${WORKER_ID} → ${CONTROL_URL} (capacity ${CAPACITY})`)
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { log('shutting down'); for (const s of [...children.keys()]) stopChild(s); process.exit(0) })
;(async () => { for (;;) { await tick(); await new Promise(r => setTimeout(r, POLL_MS)) } })()
