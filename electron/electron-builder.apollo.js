// Apollo standalone desktop build — same code, different product.
// Usage: electron-builder --config electron-builder.apollo.js --mac|--win
const base = require('./package.json').build

module.exports = {
  ...base,
  appId: 'com.100lights.apollo',
  productName: 'Apollo',
  copyright: 'Copyright \u00a9 2026 100Lights',
  // separate artifact names + update channel so the two apps never collide
  directories: { ...base.directories, output: '../dist-electron-apollo' },
  mac: {
    ...base.mac,
    icon: '../build/icons/apollo.icns', // TODO: dedicated Apollo icon (falls back to default if missing)
  },
}
