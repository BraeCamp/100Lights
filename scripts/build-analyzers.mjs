// Regenerate node-importable bundles of the TS analyzers used by the pure-Node corpus pipeline
// (lib/music-learn.mjs). Run after editing lib/audio-shape.ts: `node scripts/build-analyzers.mjs`.
import { execFileSync } from 'node:child_process'
const bundles = [
  ['lib/audio-shape.ts', 'scripts/analyzers/audio-shape.mjs'],
  ['lib/audio-to-midi.ts', 'scripts/analyzers/audio-to-midi.mjs'],  // audio→MIDI hybrid (notes + chords)
]
for (const [src, out] of bundles) {
  execFileSync('npx', ['--yes', 'esbuild', src, '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error'], { stdio: 'inherit' })
  console.log('built', out)
}
