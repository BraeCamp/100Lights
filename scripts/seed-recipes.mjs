#!/usr/bin/env node
// Seed the "Test Recipes" pipeline (admin → DAW recipe library) with progressions/bass lines mined
// from PUBLIC-DOMAIN sheet music. Each is the musical PATTERN only — the sheet itself isn't stored.
// They land as `candidate`s; review + Integrate them in the admin Audio → Test Recipes panel.
//
//   node scripts/seed-recipes.mjs           # insert/refresh the candidates
//   node scripts/seed-recipes.mjs --list    # just print what's in the table
//
// Reads DATABASE_URL from the environment or .env.local. Idempotent (upsert by id).

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env.local */ }
}
const sql = neon(process.env.DATABASE_URL)

// ── note helpers (mirror lib/practice-recipes.ts) ────────────────────────────
const N = (pitch, startBeat, durationBeats, velocity = 96) => ({ pitch, startBeat, durationBeats, velocity })
// A chord = same start/duration across several pitches.
const chord = (start, dur, ...pitches) => pitches.map(p => N(p, start, dur))
// A progression spec: root-position-ish triads, one chord per `beatsPer`.
const progSpec = (trackName, beatsPer, chords) => {
  const notes = []
  chords.forEach((pitches, i) => notes.push(...chord(i * beatsPer, beatsPer, ...pitches)))
  return { trackName, instrument: { type: 'none', params: {} }, isDrumClip: false, durationBeats: chords.length * beatsPer, usePreset: true, notes }
}
// A bass line spec: single notes.
const bassSpec = (trackName, beatsPer, roots) => ({
  trackName, instrument: { type: 'none', params: {} }, isDrumClip: false, durationBeats: roots.length * beatsPer, usePreset: true,
  notes: roots.map((p, i) => N(p, i * beatsPer, beatsPer, 100)),
})

// ── recipes mined from public-domain sheet music ─────────────────────────────
// Roman-numeral analyses grounded in published sheet music / theory sources (see `source`).
const RECIPES = [
  {
    id: 'sheet-greensleeves', title: 'Greensleeves (i–VII–VI–V)', genre: 'World',
    tagline: 'Am → G → F → E: the aching Tudor folk loop, minor with a raised leading tone.',
    annotation: [
      'A minor throughout, but the E is MAJOR (E–G#–B) — that raised G# is the leading tone that pulls hard back to Am.',
      'VII (G) and VI (F) step the top voice down by whole tones before the E lifts it back up — that descent is the melancholy.',
      'Greensleeves is really Dorian-tinged; try raising the F to F# on the VI and hear it brighten toward the older modal sound.',
    ],
    // Am, G, F, E(major)
    spec: progSpec('Recipe: Greensleeves', 4, [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 56, 59]]),
    source: 'Trad. English (c.1580), PD — i–VII–VI–V analysis (musictheory / Fretsource)',
  },
  {
    id: 'sheet-scarborough', title: 'Scarborough Fair (Dorian i–IV)', genre: 'World',
    tagline: 'Am → D → Am → G: the major IV (D) that makes it Dorian, not minor.',
    annotation: [
      'The giveaway is the MAJOR D chord (IV) sitting in an A-minor world — a minor key would use D minor. That major 6th (F#) is the Dorian colour.',
      'It hangs on i (Am) and rocks to the bright IV and back — no dominant, no strong pull home, so it floats.',
      'Keep the top voice common between chords and the drone underneath; Dorian folk lives on that suspended, unresolved feel.',
    ],
    // Am, D(major), Am, G
    spec: progSpec('Recipe: Scarborough Fair', 4, [[57, 60, 64], [54, 57, 62], [57, 60, 64], [55, 59, 62]]),
    source: 'Trad. English folk, PD — A Dorian (i–IV) analysis (Hooktheory / Guitar Noise)',
  },
  {
    id: 'sheet-amazing-grace', title: 'Amazing Grace (I–IV–I–V)', genre: 'Soul',
    tagline: 'G → C → G → D: the plain hymn/gospel frame under the most-sung melody.',
    annotation: [
      'Three chords do everything: I (G) is home, IV (C) is the warm lift, V (D) is the only tension — and it always resolves straight back to I.',
      'The melody is pentatonic, so it floats over all three chords; that\'s why congregations can harmonise it by ear.',
      'Add the vi (Em) in place of one I for the gospel version, and a IV→I "amen" (plagal) cadence at the end.',
    ],
    // G, C, G, D
    spec: progSpec('Recipe: Amazing Grace', 4, [[55, 59, 62], [52, 55, 60], [55, 59, 62], [50, 54, 57]]),
    source: 'J. Newton / "New Britain" (1779/1835), PD — I–IV–I–V hymn frame',
  },
  {
    id: 'sheet-la-folia', title: 'La Folía (Baroque i–V–i–VII…)', genre: 'Classical',
    tagline: 'Dm → A → Dm → C → F → C → Dm → A: the 400-year-old variation ground.',
    annotation: [
      'One of the oldest European chord grounds — Corelli, Vivaldi and Rachmaninoff all wrote variations over it.',
      'D minor with a MAJOR A (V) and C (VII) — the raised C# in the A chord is the Baroque leading tone; the natural-C chord is the modal side.',
      'It\'s a template for variations: keep this 8-chord ground looping and improvise a new melody over each pass.',
    ],
    // Dm, A(maj), Dm, C, F, C, Dm, A(maj) — 2 beats each
    spec: progSpec('Recipe: La Folia', 2, [[50, 53, 57], [57, 61, 64], [50, 53, 57], [48, 52, 55], [53, 57, 60], [48, 52, 55], [50, 53, 57], [57, 61, 64]]),
    source: 'La Folía (Baroque ground, pre-1700), PD — i–V–i–VII–III–VII–i–V',
  },
  {
    id: 'sheet-canon-bass', title: 'Pachelbel bass ground (Canon in D)', genre: 'Classical',
    tagline: 'D–A–B–F#–G–D–G–A: the 8-note descending bass under a thousand songs.',
    annotation: [
      'This is the BASS ostinato, not the chords — two beats per note, looping forever. Every "Canon progression" pop song is built on it.',
      'The line falls stepwise for most of its length (D–[A]–B–F#–G–D) which is why melodies over it feel like they\'re gently descending.',
      'Play block triads above each root (D A Bm F#m G D G A) to get the full Canon, or write your own tune over just the bass.',
    ],
    // D3 A2 B2 F#2 G2 D2 G2 A2
    spec: bassSpec('Recipe: Pachelbel bass', 2, [50, 45, 47, 42, 43, 38, 43, 45]),
    source: 'J. Pachelbel, Canon in D (c.1680), PD — continuo bass ostinato',
  },
]

async function ensure() {
  await sql`
    CREATE TABLE IF NOT EXISTS daw_recipes (
      id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'candidate', title TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '', annotation JSONB NOT NULL DEFAULT '[]'::jsonb, genre TEXT,
      spec JSONB NOT NULL, source TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), integrated_at TIMESTAMPTZ)`
}

async function main() {
  await ensure()
  if (process.argv.includes('--list')) {
    const rows = await sql`SELECT id, status, title, genre FROM daw_recipes ORDER BY status, title`
    console.table(rows)
    return
  }
  for (const r of RECIPES) {
    await sql`
      INSERT INTO daw_recipes (id, status, title, tagline, annotation, genre, spec, source)
      VALUES (${r.id}, 'candidate', ${r.title}, ${r.tagline}, ${JSON.stringify(r.annotation)}::jsonb, ${r.genre}, ${JSON.stringify(r.spec)}::jsonb, ${r.source})
      ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, tagline=EXCLUDED.tagline, annotation=EXCLUDED.annotation,
        genre=EXCLUDED.genre, spec=EXCLUDED.spec, source=EXCLUDED.source`
    console.log(`  ✓ ${r.id.padEnd(22)} ${r.title}`)
  }
  console.log(`\n${RECIPES.length} candidate recipes seeded → review in admin Audio → Test Recipes.`)
}
main().catch(e => { console.error(e); process.exit(1) })
