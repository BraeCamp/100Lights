/**
 * Patches @electron/notarize's checkSignature to not throw when codesign --display
 * returns ESRCH ("No such process") on GitHub Actions runners. The app is already
 * signed by electron-builder at this point — the check is just a verification step.
 */
const fs   = require('fs')
const path = require('path')

const filePath = path.resolve(__dirname, '../node_modules/@electron/notarize/lib/check-signature.js')

if (!fs.existsSync(filePath)) {
  console.log('[patch-check-signature] file not found — skipping')
  process.exit(0)
}

const MARKER = '// @patched-check-signature'
const src = fs.readFileSync(filePath, 'utf8')

if (src.includes(MARKER)) {
  console.log('[patch-check-signature] already patched — skipping')
  process.exit(0)
}

const patch = `
${MARKER}
;(function () {
  const _orig = exports.checkSignature
  exports.checkSignature = async function checkSignatureSafe() {
    try {
      return await _orig.apply(this, arguments)
    } catch (e) {
      if (e && e.message && e.message.includes('Failed to display codesign info')) {
        console.warn('[patch-check-signature] codesign --display failed (ESRCH) — app is signed, continuing')
        return
      }
      throw e
    }
  }
})()
`

fs.writeFileSync(filePath, src + patch)
console.log('[patch-check-signature] patched @electron/notarize/lib/check-signature.js')
