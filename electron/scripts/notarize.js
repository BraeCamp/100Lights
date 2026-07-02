const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env

  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log(
      '[notarize] Skipping notarization — missing env vars:',
      ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
        .filter(k => !process.env[k])
        .join(', ') || 'none'
    )
    return
  }

  console.log('[notarize] APPLE_ID set:', APPLE_ID.slice(0, 4) + '****')
  console.log('[notarize] APPLE_TEAM_ID:', APPLE_TEAM_ID)

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  try {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' })
    console.log('[notarize] Code signature verified:', appPath)
  } catch (err) {
    console.log('[notarize] App is not signed — skipping notarization')
    return
  }

  const zipPath = path.join(context.appOutDir, `${appName}.zip`)
  console.log('[notarize] Creating ZIP for submission...')
  execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath])

  console.log('[notarize] Submitting to Apple notarization service...')
  execFileSync('xcrun', [
    'notarytool', 'submit', zipPath,
    '--apple-id',  APPLE_ID,
    '--password',  APPLE_APP_SPECIFIC_PASSWORD,
    '--team-id',   APPLE_TEAM_ID,
    '--wait',
  ], { stdio: 'inherit' })

  console.log('[notarize] Stapling ticket...')
  execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' })

  execFileSync('rm', [zipPath])
  console.log('[notarize] Notarization complete')
}
