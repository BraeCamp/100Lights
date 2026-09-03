const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return

  const {
    APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID,
  } = process.env

  // ⚠️ THE SAME KEY, UNDER THE NAME THE MOBILE PIPELINE ALREADY GAVE IT.
  //
  // The App Store Connect key that notarization wants is the one Fastlane has
  // been using for TestFlight all along — it lives in .env.local as ASC_KEY_ID
  // / ASC_ISSUER_ID / ASC_KEY_PATH. This script only looked for APPLE_API_*,
  // found nothing, and quietly skipped notarizing, so a build that HAD valid
  // credentials on the machine shipped without them. Two names for one key is
  // not worth a second copy of the key.
  const APPLE_API_KEY_ID = process.env.APPLE_API_KEY_ID || process.env.ASC_KEY_ID
  const APPLE_API_ISSUER = process.env.APPLE_API_ISSUER || process.env.ASC_ISSUER_ID
  let APPLE_API_KEY = process.env.APPLE_API_KEY || process.env.ASC_KEY_PATH
  // notarytool takes a path, and a path written with ~ is not one until a
  // shell has expanded it — which nothing does when it arrives via env.
  if (APPLE_API_KEY && APPLE_API_KEY.startsWith('~')) {
    APPLE_API_KEY = path.join(process.env.HOME || '', APPLE_API_KEY.slice(1))
  }
  if (APPLE_API_KEY && !fs.existsSync(APPLE_API_KEY)) {
    console.log('[notarize] Key file not found at the configured path — skipping:', APPLE_API_KEY)
    return
  }

  let authArgs
  if (APPLE_API_KEY && APPLE_API_KEY_ID && APPLE_API_ISSUER) {
    console.log('[notarize] Using App Store Connect API key auth, key ID:', APPLE_API_KEY_ID)
    authArgs = ['--key', APPLE_API_KEY, '--key-id', APPLE_API_KEY_ID, '--issuer', APPLE_API_ISSUER]
  } else if (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID) {
    console.log('[notarize] Using Apple ID auth:', APPLE_ID.slice(0, 4) + '****', 'team:', APPLE_TEAM_ID)
    authArgs = ['--apple-id', APPLE_ID, '--password', APPLE_APP_SPECIFIC_PASSWORD, '--team-id', APPLE_TEAM_ID]
  } else {
    console.log('[notarize] Skipping — no valid credentials (need API key trio or Apple ID trio)')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  try {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' })
    console.log('[notarize] Code signature verified')
  } catch {
    console.log('[notarize] App is not signed — skipping notarization')
    return
  }

  const zipPath = path.join(context.appOutDir, `${appName}.zip`)
  execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath])
  console.log('[notarize] Submitting to Apple...')

  execFileSync('xcrun', ['notarytool', 'submit', zipPath, ...authArgs, '--wait'], { stdio: 'inherit' })
  execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' })

  fs.unlinkSync(zipPath)
  console.log('[notarize] Done')
}
