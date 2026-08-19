// Learn-mode content integrity: every [[link]] resolves; resolver spot checks.
// Verify every [[key]] in learn-content bodies resolves to a real entry.
const { LEARN_ENTRIES, resolveLearn } = await import(new URL('../../lib/apollo/learn-content.ts', import.meta.url).href)
const keys = new Set(LEARN_ENTRIES.map(e => e.key))
let bad = 0
for (const e of LEARN_ENTRIES) {
  for (const m of e.body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    if (!keys.has(m[1])) { console.log(`BAD LINK [[${m[1]}]] in "${e.key}"`); bad++ }
  }
}
console.log(`entries: ${LEARN_ENTRIES.length}, bad links: ${bad}`)
// spot-check resolver on real labels
for (const [label, title] of [
  ['Cutoff', null], ['FILTER 1', null], ['Res', null], ['LFO 4', null], ['Macro 3', null],
  ['Unison', null], ['WT Pos', null], ['Serial', null], ['S', null], ['⭳ Bounce', null],
  ['Main', null], ['MPE', null], ['Attack', null], ['Skin', null], ['Env 2', null],
  [null, "FX lane for this filter's output"], ['Reverb', null], ['SplitLMH', null], ['Density', null],
]) {
  const r = resolveLearn(label, title)
  console.log(`${label ?? title} → ${r ? r.key : 'FALLBACK'}`)
}
process.exit(bad ? 1 : 0)
