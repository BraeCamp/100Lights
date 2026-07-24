import type { MetadataRoute } from 'next'

// PWA manifest — makes the mobile studio installable ("Add to Home Screen") and
// is the same web app Capacitor wraps for the App Store / Play Store. Entry
// point is /m (the condensed mobile studio).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '100Lights — Music Studio',
    short_name: '100Lights',
    description: 'Make music in your browser — free. A full studio on desktop, a beat maker on your phone.',
    id: '/m',
    start_url: '/m',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0e0d12',
    theme_color: '#0e0d12',
    categories: ['music', 'entertainment', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
