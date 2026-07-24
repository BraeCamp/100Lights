'use client'

// Guided landing for article CTAs. When an article button deep-links into the
// studio for a SPECIFIC task — e.g. `@studio(/new?modules=audio&guide=blind-test)`
// — this reads the `guide` param and shows a small step card so the visitor
// isn't dropped into a blank project with no idea what to do. Each step can glow
// the relevant control through the Help system's data-help-id targets.
//
// To guide a new article button: add an entry to GUIDES keyed by a short slug,
// then point that article's @studio marker at `/new?modules=audio&guide=<slug>`.
// helpIds are data-help-id values (see components/editor/daw/HelpButton.tsx).

import { useEffect, useState } from 'react'
import { highlightHelpTargets } from './daw/HelpButton'

interface Step { text: string; helpIds?: string[] }
interface Guide { title: string; steps: Step[] }

const GUIDES: Record<string, Guide> = {
  'blind-test': {
    title: 'Run a blind listening test',
    steps: [
      { text: 'Open the Sound Library (or press B) and drag a loop onto a track.', helpIds: ['sound-library'] },
      { text: 'Add an effect to that track — an EQ, reverb, or a compressor — in the device chain.', helpIds: ['add-device'] },
      { text: "Toggle the effect's Bypass on and off. Don't look — just listen." },
      { text: 'Commit to a guess before you check which one was on. That gap is the whole training.' },
    ],
  },
}

export default function StudioGuide() {
  const [key, setKey] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('guide')
    if (k && GUIDES[k]) setKey(k)
  }, [])

  if (!key || dismissed) return null
  const guide = GUIDES[key]

  return (
    <div style={{
      position: 'fixed', left: 16, bottom: 16, zIndex: 2400, width: 300, maxWidth: 'calc(100vw - 32px)',
      background: 'var(--bg-surface)', border: '1px solid var(--accent)', borderRadius: 12,
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)', padding: '13px 14px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', flex: 1, lineHeight: 1.3 }}>{guide.title}</span>
        <button onClick={() => setDismissed(true)} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 17, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {guide.steps.map((s, i) => (
          <li key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 9, background: 'var(--accent-subtle, rgba(139,92,246,0.16))', color: 'var(--accent-light)', fontSize: 10.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
            <span>
              {s.text}
              {s.helpIds && (
                <button onClick={() => highlightHelpTargets(s.helpIds!)} style={{ display: 'block', marginTop: 3, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: 0 }}>Show me →</button>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
