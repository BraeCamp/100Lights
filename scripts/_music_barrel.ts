// Re-export the app's pure music-data libraries so the composer (compose.mjs)
// can bundle + read them. Driving from these means adding a genre or drum kit
// in the app automatically expands what the composer can produce.
export { GENRES } from '../lib/genres'
export { DRUM_KITS } from '../lib/drum-presets'
