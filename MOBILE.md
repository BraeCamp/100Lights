# Mobile studio + app-store path

The mobile studio is a condensed, touch-first build of 100Lights at **`/m`**
(`app/m/`). It reuses the same audio engine and drum kits as the desktop editor,
so a beat made on a phone is a normal project. Desktop stays the full DAW.

- **Phase 1 (shipped):** the **Beat** tab — a touch step sequencer over the real
  `DRUM_KITS` / `playInstrumentNote`, with play/stop, tempo, and 12 kits.
  `components/mobile/MobileBeatMaker.tsx` + `MobileStudio.tsx`.
- **Next:** Melody and Sounds tabs, a fader Mix tab, and **save/sync** — map the
  local grid to a `DawProject` drum clip and save through the existing API so a
  mobile sketch opens in the desktop studio.

## Installable now (PWA)
`app/manifest.ts` + the existing service worker make `/m` installable via
"Add to Home Screen." Icons are generated from the brand mark:
`node scripts/gen-pwa-icons.mjs` → `public/icon-{192,512}.png`,
`icon-maskable-512.png`, `apple-touch-icon.png`.

## App Store / Play Store via Capacitor

**Everything is pre-wired.** Capacitor 7 + the CLI + the native-value plugins
(`app`, `haptics`, `status-bar`, `splash-screen`, `keyboard`, `share`,
`preferences`) are already in `package.json`, and `capacitor.config.json` has the
app id/name, dark theme, splash, and status-bar all configured. So the wrap is:

```bash
npm install            # gets Capacitor + plugins (already declared)

# One-time native scaffolding — needs Xcode (iOS) / Android Studio installed:
npx cap add ios
npx cap add android

# From then on, sync + open the native IDE with one command each:
npm run cap:ios        # cap sync ios && cap open ios     → build/sign/submit in Xcode
npm run cap:android    # cap sync android && cap open android → build/submit in Android Studio
```

`npm run cap:sync` alone re-copies config/plugins after any change (run it before
opening if the config changed).

**How the web app loads** — the config uses `server.url = https://100lights.com/m`,
so the native WebView shows the live hosted mobile studio. Works immediately and
always ships the latest `/m`. Web Audio (drums, synths, recording) runs fine in
the iOS/Android WebView.

- Apple guideline **4.2** can reject a *pure* remote wrapper. The pre-installed
  native plugins already add real device value (haptics on pads, native splash +
  status bar, share sheet, on-device Preferences cache) — wire them into the
  `/m` UI (behind a `Capacitor.isNativePlatform()` check) before submitting.
- For a fully **offline/bundled** build later: export just the `/m` UI into
  `webDir` (keeping API calls pointed at `https://100lights.com`) and drop
  `server.url`. Not required for a first submission with the remote URL + native
  plugins.

`appId` is `com.hundredlights.studio` — change it to your real reverse-DNS id
before creating the native projects if you want a different one. (No leading
digit in any segment — Android package names disallow it, which is why it isn't
`com.100lights.*`.)
