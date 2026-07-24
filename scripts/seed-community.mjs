#!/usr/bin/env node
// Seed the community with a set of starter POSTS under the "100Lights" byline,
// so a first-time visitor lands somewhere alive instead of an empty feed.
//
// Idempotent: it tags seeds with user_id 'seed:100lights' and skips if any
// already exist. Text posts only — no audio, so no R2 needed.
//
// Usage (from the repo root):
//   DATABASE_URL='postgres://…' node scripts/seed-community.mjs
// If DATABASE_URL isn't set, it reads it from .env.local.

import { Client } from 'pg'
import { readFileSync } from 'node:fs'

function resolveDbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    const m = env.match(/^DATABASE_URL\s*=\s*["']?([^"'\n]+)["']?/m)
    if (m) return m[1]
  } catch { /* no .env.local */ }
  return null
}

const SEED_USER = 'seed:100lights'
const AUTHOR = '100Lights'

const POSTS = [
  { name: 'Welcome to the 100Lights Community 👋', body: 'This is the place to share what you make, ask for feedback, and pick up tips. Post a beat, a preset, a chord recipe — or just a question. Everything here is playable in the browser, no account needed to listen. Be kind, gas people up, and steal ideas freely.' },
  { name: 'How to share your first sound', body: 'Hit “Share” at the top. You can post a sample from your library, a preset, a drum kit, a pattern, or a full pack — plus plain text posts like this one. Add a short description so people know what it is and how to use it. Everything you share gets its own link you can paste anywhere.' },
  { name: 'Tip: layer two drum sounds for a fatter kick', body: 'A punchy kick is usually two sounds: a low “body” (sine sub around 50–60Hz) and a high “click” (a short transient or a tiny bit of noise). Put them on the same beat, tune the sub to your key, and shorten the click. Instantly bigger low end without turning anything up.' },
  { name: 'Tip: sidechain a pad to the kick', body: 'If your low end feels muddy, duck the pad/bass every time the kick hits. In the studio, automate the pad’s volume down a touch on each kick beat (or use the compressor). Even a small dip opens up space and gives that pumping, breathing feel.' },
  { name: 'Chord recipe: the “sad but hopeful” progression', body: 'Try vi – IV – I – V (in C major: Am – F – C – G). It’s everywhere in pop for a reason — melancholy on the Am/F, lift on the C/G. Share your own recipes by right-clicking a MIDI clip → Share as recipe.' },
  { name: 'Mixing: get levels right before you touch anything else', body: 'Before EQ, reverb, or fancy plugins — just balance the volumes. Solo the drums, set the kick and snare, then bring everything else in around them. 80% of a “bad mix” is really just a levels problem. Do this first every time.' },
  { name: 'Make a beat on your phone', body: 'The mobile studio at /m lets you tap out drums, melodies, and even record audio with your mic — then save it to your account and finish on desktop. Great for catching an idea before it’s gone. Try it and post what you make.' },
  { name: 'Looking for feedback? Post it here', body: 'Drop a link to something you’re working on and say what you want feedback on (the mix? the arrangement? the drums?). Specific questions get specific answers. And if you listen to someone’s track, leave a comment — that’s how this place stays alive.' },
  { name: 'Tip: less is more in an arrangement', body: 'If a section feels cluttered, mute a track. Then another. Almost always it sounds better with fewer things playing at once. Give each element its own moment — drop the drums for a bar, bring the pad in alone. Space is a sound too.' },
  { name: 'Share your presets and kits', body: 'Made a synth patch or a drum kit you love? Share it — other producers can install it in one click and it’ll sync across their devices. The best packs get pinned. Show us your signature sound.' },
]

async function main() {
  const url = resolveDbUrl()
  if (!url) { console.error('No DATABASE_URL (set it or add it to .env.local).'); process.exit(1) }
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    // Make sure the table + the 'post' kind are allowed (mirrors ensureTables).
    await client.query(`CREATE TABLE IF NOT EXISTS community_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT 'Anonymous', kind TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', payload JSONB, r2_key TEXT,
      votes INT NOT NULL DEFAULT 0, downloads INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
    try {
      await client.query(`ALTER TABLE community_items DROP CONSTRAINT IF EXISTS community_items_kind_check`)
      await client.query(`ALTER TABLE community_items ADD CONSTRAINT community_items_kind_check CHECK (kind IN ('song','sample','preset','recipe','pack','project','theme','kit','pattern','post'))`)
    } catch { /* constraint already fine */ }

    const existing = await client.query('SELECT COUNT(*)::int AS n FROM community_items WHERE user_id = $1', [SEED_USER])
    if ((existing.rows[0]?.n ?? 0) > 0) {
      console.log(`Already seeded (${existing.rows[0].n} starter posts). Nothing to do.`)
      return
    }

    // Space the created_at out so they don't all share a timestamp in the feed.
    let inserted = 0
    for (let i = 0; i < POSTS.length; i++) {
      const p = POSTS[i]
      await client.query(
        `INSERT INTO community_items (user_id, author_name, kind, name, description, created_at)
         VALUES ($1, $2, 'post', $3, $4, NOW() - ($5 || ' minutes')::interval)`,
        [SEED_USER, AUTHOR, p.name, p.body, String((POSTS.length - i) * 7)],
      )
      inserted++
    }
    console.log(`Seeded ${inserted} starter posts as "${AUTHOR}".`)
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
