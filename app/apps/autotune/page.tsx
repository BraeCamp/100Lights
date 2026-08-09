import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const Autotune = dynamic(() => import('@/components/apps/Autotune'))

export const metadata: Metadata = {
  title: 'Autotune — Record Your Voice and Pitch-Correct It in Your Browser',
  description: 'Record your voice, pitch-correct it to any key and scale, then compare original vs corrected and download the result. Free, all in your browser. No download, nothing uploaded.',
  alternates: { canonical: 'https://100lights.com/apps/autotune' },
  openGraph: {
    title: 'Autotune — 100Lights',
    description: 'Sing a line and hear it snapped to your chosen key and scale. Original vs corrected A/B, adjustable strength, WAV download. Free, in your browser.',
    url: 'https://100lights.com/apps/autotune',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function AutotunePage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <main id="main" className="max-w-2xl mx-auto px-6 py-14">
        <header style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.02em' }}>
            Autotune
          </h1>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0 }}>
            Record your voice, pick a key and scale, and hear it pitch-corrected to the nearest notes.
            Compare the original with the corrected take, dial the strength from subtle to hard-tuned,
            and download the result as a WAV.
          </p>
        </header>

        <Autotune />

        <div style={{ marginTop: 26, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>How to use it</h2>
          <p style={{ margin: '0 0 10px' }}>
            Choose the <strong>key</strong> and <strong>scale</strong> your part is in. Hit
            {' '}<strong>Record</strong> and sing — the detected note shows live as you go. Hit
            {' '}<strong>Stop</strong> and your take is corrected automatically. Play
            {' '}<strong>Original</strong> vs <strong>Corrected</strong> to compare, then move the
            {' '}<strong>Strength</strong> slider: 0% leaves your voice untouched, 100% snaps fully to
            the scale. Lower values keep it natural; higher values give the hard-tuned effect.
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
            Everything runs entirely in your browser — nothing is recorded to a server or uploaded.
          </p>
        </div>
      </main>
    </div>
  )
}
