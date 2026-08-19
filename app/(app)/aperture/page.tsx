import type { Metadata } from 'next'
import ModuleHome from '@/components/site/ModuleHome'

// Aperture (image) is not launched — the page exists so the redirect target is
// real, and ModuleHome's platform-flags check bounces visitors to /dashboard
// until the module ships.
export const metadata: Metadata = {
  title: 'Aperture — The Design Canvas',
  robots: { index: false, follow: false },
}

export default function AperturePage() {
  return <ModuleHome moduleKey="image" />
}
