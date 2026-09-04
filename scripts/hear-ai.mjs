#!/usr/bin/env node
// ── Hear the AI: render an AI composition to real audio ───────────────────────
// The composer emits NOTES; you can't judge a song from note data. This bounces
// an AI-generated song through the actual studio engine — the real seeded
// samples and instrument presets each track targets — into a listenable file.
//
//   node scripts/hear-ai.mjs "moody minor synthwave, slow build"   # AI director
//   node scripts/hear-ai.mjs --compose=house --seed=3              # deterministic
//   node scripts/hear-ai.mjs "lofi hip hop" --seconds=30 --open
//
// Flags: --compose=<genre> (skip the LLM, use compose.mjs directly)
//        --key=<Bb minor>  --seed=N  --seconds=N (cap; default = full song)
//        --out=<path.mp3>  --url=<dev server>  --keep (also keep the .wav)  --open
//
// Needs the dev server running (dev-only window.__daw* hooks). Writes nothing to
// the repo — the intermediate .cfproj goes to a temp dir.

import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir, homedir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const has = n => argv.includes(`--${n}`)
const prompt = argv.filter(a => !a.startsWith('--'))[0] || ''
const COMPOSE = flag('compose', null)          // genre → use compose.mjs, skip the LLM
const PROJECT = flag('project', null)          // re-render an existing .cfproj (skip composing)
const KEY = flag('key', '')
const SEED = flag('seed', String(Math.floor(Date.now() / 1000) % 100000))
const SECONDS = flag('seconds', null) ? Math.max(3, Math.min(180, Number(flag('seconds')))) : null
const URL = flag('url', 'http://localhost:3001')
const TITLE = flag('title', null)              // override the project name shown in the studio
const KEEP = has('keep')
const OFFLINE = has('offline')   // opt-in fast render; see the note at the bounce
const OPEN = has('open')
const log = (...a) => console.log(...a)
const titleCase = s => s.replace(/\b\w/g, c => c.toUpperCase())
let aiTitle = null                             // the director's moodName → used as the project name

if (!prompt && !COMPOSE && !PROJECT) {
  console.error('usage: hear-ai.mjs "<text prompt>"   OR   --compose=<genre> [--seed=N]   OR   --project=<file.cfproj>')
  process.exit(1)
}

const TMP = mkdtempSync(join(tmpdir(), 'hear-ai-'))
const specPath = join(TMP, 'spec.json')

// ── Re-render an existing project file (skip composing entirely) ──────────────
let spec, cfprojRaw, dawProject
if (PROJECT) {
  log(`▸ re-rendering existing project: ${PROJECT}`)
  cfprojRaw = readFileSync(resolve(PROJECT), 'utf8')
  const cf = JSON.parse(cfprojRaw)
  dawProject = cf.dawProject
  spec = { genre: cf.name || dawProject.name || 'project', name: cf.name || dawProject.name, tracks: dawProject.tracks }
}

// ── 1 · Compose ───────────────────────────────────────────────────────────────
if (PROJECT) { /* already loaded above */ } else if (COMPOSE) {
  log(`▸ composing (deterministic): ${COMPOSE}${KEY ? ' ' + KEY : ''} seed=${SEED}`)
  const args = ['scripts/compose.mjs', COMPOSE]
  if (KEY) args.push(KEY)
  args.push(`--seed=${SEED}`, `--out=${specPath}`)
  execFileSync('node', args, { cwd: ROOT, stdio: 'inherit' })
} else {
  log(`▸ composing (AI director): "${prompt}"`)
  const args = ['scripts/compose-ai.mjs', prompt, '--best=1', `--seed=${SEED}`, `--out=${specPath}`]
  const composeOut = execFileSync('node', args, { cwd: ROOT, encoding: 'utf8' })
  process.stdout.write(composeOut)
  // The director prints "▸ director: <genre> · <key> · <moodName>" — use the mood
  // as the project's name (the studio shows the file's embedded name, not the OS
  // filename), so an uploaded song keeps a real title instead of "Genre — Key".
  const m = composeOut.match(/director:.*·.*·\s*(.+)/)
  if (m && m[1].trim()) aiTitle = titleCase(m[1].trim())
}
if (!PROJECT) {
  spec = JSON.parse(readFileSync(specPath, 'utf8'))

  // ── 2 · spec → loadable dawProject (into the temp dir, not the repo) ─────────
  log('▸ building loadable project…')
  execFileSync('node', ['scripts/spec-to-cfproj.mjs', specPath, `--outdir=${TMP}`], { cwd: ROOT, stdio: 'inherit' })
  const cfprojFile = readdirSync(TMP).find(f => f.endsWith('.cfproj'))
  if (!cfprojFile) { console.error('spec-to-cfproj produced no .cfproj'); rmSync(TMP, { recursive: true, force: true }); process.exit(1) }
  cfprojRaw = readFileSync(join(TMP, cfprojFile), 'utf8')   // the uploadable project file (all tracks + AI sounds)
  dawProject = JSON.parse(cfprojRaw).dawProject
}

const bpm = dawProject.tempo || 120
const endBeat = Math.max(...dawProject.arrangementClips.map(c => c.startBeat + c.durationBeats), 4)
const sliceBeats = SECONDS ? Math.min(endBeat, (SECONDS * bpm) / 60) : endBeat
const approxSec = (sliceBeats * 60 / bpm)

// ── 3 · Headless studio: load the song, bounce with the REAL samples ──────────
log(`▸ bouncing ${approxSec.toFixed(0)}s through the studio engine…`)
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { try { localStorage.setItem('100lights-ui-tier', 'full') } catch { /* private mode */ } })
const page = await ctx.newPage()
page.on('pageerror', e => console.error('  page error:', e.message))
try {
  await page.goto(`${URL}/new?modules=audio`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof window.__dawDispatch === 'function', null, { timeout: 30000 })
  await page.waitForTimeout(800)                 // let the sound library seed
  await page.evaluate(want => { window.__WANT_OFFLINE = want }, OFFLINE)
  await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), dawProject)
  await page.waitForTimeout(1000)
  // A sample preset (the piano roll's Samples tab) resolves through the
  // library — which a fresh browser is still SEEDING when the page is this
  // young. Rendering before the seeded entry exists plays that track silent,
  // and a silent track reads as "better dynamics" in the stats. Wait for every
  // seeded sample the project names; if the library panel is not mounted here,
  // open it by voice so it seeds.
  const sampleIds = [...new Set((dawProject.presets ?? []).map(p => p.sampleId).filter(id => typeof id === 'string' && id.startsWith('seed:')))]
  if (sampleIds.length) {
    const seeded = async ids => {
      const dbs = await indexedDB.databases()
      for (const d of dbs) {
        if (!d.name || !d.name.startsWith('contentforge-sound-library')) continue
        const ok = await new Promise(res => {
          const req = indexedDB.open(d.name)
          req.onerror = () => res(false)
          req.onsuccess = () => {
            const db = req.result
            try {
              const tx = db.transaction('entries', 'readonly')
              const st = tx.objectStore('entries')
              let found = 0
              for (const id of ids) { const g = st.get(id); g.onsuccess = () => { if (g.result) found++ } }
              tx.oncomplete = () => { db.close(); res(found === ids.length) }
              tx.onerror = () => { db.close(); res(false) }
            } catch { db.close(); res(false) }
          }
        })
        if (ok) return true
      }
      return false
    }
    console.log(`  waiting for the sound library to seed ${sampleIds.length} sample preset(s)…`)
    try {
      await page.waitForFunction(seeded, sampleIds, { timeout: 25000, polling: 1000 })
    } catch {
      console.log('  library not seeded yet — opening the Sound Library so it seeds')
      await page.evaluate(() => window.__lightHear?.('open the sound library')).catch(() => {})
      await page.waitForFunction(seeded, sampleIds, { timeout: 90000, polling: 1000 })
    }
  }
  await page.keyboard.press('Escape').catch(() => {})
  // --offline uses the OfflineAudioContext render, which goes as fast as the CPU
  // allows rather than taking as long as the music (2:05 of audio rendered in 42s
  // wall clock, browser startup included, against ~3min realtime).
  //
  // It is OPT-IN because it is not yet trustworthy for synth-heavy projects: on a
  // seven-track Apollo piece it silently dropped the Pad track entirely — the
  // pad-only intro rendered as digital silence while the other six Apollo tracks
  // came through. The engine's renderOffline does await _preloadAll(), so this is
  // something subtler than "worklets were not warm", and until it is understood a
  // fast render that quietly loses a track is worse than a slow correct one.
  const mix = await page.evaluate(async (endB) => {
    if (!window.__WANT_OFFLINE) return null
    if (typeof window.__dawRenderOffline !== 'function') return null
    try {
      const r = await window.__dawRenderOffline({ startBeat: 0, endBeat: endB })
      return r?.base64 ? { base64: r.base64, type: r.type, durationSec: r.durationSec } : null
    } catch (e) { return { error: String((e && e.message) || e) } }
  }, sliceBeats)
  if (mix?.error) log(`  (offline render failed: ${mix.error} — falling back to realtime)`)
  let wav = null
  if (!mix?.base64) {
    log('▸ realtime capture (slower; offline path unavailable)…')
    wav = await page.evaluate(async (endB) => {
      const r = await window.__dawRenderWav({ startBeat: 0, endBeat: endB, tailSec: 1.0 })
      return r ? { master: r.master, sampleRate: r.sampleRate, durationSec: r.durationSec } : null
    }, sliceBeats)
    if (!wav) throw new Error('neither __dawRenderOffline nor __dawRenderWav returned anything')
  }

  // ── 4 · Write the file(s) ────────────────────────────────────────────────────
  const outDir = join(homedir(), 'Desktop', '100lights-ai-renders')
  mkdirSync(outDir, { recursive: true })
  const label = (COMPOSE || (spec.genre || 'ai')).replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  const base = `ai-${label}-${SEED}-${Date.now()}`
  const defaultMp3 = join(outDir, `${base}.mp3`)
  const mp3Path = resolve(flag('out', defaultMp3))
  const wavPath = mp3Path.replace(/\.mp3$/i, '') + '.wav'
  // Save the uploadable project file next to the audio — open it via the studio's
  // projects page ("Open from file") to get every instrument on its own track.
  const projPath = mp3Path.replace(/\.mp3$/i, '') + '.cfproj'
  const projectTitle = TITLE || aiTitle
  if (projectTitle) {                          // name it so the studio shows a real title, not "Genre — Key"
    const cf = JSON.parse(cfprojRaw)
    cf.name = projectTitle
    if (cf.dawProject) cf.dawProject.name = projectTitle
    writeFileSync(projPath, JSON.stringify(cf, null, 1))
  } else {
    writeFileSync(projPath, cfprojRaw)
  }
  if (wav) {
    // A real-time capture can come back SHORT without failing: the transport
    // clock keeps advancing on wall time, so it reaches the end and reports
    // success, but under CPU load the ScriptProcessor stops getting callbacks
    // and simply misses audio. A seven-synth project produced a 12MB file where
    // 44MB was expected — a third of the song silently absent, with a tick and a
    // success message. Catch it here rather than shipping a truncated bounce.
    const expected = wav.durationSec ?? 0
    const captured = Buffer.from(wav.master, 'base64').length / (wav.sampleRate * 2 * 2 || 1)
    if (expected > 1 && captured < expected * 0.9) {
      throw new Error(
        `realtime capture came back short: ${captured.toFixed(1)}s of an expected ${expected.toFixed(1)}s. ` +
        `The audio thread could not keep up — freeze the synth tracks (window.__dawFreezeApollo) or render fewer at once.`)
    }
    writeFileSync(wavPath, Buffer.from(wav.master, 'base64'))
  } else {
    // The offline path encodes to AAC/mp4 where the browser can, so normalise to
    // WAV — everything downstream (analysis, mastering) expects a wav here.
    const encPath = wavPath.replace(/\.wav$/i, '') + (String(mix.type).includes('mp4') ? '.m4a' : '.src.wav')
    writeFileSync(encPath, Buffer.from(mix.base64, 'base64'))
    execFileSync('ffmpeg', ['-y', '-i', encPath, wavPath], { stdio: 'ignore' })
    rmSync(encPath, { force: true })
  }
  try {
    execFileSync('ffmpeg', ['-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-q:a', '2', mp3Path], { stdio: 'ignore' })
    if (!KEEP) rmSync(wavPath, { force: true })
  } catch {
    console.error('  (ffmpeg mp3 encode failed — leaving the .wav)')
  }
  const finalPath = (KEEP || !mp3Exists(mp3Path)) && !mp3Exists(mp3Path) ? wavPath : mp3Path
  log(`\n✓ ${spec.genre || COMPOSE} · ${bpm} BPM · ${approxSec.toFixed(0)}s`)
  log(`  ${spec.tracks?.map(t => t.name).join(', ') || ''}`)
  log(`  → ${finalPath}   (preview)`)
  log(`  → ${projPath}   (upload this — separate tracks)`)
  if (KEEP && mp3Exists(mp3Path)) log(`  → ${wavPath}`)
  if (OPEN) { try { execFileSync('open', [finalPath]) } catch { /* non-mac */ } }
} finally {
  await browser.close()
  rmSync(TMP, { recursive: true, force: true })
}

function mp3Exists(p) { try { readFileSync(p); return true } catch { return false } }
