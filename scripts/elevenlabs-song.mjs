#!/usr/bin/env node
// ── ElevenLabs → stems → self-contained .cfproj ──────────────────────────────
// Generate a song with ElevenLabs, stem-separate it, and package the stems into
// a self-contained 100Lights ".cfproj" (plain JSON, NOT a zip) so each stem
// opens in the studio as its own AUDIO track carrying its ORIGINAL ElevenLabs
// audio (not a note-recreation).
//
// Each stem is MP3-encoded and inlined as a `data:audio/mpeg;base64,…` URL on
// its clip. That makes the file self-contained: the DAW engine decodes and plays
// data: URLs directly — no zip, no R2 upload, no blob URLs that die on nav. The
// old Firefly .zip only kept audio if an authenticated R2 upload succeeded at
// import time; when it failed it degraded to blob URLs → silent clips.
//
// Runs standalone — no app, no dev server, no login. Reads ELEVENLABS_API_KEY
// from the environment or .env.local.
//
//   node scripts/elevenlabs-song.mjs "<prompt>" [--length=<ms>] [--vocals] \
//   (instrumental by default — pass --vocals to include a vocal stem) \
//        [--title="..."] [--out=<path.cfproj>]
//   node scripts/elevenlabs-song.mjs --selftest   # no key needed; validates cfproj
//
// Deliverable: opened via the projects page "Open from file" → readProjectFile
// JSON.parses it → data:-URL audio plays. (importFireflyBundle is NOT involved.)
//
// Outputs (in ~/Desktop/100lights-ai-renders/):
//   <title>.cfproj         the self-contained project (the deliverable)
//   <title>__full-mix.mp3  the raw generated song (preview before stems)

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join, dirname, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { analyzeSong, recordToCorpus } from '../lib/music-learn.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const uid = () => randomUUID()

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const bool = n => argv.includes(`--${n}`)
const positional = argv.filter(a => !a.startsWith('--')).join(' ').trim()

const SELFTEST = bool('selftest')
const INSTRUMENTAL = !bool('vocals')   // instrumental by default; pass --vocals to include a vocal stem
const NO_LEARN = bool('no-learn')   // skip adding this generation to the ML corpus
const LENGTH_MS = Math.max(3000, Math.min(600000, parseInt(flag('length', '40000'), 10) || 40000))
const PROMPT = positional
const TITLE = (flag('title', '') || (PROMPT ? PROMPT.slice(0, 60) : 'ElevenLabs Song')).trim() || 'ElevenLabs Song'

const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
const safeName = s => s.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, ' ').trim() || 'song'
const OUT_CFPROJ = flag('out', join(OUT_DIR, `${safeName(TITLE)}.cfproj`))
const TEMPO = 120
// Vercel caps request bodies at ~4.5 MB; the signed-in "save to projects" path
// POSTs the whole project to /api/projects. Warn before we get close.
const SIZE_WARN_MB = 4

// ── Key resolution (mirror scripts/compose-ai.mjs) ───────────────────────────
function resolveKey() {
  let key = process.env.ELEVENLABS_API_KEY
  if (!key) {
    try {
      key = (readFileSync(join(ROOT, '.env.local'), 'utf8')
        .match(/^\s*ELEVENLABS_API_KEY\s*=\s*["']?([^"'\n]+)/m) || [])[1]?.trim()
    } catch { /* none */ }
  }
  return key || null
}

// ── ElevenLabs calls ─────────────────────────────────────────────────────────
async function generateMusic(key, prompt, lengthMs, instrumental) {
  const body = { prompt, model_id: 'music_v2', music_length_ms: lengthMs }
  if (instrumental) body.force_instrumental = true
  const res = await fetch('https://api.elevenlabs.io/v1/music', {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(290_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`ElevenLabs /music ${res.status}: ${text.slice(0, 500)}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

async function stemSeparate(key, audioBuf) {
  const form = new FormData()
  // Let fetch set the multipart boundary — do NOT set content-type manually.
  form.append('file', new Blob([audioBuf], { type: 'audio/mpeg' }), 'mix.mp3')
  const res = await fetch('https://api.elevenlabs.io/v1/music/stem-separation', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
    signal: AbortSignal.timeout(290_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`ElevenLabs /music/stem-separation ${res.status}: ${text.slice(0, 500)}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

// ── Audio helpers (ffmpeg / ffprobe) ─────────────────────────────────────────
function probeDurationSec(path) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', path,
    ]).toString().trim()
    const d = parseFloat(out)
    return Number.isFinite(d) && d > 0 ? d : 0
  } catch { return 0 }
}

// Convert any stem to a 16-bit PCM WAV (stereo kept — decodeAudioData handles it;
// the importer imposes no channel requirement, it just uploads the blob).
function toWav(srcPath, destPath) {
  execFileSync('ffmpeg', ['-y', '-i', srcPath, '-acodec', 'pcm_s16le', destPath],
    { stdio: ['ignore', 'ignore', 'ignore'] })
}

// Pretty stem name from a stem filename (e.g. "vocals.mp3" → "Vocals").
function prettyStemName(file) {
  const base = basename(file, extname(file))
    .replace(/^stem[_-]?/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
  return base ? base.replace(/\b\w/g, c => c.toUpperCase()) : 'Stem'
}

// MP3-encode a stem WAV and return it as a self-contained `data:audio/mpeg;base64,…` URL the DAW
// engine decodes directly. Bitrate defaults to 112 kbps CBR — stems are inlined as base64 (≈1.33× the
// bytes) so a whole multi-stem song stays under the ~4.5 MB /api/projects body cap; 165 kbps blew past
// it (see scripts/shrink-cfproj.mjs, which rescues older exports).
function stemToDataUrl(wavPath, kbps = 112) {
  const mp3Path = `${wavPath.replace(/\.wav$/i, '')}.${kbps}k.mp3`
  execFileSync('ffmpeg', ['-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', `${kbps}k`, mp3Path],
    { stdio: ['ignore', 'ignore', 'ignore'] })
  const b64 = readFileSync(mp3Path).toString('base64')
  try { rmSync(mp3Path, { force: true }) } catch { /* ignore */ }
  return `data:audio/mpeg;base64,${b64}`
}

// True if a stem WAV is effectively silent (ElevenLabs stem-separation returns all 6 stems even for an
// instrumental — the empty Vocals/Guitar/Piano ones just bloat the file and clutter the project).
function isSilentWav(wavPath) {
  const r = spawnSync('ffmpeg', ['-i', wavPath, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
  const m = (r.stderr || '').match(/max_volume:\s*(-?[\d.]+) dB/)
  return m ? parseFloat(m[1]) < -55 : false
}

// ── Cfproj authoring (the single path selftest + real run share) ─────────────
// stems: [{ name, wavPath, durationSec }]  → writes outCfprojPath (plain JSON),
// each clip's audioUrl inlined as a data:audio/mpeg base64 MP3. Returns stats.
function buildCfproj(stems, title, outCfprojPath) {
  const tracks = []
  const arrangementClips = []
  const COLORS = ['#ef4444', '#a78bfa', '#3b82f6', '#14b8a6', '#f59e0b', '#22c55e', '#ec4899']

  // Drop silent stems (empty Vocals/Guitar/etc.) — they only bloat the inlined base64 and clutter the
  // project. Selftest passes synthetic stems, so only filter when a wavPath is present.
  const kept = stems.filter(s => !s.wavPath || !isSilentWav(s.wavPath))
  const skipped = stems.length - kept.length
  if (skipped > 0) console.log(`▸ dropped ${skipped} silent stem${skipped === 1 ? '' : 's'}`)
  stems = kept

  stems.forEach((stem, i) => {
    const assetId = uid()
    const trackId = uid()
    const clipId = uid()
    const durationSec = stem.durationSec
    const durationBeats = durationSec * TEMPO / 60

    // Track — mirrors scripts/spec-to-cfproj.mjs toDawProject() + DawTrack shape.
    tracks.push({
      id: trackId,
      name: stem.name,
      type: 'audio',
      color: COLORS[i % COLORS.length],
      volume: 0.8,
      pan: 0,
      mute: false,
      solo: false,
      armed: false,
      height: 64,
      effects: [],
      instrument: { type: 'none', params: {} }, // defaultTrackInstrument()
    })

    // Audio clip — mirrors lib/daw-state.ts makeAudioClip() + AudioClip shape.
    // audioUrl is a self-contained data:audio/mpeg base64 MP3 → the engine
    // decodes and plays it directly, no zip/R2/blob involved.
    arrangementClips.push({
      kind: 'audio',
      id: clipId,
      trackId,
      name: stem.name,
      startBeat: 0,
      durationBeats,
      audioUrl: stemToDataUrl(stem.wavPath),
      gain: 1,
      loopEnabled: false,
      reverse: false,
      fadeIn: 0,
      fadeOut: 0,
      trimStart: 0,
      trimEnd: 0,
      bufferDuration: durationSec,
    })

    void assetId // asset id no longer used as a file path; kept for parity
  })

  const loopEnd = Math.max(4, ...arrangementClips.map(c => c.startBeat + c.durationBeats))

  // dawProject — mirrors spec-to-cfproj toDawProject() + defaultProject().
  const dawProject = {
    id: uid(),
    name: title,
    tempo: TEMPO,
    timeSignatureNum: 4,
    timeSignatureDen: 4,
    tracks,
    arrangementClips,
    scenes: Array.from({ length: 4 }, (_, i) => ({ id: uid(), name: `Scene ${i + 1}` })),
    sessionGrid: {},
    loopStart: 0,
    loopEnd,
    loopEnabled: false,
    masterVolume: 0.85,
    automationLanes: [],
    clipEffects: [],
    returnTracks: [],
    takeLanes: [],
    crossfaderValue: 0.5,
    waveformZoom: 1,
    swing: 0,
    cueMarkers: [],
    sections: [],
    key: 0,
    scale: 'major',
  }

  // cfproj wrapper — mirrors spec-to-cfproj toCfproj().
  const cfproj = {
    _type: '100lights-project',
    version: 1,
    id: dawProject.id,
    name: title,
    savedAt: new Date().toISOString(),
    tracks: [],
    clips: [],
    adjustments: {},
    zoomLevel: 1,
    captions: [],
    outputs: [],
    media: [],
    modules: ['audio'],
    audioMode: 'music',
    dawProject,
  }

  const json = JSON.stringify(cfproj, null, 1)
  mkdirSync(dirname(outCfprojPath), { recursive: true })
  writeFileSync(outCfprojPath, json)
  const sizeMB = Buffer.byteLength(json) / (1024 * 1024)
  return {
    cfprojPath: outCfprojPath,
    trackCount: tracks.length,
    audioClipCount: arrangementClips.length,
    sizeMB,
  }
}

// ── Cfproj validation (used by --selftest) ───────────────────────────────────
function validateCfproj(cfprojPath, expectedN) {
  const results = []
  const check = (label, pass, detail = '') => results.push({ label, pass, detail })

  check('output is a .cfproj file (not a zip)', cfprojPath.endsWith('.cfproj'))

  let cfproj = null
  try {
    cfproj = JSON.parse(readFileSync(cfprojPath, 'utf8'))
    check('cfproj parses as JSON', true)
  } catch (e) {
    check('cfproj parses as JSON', false, e.message)
  }

  if (cfproj) {
    check("_type === '100lights-project'", cfproj._type === '100lights-project',
      `got ${cfproj._type}`)
    const dp = cfproj.dawProject || {}
    const tracks = dp.tracks || []
    const clips = dp.arrangementClips || []
    check(`dawProject.tracks.length === ${expectedN}`, tracks.length === expectedN,
      `got ${tracks.length}`)

    const audioClips = clips.filter(c => c.kind === 'audio')
    check(`exactly N audio clips (N=${expectedN})`, audioClips.length === expectedN,
      `got ${audioClips.length}`)

    // one audio clip per track
    const perTrackOk = tracks.every(t => audioClips.filter(c => c.trackId === t.id).length === 1)
    check('each track has exactly one audio clip', perTrackOk)

    const allData = audioClips.every(c => (c.audioUrl || '').startsWith('data:audio/'))
    check("every audio clip audioUrl starts with 'data:audio/'", allData,
      audioClips.map(c => (c.audioUrl || '').slice(0, 20)).join(', '))
  }

  console.log('\n── cfproj validation ──')
  let allPass = true
  for (const r of results) {
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.label}${r.pass ? '' : `  (${r.detail})`}`)
    if (!r.pass) allPass = false
  }
  return allPass
}

// ── Self-test: synth dummy stems, run same authoring path, validate ──────────
async function runSelfTest() {
  console.log('▸ SELFTEST — synthesizing dummy stems with ffmpeg (no ElevenLabs call)')
  const tmp = mkdtempSync(join(tmpdir(), 'el-selftest-'))
  const specs = [
    { name: 'Drums', freq: 110, dur: 3 },
    { name: 'Bass', freq: 220, dur: 3 },
    { name: 'Lead', freq: 440, dur: 3 },
  ]
  const stems = []
  for (const s of specs) {
    const wav = join(tmp, `${s.name.toLowerCase()}.wav`)
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i',
      `sine=frequency=${s.freq}:duration=${s.dur}`, '-acodec', 'pcm_s16le', wav],
      { stdio: ['ignore', 'ignore', 'ignore'] })
    stems.push({ name: s.name, wavPath: wav, durationSec: probeDurationSec(wav) })
  }

  const outCfproj = join(OUT_DIR, 'selftest-bundle.cfproj')
  const { trackCount, sizeMB } = buildCfproj(stems, 'Selftest Bundle', outCfproj)
  console.log(`▸ wrote test cfproj: ${outCfproj} (${trackCount} tracks, ${sizeMB.toFixed(2)} MB)`)

  const ok = validateCfproj(outCfproj, stems.length)
  console.log(`\n${ok ? 'SELFTEST PASS' : 'SELFTEST FAIL'}`)
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  process.exit(ok ? 0 : 1)
}

// ── Real run ─────────────────────────────────────────────────────────────────
async function runReal(key) {
  if (!PROMPT) {
    console.error('Missing <prompt>. Usage: node scripts/elevenlabs-song.mjs "<prompt>" [--length=ms] [--instrumental] [--title=..] [--out=..]')
    process.exit(1)
  }
  mkdirSync(OUT_DIR, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'el-song-'))

  console.log(`▸ generating "${TITLE}" (${LENGTH_MS} ms${INSTRUMENTAL ? ', instrumental' : ''})`)
  console.log(`  prompt: ${PROMPT}`)
  const mp3 = await generateMusic(key, PROMPT, LENGTH_MS, INSTRUMENTAL)
  const mixPath = join(OUT_DIR, `${safeName(TITLE)}__full-mix.mp3`)
  writeFileSync(mixPath, mp3)
  console.log(`▸ full mix saved: ${mixPath} (${(mp3.length / 1024).toFixed(0)} KB)`)

  console.log('▸ stem-separating…')
  const stemZipBuf = await stemSeparate(key, mp3)
  const JSZip = (await import('jszip')).default
  const stemZip = await JSZip.loadAsync(stemZipBuf)
  const audioExt = /\.(wav|mp3|flac|ogg|m4a|aac)$/i
  const stemFiles = Object.values(stemZip.files).filter(f => !f.dir && audioExt.test(f.name))
  if (!stemFiles.length) throw new Error('stem separation returned no audio files')

  const stems = []
  for (const f of stemFiles) {
    const rawPath = join(tmp, basename(f.name))
    writeFileSync(rawPath, Buffer.from(await f.async('nodebuffer')))
    const wavPath = join(tmp, `${basename(f.name, extname(f.name))}.conv.wav`)
    toWav(rawPath, wavPath)
    stems.push({ name: prettyStemName(f.name), wavPath, durationSec: probeDurationSec(wavPath) })
  }
  // Stable order for readability.
  stems.sort((a, b) => a.name.localeCompare(b.name))

  const { cfprojPath, trackCount, audioClipCount, sizeMB } = buildCfproj(stems, TITLE, OUT_CFPROJ)

  // ── Learning corpus: reverse-engineer the musical decisions from the returned
  // stems (ElevenLabs is a closed API — this is the ONLY way we "learn" from it)
  // and append a corpus entry. Runs on the WAVs while tmp still exists. --no-learn
  // to skip. Never blocks the deliverable: failures are logged, not fatal.
  let corpusDir = null
  if (!NO_LEARN) {
    try {
      const analysis = await analyzeSong({ stems: stems.map(s => ({ name: s.name, wavPath: s.wavPath })), mixPath })
      const rec = recordToCorpus({
        title: TITLE, prompt: PROMPT,
        params: { model_id: 'music_v2', music_length_ms: LENGTH_MS, force_instrumental: !!INSTRUMENTAL },
        analysis, mixPath, stemPaths: stems.map(s => ({ name: s.name, wavPath: s.wavPath })),
        model: 'music_v2',
      })
      corpusDir = rec.corpusDir
      console.log(`▸ learned: ${analysis.summary}`)
    } catch (e) {
      console.error(`▸ learn skipped (analysis failed): ${e.message}`)
    }
  }

  console.log('\n── summary ──')
  console.log(`  title:   ${TITLE}`)
  console.log(`  length:  ${LENGTH_MS} ms (${(LENGTH_MS / 1000).toFixed(1)} s)`)
  console.log(`  stems:   ${trackCount} — ${stems.map(s => s.name).join(', ')}`)
  console.log(`  clips:   ${audioClipCount} audio clips (data:audio/mpeg inlined)`)
  console.log(`  cfproj:  ${cfprojPath} (${sizeMB.toFixed(2)} MB)`)
  console.log(`  mix:     ${mixPath}`)
  if (corpusDir) console.log(`  corpus:  ${corpusDir}`)
  if (sizeMB > SIZE_WARN_MB) {
    console.warn(`\n⚠ WARNING: cfproj is ${sizeMB.toFixed(2)} MB (> ${SIZE_WARN_MB} MB). ` +
      'The signed-in "save to projects" path POSTs to /api/projects, and Vercel ' +
      'caps request bodies at ~4.5 MB — this may fail to save online.')
  }

  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
}

// ── Entry ────────────────────────────────────────────────────────────────────
;(async () => {
  const key = resolveKey()
  if (SELFTEST || !key) {
    if (!SELFTEST && !key) {
      console.error('ELEVENLABS_API_KEY not found (checked env + .env.local) — running --selftest instead.\n')
    }
    await runSelfTest()
    return
  }
  await runReal(key)
})().catch(e => {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
})
