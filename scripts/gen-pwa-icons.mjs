// Generate the PWA / app-store icon PNGs from the brand mark (app/icon.svg).
// Run: node scripts/gen-pwa-icons.mjs
import sharp from 'sharp'

const BOLT = 'M7 18a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 16 14h9a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 16 18z'
// Standard icon: rounded violet square + bolt (matches favicon).
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="#8b5cf6"/><path d="${BOLT}" fill="white"/></svg>`
// Maskable: full-bleed violet (the OS mask makes the shape) with the bolt in the safe area.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#8b5cf6"/><g transform="translate(23 23) scale(1.72)"><path d="${BOLT}" fill="white"/></g></svg>`

await sharp(Buffer.from(icon)).resize(192, 192).png().toFile('public/icon-192.png')
await sharp(Buffer.from(icon)).resize(512, 512).png().toFile('public/icon-512.png')
await sharp(Buffer.from(icon)).resize(180, 180).png().toFile('public/apple-touch-icon.png')
await sharp(Buffer.from(maskable)).resize(512, 512).png().toFile('public/icon-maskable-512.png')
console.log('PWA icons written to public/: icon-192, icon-512, apple-touch-icon, icon-maskable-512')
