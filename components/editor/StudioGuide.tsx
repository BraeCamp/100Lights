'use client'

// Live "Do it in the studio" mode for the feature tutorials. A tutorial's
// "Do it in the studio →" button links to /new?modules=audio&guide=<slug>; this
// reads the slug, pulls that tutorial's steps from lib/tutorials.ts (the SAME
// source the illustrated /tutorial page uses), and shows a step card whose
// "Show me →" buttons glow the real control via the Help system's data-help-id
// targets. Illustrated page and live guide can't drift — they share the steps.

import { useEffect, useState } from 'react'
import { highlightHelpTargets } from './daw/HelpButton'
import { getTutorial, type Tutorial } from '@/lib/tutorials'

export default function StudioGuide() {
  const [tutorial, setTutorial] = useState<Tutorial | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('guide')
    const t = k ? getTutorial(k) : undefined
    if (t) setTutorial(t)
  }, [])

  if (!tutorial || dismissed) return null

  return (
    <div style={{
      position: 'fixed', left: 16, bottom: 16, zIndex: 2400, width: 300, maxWidth: 'calc(100vw - 32px)',
      background: 'var(--bg-surface)', border: '1px solid var(--accent)', borderRadius: 12,
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)', padding: '13px 14px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', flex: 1, lineHeight: 1.3 }}>{tutorial.title}</span>
        <button onClick={() => setDismissed(true)} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 17, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {tutorial.steps.map((s, i) => (
          <li key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 9, background: 'var(--accent-subtle, rgba(139,92,246,0.16))', color: 'var(--accent-light)', fontSize: 10.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
            <span>
              {s.text}
              {s.helpId && (
                <button onClick={() => highlightHelpTargets([s.helpId!])} style={{ display: 'block', marginTop: 3, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: 0 }}>Show me →</button>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
