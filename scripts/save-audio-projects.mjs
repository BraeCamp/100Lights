// Save the 4 generated .cfproj (2 EL + 2 producer) as EDITABLE audio/DAW projects in Brae's account,
// in a new folder, and soft-delete the 4 wrongly-baked video projects. Direct DB (avoids the API body
// limit for the ~2MB EL projects). Self-contained cfproj → open in the studio, hear + edit the music.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'

const env = {}
for (const l of readFileSync('/Users/brae/100lights/.env.local','utf8').split('\n')) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) env[m[1]]=m[2].replace(/^["']|["']$/g,'') }
const sql = neon(env.DATABASE_URL)
const USER = 'user_3FElUNjivSIJ9gZsJUKp1496n17'
const D = `${homedir()}/Desktop/100lights-ai-renders`
const OLD_FOLDER = '18681d0c-d0be-4faf-9d54-759037cd072c'  // the "AI Content" folder with the baked projects

const items = [
  [`${D}/Orchestral EL.cfproj`,               'Orchestral (EL)'],
  [`${D}/EDM EL.cfproj`,                       'EDM (EL)'],
  [`${D}/Ode to Joy accompaniment.cfproj`,     'Ode to Joy (Producer)'],
  [`${D}/Greensleeves accompaniment.cfproj`,   'Greensleeves (Producer)'],
]

// folder
await sql`CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
const folderId = randomUUID()
await sql`INSERT INTO folders (id, user_id, name) VALUES (${folderId}, ${USER}, 'AI Music — EL vs Producer')`
console.log('folder created: AI Music — EL vs Producer')

let n = 0
for (const [path, name] of items) {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const id = data.id || randomUUID()
  data.id = id; data.name = name
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50) + '-' + id.slice(0,6)
  const kb = (JSON.stringify(data).length/1024).toFixed(0)
  await sql`
    INSERT INTO projects (id, user_id, name, slug, owner_username, saved_at, data, folder_id)
    VALUES (${id}, ${USER}, ${name}, ${slug}, 'braedancampbell', NOW(), ${JSON.stringify(data)}::jsonb, ${folderId})
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, data=EXCLUDED.data, folder_id=EXCLUDED.folder_id, saved_at=NOW(), deleted_at=NULL`
  console.log(`✓ saved "${name}" (${kb} KB, editable audio project)`)
  n++
}

// soft-delete the 4 wrongly-baked video projects (recoverable)
const del = await sql`UPDATE projects SET deleted_at = NOW() WHERE user_id=${USER} AND folder_id=${OLD_FOLDER} AND deleted_at IS NULL RETURNING id`
console.log(`\nSoft-deleted ${del.length} baked video project(s) from the old "AI Content" folder (recoverable).`)
console.log(`Done — ${n} editable audio projects in "AI Music — EL vs Producer".`)
