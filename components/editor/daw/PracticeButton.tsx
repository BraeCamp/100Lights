'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GraduationCap, Check, ChevronLeft, ChevronDown, ChevronUp, Sparkles, X, Lock, RotateCcw, Play } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import type { PolyInstrumentParams } from '@/lib/daw-types'
import { PRACTICE_PATHS, PRACTICE_CATEGORY_ORDER, type PracticeSnapshot } from '@/lib/practice-paths'
import { PRACTICE_RECIPES, buildRecipeClip, type PracticeRecipe } from '@/lib/practice-recipes'
import { PRACTICE_SONGS, buildSongClip, songTrackName, type PracticeSong, type SongPart } from '@/lib/practice-songs'
import { highlightHelpTargets } from './HelpButton'
import { usePlan } from '@/hooks/usePlan'
import { useUITierOptional } from '../UITierProvider'
import { useUpgradeModal } from '@/components/UpgradeModal'
import { lessonVisibleInMode, lessonRequiresPro, type UITier } from '@/lib/ui-tiers'

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
  const { project, view, playing, recording, metronome, expandedPianoRollClipId, expandedStepSeqClipId, dispatch, setView, setSelectedTrackId, setExpandedPianoRollClipId } = useDaw()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'paths' | 'songs' | 'recipes'>('paths')
  const [activePathId, setActivePathId] = useState<string | null>(null)
  const [activeSongId, setActiveSongId] = useState<string | null>(null)
  const [loadedRecipe, setLoadedRecipe] = useState<PracticeRecipe | null>(null)
  const [openDetail, setOpenDetail] = useState<string | null>(null)   // lesson step id whose "Learn more" is expanded

  // Lessons follow the UI tier: each is offered in its studio mode and up, and
  // only Simplified (beginner) lessons are free — Standard/Everything need Pro.
  const { isPro } = usePlan()
  const { showUpgrade } = useUpgradeModal()
  const mode: UITier = useUITierOptional()?.tier ?? 'full'
  const lessonTier = (t?: UITier): UITier => t ?? 'beginner'
  const inMode = <T extends { tier?: UITier }>(items: readonly T[]): T[] =>
    items.filter(i => lessonVisibleInMode(lessonTier(i.tier), mode))
  const lockedFor = (t?: UITier): boolean => !isPro && lessonRequiresPro(lessonTier(t))
  const proNudge = () => showUpgrade('Standard and Everything lessons are a Pro feature — the Simplified lessons are always free.')
  const visiblePaths = inMode(PRACTICE_PATHS)
  const visibleSongs = inMode(PRACTICE_SONGS)
  const visibleRecipes = inMode(PRACTICE_RECIPES)

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
    // Always builds the full set — so a song lesson can be run again after use
    // (a repeat build adds fresh tracks; undo removes them).
    for (const part of song.parts) loadSongPart(song, part)
  }
  const [progress, setProgress] = useState<Progress>(() =>
    typeof window === 'undefined' ? {} : loadProgress()
  )
  // Per-path baseline of the project state, captured when the session starts
  // (and reset on "Restart this path"). A step only auto-completes on a genuine
  // false→true transition SINCE this baseline — i.e. an action you actually take
  // while using the app — so pre-existing project state (tracks/effects/notes you
  // already had) no longer marks lessons "seen" that you never did.
  const baseline = useRef<Record<string, PracticeSnapshot>>({})
  const baselineInit = useRef(false)

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
    // Beginner basics
    recording,
    loopEnabled: project.loopEnabled,
    stepSeqOpen: expandedStepSeqClipId != null,
    anyVolumeChanged: project.tracks.some(t => Math.abs(t.volume - 0.8) > 0.02),
  }), [project, playing, recording, metronome, view, expandedPianoRollClipId, expandedStepSeqClipId])

  // Capture the starting state once, so anything already true at load is the
  // baseline (not a "completed" step).
  if (!baselineInit.current) {
    baselineInit.current = true
    for (const p of PRACTICE_PATHS) baseline.current[p.id] = snapshot
  }

  // The verifier: complete the current step of a path only when its predicate
  // goes from NOT satisfied at the baseline to satisfied now — i.e. you did the
  // action during this session. Derived during render (the sanctioned
  // adjust-state-on-change pattern) so it runs while the panel is closed too.
  let advanced: Progress | null = null
  for (const path of PRACTICE_PATHS) {
    const base = baseline.current[path.id] ?? snapshot
    const done: Set<string> = new Set((advanced ?? progress)[path.id] ?? [])
    // Only the first incomplete step can complete — paths are sequential
    const current = path.steps.find(st => !done.has(st.id))
    if (current && current.done(snapshot) && !current.done(base)) {
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
        title="Lessons — guided skill paths, song builds & recipes"
        data-help-id="practice"
        style={{
          height: 24, padding: '0 9px', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`,
          background: open ? 'rgb(var(--accent-rgb) / 0.12)' : 'transparent',
          color: open ? 'var(--accent)' : 'var(--text-secondary)',
          display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700,
        }}
      >
        <GraduationCap size={13} /> Lessons
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
              {(activePath || activeSong || loadedRecipe) && (
                <button
                  onClick={() => { setActivePathId(null); setActiveSongId(null); setLoadedRecipe(null) }}
                  title={activeSong ? 'All songs' : loadedRecipe ? 'All recipes' : 'All paths'}
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
                  }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ChevronLeft size={12} /> All recipes</span></button>
                </>
              )}

              {!activePath && tab === 'recipes' && !loadedRecipe && (
                <>
                  <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 4px', lineHeight: 1.5 }}>
                    Small annotated constructions — load one into your project and pull it apart in the piano roll.
                  </p>
                  {visibleRecipes.length === 0 && <LessonsEmpty />}
                  {visibleRecipes.map(r => {
                    const locked = lockedFor(r.tier)
                    return (
                    <div key={r.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>{r.title}{locked && <ProTag />}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{r.tagline}</div>
                      </div>
                      <button onClick={() => locked ? proNudge() : loadRecipe(r)} style={{
                        flexShrink: 0, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                        color: locked ? 'var(--accent-light)' : 'var(--accent-contrast)', background: locked ? 'var(--accent-subtle)' : 'var(--accent)', border: locked ? '1px solid rgba(139,92,246,0.35)' : 'none', borderRadius: 5, padding: '5px 12px',
                      }}>{locked ? 'Unlock' : 'Load'}</button>
                    </div>
                    )
                  })}
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
                  {visibleSongs.length === 0 && <LessonsEmpty />}
                  {visibleSongs.map(song => {
                    const loaded = song.parts.filter(p => project.tracks.some(t => t.name === songTrackName(song, p))).length
                    const locked = lockedFor(song.tier)
                    return (
                      <button key={song.id} onClick={() => locked ? proNudge() : setActiveSongId(song.id)} style={{
                        textAlign: 'left', cursor: 'pointer',
                        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
                        padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                      }}>
                        <span style={{
                          fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
                          color: '#fff', background: GENRE_COLOR[song.genre], borderRadius: 4, padding: '3px 6px', flexShrink: 0,
                        }}>{song.genre}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>{song.title}{locked && <ProTag />}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{song.tagline}</div>
                        </div>
                        <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10.5, fontWeight: 700, flexShrink: 0, color: loaded === song.parts.length ? 'var(--success)' : 'var(--text-muted)' }}>
                          {locked ? <Lock size={11} /> : `${loaded}/${song.parts.length}`}
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
                      <button onClick={() => loadWholeSong(activeSong)} style={{
                        marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                        color: 'var(--accent-contrast)', background: 'var(--accent)',
                        border: 'none', borderRadius: 5, padding: '5px 12px',
                      }}>{allIn ? 'Build again' : 'Build whole song'}</button>
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
                              <button onClick={() => loadSongPart(activeSong, part)} style={{
                                fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                                color: isDone ? 'var(--text-secondary)' : 'var(--accent-contrast)',
                                background: isDone ? 'var(--bg-card)' : 'var(--accent)',
                                border: isDone ? '1px solid var(--border)' : 'none', borderRadius: 5, padding: '4px 11px',
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                              }}>{isDone ? <><RotateCcw size={12} /> Add again</> : 'Add this part'}</button>
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
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}><Play size={12} /> Play it</button>
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
                  {visiblePaths.length === 0 && <LessonsEmpty />}
                  {PRACTICE_CATEGORY_ORDER.map(cat => {
                    const paths = visiblePaths.filter(p => p.category === cat)
                    if (paths.length === 0) return null
                    return (
                      <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 4 }}>
                          {cat}
                        </div>
                        {paths.map(path => {
                          const done = doneIds(path.id)
                          const complete = done.size === path.steps.length
                          const locked = lockedFor(path.tier)
                          return (
                            <button
                              key={path.id}
                              onClick={() => locked ? proNudge() : setActivePathId(path.id)}
                              style={{
                                textAlign: 'left', cursor: 'pointer',
                                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
                                padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>{path.title}{locked && <ProTag />}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{path.tagline}</div>
                              </div>
                              <span style={{
                                fontSize: 10.5, fontWeight: 700, flexShrink: 0,
                                color: complete ? 'var(--success)' : 'var(--text-muted)',
                                display: 'flex', alignItems: 'center', gap: 4,
                              }}>
                                {locked ? <Lock size={11} /> : <>{complete && <Sparkles size={11} />}{done.size}/{path.steps.length}</>}
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
                return (
                <>
                {activePath.steps.map((step, i) => {
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
                        {isCurrent && step.detail && (
                          <div style={{ marginTop: 4 }}>
                            <button
                              onClick={() => setOpenDetail(openDetail === step.id ? null : step.id)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, cursor: 'pointer', color: 'var(--text-muted)', background: 'none', border: 'none', padding: 0 }}
                            >
                              {openDetail === step.id ? <>Hide detail <ChevronUp size={12} /></> : <>Learn more <ChevronDown size={12} /></>}
                            </button>
                            {openDetail === step.id && (
                              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.55, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px' }}>
                                {step.detail}
                              </div>
                            )}
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
                })}
                {done.size > 0 && (
                  <button
                    onClick={() => {
                      // Re-baseline this path to the current state so clearing
                      // progress doesn't instantly re-complete already-satisfied
                      // steps — only new actions count from here.
                      baseline.current[activePath.id] = snapshot
                      setProgress(p => { const n = { ...p }; delete n[activePath.id]; return n })
                    }}
                    title="Clear this path's progress so you can run it again"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, alignSelf: 'flex-start', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', color: 'var(--text-secondary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 12px' }}
                  >
                    <RotateCcw size={12} /> Restart this path
                  </button>
                )}
                </>
                )
              })()}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

/** Small "PRO" chip for lessons above the free (Simplified) tier. */
function ProTag() {
  return (
    <span style={{
      flexShrink: 0, fontSize: 8.5, fontWeight: 800, letterSpacing: '0.04em',
      color: 'var(--accent-light)', background: 'var(--accent-subtle)',
      border: '1px solid rgba(139,92,246,0.35)', borderRadius: 4, padding: '1px 4px', lineHeight: 1.4,
    }}>PRO</span>
  )
}

/** Empty state for a lessons tab with nothing in the current mode. */
function LessonsEmpty() {
  return (
    <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 8px', lineHeight: 1.5 }}>
      No lessons here yet — new ones are on the way.
    </div>
  )
}
