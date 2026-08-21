# Selling Apollo as a plugin — roadmap

Apollo (the Helios engine + React UI at /apollo) becomes a sellable product in
three stages. Each stage is independently sellable; later stages reuse
everything from earlier ones.

## Stage 1 — Desktop standalone app (READY TO BUILD NOW)

The existing Electron shell in `electron/` now ships a second product:

```bash
cd electron
npm install
npm run dev:apollo          # dev: Apollo window against localhost:3000
npm run dist:apollo:mac     # → dist-electron-apollo/Apollo-*.dmg (arm64 + x64)
npm run dist:apollo:win     # → dist-electron-apollo/Apollo Setup *.exe
```

- appId `com.100lights.apollo`, productName **Apollo**, own output dir and
  update channel — never collides with the 100Lights app.
- Loads `https://100lights.com/apollo`; window opens at instrument size
  (1500×980, min 1200×760).
- WebMIDI enabled (`midi`/`midiSysex` permission + synchronous check
  handler) so hardware keyboards work — this also benefits the main app.
- Reuses the shell's auto-updater, offline page, native menu, notarize
  pipeline unchanged.

**Remaining before it's on sale (Brae's side, mostly one-time):**
1. Icon: `build/icons/apollo.icns` / `.ico` / `.png` (config already points
   at them; falls back to default icon if absent).
2. Notarization runs on the existing App Store Connect API key — nothing new.
3. Windows: code-signing cert (Azure Trusted Signing is the cheap 2026 path)
   or ship unsigned with SmartScreen caveat.
4. Licensing/paywall: simplest v1 is account-based — Apollo desktop asks for
   100Lights login and checks the existing Pro subscription (`getSubscription`
   merge point; redemption codes already work). No new license-key
   infrastructure needed. Sell "Apollo Desktop" as a Stripe product that
   grants a `pro`-tier entitlement scoped to Apollo.
5. Distribution: direct download from 100lights.com + Gumroad/LemonSqueezy if
   we want marketplace reach. (Steam is real for synths but needs its own
   build plumbing.)

## Stage 2 — Offline-capable desktop (quality upgrade, not a blocker)

Today the standalone loads the hosted site (auto-updates content, requires
network on first run; Electron caches after that). To make it truly offline:
bundle a static export of the /apollo route + engine.js in the app package and
load from `file://` with a custom protocol handler. The engine is a single
self-contained worklet file, so the audio path has zero server dependencies —
only preset cloud-sync and community packs need network, and they already
no-op silently when logged out (401 → cloudOff).

## Stage 3 — True VST3/AU/CLAP plugin (the multi-month project)

Architecture decided; two workstreams:

1. **DSP: port engine.js to C++.** `plugin/apollo-core/` is the proof — a
   line-for-line port of the AHDSR envelope, TPT SVF, band-limited wavetable
   oscillator, and the shared mapping functions (`cutoffHz`, `curveShape`),
   compiled with plain clang and verified spectrally (`verify.py`, same
   Goertzel probes the browser QAs use). engine.js is one dependency-free
   file (~3.3k lines) written in typed-array DSP style, so the port is
   mechanical: classes → classes, Float32Array → float*, no GC/allocation in
   the render path to redesign. Keep the JS engine as the reference
   implementation and port module-by-module with paired renders as the test.
2. **UI: JUCE 8 WebView.** JUCE 8's `WebBrowserComponent` hosts the existing
   React UI inside the plugin window and bridges parameter changes over
   `evaluateJavascript`/native callbacks. The Apollo UI already talks to the
   engine exclusively through a message port (`postMessage` patches/params),
   so the bridge swaps the worklet port for the JUCE native bridge — same
   message schema, no UI rewrite.

Order of work when this stage starts:
- Port the full voice path (osc engines incl. FM/chaos/sub/noise, filters
  incl. the appended FILTER_TYPE_IDS — never reorder), then FX units, then
  the mod matrix/LFO/macro system, then the sequencer/arp.
- Wrap in JUCE `AudioProcessor` (VST3 + AU + CLAP via clap-juce-extensions).
- Parity harness: render the same patch JSON through node (engine.js harness
  already exists in scripts/apollo-tests) and through the C++ core; compare
  band energies per module.
- Sign + notarize with the same Apple credentials; VST3 needs no Steinberg
  fee since the GPLv3/proprietary dual license moved to a free agreement.

## Pricing thought (for Brae)

Comparable hybrid synths: Serum 2 $189, Vital $80 (free tier), Pigments $199.
Apollo's wedge is DAW-integration + web + community packs. A sane ladder:
free web tier (exists) → Apollo Desktop $49–79 one-time or bundled with
100Lights Pro → VST later at the same price with desktop owners upgraded free.
