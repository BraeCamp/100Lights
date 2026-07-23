// Test suite for lib/project-merge.ts. Run via `npm run test:merge` (which
// compiles the module first). Zero-dependency: a tiny assert harness.
import { mergeProjects, applyResolutions, hasDiverged } from '../.test-build/project-merge.js'

let passed = 0, failed = 0
function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${name}`) }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b)) }

// ── Builders ──
const clip = (id, over = {}) => ({ id, name: id, startBeat: 0, durationBeats: 4, notes: [], ...over })
const track = (id, over = {}) => ({ id, name: id, volume: 0.8, ...over })
const P = (over = {}) => ({ arrangementClips: [], tracks: [], clipEffects: [], scenes: [], tempo: 120, timeSignatureNum: 4, name: 'Song', swing: 0, ...over })
const clipIds = p => p.arrangementClips.map(c => c.id).sort()
const findClip = (p, id) => p.arrangementClips.find(c => c.id === id)

// 1) No changes → no conflicts, merged == base collections
{
  const base = P({ arrangementClips: [clip('A'), clip('B')] })
  const { merged, conflicts } = mergeProjects(base, structuredClone(base), structuredClone(base))
  eq('1 no-op: no conflicts', conflicts, [])
  eq('1 no-op: clips preserved', clipIds(merged), ['A', 'B'])
}

// 2) Disjoint edits → both apply, no conflict
{
  const base = P({ arrangementClips: [clip('A'), clip('B')] })
  const mine = P({ arrangementClips: [clip('A', { startBeat: 8 }), clip('B')] })
  const theirs = P({ arrangementClips: [clip('A'), clip('B', { durationBeats: 2 })] })
  const { merged, conflicts } = mergeProjects(base, mine, theirs)
  ok('2 disjoint: no conflicts', conflicts.length === 0)
  ok('2 disjoint: mine A kept', findClip(merged, 'A').startBeat === 8)
  ok('2 disjoint: theirs B kept', findClip(merged, 'B').durationBeats === 2)
}

// 3) Add on mine only → included
{
  const base = P({ arrangementClips: [clip('A')] })
  const mine = P({ arrangementClips: [clip('A'), clip('C')] })
  const theirs = P({ arrangementClips: [clip('A')] })
  const { merged, conflicts } = mergeProjects(base, mine, theirs)
  ok('3 add-mine: no conflict', conflicts.length === 0)
  eq('3 add-mine: C present', clipIds(merged), ['A', 'C'])
}

// 4) Add on theirs only → included
{
  const base = P({ arrangementClips: [clip('A')] })
  const mine = P({ arrangementClips: [clip('A')] })
  const theirs = P({ arrangementClips: [clip('A'), clip('D')] })
  const { merged } = mergeProjects(base, mine, theirs)
  eq('4 add-theirs: D present', clipIds(merged), ['A', 'D'])
}

// 5) Delete on mine (theirs unchanged) → removed
{
  const base = P({ arrangementClips: [clip('A'), clip('B')] })
  const mine = P({ arrangementClips: [clip('B')] })
  const theirs = P({ arrangementClips: [clip('A'), clip('B')] })
  const { merged, conflicts } = mergeProjects(base, mine, theirs)
  ok('5 delete-mine: no conflict', conflicts.length === 0)
  eq('5 delete-mine: A gone', clipIds(merged), ['B'])
}

// 6) Delete on theirs (mine unchanged) → removed
{
  const base = P({ arrangementClips: [clip('A'), clip('B')] })
  const mine = P({ arrangementClips: [clip('A'), clip('B')] })
  const theirs = P({ arrangementClips: [clip('B')] })
  const { merged } = mergeProjects(base, mine, theirs)
  eq('6 delete-theirs: A gone', clipIds(merged), ['B'])
}

// 7) Both edit A differently → conflict, default theirs
{
  const base = P({ arrangementClips: [clip('A')] })
  const mine = P({ arrangementClips: [clip('A', { startBeat: 8 })] })
  const theirs = P({ arrangementClips: [clip('A', { startBeat: 16 })] })
  const { merged, conflicts } = mergeProjects(base, mine, theirs)
  ok('7 conflict: one conflict', conflicts.length === 1)
  ok('7 conflict: it is clip A', conflicts[0].kind === 'clip' && conflicts[0].id === 'A')
  ok('7 conflict: default theirs', findClip(merged, 'A').startBeat === 16)
  ok('7 conflict: carries both sides', conflicts[0].mine.startBeat === 8 && conflicts[0].theirs.startBeat === 16)
}

// 8) Both edit A identically → no conflict
{
  const base = P({ arrangementClips: [clip('A')] })
  const mine = P({ arrangementClips: [clip('A', { startBeat: 8 })] })
  const theirs = P({ arrangementClips: [clip('A', { startBeat: 8 })] })
  const { merged, conflicts } = mergeProjects(base, mine, theirs)
  ok('8 same-edit: no conflict', conflicts.length === 0)
  ok('8 same-edit: applied', findClip(merged, 'A').startBeat === 8)
}

// 9) Delete on mine vs edit on theirs → conflict
{
  const base = P({ arrangementClips: [clip('A')] })
  const mine = P({ arrangementClips: [] })
  const theirs = P({ arrangementClips: [clip('A', { startBeat: 8 })] })
  const { conflicts } = mergeProjects(base, mine, theirs)
  ok('9 delete-vs-edit: conflict', conflicts.length === 1 && conflicts[0].id === 'A')
  ok('9 delete-vs-edit: mine is null (deleted)', conflicts[0].mine === null)
}

// 10) Scalar both change tempo differently → field conflict
{
  const base = P({ tempo: 120 })
  const { merged, conflicts } = mergeProjects(base, P({ tempo: 100 }), P({ tempo: 140 }))
  ok('10 tempo: field conflict', conflicts.length === 1 && conflicts[0].kind === 'field' && conflicts[0].id === 'tempo')
  ok('10 tempo: default theirs', merged.tempo === 140)
}

// 11) Scalar only mine changes → mine applied, no conflict
{
  const base = P({ tempo: 120 })
  const { merged, conflicts } = mergeProjects(base, P({ tempo: 100 }), P({ tempo: 120 }))
  ok('11 tempo-mine: no conflict', conflicts.length === 0)
  ok('11 tempo-mine: mine applied', merged.tempo === 100)
}

// 12) applyResolutions flips a clip conflict to mine
{
  const base = P({ arrangementClips: [clip('A')] })
  const mine = P({ arrangementClips: [clip('A', { startBeat: 8 })] })
  const theirs = P({ arrangementClips: [clip('A', { startBeat: 16 })] })
  const { merged, conflicts } = mergeProjects(base, mine, theirs)
  const resolved = applyResolutions(merged, conflicts, { A: 'mine' })
  ok('12 resolve: flipped to mine', findClip(resolved, 'A').startBeat === 8)
  ok('12 resolve: theirs stays default without a pick', findClip(applyResolutions(merged, conflicts, {}), 'A').startBeat === 16)
}

// 13) hasDiverged
{
  const base = P({ arrangementClips: [clip('A')] })
  ok('13 diverged: same → false', hasDiverged(base, structuredClone(base)) === false)
  ok('13 diverged: edited → true', hasDiverged(base, P({ arrangementClips: [clip('A', { startBeat: 8 })] })) === true)
}

// 14) Track edits merge and conflict like clips
{
  const base = P({ tracks: [track('t1'), track('t2')] })
  const mine = P({ tracks: [track('t1', { volume: 0.5 }), track('t2')] })
  const theirs = P({ tracks: [track('t1', { volume: 0.9 }), track('t2', { name: 'Bass' })] })
  const { merged, conflicts } = mergeProjects(base, mine, theirs)
  ok('14 tracks: one conflict (t1)', conflicts.length === 1 && conflicts[0].kind === 'track' && conflicts[0].id === 't1')
  ok('14 tracks: t2 rename kept', merged.tracks.find(t => t.id === 't2').name === 'Bass')
}

console.log(`\nproject-merge: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
