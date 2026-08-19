import type { Metadata } from 'next'
import ModuleHome from '@/components/site/ModuleHome'

export const metadata: Metadata = {
  title: 'Prism — The Video Suite',
  description: 'Prism is the 100Lights video suite: multi-track timeline, color grading, captions, effects, and export — in your browser.',
  alternates: { canonical: 'https://100lights.com/prism' },
}

export default function PrismPage() {
  return <ModuleHome moduleKey="video" />
}
