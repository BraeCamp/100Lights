'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { GraduationCap, Check, ChevronLeft, Sparkles, X } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import { PRACTICE_PATHS, type PracticeSnapshot } from '@/lib/practice-paths'
import { highlightHelpTargets } from './HelpButton'

// ── Progress persistence ────────────────────────────────────────────────────
// { [pathId]: string[] } — completed step ids. Steps are sticky: once done,
// un-doing the action (e.g. un-soloing) doesn't take the checkmark away.

const STORAGE_KEY = '100lights-practice-progress'

type Progress = Record<string, string[]>

function loadProgress(): Progress {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Progress
  } catch {
    return {}
  }
}

export default function PracticeButton() {
  const { project, view, playing, metronome } = useDaw()
  const [open, setOpen] = useState(false)
  const [activePathId, setActivePathId] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress>(() =>
    typeof window === 'undefined' ? {} : loadProgress()
  )

  const snapshot: PracticeSnapshot = useMemo(() => ({
    trackCount: project.tracks.length,
    arrangementClipCount: project.arrangementClips.length,
    sessionClipCount: Object.values(project.sessionGrid)
      .reduce((n, row) => n + (row ? row.filter(Boolean).length : 0), 0),
    playing,
    metronome,
    view,
    anySolo: project.tracks.some(t => t.solo),
    anyMute: project.tracks.some(t => t.mute),
    anyTrackEffect: project.tracks.some(t => t.effects.length > 0),
    anyArmed: project.tracks.some(t => t.armed),
  }), [project, playing, metronome, view])

  // The verifier: mark the current step of every path when its predicate
  // passes the live snapshot. Derived during render (the sanctioned
  // adjust-state-on-change pattern) so it runs while the panel is closed too —
  // doing the work first and opening Practice later still counts.
  let advanced: Progress | null = null
  for (const path of PRACTICE_PATHS) {
    const done: Set<string> = new Set((advanced ?? progress)[path.id] ?? [])
    // Only the first incomplete step can complete — paths are sequential
    const current = path.steps.find(st => !done.has(st.id))
    if (current && current.done(snapshot)) {
      done.add(current.id)
      advanced = {
        ...(advanced ?? progress),
        [path.id]: path.steps.map(st => st.id).filter(id => done.has(id)),
      }
    }
  }
  if (advanced) setProgress(advanced)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)) } catch { /* private mode */ }
  }, [progress])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (activePathId) setActivePathId(null)
        else setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, activePathId])

  const activePath = PRACTICE_PATHS.find(p => p.id === activePathId) ?? null
  const doneIds = (pathId: string) => new Set(progress[pathId] ?? [])

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        title="Practice Room — guided skill paths"
        data-help-id="practice"
        style={{
          width: 24, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer',
          background: open ? 'rgba(99,102,241,0.12)' : 'transparent',
          color: open ? 'var(--accent)' : 'var(--text-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <GraduationCap size={14} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          onClick={() => setOpen(false)}
          className="electron-nodrag"
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 460, maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 80px)',
              display: 'flex', flexDirection: 'column',
              background: '#141414', border: '1px solid #2a2a2a', borderRadius: 10,
              boxShadow: '0 16px 50px rgba(0,0,0,0.7)', overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 14px', borderBottom: '1px solid #232323', background: '#171717',
              flexShrink: 0,
            }}>
              {activePath && (
                <button
                  onClick={() => setActivePathId(null)}
                  title="All paths"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 2 }}
                >
                  <ChevronLeft size={15} />
                </button>
              )}
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                {activePath ? activePath.title : 'Practice Room'}
              </span>
              <button
                onClick={() => setOpen(false)}
                title="Close"
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#666', display: 'flex', padding: 2 }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div style={{ overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!activePath && (
                <>
                  <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 4px', lineHeight: 1.5 }}>
                    Skill paths are completed by doing, not reading — the editor watches your
                    project and checks steps off as you go.
                  </p>
                  {PRACTICE_PATHS.map(path => {
                    const done = doneIds(path.id)
                    const complete = done.size === path.steps.length
                    return (
                      <button
                        key={path.id}
                        onClick={() => setActivePathId(path.id)}
                        style={{
                          textAlign: 'left', cursor: 'pointer',
                          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
                          padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{path.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{path.tagline}</div>
                        </div>
                        <span style={{
                          fontSize: 10.5, fontWeight: 700, flexShrink: 0,
                          color: complete ? 'var(--success)' : 'var(--text-muted)',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                          {complete && <Sparkles size={11} />}
                          {done.size}/{path.steps.length}
                        </span>
                      </button>
                    )
                  })}
                </>
              )}

              {activePath && (() => {
                const done = doneIds(activePath.id)
                const currentIdx = activePath.steps.findIndex(st => !done.has(st.id))
                return activePath.steps.map((step, i) => {
                  const isDone = done.has(step.id)
                  const isCurrent = i === currentIdx
                  return (
                    <div
                      key={step.id}
                      style={{
                        display: 'flex', gap: 10, padding: '9px 11px', borderRadius: 8,
                        background: isCurrent ? 'rgba(99,102,241,0.08)' : 'transparent',
                        border: `1px solid ${isCurrent ? 'rgba(99,102,241,0.35)' : isDone ? 'transparent' : 'var(--border)'}`,
                        opacity: !isDone && !isCurrent ? 0.45 : 1,
                      }}
                    >
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: isDone ? 'var(--success)' : 'transparent',
                        border: isDone ? 'none' : `1.5px solid ${isCurrent ? 'var(--accent)' : 'var(--border-light)'}`,
                        color: '#fff', fontSize: 10, fontWeight: 700,
                      }}>
                        {isDone ? <Check size={11} /> : i + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: isDone ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                          {step.title}
                        </div>
                        {isCurrent && (
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}>
                            {step.instruction}
                          </div>
                        )}
                        {isCurrent && step.helpId && (
                          <button
                            onClick={() => { highlightHelpTargets([step.helpId!]); setOpen(false) }}
                            style={{
                              marginTop: 6, fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
                              color: 'var(--accent-light)', background: 'rgba(99,102,241,0.1)',
                              border: '1px solid rgba(99,102,241,0.3)', borderRadius: 5, padding: '3px 9px',
                            }}
                          >
                            Show me where
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
