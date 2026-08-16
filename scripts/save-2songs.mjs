import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
const env = {}
for (const l of readFileSync('/Users/brae/100lights/.env.local','utf8').split('\n')) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) env[m[1]]=m[2].replace(/^["']|["']$/g,'') }
const sql = neon(env.DATABASE_URL)
const USER = 'user_3FElUNjivSIJ9gZsJUKp1496n17'
const D = `${homedir()}/Desktop/100lights-ai-renders`
const items = [
  [`${D}/Nightfall original accompaniment.cfproj`,     'Nightfall (Claude original)'],
  [`${D}/Neon Highway original accompaniment.cfproj`,  'Neon Highway (Claude original)'],
]
// reuse the producer folder, repurpose it for the Claude-authored originals
const frows = await sql`SELECT id FROM folders WHERE user_id=${USER} AND name IN ('Producer (compose)','Producer (Claude-authored)') ORDER BY created_at LIMIT 1`
let folderId = frows[0]?.id
if (!folderId) { folderId = randomUUID(); await sql`INSERT INTO folders (id,user_id,name) VALUES (${folderId},${USER},'Producer (Claude-authored)')` }
await sql`UPDATE folders SET name='Producer (Claude-authored)' WHERE id=${folderId} AND user_id=${USER}`
const del = await sql`UPDATE projects SET deleted_at=NOW() WHERE user_id=${USER} AND folder_id=${folderId} AND deleted_at IS NULL RETURNING name`
console.log('removed:', del.map(r=>r.name).join(', ') || '(none)')
for (const [path, name] of items) {
  const data = JSON.parse(readFileSync(path,'utf8')); const id = data.id || randomUUID(); data.id = id; data.name = name
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)+'-'+id.slice(0,6)
  await sql`INSERT INTO projects (id, user_id, name, slug, owner_username, saved_at, data, folder_id)
    VALUES (${id}, ${USER}, ${name}, ${slug}, 'braedancampbell', NOW(), ${JSON.stringify(data)}::jsonb, ${folderId})
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, data=EXCLUDED.data, folder_id=EXCLUDED.folder_id, saved_at=NOW(), deleted_at=NULL`
  console.log(`✓ saved "${name}"`)
}
console.log('done — folder "Producer (Claude-authored)"')
