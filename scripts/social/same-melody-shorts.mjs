#!/usr/bin/env node
// PROTOTYPE — "Same melody, N genres" Short, end-to-end, hands-off. The SAME hooky melody is authored
// with a genre kit (tempo + lead/pad/bass sounds + drum pattern + accent colour) per section, each is
// rendered to real audio through the studio engine, then ffmpeg assembles a vertical (1080×1920) Short:
// hook intro card → one segment per genre (audio-reactive wave + big genre label) → loop-friendly end.
// This is the format the program can mass-produce; wire it into the content pipeline to run daily.
//
//   node scripts/social/same-melody-shorts.mjs [--genres=lofi,orchestral,edm] [--seg=7] [--out=path.mp4]
//
// Reuses scripts/hear-ai.mjs (--project) for the render. Output → ~/Desktop/100lights-ai-renders/.
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
const uid = () => randomUUID()
const argv = process.argv.slice(2)
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const SEG = Math.max(4, Number(flag('seg', '7')))
const FONT = ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf'].find(existsSync) || ''

// ── the hook: a catchy 4-bar loop in A minor (vi-IV-I-V), melody stays constant across genres ────────
const N = (pitch, startBeat, durationBeats, velocity = 100) => ({ id: uid(), pitch, startBeat, durationBeats, velocity })
const MELODY = [ // A minor pentatonic hook, 16 beats
  [76, 0, 1], [74, 1, 1], [72, 2, 1], [69, 3, 1], [72, 4, 2], [69, 6, 2],
  [77, 8, 1], [76, 9, 1], [74, 10, 1], [72, 11, 1], [74, 12, 2], [69, 14, 2],
]
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]  // Am F C G, 4 beats each
const KICK = 36, SNARE = 38, HAT = 42, OPEN = 46, CLAP = 39

// drum patterns (beats within a 4-beat bar) → repeated each bar
const DRUMS = {
  none: [],
  lofi: [[KICK, 0], [KICK, 2.5], [SNARE, 1], [SNARE, 3], [HAT, 0.5, 70], [HAT, 1.5, 70], [HAT, 2.5, 70], [HAT, 3.5, 70]],
  four: [[KICK, 0], [KICK, 1], [KICK, 2], [KICK, 3], [CLAP, 1], [CLAP, 3], [OPEN, 0.5, 70], [OPEN, 1.5, 70], [OPEN, 2.5, 70], [OPEN, 3.5, 70]],
  soft: [[KICK, 0, 90]],
}
const POLY = (o) => ({ waveform: 'sawtooth', attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.4, detune: 8, filterType: 'lowpass', filterCutoff: 2200, filterResonance: 1, lfoEnabled: false, lfoRate: 3, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine', ...o })

// ── genre kits: same melody, different everything else ───────────────────────────────────────────
const KITS = {
  lofi:       { name: 'LO-FI',       bpm: 78,  accent: '0x6d5bd0', lead: 'builtin-2', pad: POLY({ waveform: 'triangle', filterCutoff: 1400, attack: 0.4, release: 1.2 }), bass: POLY({ waveform: 'sine', filterCutoff: 600, sustain: 0.85 }), drum: 'lofi' },
  orchestral: { name: 'ORCHESTRAL',  bpm: 92,  accent: '0xb8862b', lead: 'builtin-10', pad: POLY({ waveform: 'sawtooth', filterCutoff: 2600, attack: 0.6, release: 1.4, detune: 11 }), bass: POLY({ waveform: 'triangle', filterCutoff: 700 }), drum: 'soft' },
  edm:        { name: 'EDM',         bpm: 124, accent: '0x1fa971', lead: 'builtin-8', pad: POLY({ waveform: 'sawtooth', filterCutoff: 4200, detune: 14, attack: 0.02 }), bass: POLY({ waveform: 'sawtooth', filterCutoff: 620, filterResonance: 5, detune: 9 }), drum: 'four' },
  trap:       { name: 'TRAP',        bpm: 140, accent: '0xc0392b', lead: 'builtin-8', pad: POLY({ waveform: 'square', filterCutoff: 2400 }), bass: POLY({ waveform: 'sine', filterCutoff: 300, sustain: 0.9 }), drum: 'four' },
  synthwave:  { name: 'SYNTHWAVE',   bpm: 100, accent: '0xd6398f', lead: 'builtin-8', pad: POLY({ waveform: 'sawtooth', filterCutoff: 3000, detune: 10, attack: 0.3 }), bass: POLY({ waveform: 'sawtooth', filterCutoff: 800, detune: 6 }), drum: 'lofi' },
}

const ff = (args) => { try { execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] }) } catch (e) { throw new Error('ffmpeg failed:\n' + (e.stderr?.toString().split('\n').slice(-8).join('\n') || e.message)) } }
const track = (id, name, instrument) => ({ id, name, type: 'audio', color: '#a78bfa', volume: 0.8, pan: 0, mute: false, solo: false, armed: false, height: 64, effects: [], instrument })
const clip = (trackId, notes, presetId, isDrum, dur) => ({ kind: 'midi', id: uid(), trackId, name: 'c', startBeat: 0, durationBeats: dur, notes, isDrumClip: isDrum, presetId, rollFx: {} })

function buildGenreCfproj(kit, bars) {
  const tMel = uid(), tPad = uid(), tBass = uid(), tDrum = uid()
  const mel = [], pad = [], bass = [], drum = []
  for (let b = 0; b < bars; b++) {
    const off = b * 16
    for (const [p, s, d] of MELODY) mel.push(N(p, off + s, d, 105))
    CHORDS.forEach((ch, bar) => {
      const bs = off + bar * 4
      for (const n of ch) pad.push(N(n, bs, 4, 60))
      bass.push(N(ch[0] - 12, bs, 2, 92), N(ch[0] - 12, bs + 2, 2, 84))
      for (const [pit, beat, vel = 100] of DRUMS[kit.drum]) drum.push(N(pit, bs + beat, 0.4, vel))
    })
  }
  const beats = bars * 16
  const tracks = [
    { ...track(tMel, 'Lead', { type: 'none', params: {} }), volume: 0.95, effects: [{ id: uid(), type: 'reverb', params: { enabled: true, wet: 0.18, decay: 1.6, preDelay: 0.01 } }] },
    { ...track(tPad, 'Pad', { type: 'poly', params: kit.pad }), volume: 0.3 },
    { ...track(tBass, 'Bass', { type: 'poly', params: kit.bass }), volume: 0.5 },
  ]
  const clips = [clip(tMel, mel, kit.lead, false, beats), clip(tPad, pad, null, false, beats), clip(tBass, bass, null, false, beats)]
  if (drum.length) { tracks.push({ ...track(tDrum, 'Drums', { type: 'drum', params: { pack: 'synth' } }), volume: 0.6 }); clips.push(clip(tDrum, drum, null, true, beats)) }
  const dawProject = { id: uid(), name: kit.name, tempo: kit.bpm, timeSignatureNum: 4, timeSignatureDen: 4, swing: kit.drum === 'lofi' ? 0.12 : 0, key: 'A', scale: 'minor', masterVolume: 1.15, tracks, arrangementClips: clips, sessionGrid: [], scenes: [], automationLanes: [], clipEffects: [], returnTracks: [], takeLanes: [], loopStart: 0, loopEnd: beats, loopEnabled: false }
  return { _type: '100lights-project', version: 1, id: uid(), name: kit.name, savedAt: new Date(0).toISOString(), tracks: [], clips: [], adjustments: {}, zoomLevel: 1, captions: [], outputs: [], media: [], modules: ['audio'], audioMode: true, dawProject }
}

const frameHtml = (kit) => `<!doctype html><html><body style="margin:0;width:1080px;height:1920px;overflow:hidden;
  font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#fff;
  background:linear-gradient(158deg,#${kit.accent.slice(2)} 0%,#0b0b13 78%);display:flex;flex-direction:column;align-items:center;text-align:center">
  <div style="margin-top:170px;font-size:58px;font-weight:800;letter-spacing:12px">SAME MELODY</div>
  <div style="margin-top:30px;font-size:36px;font-weight:500;opacity:.72">one hook · every genre</div>
  <div style="margin-top:360px;padding:0 50px;font-size:${Math.min(160, Math.floor(1450 / Math.max(3, kit.name.length)))}px;font-weight:900;letter-spacing:1px;text-shadow:0 10px 50px rgba(0,0,0,.45)">${kit.name}</div>
  <div style="flex:1"></div>
  <div style="margin-bottom:200px;font-size:46px;font-weight:700;opacity:.92">which one hits harder? 🎧</div>
  <div style="margin-bottom:80px;font-size:30px;font-weight:800;letter-spacing:6px;opacity:.55">100LIGHTS</div>
</body></html>`

async function main() {
  const genres = (flag('genres', 'lofi,orchestral,edm')).split(',').map(s => s.trim()).filter(g => KITS[g])
  if (!genres.length) { console.error('no valid genres. options:', Object.keys(KITS).join(', ')); process.exit(1) }
  const tmp = mkdtempSync(join(tmpdir(), 'melody-shorts-'))
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } })
  const segs = []
  for (const g of genres) {
    const kit = KITS[g]
    const secsPerLoop = 16 * 60 / kit.bpm
    const bars = Math.max(4, Math.round((SEG / secsPerLoop) * 4))
    console.log(`▸ ${kit.name}: rendering audio (${kit.bpm} BPM)…`)
    const cfPath = join(tmp, `${g}.cfproj`); writeFileSync(cfPath, JSON.stringify(buildGenreCfproj(kit, bars)))
    execFileSync('node', ['scripts/hear-ai.mjs', `--project=${cfPath}`, `--seconds=${SEG + 1}`, '--keep', `--out=${join(tmp, g + '.mp3')}`], { cwd: ROOT, stdio: 'ignore' })
    const wav = join(tmp, `${g}.wav`)
    console.log(`  ▸ ${kit.name}: styling the frame + building segment…`)
    const png = join(tmp, `${g}.png`)
    await page.setContent(frameHtml(kit), { waitUntil: 'load' })
    await page.screenshot({ path: png, type: 'png' })
    const seg = join(tmp, `seg_${g}.mp4`)
    // styled frame (loop) as base + audio-reactive waveform overlaid in the lower-middle band + the audio
    ff(['-y', '-loop', '1', '-i', png, '-i', wav,
      '-filter_complex', `[1:a]showwaves=s=1080x420:mode=cline:colors=white@0.7:draw=full[w];[0:v][w]overlay=0:1160[v]`,
      '-map', '[v]', '-map', '1:a', '-t', String(SEG), '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '160k', seg])
    segs.push(seg)
  }
  await browser.close()
  // concat
  const listFile = join(tmp, 'list.txt'); writeFileSync(listFile, segs.map(s => `file '${s}'`).join('\n'))
  const out = flag('out', join(OUT_DIR, `Short - Same Melody ${genres.length} Genres.mp4`))
  ff(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-movflags', '+faststart', out])
  rmSync(tmp, { recursive: true, force: true })
  const secs = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim()
  console.log(`\n✓ ${out}\n  ${genres.join(' → ')} · ${(+secs).toFixed(0)}s · 1080x1920 · ready to post`)
}
main().catch(e => { console.error(e); process.exit(1) })
