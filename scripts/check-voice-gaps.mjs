#!/usr/bin/env node
/**
 * The patch queue: sentences the built-in commands could not read.
 *
 *   node --experimental-strip-types scripts/check-voice-gaps.mjs
 *
 * Brae: "Then it executes with AI and sends the system a correction that we can
 * work from when I'm making patches."
 *
 * Writes to the LOCAL database and cleans up after itself. The interesting
 * assertions are not "does an insert work" but the two decisions around it:
 *
 *   It must be grouped by PHRASING, because the unit of work is a rule to write
 *   and "make it punchier" said nine times is one rule, not nine. The count
 *   survives, because how often a gap is hit is the entire argument for closing
 *   it.
 *
 *   It must be incapable of failing anything. This is a notebook attached to a
 *   command that has already run, so a database that is down has to cost a note
 *   and nothing else — never turn a successful edit into a reported failure.
 */

import { readFileSync } from 'node:fs'

// The app reads DATABASE_URL from the environment; scripts here read .env.local.
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter(l => /^[A-Z0-9_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
process.env.DATABASE_URL ||= env.DATABASE_URL

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

if (!process.env.DATABASE_URL) {
  console.log('SKIP no DATABASE_URL in .env.local — nothing to write to.')
  process.exit(0)
}

const { importTs } = await import('./lib/ts-import.mjs')
const { addGap, listGaps, setGapStatus } = await importTs('lib/voice-gaps-db.ts')

const TAG = `check-${Date.now()}`
const SAID = `${TAG} make the whole thing sound more like a rainy afternoon`

await addGap({
  said: SAID,
  calls: [{ name: 'set_track', input: { target: 'Pad', volume: 40 } }],
  say: 'Pad: volume 40 percent.',
  source: 'typed',
  tracks: ['Pad', 'Bass 2'],
  userId: 'user_test',
})
// The same phrasing again — a second person, or the same person tomorrow.
await addGap({ said: SAID, calls: [], say: 'Pad: volume 40 percent.', source: 'spoken', tracks: [], userId: 'user_test2' })

const gaps = await listGaps()
const mine = gaps.find(g => g.said === SAID)
check('a phrasing the rules could not read is recorded', !!mine, mine ? '' : 'not found')
check('and it is grouped by phrasing, not listed twice',
  gaps.filter(g => g.said === SAID).length === 1)
check('with the count kept, because that is the argument for a rule',
  mine?.count === 2, String(mine?.count))
check('and what it turned out to mean', /volume 40/.test(mine?.say ?? ''), mine?.say)
check('newest first, so the queue reads as a queue', gaps[0]?.said === SAID)

await setGapStatus(mine.ids, 'added', 'wrote a phrasing for this')
const after = (await listGaps()).find(g => g.said === SAID)
check('closing one marks it, rather than deleting the evidence',
  after?.status === 'added', String(after?.status))

// The half that matters most: this is a notebook, and a notebook being
// unavailable must cost a note and nothing else.
const { sql } = await importTs('lib/db.ts')
let threw = false
try {
  await addGap({ said: 'x'.repeat(50), calls: undefined, say: undefined, source: undefined, tracks: undefined, userId: undefined })
} catch { threw = true }
check('a malformed note does not throw at the caller', !threw)
let emptyThrew = false
try { await addGap({ said: '   ', calls: [], say: '', source: 'typed', tracks: [], userId: 'u' }) } catch { emptyThrew = true }
check('nor does an empty one', !emptyThrew)

// Clean up everything this check wrote.
await sql`DELETE FROM voice_command_gaps WHERE said LIKE ${TAG + '%'} OR said = ${'x'.repeat(50)}`
const gone = (await listGaps()).some(g => g.said === SAID)
check('and the check leaves nothing behind', !gone)

console.log(failures ? `\n${failures} failing` : '\nthe queue records phrasings and cannot break a command')
process.exit(failures ? 1 : 0)
