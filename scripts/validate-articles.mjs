// Build-time guard for Learn article widget markers. simple-markdown silently
// skips a malformed @grid / @progression / @ab / @synth / @sound / @audio
// marker, so a typo'd payload just vanishes from the published page with no
// error. This runs as `prebuild` and fails the build instead.

import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const DIR = 'content/learn'
const JSON_MARKERS = ['grid', 'ab', 'synth', 'progression']  // ( uri-encoded JSON )
const ARG_MARKERS = ['sound', 'audio']                       // ( string arg )
const ALL = [...JSON_MARKERS, ...ARG_MARKERS]

const errors = []
let files = []
try { files = readdirSync(DIR).filter(f => f.endsWith('.md')) } catch { /* no dir yet */ }

for (const file of files) {
  const lines = readFileSync(join(DIR, file), 'utf8').split('\n')
  lines.forEach((raw, i) => {
    const line = raw.trimStart()
    for (const name of ALL) {
      if (!line.startsWith('@' + name)) continue
      const rest = line.slice(name.length + 1)  // chars after "@name"
      if (/^[a-z]/i.test(rest)) break            // it's a longer word (@audioX), not this marker
      const at = `${file}:${i + 1}  @${name}`
      if (!rest.startsWith('(')) { errors.push(`${at} is missing its ( … ) payload`); break }
      const m = line.match(new RegExp(`^@${name}\\(([^)]*)\\)`))
      if (!m) { errors.push(`${at}( … ) has no closing paren`); break }
      if (JSON_MARKERS.includes(name)) {
        try { JSON.parse(decodeURIComponent(m[1])) }
        catch (e) { errors.push(`${at} payload is not valid URI-encoded JSON — ${e.message}`) }
      } else if (!m[1].trim()) {
        errors.push(`${at}() has an empty argument`)
      }
      break
    }
  })
}

if (errors.length) {
  console.error(`\n✖ Article marker validation failed (${errors.length}):\n` + errors.map(e => '  ' + e).join('\n') + '\n')
  process.exit(1)
}
console.log(`✓ Article markers valid (${files.length} file${files.length === 1 ? '' : 's'})`)
