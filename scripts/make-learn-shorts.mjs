// Music-learning shorts — the base for a teaching channel + longform. Two formats:
//   • CHORD QUIZ  — play a progression, ask what it is, reveal it + name famous songs that use it.
//   • DID YOU KNOW — a music-history fact over a bed.
// EDITABLE BY CONSTRUCTION (Brae's rule): each project = a SILENT visual on a video track + the audio
// on an audio track + the teaching TEXT as separate, editable CAPTION layers (question/answer/facts).
// Nothing baked together, so the pieces can be re-timed, re-voiced, or stacked into longform later.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'
import { recordFormatVideo } from '../lib/song-video/headless.mjs'

const ROOT = process.cwd(), env = {}
for (const l of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const sql = neon(env.DATABASE_URL)
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })
const BUCKET = env.R2_BUCKET, USER = 'user_3FElUNjivSIJ9gZsJUKp1496n17'
const D = `${homedir()}/Desktop/100lights-ai-renders`
const put = (key, body, ct) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: ct }))
const SONGS = { edm: 'EDM EL__full-mix.mp3', house: 'Hybrid House__full-mix.mp3', lofi: 'Dusk (lofi master).mp3', filtered_house: 'ai-filtered-house-43770-1786843840300.mp3' }

// ── Chord synth: MIDI note arrays → 16-bit WAV (sine + 2 harmonics + soft ADSR), piano-ish. ──
const midiFreq = p => 440 * Math.pow(2, (p - 69) / 12)
function synthProgression(chords, chordDur, repeats = 2, sr = 44100) {
  const seq = []; for (let r = 0; r < repeats; r++) seq.push(...chords)
  const total = Math.round(seq.length * chordDur * sr)
  const buf = new Float32Array(total)
  seq.forEach((notes, ci) => {
    const start = Math.round(ci * chordDur * sr), n = Math.round(chordDur * sr)
    for (let i = 0; i < n; i++) {
      const t = i / sr
      const env = Math.min(1, t / 0.015) * (t > chordDur - 0.18 ? Math.max(0, (chordDur - t) / 0.18) : 1) * (0.55 + 0.45 * Math.exp(-t * 1.6))
      let s = 0
      for (const p of notes) { const f = midiFreq(p); s += Math.sin(2 * Math.PI * f * t) * 0.6 + Math.sin(2 * Math.PI * 2 * f * t) * 0.14 + Math.sin(2 * Math.PI * 3 * f * t) * 0.07 }
      buf[start + i] += (s / notes.length) * env * 0.6
    }
  })
  let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v)); const g = peak > 0 ? 0.9 / peak : 1
  const bytes = Buffer.alloc(44 + total * 2)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + total * 2, 4); bytes.write('WAVE', 8)
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sr, 24); bytes.writeUInt32LE(sr * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(total * 2, 40)
  for (let i = 0; i < total; i++) { const v = Math.max(-1, Math.min(1, buf[i] * g)); bytes.writeInt16LE(Math.round(v * 32767), 44 + i * 2) }
  return bytes
}

// ── CLI ──
const argv = process.argv.slice(2)
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d }
const FOLDER = flag('folder', 'Learn')
const MODE = argv.includes('--quizzes') ? 'quizzes' : argv.includes('--facts') ? 'facts' : 'all'

// ── Content ──
const CHORD_DUR = 1.1
// Famous progressions across genres (root-position-ish voicings w/ bass root). answer = roman numerals.
const QUIZZES = [
  { id: 'quiz-4chords', title: 'Chord Quiz — The 4 Chords', accent: '#a78bfa', repeats: 2,
    chords: [[48, 60, 64, 67], [43, 55, 59, 62], [45, 57, 60, 64], [41, 53, 57, 60]],  // C G Am F
    answer: 'I – V – vi – IV', tag: 'the "4 chords" of pop',
    songs: 'Let It Be · Don’t Stop Believin’ · With or Without You · Someone Like You',
    caption: 'Name this progression 🎹 — the 4 chords behind a thousand hits (I–V–vi–IV).\n\n#musictheory #chords #learnmusic #musicquiz #100lights' },
  { id: 'quiz-251', title: 'Chord Quiz — ii–V–I (Jazz)', accent: '#34d399', repeats: 2,
    chords: [[50, 62, 65, 69], [43, 55, 59, 65], [48, 60, 64, 67, 71]],  // Dm7 G7 Cmaj7
    answer: 'ii – V – I', tag: 'jazz’s home base',
    songs: 'Autumn Leaves · Fly Me to the Moon · nearly every jazz standard',
    caption: 'Guess the progression 🎷 — the ii–V–I that runs all of jazz.\n\n#jazz #musictheory #chords #learnmusic #100lights' },
  { id: 'quiz-blues', title: 'Chord Quiz — 12-Bar Blues', accent: '#fbbf24', repeats: 2,
    chords: [[45, 57, 61, 64, 67], [50, 62, 66, 69], [45, 57, 61, 64], [52, 64, 68, 71]],  // A7 D7 A7 E7
    answer: 'I7 – IV7 – I7 – V7', tag: 'the 12-bar blues',
    songs: 'Johnny B. Goode · Sweet Home Chicago · Hound Dog',
    caption: 'Every blues song ever 🎸 — the I7–IV7–V7 twelve-bar.\n\n#blues #guitar #musictheory #learnmusic #100lights' },
  { id: 'quiz-sadminor', title: 'Chord Quiz — The Sad One', accent: '#f472b6', repeats: 2,
    chords: [[45, 57, 60, 64], [41, 53, 57, 60], [48, 60, 64, 67], [43, 55, 59, 62]],  // Am F C G
    answer: 'i – VI – III – VII', tag: 'the minor "sad" loop',
    songs: 'Save Tonight · Numb · half of EDM',
    caption: 'Why does this sound so sad? 🥲 The i–VI–III–VII minor loop.\n\n#musictheory #chords #edm #learnmusic #100lights' },
  { id: 'quiz-doowop', title: 'Chord Quiz — 50s Doo-Wop', accent: '#22d3ee', repeats: 2,
    chords: [[48, 60, 64, 67], [45, 57, 60, 64], [41, 53, 57, 60], [43, 55, 59, 62]],  // C Am F G
    answer: 'I – vi – IV – V', tag: 'the doo-wop changes',
    songs: 'Stand By Me · Earth Angel · Blue Moon',
    caption: 'Sounds like the 50s? 🎶 The I–vi–IV–V doo-wop changes.\n\n#musictheory #chords #oldies #learnmusic #100lights' },
  { id: 'quiz-sensitive', title: 'Chord Quiz — vi–IV–I–V', accent: '#f59e0b', repeats: 2,
    chords: [[45, 57, 60, 64], [41, 53, 57, 60], [48, 60, 64, 67], [43, 55, 59, 62]],  // Am F C G (start on vi)
    answer: 'vi – IV – I – V', tag: 'the "yearning" rotation',
    songs: 'Grenade · Poker Face · Zombie',
    caption: 'The most emotional 4 chords 😭 — vi–IV–I–V.\n\n#musictheory #chords #popmusic #learnmusic #100lights' },
  { id: 'quiz-andalusian', title: 'Chord Quiz — Andalusian', accent: '#ef4444', repeats: 2,
    chords: [[45, 57, 60, 64], [43, 55, 59, 62], [41, 53, 57, 60], [40, 52, 56, 59]],  // Am G F E(maj)
    answer: 'i – VII – VI – V', tag: 'the flamenco / Spanish cadence',
    songs: 'Hit the Road Jack · Sultans of Swing · Stray Cat Strut',
    caption: 'That Spanish-guitar sound 🎸 — the Andalusian i–VII–VI–V.\n\n#musictheory #flamenco #guitar #learnmusic #100lights' },
  { id: 'quiz-canon', title: 'Chord Quiz — Pachelbel’s Canon', accent: '#818cf8', repeats: 2,
    chords: [[50, 62, 66, 69], [45, 57, 61, 64], [46, 58, 61, 66], [42, 54, 58, 61]],  // D A Bm F#m
    answer: 'I – V – vi – iii', tag: 'the Canon progression',
    songs: 'Canon in D · Basket Case · every graduation',
    caption: 'You’ve heard this at every wedding 💍 — Pachelbel’s Canon.\n\n#musictheory #classical #chords #learnmusic #100lights' },
  { id: 'quiz-threechord', title: 'Chord Quiz — Three Chords', accent: '#4ade80', repeats: 2,
    chords: [[40, 52, 56, 59], [45, 57, 61, 64], [47, 59, 63, 66]],  // E A B
    answer: 'I – IV – V', tag: 'three chords & the truth',
    songs: 'Twist and Shout · La Bamba · Wild Thing',
    caption: 'Three chords = a hit 🎸 — I–IV–V.\n\n#musictheory #rocknroll #guitar #learnmusic #100lights' },
  { id: 'quiz-royalroad', title: 'Chord Quiz — Royal Road', accent: '#38bdf8', repeats: 2,
    chords: [[41, 53, 57, 60], [43, 55, 59, 62], [40, 52, 55, 59], [45, 57, 60, 64]],  // F G Em Am
    answer: 'IV – V – iii – vi', tag: 'the J-pop "royal road"',
    songs: 'Anime openings · J-pop · Bruno Mars',
    caption: 'The anime-opening sound 🌸 — the IV–V–iii–vi royal road.\n\n#musictheory #jpop #anime #chords #100lights' },
]
const FACTS = [
  { id: 'dyk-amen', title: 'Did You Know — The Amen Break', accent: '#f472b6', song: 'filtered_house', start: 8, seconds: 16,
    lines: [{ t: 'Did you know? 🥁', a: 0.3, b: 3.2 }, { t: 'A 6-second drum solo from 1969…', a: 3.4, b: 8 }, { t: 'became the most sampled beat ever — it built jungle, DnB & hip-hop.', a: 8.2, b: 15.6 }],
    caption: 'The "Amen Break" — 6 seconds of drums that built entire genres. 🥁\n\n#musichistory #didyouknow #drumandbass #hiphop #100lights' },
  { id: 'dyk-4chords', title: 'Did You Know — Same 4 Chords', accent: '#fbbf24', song: 'edm', start: 0, seconds: 15,
    lines: [{ t: 'Did you know? 🎶', a: 0.3, b: 3 }, { t: 'Most pop hits ride the SAME 4 chords…', a: 3.2, b: 8 }, { t: 'I–V–vi–IV. Once you hear it, you can’t unhear it.', a: 8.2, b: 14.6 }],
    caption: 'Most pop songs = the same 4 chords (I–V–vi–IV). 🎶\n\n#musictheory #didyouknow #popmusic #learnmusic #100lights' },
]

async function ensureFolder(name) {
  await sql`CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  await sql`ALTER TABLE folders ADD COLUMN IF NOT EXISTS parent_id TEXT`
  const par = await sql`SELECT id FROM folders WHERE user_id=${USER} AND name='Shorts' ORDER BY created_at DESC LIMIT 1`
  const parentId = par[0]?.id ?? null
  const f = await sql`SELECT id FROM folders WHERE user_id=${USER} AND name=${name} AND parent_id IS NOT DISTINCT FROM ${parentId} ORDER BY created_at DESC LIMIT 1`
  if (f.length) return f[0].id
  const id = randomUUID(); await sql`INSERT INTO folders (id, user_id, name, parent_id) VALUES (${id}, ${USER}, ${name}, ${parentId})`; return id
}

// Save an editable project: silent visual (video track) + audio clip (audio track) + caption layers.
async function saveEditable(folderId, { title, accent, seconds, visualPath, audioMp3, captions, postCaption }) {
  const finalDur = +seconds.toFixed(2)
  const vidId = randomUUID(), vidKey = `${USER}/${vidId}.mp4`
  await put(vidKey, readFileSync(visualPath), 'video/mp4')
  const audId = randomUUID(), audKey = `${USER}/${audId}.mp3`
  await put(audKey, readFileSync(audioMp3), 'audio/mpeg')
  for (const [id, nm, ct, key, dur] of [[vidId, `${title} (visual)`, 'video/mp4', vidKey, finalDur], [audId, `${title} (audio)`, 'audio/mpeg', audKey, finalDur]])
    await sql`INSERT INTO user_media (id, user_id, name, content_type, duration, r2_key, thumbnail, created_at) VALUES (${id}, ${USER}, ${nm}, ${ct}, ${dur}, ${key}, NULL, NOW()) ON CONFLICT (id) DO NOTHING`
  const media = [{ id: vidId, name: `${title} (visual)`, r2Key: vidKey, duration: finalDur, contentType: 'video' }, { id: audId, name: `${title} (audio)`, r2Key: audKey, duration: finalDur, contentType: 'audio' }]
  const tracks = [{ id: 'v1', label: 'Video', type: 'media', height: 64 }, { id: 'a1', label: 'Audio', type: 'audio', height: 56, volume: 1 }]
  const clips = [
    { id: randomUUID(), color: accent, label: title, inPoint: 0, outPoint: finalDur, startTime: 0, trackId: 'v1', mediaRefId: vidId, contentType: 'video', captions: [] },
    { id: randomUUID(), color: '#34d399', label: 'Audio', inPoint: 0, outPoint: finalDur, startTime: 0, trackId: 'a1', mediaRefId: audId, contentType: 'audio', captions: [] },
  ]
  const projId = randomUUID()
  const data = { _type: '100lights-project', version: 1, id: projId, name: title, userId: USER, aspect: '9:16', audioMode: 'music', modules: ['video'], media, tracks, clips, outputs: [], captions, chapters: [], beatGrid: null, zoomLevel: 1, adjustments: {}, postCaption, savedAt: new Date().toISOString() }
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) + '-' + projId.slice(0, 6)
  const existing = await sql`SELECT id FROM projects WHERE user_id=${USER} AND deleted_at IS NULL AND folder_id=${folderId} AND data->>'name'=${title} ORDER BY saved_at DESC LIMIT 1`
  if (existing.length) { await sql`UPDATE projects SET data=${JSON.stringify(data)}::jsonb, saved_at=NOW() WHERE id=${existing[0].id}`; return 'updated' }
  await sql`INSERT INTO projects (id, user_id, name, slug, owner_username, saved_at, data, folder_id) VALUES (${projId}, ${USER}, ${title}, ${slug}, 'braedancampbell', NOW(), ${JSON.stringify(data)}::jsonb, ${folderId})`
  return 'created'
}

const folderId = await ensureFolder(FOLDER)
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })

// ── Chord quizzes ──
for (const q of (MODE === 'facts' ? [] : QUIZZES)) {
  const tmp = mkdtempSync(join(tmpdir(), 'learn-'))
  try {
    process.stdout.write(`▸ ${q.title}… `)
    const wav = synthProgression(q.chords, CHORD_DUR, q.repeats)
    const seconds = q.chords.length * CHORD_DUR * q.repeats
    const wavPath = join(tmp, 'chord.wav'); writeFileSync(wavPath, wav)
    const audioMp3 = join(tmp, 'chord.mp3'); execFileSync('ffmpeg', ['-y', '-i', wavPath, '-c:a', 'libmp3lame', '-q:a', '3', audioMp3], { stdio: 'ignore' })
    // silent visual: a waveform reacting to the chords, NO baked hook (text is separate captions)
    const songData = { tempo: 120, keyLabel: '', tracks: [{ name: 'Chords', color: q.accent }], notes: [], loopBeats: Math.round(seconds * 2) }
    const r = await recordFormatVideo(browser, { wavBuf: wav, songData, format: 'waveform', meta: 'MUSIC THEORY · 100LIGHTS', hook: [], seconds, root: ROOT, tmpDir: tmp, accent: q.accent })
    const visual = join(tmp, 'v.mp4'); execFileSync('ffmpeg', ['-y', '-i', r.videoPath, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', visual], { stdio: 'ignore' })
    const rev = Math.max(4.2, seconds * 0.55)
    const captions = [
      { start: 0.3, end: rev - 0.2, text: 'what progression is this? 🎹' },
      { start: rev, end: rev + 2.2, text: q.answer },
      { start: rev + 2.4, end: seconds, text: `${q.tag} — used in: ${q.songs}` },
    ]
    const res = await saveEditable(folderId, { title: q.title, accent: q.accent, seconds, visualPath: visual, audioMp3, captions, postCaption: q.caption })
    console.log(`✓ ${res} (editable: chord audio + silent video + 3 caption layers)`)
  } catch (e) { console.log(`✗ ${e.message}`) } finally { rmSync(tmp, { recursive: true, force: true }) }
}

// ── Did-you-know ──
for (const f of (MODE === 'quizzes' ? [] : FACTS)) {
  const tmp = mkdtempSync(join(tmpdir(), 'learn-'))
  try {
    process.stdout.write(`▸ ${f.title}… `)
    const srcMp3 = `${D}/${SONGS[f.song]}`
    const wavPath = join(tmp, 'bed.wav'); execFileSync('ffmpeg', ['-y', '-ss', String(f.start), '-t', String(f.seconds), '-i', srcMp3, wavPath], { stdio: 'ignore' })
    const audioMp3 = join(tmp, 'bed.mp3'); execFileSync('ffmpeg', ['-y', '-i', wavPath, '-c:a', 'libmp3lame', '-q:a', '3', audioMp3], { stdio: 'ignore' })
    const songData = { tempo: 120, keyLabel: '', tracks: [{ name: 'Bed', color: f.accent }], notes: [], loopBeats: Math.round(f.seconds * 2) }
    const r = await recordFormatVideo(browser, { wavBuf: readFileSync(wavPath), songData, format: 'radial', meta: 'MUSIC HISTORY · 100LIGHTS', hook: [], seconds: f.seconds, root: ROOT, tmpDir: tmp, accent: f.accent })
    const visual = join(tmp, 'v.mp4'); execFileSync('ffmpeg', ['-y', '-i', r.videoPath, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', visual], { stdio: 'ignore' })
    const captions = f.lines.map(l => ({ start: l.a, end: l.b, text: l.t }))
    const res = await saveEditable(folderId, { title: f.title, accent: f.accent, seconds: f.seconds, visualPath: visual, audioMp3, captions, postCaption: f.caption })
    console.log(`✓ ${res} (editable: bed audio + silent video + ${captions.length} caption layers)`)
  } catch (e) { console.log(`✗ ${e.message}`) } finally { rmSync(tmp, { recursive: true, force: true }) }
}

await browser.close()
console.log(`\nDone — music-learning shorts in "Shorts › ${FOLDER}" (editable: separate audio + video + text captions).`)
