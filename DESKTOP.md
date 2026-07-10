# 100Lights Desktop App

Electron wrapper that loads `https://100lights.com` in a native window with:
- Native file open/save dialogs (audio, video, all formats)
- Native application menu (File, Edit, View, Window, Help)
- Keyboard shortcut navigation (Cmd+N, Cmd+D, etc.)
- Auto-updater via GitHub Releases
- Single-instance enforcement
- Mac: hidden title bar + traffic lights, arm64 + x64 DMG
- Windows: NSIS one-click installer (x64)

## Development

```bash
cd electron
npm install

# Start the Next.js dev server first:
# (in another terminal, from repo root)
npm run dev

# Then start Electron pointing at localhost:3000
npm run dev
```

## Building installers

### Prerequisites
- Node 20+
- Mac: Xcode Command Line Tools, Apple Developer account for notarization
- Windows: nothing extra needed (builds NSIS installer)
- Icons: place `icon.icns`, `icon.ico`, `icon.png` in `build/icons/` (see `build/icons/README.md`)

### Build commands
```bash
cd electron
npm install

npm run dist:mac    # → dist-electron/100Lights-*.dmg + .zip (x64 + arm64)
npm run dist:win    # → dist-electron/100Lights Setup *.exe
npm run dist:all    # both platforms (only works on Mac with cross-compile tools)
```

### Mac notarization (required for distribution outside the App Store)
Preferred: App Store Connect API key (what CI uses):
```
APPLE_API_KEY=/path/to/AuthKey_XXXXXXXXXX.p8
APPLE_API_KEY_ID=XXXXXXXXXX
APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```
Fallback: Apple ID trio (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID`). If neither full set is present, notarization is skipped
with a log line.

### Code signing (Mac)
```
CSC_LINK=<base64-encoded .p12 certificate>
CSC_KEY_PASSWORD=<certificate password>
```

## CI / GitHub Actions

`.github/workflows/desktop.yml` builds both platforms when you push a version tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The workflow uploads installers to the GitHub release. `electron-updater` checks
this GitHub release for updates on every launch and every 4 hours.

Add these secrets in GitHub → Settings → Secrets:
| Secret | Description |
|--------|-------------|
| `APPLE_API_KEY_CONTENT` | Raw contents of the App Store Connect `.p8` key |
| `APPLE_API_KEY_ID` | 10-char API key ID |
| `APPLE_API_ISSUER` | API issuer UUID |
| `MAC_CERTIFICATE_P12_BASE64` | Base64-encoded .p12 signing cert |
| `MAC_CERTIFICATE_PASSWORD` | .p12 password |

The release is created as a **draft** (prevents the Mac/Win jobs racing).
After both jobs finish: paste in the notes from `release-notes/`, smoke-test
the DMG, then **Publish** — auto-update only sees published releases.

## Architecture

```
electron/
  src/
    main.ts       — BrowserWindow, session, navigation guard, single-instance
    preload.ts    — contextBridge API (window.electronAPI)
    menu.ts       — native application menu
    ipc.ts        — main-side IPC handlers (file dialogs, shell)
    updater.ts    — electron-updater auto-update
  scripts/
    notarize.js   — post-sign Mac notarization hook
  package.json    — electron-builder config

build/
  entitlements.mac.plist  — hardened runtime entitlements
  icons/                  — icon assets (you must provide these)

lib/electron.ts           — web-side helpers (isElectron, nativeOpenFile, etc.)
```

## Feature compatibility

| Feature | Web | Desktop |
|---------|-----|---------|
| Audio Editor (DAW) | ✓ | ✓ |
| Video Editor | ✓ | ✓ |
| Clerk auth (email, Google, GitHub OAuth) | ✓ | ✓ (popup flow) |
| File import via `<input type="file">` | ✓ | ✓ |
| Native file open dialog | — | ✓ via `nativeOpenFile()` |
| Native save dialog | — | ✓ via `nativeSaveFile()` |
| Auto-update | — | ✓ |
| Offline use | — | — (requires internet for auth + media storage) |
| R2 media upload/download | ✓ | ✓ |
| FFmpeg.wasm | ✓ | ✓ (COOP/COEP set in session) |
| Web Audio API | ✓ | ✓ |
| Stripe checkout | ✓ | ✓ (opens system browser) |
