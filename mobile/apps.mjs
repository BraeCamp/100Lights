// Single source of truth for the native (Capacitor) apps this repo can ship.
//
// Each entry becomes ONE App Store / Play Store app. `scripts/cap-select.mjs <slug>`
// writes capacitor.config.json for the chosen app from BASE + the app's fields, so one
// codebase produces N genuinely-distinct native apps — the full studio today, plus any
// /apps mini-app you promote to native. This is the "not a wrapper farm" model: each app
// points at its OWN production route and gets its own bundle id, icon, and native plugins.
//
// Bundle ids are reverse-DNS with NO leading digit in any segment (Android package rule —
// that's why it's com.hundredlights.*, not com.100lights.*).

// Shared config every app inherits (theme, splash, status bar, keyboard, native plugins).
export const BASE = {
  webDir: 'public',
  backgroundColor: '#0e0d12',
  ios: { contentInset: 'always', backgroundColor: '#0e0d12' },
  android: { backgroundColor: '#0e0d12' },
  plugins: {
    SplashScreen: { backgroundColor: '#0e0d12', showSpinner: false, launchAutoHide: true, launchShowDuration: 600 },
    StatusBar: { style: 'DARK', backgroundColor: '#0e0d12' },
    Keyboard: { resize: 'native' },
  },
}

// One object per shippable app. `serverUrl` is the PRODUCTION route the native shell loads,
// so a TestFlight build always shows the live deployment (and your web edits ship without a
// new native build). Add apps 2–5 by adding entries and editing freely before you submit.
export const MOBILE_APPS = [
  {
    slug: 'studio',
    appId: 'com.hundredlights.studio',
    appName: '100Lights',
    serverUrl: 'https://100lights.com/m',
    tagline: 'The full touch studio — beats, melodies, mixing.',
  },
  {
    // Firefly = the voice-first sketchpad (supersedes the old standalone Flutter app). Reuses
    // its EXISTING App Store identity (com.hundredlights.firefly) so the web build continues
    // that listing rather than starting a new one.
    slug: 'firefly',
    appId: 'com.hundredlights.firefly',
    appName: 'Firefly',
    serverUrl: 'https://100lights.com/apps/firefly',
    tagline: 'Sing a melody, add a beat, finish it in the studio.',
  },
  // Promote a /apps mini-app to its own native app by uncommenting + tailoring an entry.
  // Make each genuinely distinct (own identity, own native value) — see mobile/AUTOMATION.md.
  // { slug: 'voicemidi', appId: 'com.hundredlights.voicemidi', appName: 'Sing to Instrument', serverUrl: 'https://100lights.com/apps/voicemidi', tagline: 'Hum a line; hear any instrument.' },
  // { slug: 'sheetmusic', appId: 'com.hundredlights.sheetmusic', appName: 'Hear Sheet Music', serverUrl: 'https://100lights.com/apps/sheetmusic', tagline: 'Upload a score; hear it played.' },
  // { slug: 'beatmaker', appId: 'com.hundredlights.beatmaker', appName: 'Beat Maker',          serverUrl: 'https://100lights.com/apps/beatmaker', tagline: 'Tap out a drum pattern fast.' },
  // { slug: 'autotune',  appId: 'com.hundredlights.autotune',  appName: 'Autotune',            serverUrl: 'https://100lights.com/apps/autotune',  tagline: 'Snap a vocal to key.' },
]

// The Capacitor iOS scheme is always "App" (Capacitor's fixed target name).
export const IOS_SCHEME = 'App'

export const bySlug = (slug) => MOBILE_APPS.find((a) => a.slug === slug)
