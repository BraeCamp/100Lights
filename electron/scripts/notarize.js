const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return

  const {
    APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER,
    APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID,
  } = process.env

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
