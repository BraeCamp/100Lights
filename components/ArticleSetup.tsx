'use client'

// A "set it once" control at the top of an article: pick a tempo and key, and
// every rhythm/melody widget below follows. Purely a writer into the shared
// article state — it makes no sound itself.

import { ACCENT, Frame, Control, rangeStyle } from './article/mix-kit'
import { useArticleState, useActivateShared, NOTE_NAMES } from './article/article-state'

export default function ArticleSetup({ caption }: { caption?: string }) {
  useActivateShared()
  const { tempo, root, setTempo, setRoot } = useArticleState()

  return (
    <Frame caption={caption}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: 12 }}>
        SET THE GROOVE FOR THIS PAGE
      </div>

      <Control label="Tempo" value={`${tempo} BPM`}>
        <input type="range" min={60} max={180} step={1} value={tempo} onChange={e => setTempo(+e.target.value)} style={rangeStyle} aria-label="Tempo" />
      </Control>

      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>Key</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 5 }}>
          {NOTE_NAMES.map((n, i) => (
            <button key={n} onClick={() => setRoot(i)} style={{
              fontSize: 11.5, fontWeight: 700, padding: '7px 0', borderRadius: 7, cursor: 'pointer',
              border: `1px solid ${root === i ? ACCENT : 'var(--border)'}`,
              background: root === i ? 'rgba(167,139,250,0.18)' : 'var(--bg-card)', color: root === i ? ACCENT : 'var(--text-secondary)',
            }}>{n}</button>
          ))}
        </div>
      </div>

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>
        The beat, arpeggio, chord, and ear-training tools further down this page all use this tempo and key — change it here and they change together.
      </p>
    </Frame>
  )
}
