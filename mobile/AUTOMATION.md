# Mobile release automation

Ship any app in [`mobile/apps.mjs`](apps.mjs) to TestFlight. One pipeline serves every app —
adding apps 2–5 is a config entry, not a new setup. Each app points at its own production route
via `server.url`, so a build always shows the **live deployment** and your web edits ship without
a new native build.

Two tiers, same Fastlane lane underneath:

| Tier | What runs it | Use it for |
|------|--------------|------------|
| **Local one-command** | `npm run beta` on your Mac | Getting the first beta out today; quick reruns |
| **CI (hands-off)** | GitHub Actions → *Mobile beta → TestFlight* | Repeatable releases once signing is in a match repo |

Everything in this repo is scaffolding. The steps below marked **YOU** need your Apple account and
are the part I can't do — that's "the rest."

---

## What's already wired (in the repo)

- **`mobile/apps.mjs`** — the app registry (bundle id, name, production URL per app).
- **`scripts/cap-select.mjs`** (`npm run app:select -- <slug>`) — writes `capacitor.config.json`
  for the chosen app. Run before any build.
- **`fastlane/Fastfile`** — the `ios beta` lane: build → sign → upload to TestFlight, API-key auth.
- **`fastlane/Appfile`** — reads the bundle id from the selected app automatically.
- **`.github/workflows/mobile-release.yml`** — CI that generates the iOS project fresh, signs, and
  uploads. Inert until the secrets below are set.
- **`Gemfile`** — pins Fastlane + CocoaPods.
- The native `ios/` project is **not committed** — it's generated from config each time (`cap add ios`).

---

## One-time setup (YOU — needs your Apple Developer account)

You already did this for Firefly, so most is familiar.

1. **Bundle IDs** — Developer Portal → Certificates, IDs & Profiles → Identifiers → register each
   app id from `mobile/apps.mjs` (e.g. `com.hundredlights.studio`). Enable the capabilities the app
   uses (voicemidi needs the mic; add "Push"/others only if used).
2. **App Store Connect record** — My Apps → **＋** → New App, one per bundle id. Fill name, primary
   language, SKU. (This is what makes the app show up in TestFlight.)
3. **App Store Connect API key** — Users and Access → **Integrations / Keys** → App Store Connect API
   → generate a key with **App Manager** role. Download the **`.p8` once** and note the **Key ID** and
   **Issuer ID**. This is the credential CI + Fastlane use (no 2FA).
4. **Export compliance** — set `ITSAppUsesNonExemptEncryption = NO` in the app's Info.plist (HTTPS-only
   counts as exempt) so uploads don't stall on a compliance question. `cap add ios` won't add it — do
   it in Xcode once, or I can add a build-phase to inject it.

Keep the `.p8`, Key ID, and Issuer ID somewhere safe — you'll paste them below.

---

## Fastest path: first beta from your Mac (~20 min)

Prereqs: Xcode installed + signed in (Xcode → Settings → Accounts → your Apple ID), and
`bundle install` once in the repo.

Credentials live in **`.env.local`** (the same gitignored file as the DB/R2/Stripe secrets) —
the Fastfile auto-loads it, so there are no manual `export`s. `ASC_KEY_ID`, `ASC_KEY_PATH`, and
`APPLE_TEAM_ID` are already filled (reused from Firefly); you only paste the **Issuer ID**.

```bash
# 1. Pick the app (studio already targets https://100lights.com/m) + generate the native project
#    (app:add-ios runs select → cap add ios → sync → the Info.plist patch below)
APP=studio npm run app:add-ios && (cd ios/App && pod install)

# 2. Verify creds + that the app record exists (read-only — no build, no upload):
npm run beta:check

# 3. When beta:check is green and you're ready, ship to TestFlight (reads .env.local automatically):
npm run beta
```

`npm run beta:check` (the `preflight` lane) authenticates with `.env.local` and reports whether the
selected app's App Store Connect record exists — run it any time to see exactly what's left.
`scripts/ios-postsync.mjs` (run automatically by `app:add-ios`) sets `ITSAppUsesNonExemptEncryption`
+ the mic usage string on the regenerated Info.plist, so uploads don't stall and mic access won't crash.

That builds, signs (Xcode automatic signing — no match repo needed for this local run), and uploads.
The build appears under **TestFlight** in App Store Connect after Apple finishes processing (a few
minutes); add yourself as an internal tester and install via the TestFlight app. **That's your beta on
the production deployment.**

> If the build fails on signing, open `ios/App/App.xcworkspace` in Xcode once, select the App target →
> Signing & Capabilities → check "Automatically manage signing" and pick your team, then rerun `npm run beta`.

---

## Hands-off: CI releases (do after the first manual one works)

Signing on a runner needs certs in a **match** repo (a private git repo of encrypted signing assets):

```bash
# one-time, locally — creates the distribution cert + App Store profiles and pushes them encrypted
bundle exec fastlane match appstore --git_url git@github.com:BraeCamp/ios-certs.git
```

Then add these **GitHub → Settings → Secrets and variables → Actions** (YOU):

| Secret | Value |
|--------|-------|
| `ASC_KEY_ID` / `ASC_ISSUER_ID` | from the API key |
| `ASC_KEY_P8` | the **contents** of the `.p8` file |
| `APPLE_TEAM_ID` | your 10-char team id |
| `MATCH_GIT_URL` | the certs repo URL |
| `MATCH_PASSWORD` | the passphrase you set during `match` |
| `MATCH_GIT_BASIC_AUTHORIZATION` | base64 of `user:personal-access-token` for the certs repo |

Now: **Actions → Mobile beta → TestFlight → Run workflow → pick a slug.** It builds and uploads with
zero local steps. (Wire it to a git tag later if you want tag-push releases.)

---

## Adding apps 2–5

1. Uncomment / add an entry in `mobile/apps.mjs` (own `slug`, `appId`, `appName`, `serverUrl`).
2. Register its bundle id + App Store Connect record (steps 1–2 above).
3. `npm run app:select -- <slug>` then `npm run beta` (or run the CI workflow with that slug).

The same API key and match repo cover all your apps — no per-app credential work after the first.

---

## Guardrails (why these won't get 4.3'd)

- **Distinct apps, not wrappers.** Each app is a different tool with its own identity and route — the
  opposite of a wrapper farm. Keep them genuinely different (you're already planning that).
- **Apple 4.2 (minimum functionality) on a remote-loaded shell** — add real device value so it's not "a
  website in a can": the pre-installed native plugins (haptics, share sheet, native splash/status bar,
  on-device Preferences) wired into the UI behind `Capacitor.isNativePlatform()`. voicemidi/beatmaker
  using the mic + haptics clears this easily.
- **First submission** can stay remote-URL (fast). For a fully offline/bundled build later, export the
  app's UI into `webDir` and drop `server.url` — not needed for a TestFlight beta.

---

*What I can't do for you:* create the Apple app records, generate the `.p8`, run `fastlane match` (all
need your Apple credentials), and add the GitHub secrets. Everything else — the lanes, the CI, the
multi-app selector — is done. Ping me to add the Info.plist export-compliance/mic-usage injection or an
Android (Play Store) lane and I'll extend the same setup.
