'use client'

// "Make a beat in ten seconds." Wraps the article step-grid (self-contained Web
// Audio drum machine) in the phone-first play shell, seeded with a half-built
// pattern so there's something alive to tweak immediately.

import ArticleGrid from '@/components/ArticleGrid'
import type { GridSpec } from '@/components/ArticleGrid'

const SPEC: GridSpec = {
  lanes: [
    { name: 'Kick', sound: 'kick' },
    { name: 'Snare', sound: 'snare' },
    { name: 'Hat', sound: 'hat' },
    { name: 'Clap', sound: 'clap' },
  ],
  steps: 16,
  bpm: 96,
  // A groove already going — kick on the beats, snare on 2 & 4, hats on offbeats.
  pattern: [[0, 6, 8, 14], [4, 12], [2, 6, 10, 14], []],
}

export default function PlayBuildABeat() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}>
      <ArticleGrid spec={SPEC} />
      <p style={{ fontSize: 11.5, color: '#8b8397', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
        Tap squares to add or remove hits, then press play. This is a real drum machine — running in a web page.
      </p>
    </div>
  )
}
