const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env
  if (!APPLE_ID) {
    console.log('Skipping notarization — APPLE_ID not set')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  // Verify signing before submitting
  try {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' })
    console.log('Code signature verified:', appPath)
  } catch (err) {
    console.log('App is not signed — skipping notarization')
    return
  }

  // Zip the .app for submission (notarytool requires a zip, pkg, or dmg)
  const zipPath = path.join(context.appOutDir, `${appName}.zip`)
  console.log('Creating ZIP for notarytool submission...')
  execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath])

  // Submit to Apple and wait for approval
  console.log('Submitting to Apple notarization service...')
  execFileSync('xcrun', [
    'notarytool', 'submit', zipPath,
    '--apple-id',  APPLE_ID,
    '--password',  APPLE_APP_SPECIFIC_PASSWORD,
    '--team-id',   APPLE_TEAM_ID,
    '--wait',
  ], { stdio: 'inherit' })

  // Staple the ticket to the .app so it works offline
  console.log('Stapling notarization ticket...')
  execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' })

  execFileSync('rm', [zipPath])
  console.log('Notarization complete')
}
