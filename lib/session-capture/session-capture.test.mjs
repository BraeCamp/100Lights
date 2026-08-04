// Test suite for the session-capture layer. Zero-dependency (tiny assert
// harness, ajv is already a dep). Run: node lib/session-capture/session-capture.test.mjs
import { existsSync, readFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createSession, ingestSession, assembleManifest, validateManifest, readSessionLogs,
  roiGaps, roiIsCovered, fullFrameRect, panelRectToCapture, SCHEMA_VERSION,
} from './index.mjs'

let passed = 0, failed = 0
function ok(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ ${name}`) } }
function throws(name, fn) { let t = false; try { fn() } catch { t = true } ok(name, t) }

const ROOT = mkdtempSync(join(tmpdir(), 'sesscap-'))

// A controllable clock so event timestamps (and thus ROI gaps) are deterministic.
function fakeClock(start = Date.UTC(2026, 7, 4, 0, 0, 0)) {
  const c = { now: start }
  return { fn: () => c.now, advance: s => { c.now += s * 1000 }, set: s => { c.now = start + s * 1000 } }
}
const opts = (clk, extra = {}) => ({ root: ROOT, handleCrashes: false, now: clk.fn(), clock: clk.fn, ...extra })

const goodMusical = { bpm: 120, key: 'A minor', time_signature: '4/4', genre_tags: ['lofi'], instrument_list: ['Drums', 'Bass'] }
const goodGen = { model: 'compose.mjs', prompt_or_seed: 42, total_takes: 3, rejected_takes: 2 }

// ── 1 · Atomic write: completed session ──────────────────────────────────────
{
  const clk = fakeClock()
  const s = createSession(opts(clk, { sessionId: 'a1' }))
  const partial = s.dir
  ok('1 partial dir exists during session', existsSync(partial) && partial.endsWith('.partial'))
  s.setMusical(goodMusical).setGeneration(goodGen)
  clk.advance(1.5); s.event('take_started', { index: 0, seed: 42 })
  const finalDir = s.end('completed')
  ok('1 final dir exists after end', existsSync(finalDir) && !finalDir.endsWith('.partial'))
  ok('1 partial dir removed (watcher never sees half-written)', !existsSync(partial))
  ok('1 manifest.json written', existsSync(join(finalDir, 'manifest.json')))
  const m = JSON.parse(readFileSync(join(finalDir, 'manifest.json'), 'utf8'))
  ok('1 schema_version stamped', m.schema_version === SCHEMA_VERSION)
  ok('1 outcome completed', m.outcome === 'completed')
  ok('1 event t is relative seconds from start', m.events[0].t === 1.5)
  ok('1 started_at is absolute ISO', m.started_at === '2026-08-04T00:00:00.000Z')
}

// ── 2 · Atomic write: abort → .failed, never .partial ────────────────────────
{
  const clk = fakeClock()
  const s = createSession(opts(clk, { sessionId: 'a2' }))
  const partial = s.dir
  const failedDir = s.abort('user cancelled')
  ok('2 aborted lands in .failed', existsSync(failedDir) && failedDir.endsWith('.failed'))
  ok('2 no .partial left behind', !existsSync(partial))
  ok('2 no completed dir', !existsSync(partial.replace('.partial', '')))
}

// ── 3 · Schema validation: reason REQUIRED on take_rejected / retry ───────────
{
  const base = () => ({
    schema_version: SCHEMA_VERSION, session_id: 'x', started_at: '2026-08-04T00:00:00.000Z',
    duration_s: 1, capture: null, audio: null, musical: goodMusical, generation: goodGen,
    events: [], roi: [], roi_fallback: fullFrameRect(null), outcome: 'completed',
  })
  ok('3 minimal manifest validates', !!validateManifest(base()))

  const withReason = base(); withReason.events = [{ t: 0.1, type: 'take_rejected', payload: { reason: 'too flat', changed: 'new seed' } }]
  ok('3 take_rejected WITH reason+changed validates', !!validateManifest(withReason))

  throws('3 take_rejected WITHOUT reason throws', () => {
    const bad = base(); bad.events = [{ t: 0.1, type: 'take_rejected', payload: { note: 'oops' } }]
    validateManifest(bad)
  })
  throws('3 retry WITHOUT changed throws', () => {
    const bad = base(); bad.events = [{ t: 0.1, type: 'retry', payload: { reason: 'weak' } }]
    validateManifest(bad)
  })
  throws('3 missing required field throws', () => { const bad = base(); delete bad.musical; validateManifest(bad) })
  throws('3 wrong schema_version throws', () => { const bad = base(); bad.schema_version = 999; validateManifest(bad) })
}

// ── 4 · Loud failure at finalize when an event lacks a reason ─────────────────
{
  const clk = fakeClock()
  const s = createSession(opts(clk, { sessionId: 'a4' }))
  const partial = s.dir
  s.setMusical(goodMusical).setGeneration(goodGen)
  s.event('take_rejected', { note: 'no reason here' }) // invalid payload
  throws('4 end() throws loudly on invalid manifest', () => s.end('completed'))
  ok('4 invalid session lands in .failed, not completed', existsSync(partial.replace('.partial', '.failed')) && !existsSync(partial.replace('.partial', '')))
  ok('4 no .partial left behind after loud failure', !existsSync(partial))
}

// ── 5 · ROI coverage: no gap > 2s without a fallback rect ─────────────────────
{
  const clk = fakeClock()
  const s = createSession(opts(clk, { sessionId: 'a5' }))
  s.setMusical(goodMusical).setGeneration(goodGen)
  s.setCapture({ path: 'capture.mp4', fps: 30, width: 1920, height: 1080, started_at: '2026-08-04T00:00:00.000Z' })
  s.roi({ x: 0, y: 0, w: 960, h: 1080, panel: 'arrangement' })         // t=0
  clk.advance(3); s.roi({ x: 960, y: 0, w: 960, h: 1080, panel: 'mixer' }) // t=3 → 3s gap
  const dir = s.end('completed')
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))

  const gaps = roiGaps(m.roi, m.duration_s, 2)
  ok('5 a >2s ROI gap is detected', gaps.length === 1 && gaps[0][0] === 0 && gaps[0][1] === 3)
  ok('5 fallback rect emitted (full frame)', m.roi_fallback && m.roi_fallback.w === 1920 && m.roi_fallback.h === 1080)
  ok('5 covered because a fallback rect exists', roiIsCovered(m.roi, m.duration_s, m.roi_fallback, 2) === true)
  ok('5 NOT covered if fallback were absent', roiIsCovered(m.roi, m.duration_s, null, 2) === false)
  // A dense track with no >2s gap needs no fallback to be covered.
  const dense = [{ t: 0 }, { t: 1.5 }, { t: 3 }, { t: 4 }]
  ok('5 dense ROI (<=2s spacing) has no gaps', roiGaps(dense, 5, 2).length === 0)
}

// ── 6 · Replay: regenerate manifest from stored logs, idempotently ────────────
{
  const clk = fakeClock()
  const s = createSession(opts(clk, { sessionId: 'a6' }))
  s.setMusical(goodMusical).setGeneration(goodGen)
  clk.advance(0.5); s.event('take_started', { index: 0, seed: 1 })
  clk.advance(0.5); s.event('take_rejected', { reason: 'flat arrangement', changed: 'seed 1 → 8', index: 0 })
  clk.advance(0.5); s.event('take_completed', { index: 1, seed: 8 })
  clk.advance(0.5); s.roi({ x: 0, y: 0, w: 100, h: 100, panel: 'lead' })
  const dir = s.end('completed')

  const onDisk = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  const logs = readSessionLogs(dir)
  const replayed = assembleManifest(logs)
  ok('6 replay reproduces manifest exactly', JSON.stringify(replayed) === JSON.stringify(onDisk))
  ok('6 replayed manifest validates', !!validateManifest(replayed))
  ok('6 stored logs preserve reason field', logs.events.find(e => e.type === 'take_rejected').payload.reason === 'flat arrangement')
}

// ── 7 · Disable flag: no-op recorder, nothing written ────────────────────────
{
  const before = existsSync(ROOT) ? readdirCount(ROOT) : 0
  const s = createSession({ root: ROOT, enabled: false, handleCrashes: false })
  ok('7 disabled recorder reports not enabled', s.enabled === false && s.dir === null)
  s.event('take_started', {}).roi({ x: 0, y: 0, w: 1, h: 1, panel: 'x' })
  ok('7 disabled end() returns null', s.end('completed') === null)
  ok('7 disabled recorder writes no directory', readdirCount(ROOT) === before)
}
function readdirCount(p) { return readdirSync(p).length }

// ── 8 · ingestSession: server-side atomic write from a complete payload ───────
{
  const header = {
    started_at: '2026-08-04T01:00:00.000Z',
    capture: { path: 'capture.webm', fps: 30, width: 1920, height: 1080, started_at: '2026-08-04T01:00:00.000Z' },
    audio: { path: 'final_mix.wav', sample_rate: 48000, duration_s: 120, stems: ['stems/lead.wav'] },
    musical: goodMusical, generation: goodGen, outcome: 'completed', duration_s: 120,
  }
  const events = [{ t: 0.2, type: 'take_rejected', payload: { reason: 'muddy low end', changed: 'high-passed the pad' } }]
  const roi = [{ t: 0, x: 0, y: 0, w: 960, h: 1080, panel: 'arrangement' }]
  const files = [
    { name: 'capture.webm', data: Buffer.from('FAKEVIDEO') },
    { name: 'final_mix.wav', data: Buffer.from('FAKEWAV') },
    { name: 'stems/lead.wav', data: Buffer.from('FAKESTEM') },
  ]
  const dir = ingestSession({ root: ROOT, sessionId: 'ing1', header, events, roi, files })
  ok('8 ingested final dir exists (not .partial)', existsSync(dir) && !dir.endsWith('.partial'))
  ok('8 no .partial left behind', !existsSync(dir + '.partial'))
  ok('8 manifest.json present + valid', !!validateManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))))
  ok('8 capture file landed', existsSync(join(dir, 'capture.webm')))
  ok('8 final_mix.wav landed', existsSync(join(dir, 'final_mix.wav')))
  ok('8 stem landed in stems/', existsSync(join(dir, 'stems', 'lead.wav')))
  ok('8 reason preserved through ingest', JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).events[0].payload.reason === 'muddy low end')

  // Path-traversal in a file name is refused, not written outside the dir.
  const dir2 = ingestSession({ root: ROOT, sessionId: 'ing2', header: { ...header, started_at: '2026-08-04T01:01:00.000Z' }, files: [{ name: '../escape.txt', data: Buffer.from('x') }] })
  ok('8 path-traversal file rejected', !existsSync(join(dir2, '..', 'escape.txt')) && existsSync(dir2))

  // Invalid payload (missing reason) → throws + lands in .failed, no completed dir.
  throws('8 invalid ingest throws loudly', () => ingestSession({
    root: ROOT, sessionId: 'ing3', header: { ...header, started_at: '2026-08-04T01:02:00.000Z' },
    events: [{ t: 0, type: 'take_rejected', payload: { note: 'no reason' } }],
  }))
  ok('8 invalid ingest landed in .failed', existsSync(join(ROOT, '2026-08-04T01-02-00-000Z.failed')) && !existsSync(join(ROOT, '2026-08-04T01-02-00-000Z')))
}

// ── 9 · ROI transform: CSS-px rect → capture-px space ─────────────────────────
{
  const r = panelRectToCapture({ x: 100, y: 50, width: 200, height: 100 }, { width: 1000, height: 500 }, { width: 2000, height: 1000 })
  ok('9 rect scaled into capture space (×2)', r.x === 200 && r.y === 100 && r.w === 400 && r.h === 200)
  const same = panelRectToCapture({ left: 10, top: 20, width: 30, height: 40 }, { width: 800, height: 600 }, null)
  ok('9 no capture → identity (uses left/top)', same.x === 10 && same.y === 20 && same.w === 30 && same.h === 40)
}

// ── report ───────────────────────────────────────────────────────────────────
rmSync(ROOT, { recursive: true, force: true })
console.log(`\nsession-capture: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
