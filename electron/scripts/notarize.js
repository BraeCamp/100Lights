// Mac notarization — runs after electron-builder signs the .app.
// Requires environment variables:
//   APPLE_ID              — your Apple ID (e.g. you@icloud.com)
//   APPLE_APP_SPECIFIC_PASSWORD — app-specific password from appleid.apple.com
//   APPLE_TEAM_ID         — your 10-char Apple Developer team ID
//
// These should be set as CI secrets (GitHub Actions) and never committed.
// If APPLE_ID is not set, notarization is skipped (e.g. local builds).

const { notarize } = require('@electron/notarize')

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (!process.env.APPLE_ID) {
    console.log('Skipping notarization — APPLE_ID not set')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = `${context.appOutDir}/${appName}.app`

  const { execFileSync } = require('child_process')
  try {
    execFileSync('codesign', ['--verify', '--deep', appPath], { stdio: 'pipe' })
  } catch {
    console.log('Skipping notarization — app is not code signed (signing was skipped or failed)')
    return
  }

  console.log(`Notarizing ${appPath}...`)

  await notarize({
    appBundleId: 'com.100lights.app',
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  })

  console.log('Notarization complete')
}
