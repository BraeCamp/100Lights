'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { GraduationCap, Check, ChevronLeft, Sparkles, X } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import type { PolyInstrumentParams } from '@/lib/daw-types'
import { PRACTICE_PATHS, PRACTICE_CATEGORY_ORDER, type PracticeSnapshot } from '@/lib/practice-paths'
import { PRACTICE_RECIPES, buildRecipeClip, type PracticeRecipe } from '@/lib/practice-recipes'
import { PRACTICE_SONGS, buildSongClip, songTrackName, type PracticeSong, type SongPart } from '@/lib/practice-songs'
import { highlightHelpTargets } from './HelpButton'

const GENRE_COLOR: Record<PracticeSong['genre'], string> = { Pop: '#ec4899', Rock: '#f59e0b', Metal: '#ef4444' }

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
  const { project, view, playing, metronome, expandedPianoRollClipId, dispatch, setView, setSelectedTrackId, setExpandedPianoRollClipId } = useDaw()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'paths' | 'songs' | 'recipes'>('paths')
  const [activePathId, setActivePathId] = useState<string | null>(null)
  const [activeSongId, setActiveSongId] = useState<string | null>(null)
  const [loadedRecipe, setLoadedRecipe] = useState<PracticeRecipe | null>(null)

  // Load a recipe: fresh track + annotated clip appended to the real project,
  // then open it in the piano roll for study.
  function loadRecipe(recipe: PracticeRecipe) {
    const spec = recipe.build()
    const trackId = crypto.randomUUID()
    dispatch({ type: 'ADD_TRACK', id: trackId, name: spec.trackName, instrument: spec.instrument })
    const clip = buildRecipeClip(recipe, trackId, 0)
    dispatch({ type: 'ADD_CLIP', clip })
    setView('arrangement')
    setSelectedTrackId(trackId)
    setExpandedPianoRollClipId(clip.id)
    setLoadedRecipe(recipe)
  }

  // Load one song part onto its own track at beat 0, so parts stack and play
  // together. The first part sets the song's tempo.
  function loadSongPart(song: PracticeSong, part: SongPart) {
    if (project.tempo !== song.tempo) dispatch({ type: 'SET_TEMPO', tempo: song.tempo })
    const trackId = crypto.randomUUID()
    dispatch({ type: 'ADD_TRACK', id: trackId, name: songTrackName(song, part), instrument: part.build().instrument })
    dispatch({ type: 'ADD_CLIP', clip: buildSongClip(part, trackId) })
    setView('arrangement')
    setSelectedTrackId(trackId)
  }

  function loadWholeSong(song: PracticeSong) {
    for (const part of song.parts) {
      if (!project.tracks.some(t => t.name === songTrackName(song, part))) loadSongPart(song, part)
    }
  }
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
    midiClipCount: project.arrangementClips.filter(c => c.kind === 'midi').length,
    maxClipNotes: Math.max(0, ...project.arrangementClips.map(c => (c.kind === 'midi' ? c.notes.length : 0))),
    pianoRollOpen: expandedPianoRollClipId != null,
    anyPolyTrack: project.tracks.some(t => t.instrument.type === 'poly'),
    polyMaxNotes: Math.max(0, ...project.arrangementClips.map(c => {
      if (c.kind !== 'midi') return 0
      const t = project.tracks.find(tr => tr.id === c.trackId)
      return t?.instrument.type === 'poly' ? c.notes.length : 0
    })),
    anyPolyBright: project.tracks.some(t => t.instrument.type === 'poly' && (t.instrument.params as PolyInstrumentParams).filterCutoff >= 3000),
    anyPolyPad: project.tracks.some(t => t.instrument.type === 'poly' && (t.instrument.params as PolyInstrumentParams).attack >= 0.5),
    returnCount: project.returnTracks.length,
    anySend: project.tracks.some(t => t.sendAmounts != null && Object.values(t.sendAmounts).some(v => v > 0)),
    anyReturnEffect: project.returnTracks.some(r => r.effects.length > 0),
  }), [project, playing, metronome, view, expandedPianoRollClipId])

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
        else if (activeSongId) setActiveSongId(null)
        else setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, activePathId, activeSongId])

  const activePath = PRACTICE_PATHS.find(p => p.id === activePathId) ?? null
  const activeSong = PRACTICE_SONGS.find(s => s.id === activeSongId) ?? null
  const doneIds = (pathId: string) => new Set(progress[pathId] ?? [])

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        title="Practice Room — guided skill paths"
        data-help-id="practice"
        style={{
          width: 24, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer',
          background: open ? 'rgb(var(--accent-rgb) / 0.12)' : 'transparent',
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
              background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10,
              boxShadow: '0 16px 50px rgba(0,0,0,0.7)', overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
              flexShrink: 0,
            }}>
              {(activePath || activeSong) && (
                <button
                  onClick={() => { setActivePathId(null); setActiveSongId(null) }}
                  title={activeSong ? 'All songs' : 'All paths'}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 2 }}
                >
                  <ChevronLeft size={15} />
                </button>
              )}
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                {activePath ? activePath.title : activeSong ? activeSong.title : loadedRecipe && tab === 'recipes' ? loadedRecipe.title : 'Practice Room'}
              </span>
              {!activePath && !activeSong && !loadedRecipe && (
                <span style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                  {(['paths', 'songs', 'recipes'] as const).map(t => (
                    <button key={t} onClick={() => setTab(t)} style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 9px', borderRadius: 4, cursor: 'pointer',
                      background: tab === t ? 'var(--bg-card)' : 'transparent',
                      border: tab === t ? '1px solid var(--border)' : '1px solid transparent',
                      color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
                      textTransform: 'capitalize',
                    }}>{t}</button>
                  ))}
                </span>
              )}
              <button
                onClick={() => setOpen(false)}
                title="Close"
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 2 }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div style={{ overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!activePath && tab === 'recipes' && loadedRecipe && (
                <>
                  <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '0 0 2px', lineHeight: 1.5 }}>
                    Loaded into your project and opened in the piano roll. What to notice:
                  </p>
                  {loadedRecipe.annotation.map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, padding: '7px 10px', borderRadius: 7, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--accent-light)', fontWeight: 700, fontSize: 11, flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{a}</span>
                    </div>
                  ))}
                  <button onClick={() => setLoadedRecipe(null)} style={{
                    marginTop: 4, fontSize: 10.5, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start',
                    color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 9px',
                  }}>← All recipes</button>
                </>
              )}

              {!activePath && tab === 'recipes' && !loadedRecipe && (
                <>
                  <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 4px', lineHeight: 1.5 }}>
                    Small annotated constructions — load one into your project and pull it apart in the piano roll.
                  </p>
                  {PRACTICE_RECIPES.map(r => (
                    <div key={r.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{r.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{r.tagline}</div>
                      </div>
                      <button onClick={() => loadRecipe(r)} style={{
                        flexShrink: 0, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                        color: 'var(--accent-contrast)', background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '5px 12px',
                      }}>Load</button>
                    </div>
                  ))}
                  <a href="/community?kind=recipe" target="_blank" rel="noreferrer" style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textDecoration: 'none',
                    padding: '8px 12px', textAlign: 'center',
                  }}>
                    Find more recipes in Community ↗
                  </a>
                </>
              )}

              {/* Songs — pick a genre, then build a full section part by part */}
              {!activePath && !activeSong && tab === 'songs' && (
                <>
                  <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 4px', lineHeight: 1.5 }}>
                    Build a full song section, part by part, in your own project. Pick the kind of music you want to make.
                  </p>
                  {PRACTICE_SONGS.map(song => {
                    const loaded = song.parts.filter(p => project.tracks.some(t => t.name === songTrackName(song, p))).length
                    return (
                      <button key={song.id} onClick={() => setActiveSongId(song.id)} style={{
                        textAlign: 'left', cursor: 'pointer',
                        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
                        padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                      }}>
                        <span style={{
                          fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
                          color: '#fff', background: GENRE_COLOR[song.genre], borderRadius: 4, padding: '3px 6px', flexShrink: 0,
                        }}>{song.genre}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{song.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{song.tagline}</div>
                        </div>
                        <span style={{ fontSize: 10.5, fontWeight: 700, flexShrink: 0, color: loaded === song.parts.length ? 'var(--success)' : 'var(--text-muted)' }}>
                          {loaded}/{song.parts.length}
                        </span>
                      </button>
                    )
                  })}
                </>
              )}

              {activeSong && (() => {
                const doneCount = activeSong.parts.filter(p => project.tracks.some(t => t.name === songTrackName(activeSong, p))).length
                const allIn = doneCount === activeSong.parts.length
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 2px' }}>
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#fff', background: GENRE_COLOR[activeSong.genre], borderRadius: 4, padding: '3px 6px' }}>{activeSong.genre}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{activeSong.tempo} BPM · {activeSong.parts.length} parts</span>
                      <button onClick={() => loadWholeSong(activeSong)} disabled={allIn} style={{
                        marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, cursor: allIn ? 'default' : 'pointer',
                        color: allIn ? 'var(--text-muted)' : 'var(--accent-contrast)', background: allIn ? 'transparent' : 'var(--accent)',
                        border: allIn ? '1px solid var(--border)' : 'none', borderRadius: 5, padding: '5px 12px', opacity: allIn ? 0.6 : 1,
                      }}>{allIn ? 'All parts in' : 'Build whole song'}</button>
                    </div>
                    <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '0 0 4px', lineHeight: 1.5 }}>{activeSong.tagline}</p>
                    {activeSong.parts.map((part, i) => {
                      const isDone = project.tracks.some(t => t.name === songTrackName(activeSong, part))
                      return (
                        <div key={part.id} style={{
                          display: 'flex', gap: 10, padding: '9px 11px', borderRadius: 8,
                          background: isDone ? 'transparent' : 'var(--bg-card)',
                          border: `1px solid ${isDone ? 'transparent' : 'var(--border)'}`,
                        }}>
                          <div style={{
                            width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: isDone ? 'var(--success)' : 'transparent',
                            border: isDone ? 'none' : '1.5px solid var(--border-light)',
                            color: '#fff', fontSize: 10, fontWeight: 700,
                          }}>
                            {isDone ? <Check size={11} /> : i + 1}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: isDone ? 'var(--text-muted)' : 'var(--text-primary)' }}>{part.title}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}>{part.instruction}</div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                              {!isDone && (
                                <button onClick={() => loadSongPart(activeSong, part)} style={{
                                  fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                                  color: 'var(--accent-contrast)', background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '4px 11px',
                                }}>Add this part</button>
                              )}
                              {part.helpId && (
                                <button onClick={() => { highlightHelpTargets([part.helpId!]); setOpen(false) }} style={{
                                  fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
                                  color: 'var(--accent-light)', background: 'rgb(var(--accent-rgb) / 0.1)',
                                  border: '1px solid rgb(var(--accent-rgb) / 0.3)', borderRadius: 5, padding: '4px 9px',
                                }}>Show me where</button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {allIn && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, padding: '9px 11px', borderRadius: 8, background: 'rgb(var(--accent-rgb) / 0.08)', border: '1px solid rgb(var(--accent-rgb) / 0.3)' }}>
                        <Sparkles size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.4, flex: 1 }}>
                          Your {activeSong.genre.toLowerCase()} track is built. Press Play to hear it, then make it yours — mute parts, tweak sounds, add effects.
                        </span>
                        <button onClick={() => { highlightHelpTargets(['play']); setOpen(false) }} style={{
                          flexShrink: 0, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                          color: 'var(--accent-contrast)', background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '5px 12px',
                        }}>▶ Play it</button>
                      </div>
                    )}
                  </>
                )
              })()}

              {!activePath && tab === 'paths' && (
                <>
                  <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 4px', lineHeight: 1.5 }}>
                    Skill paths are completed by doing, not reading — the editor watches your
                    project and checks steps off as you go.
                  </p>
                  {PRACTICE_CATEGORY_ORDER.map(cat => {
                    const paths = PRACTICE_PATHS.filter(p => p.category === cat)
                    if (paths.length === 0) return null
                    return (
                      <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 4 }}>
                          {cat}
                        </div>
                        {paths.map(path => {
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
                      </div>
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
                        background: isCurrent ? 'rgb(var(--accent-rgb) / 0.08)' : 'transparent',
                        border: `1px solid ${isCurrent ? 'rgb(var(--accent-rgb) / 0.35)' : isDone ? 'transparent' : 'var(--border)'}`,
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
                              color: 'var(--accent-light)', background: 'rgb(var(--accent-rgb) / 0.1)',
                              border: '1px solid rgb(var(--accent-rgb) / 0.3)', borderRadius: 5, padding: '3px 9px',
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
