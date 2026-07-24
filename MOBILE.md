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
`capacitor.config.json` is the scaffold. It's wrapped when you're ready — these
steps run locally and need Xcode (iOS) / Android Studio, so they're yours to run:

```bash
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android
npx cap open ios      # build/sign/submit in Xcode
npx cap open android  # build/submit in Android Studio
```

**Two ways to bundle the web app** (config currently uses the first):

1. **Remote (fastest to test):** `server.url` points the native WebView at the
   hosted `https://100lights.com/m`. Works immediately; needs network. Apple
   guideline 4.2 can reject a *pure* remote wrapper, so before submission add
   native value (see below).
2. **Bundled (recommended for the stores):** ship `/m` as static assets inside
   the app so it launches offline and reads as a real app. Because the rest of
   the Next app is server-rendered, do this by exporting just the mobile bundle
   (or a small standalone build of the `/m` UI) into `webDir`, keeping API calls
   pointed at `https://100lights.com`. Then drop `server.url`.

**Add native value (helps App Store review + the feel):**
`@capacitor/haptics` (pad feedback), `@capacitor/status-bar`,
`@capacitor/share`, `@capacitor/preferences` (local project cache), and a proper
audio-session config so playback behaves like a music app. The audio already
runs through Web Audio in the WebView, which works on iOS/Android.

`appId` (`com.hundredlights.studio`) is a placeholder — set it to your real
reverse-DNS id before creating the native projects. (Avoid a leading digit in
any segment — Android package names disallow it, which is why it isn't
`com.100lights.*`.)
