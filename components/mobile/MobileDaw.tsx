'use client'

// Mobile DAW shell — a phone layout around the REAL desktop feature components
// (ArrangementView, Mixer, SessionView, InstrumentPicker, DeviceChain, PadInput,
// SoundLibrary, PolyCode), all driven by the shared DawContext. We change the
// layout, not the functions.
//
// Layout: hamburger drawer (Home / projects / Clips-live / Sound library / Code),
// a slim transport, a Song | Mix | Sounds bottom nav (Clips lives in the drawer
// since it's the live view), and a full-screen per-track Sounds editor.

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import posthog from 'posthog-js'
import { Menu, Home, FolderOpen, Plus, LayoutGrid, X } from 'lucide-react'
import { useUser } from '@clerk/nextjs'
import { MobileDawProvider } from './MobileDawProvider'
import { ForceMobileContext } from '@/lib/use-is-mobile'
import { useDaw, makeMidiClip, migrateProject } from '@/lib/daw-state'
import { projectToCfFile } from './daw/save-project'
import { drumInstrument, polyInstrument, seedProject } from './daw/seed'
import { MOBILE_TEMPLATES, buildTemplate, templateLabel, type MobileTemplate } from './daw/templates'
import { MobileTransport } from './daw/MobileTransport'
import ArrangementView from '@/components/editor/daw/ArrangementView'
import Mixer from '@/components/editor/daw/Mixer'
import SessionView from '@/components/editor/daw/SessionView'
import InstrumentPicker from '@/components/editor/daw/InstrumentPicker'
import DeviceChain from '@/components/editor/daw/DeviceChain'
import PadInput from '@/components/editor/daw/PadInput'
import ChordPad from './daw/ChordPad'
import SoundLibraryPanel from '@/components/editor/SoundLibrary'
import PolyCodePanel from '@/components/editor/daw/PolyCodePanel'
import type { DawProject, TrackInstrument } from '@/lib/daw-types'

const PianoRoll = dynamic(() => import('@/components/editor/daw/PianoRoll'), { ssr: false })
const StepSequencer = dynamic(() => import('@/components/editor/daw/StepSequencer'), { ssr: false })

export default function MobileDaw({ projectId }: { projectId?: string }) {
  const [loaded, setLoaded] = useState<DawProject | null>(projectId ? null : seedProject())
  const [error, setError] = useState(false)
  // New projects open on a "start from a beat" chooser so the studio never
  // starts blank; picking a genre loads a playable template.
  const [chooserDone, setChooserDone] = useState(false)

  useEffect(() => {
    if (!projectId) return
    let alive = true
    fetch(`/api/projects/${projectId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then((cf: { name?: string; dawProject?: DawProject }) => {
        if (!alive) return
        const dp = cf?.dawProject ? migrateProject(cf.dawProject) : seedProject()
        if (cf?.name) dp.name = cf.name
        setLoaded(dp)
      })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [projectId])

  if (error) return <FullMsg><>Couldn&apos;t load this project. <Link href="/dashboard" style={{ color: 'var(--accent-light)' }}>Back to projects →</Link></></FullMsg>
  if (!loaded) return <FullMsg>Loading project…</FullMsg>

  if (!projectId && !chooserDone) {
    return (
      <TemplateChooser
        onPick={t => { setLoaded(buildTemplate(t)); setChooserDone(true) }}
        onBlank={() => { setLoaded(seedProject()); setChooserDone(true) }}
      />
    )
  }

  return (
    // Force mobile layout for everything inside the mobile studio, so the shared
    // Mixer / ArrangementView / PadInput render their touch UI even when the
    // window is wide (desktop, tablet) — not just under the 760px width check.
    <ForceMobileContext.Provider value={true}>
      <MobileDawProvider key={projectId ?? 'new'} initialProject={loaded}>
        <Shell projectId={projectId} />
      </MobileDawProvider>
    </ForceMobileContext.Provider>
  )
}

function FullMsg({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>{children}</div>
}

// One-time gesture hints — discoverability is the biggest touch-DAW battle.
function CoachMarks() {
  const [show, setShow] = useState(false)
  useEffect(() => { try { if (!localStorage.getItem('100lights-mobile-coach')) setShow(true) } catch { /* ok */ } }, [])
  if (!show) return null
  const dismiss = () => { try { localStorage.setItem('100lights-mobile-coach', '1') } catch { /* ok */ } setShow(false) }
  const tips: [string, string][] = [
    ['🎵', 'Song: double-tap the empty lane to play/stop; drag it sideways to scrub.'],
    ['🤏', 'Two fingers on the timeline pan; pinch to zoom the whole song.'],
    ['✏️', 'Double-tap a clip to open its beat grid or piano roll.'],
    ['🎛️', 'Sounds tab: pick an instrument, add FX, or tap Chords for in-key chords.'],
    ['🎲', 'In a beat, hit 🎲 or Smart to generate a groove instantly.'],
    ['⚡', 'Hold a ⚡ FX pad for a live filter/duck; ↩ undoes (hold to redo).'],
  ]
  return (
    <div onClick={dismiss} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', padding: '18px 18px calc(20px + env(safe-area-inset-bottom))' }}>
        <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800 }}>Quick tips 👋</p>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--text-muted)' }}>A few gestures so the studio feels fast on your phone.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 16 }}>
          {tips.map(([emoji, t]) => (
            <div key={t} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 18, lineHeight: 1.2, flexShrink: 0 }}>{emoji}</span>
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{t}</span>
            </div>
          ))}
        </div>
        <button onClick={dismiss} style={{ width: '100%', padding: '13px 0', borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 800, background: 'var(--accent)', color: '#fff' }}>Got it</button>
      </div>
    </div>
  )
}

// "Start from a beat" — a new project opens here so it's never a blank timeline.
function TemplateChooser({ onPick, onBlank }: { onPick: (t: MobileTemplate) => void; onBlank: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-base)', color: 'var(--text-primary)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: 'calc(28px + env(safe-area-inset-top)) 18px calc(28px + env(safe-area-inset-bottom))' }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent-light)' }}>New project</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '8px 0 4px', letterSpacing: '-0.02em' }}>Start from a beat</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '0 0 20px' }}>Pick a groove to jam on — press play and it&apos;s already a song. You can change everything.</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {MOBILE_TEMPLATES.map(t => (
            <button key={t.id} onClick={() => onPick(t)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, padding: '15px 14px', borderRadius: 14, cursor: 'pointer', textAlign: 'left', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
              <span style={{ fontSize: 26, lineHeight: 1 }}>{t.emoji}</span>
              <span style={{ fontSize: 15, fontWeight: 800 }}>{t.name}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t.blurb}</span>
              <span style={{ fontSize: 10.5, color: 'var(--accent-light)', fontWeight: 600, marginTop: 2 }}>{templateLabel(t).split(' · ').slice(1).join(' · ')}</span>
            </button>
          ))}
        </div>

        <button onClick={onBlank}
          style={{ width: '100%', marginTop: 14, padding: '13px 0', borderRadius: 12, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>
          Start blank
        </button>
      </div>
    </div>
  )
}

type Tab = 'song' | 'mix' | 'sounds' | 'clips'
const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: 'song', label: 'Song', icon: '☰' },
  { id: 'mix', label: 'Mix', icon: '🎚️' },
  { id: 'sounds', label: 'Sounds', icon: '🎛️' },
]

function Shell({ projectId }: { projectId?: string }) {
  const { project, dispatch, setSelectedTrackId, expandedPianoRollClipId, expandedStepSeqClipId } = useDaw()
  const { isSignedIn } = useUser()
  const [tab, setTab] = useState<Tab>('song')

  // Double-tapping a clip in the Song timeline opens its editor (piano roll /
  // beat) — on mobile that lives in the Sounds tab, so jump there when one opens.
  const editingClip = expandedPianoRollClipId || expandedStepSeqClipId
  useEffect(() => { if (editingClip) setTab('sounds') }, [editingClip])

  // Double-tapping a track head fires this: focus the track and open its Sounds
  // sub-view (Effects / Sound / Keys) so effects etc. are reachable on mobile.
  const [soundsFocus, setSoundsFocus] = useState<{ sub: 'sounds' | 'fx' | 'keys' | 'chords'; n: number }>({ sub: 'sounds', n: 0 })
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ trackId: string; sub: 'sounds' | 'fx' | 'keys' | 'chords' }>).detail
      if (d?.trackId) setSelectedTrackId(d.trackId)
      setSoundsFocus(f => ({ sub: d?.sub ?? 'sounds', n: f.n + 1 }))
      setTab('sounds')
    }
    window.addEventListener('mobile-open-sounds', onOpen)
    return () => window.removeEventListener('mobile-open-sounds', onOpen)
  }, [setSelectedTrackId])
  const [drawer, setDrawer] = useState(false)
  const [adding, setAdding] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)

  const addTrack = (kind: 'drum' | 'melody') => {
    const n = project.tracks.filter(t => (t.instrument?.type === 'drum') === (kind === 'drum')).length + 1
    const inst: TrackInstrument = kind === 'drum' ? drumInstrument('studio') : polyInstrument({ waveform: 'triangle', filterCutoff: 3000, attack: 0.005, decay: 0.4, sustain: 0.5, release: 0.3 })
    const name = kind === 'drum' ? (n > 1 ? `Drums ${n}` : 'Drums') : (n > 1 ? `Melody ${n}` : 'Melody')
    const trackId = crypto.randomUUID()
    dispatch({ type: 'ADD_TRACK', id: trackId, name, instrument: inst })
    dispatch({ type: 'ADD_CLIP', clip: makeMidiClip(trackId, name, 0, 4, { isDrumClip: kind === 'drum' }) })
    setSelectedTrackId(trackId)
    setAdding(false)
  }

  // Reference / group bus: route several tracks through one group so its FX +
  // volume shape a whole section at once.
  const [groupPick, setGroupPick] = useState<Set<string> | null>(null)
  const [groupName, setGroupName] = useState('Group')
  const groupable = project.tracks.filter(t => t.kind !== 'group' && !t.groupId)
  const createGroup = () => {
    const ids = [...(groupPick ?? [])]
    if (ids.length === 0) return
    const groupId = crypto.randomUUID()
    dispatch({ type: 'GROUP_TRACKS', trackIds: ids, groupId, name: groupName.trim() || 'Group' })
    setSelectedTrackId(groupId)
    setGroupPick(null); setAdding(false)
  }

  const save = useCallback(async () => {
    const cf = projectToCfFile(project)
    if (projectId) cf.id = projectId
    if (!isSignedIn) {
      try { localStorage.setItem('100lights-mobile-beat', JSON.stringify(cf)) } catch { /* ok */ }
      window.location.assign('/sign-up?redirect_url=' + encodeURIComponent('/m')); return
    }
    setSaveState('saving')
    try {
      const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cf) })
      if (!res.ok) { let m = 'Could not save.'; try { const b = await res.json(); if (b?.error) m = b.error } catch { /* ok */ } throw new Error(m) }
      setSavedId(cf.id); setSaveState('saved')
      posthog.capture('mobile_daw_saved', { tracks: project.tracks.length, clips: project.arrangementClips.length })
    } catch (e) { setSaveMsg((e as Error).message); setSaveState('error') }
  }, [project, isSignedIn, projectId])

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', paddingTop: 'calc(8px + env(safe-area-inset-top))', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button onClick={() => setDrawer(true)} aria-label="Menu" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 9, border: 'none', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}><Menu size={20} /></button>
        <strong style={{ fontSize: 13 }}>100Lights</strong>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>· {tab === 'sounds' ? 'Sounds' : tab === 'mix' ? 'Mixer' : tab === 'clips' ? 'Clips' : 'Studio'}</span>
        <button onClick={() => void save()} disabled={saveState === 'saving'} style={{ marginLeft: 'auto', padding: '7px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 800, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff' }}>{saveState === 'saving' ? 'Saving…' : 'Save'}</button>
      </header>

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
          {tab === 'song' && <ArrangementView />}
          {tab === 'mix' && <Mixer />}
          {tab === 'clips' && <SessionView />}
          {tab === 'sounds' && <SoundsEditor onDoneClip={() => setTab('song')} focus={soundsFocus} />}
        </div>
        {/* Add-track lives on the timeline (Song view) as a floating button. */}
        {tab === 'song' && (
          <button onClick={() => setAdding(true)} aria-label="Add a track"
            style={{ position: 'absolute', right: 14, bottom: 14, display: 'flex', alignItems: 'center', gap: 6, padding: '11px 16px', borderRadius: 999, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 800, boxShadow: '0 4px 14px rgba(0,0,0,0.45)', zIndex: 20 }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>＋</span>Track
          </button>
        )}
      </div>

      {/* Transport docked at the bottom — controls sit under the thumb, right
          above the tabs (Brae: move all controls to the bottom). */}
      <MobileTransport />

      {/* Bottom nav — Song / Mix / Sounds */}
      <nav style={{ display: 'flex', alignItems: 'stretch', gap: 4, padding: '6px 8px calc(6px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg-surface)' }}>
        {NAV.map(n => {
          const on = tab === n.id
          return (
            <button key={n.id} onClick={() => setTab(n.id)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '8px 0', borderRadius: 10, cursor: 'pointer', border: 'none', background: on ? 'rgba(139,92,246,0.14)' : 'transparent', color: on ? 'var(--accent-light)' : 'var(--text-muted)' }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>{n.icon}</span>
              <span style={{ fontSize: 10.5, fontWeight: 700 }}>{n.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Hamburger drawer */}
      {drawer && <SideDrawer onClose={() => setDrawer(false)} onOpenClips={() => { setTab('clips'); setDrawer(false) }} />}

      <CoachMarks />

      {/* Add-track sheet */}
      {adding && (
        <div onClick={() => setAdding(false)} style={{ position: 'fixed', inset: 0, zIndex: 160, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', padding: '18px 16px calc(18px + env(safe-area-inset-bottom))' }}>
            <p style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 800 }}>Add a track</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => addTrack('drum')} style={pickBtn}><span style={{ fontSize: 24 }}>🥁</span>Drums</button>
              <button onClick={() => addTrack('melody')} style={pickBtn}><span style={{ fontSize: 24 }}>🎹</span>Melody</button>
              <button onClick={() => { if (groupable.length) { setGroupName('Group'); setGroupPick(new Set()) } }} disabled={!groupable.length}
                style={{ ...pickBtn, opacity: groupable.length ? 1 : 0.4 }}><span style={{ fontSize: 24 }}>🎚</span>Group</button>
            </div>
            <p style={{ margin: '12px 0 0', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>Edit any track&apos;s sound, FX &amp; keys in the Sounds tab. A <b>Group</b> routes tracks through one bus so its FX shape the whole section.</p>
          </div>
        </div>
      )}

      {/* Group picker — choose which tracks feed the new bus */}
      {groupPick && (
        <div onClick={() => setGroupPick(null)} style={{ position: 'fixed', inset: 0, zIndex: 165, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '85vh', overflowY: 'auto', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', padding: '18px 16px calc(18px + env(safe-area-inset-bottom))' }}>
            <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800 }}>New group bus</p>
            <p style={{ margin: '0 0 12px', fontSize: 11.5, color: 'var(--text-muted)' }}>Pick the tracks this group controls. Add FX to the group to affect them all.</p>
            <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name"
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 14, padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', marginBottom: 12, outline: 'none' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {groupable.map(t => {
                const on = groupPick.has(t.id)
                return (
                  <button key={t.id} onClick={() => setGroupPick(prev => { const n = new Set(prev); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n })}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'rgba(139,92,246,0.14)' : 'var(--bg-card)', color: 'var(--text-primary)' }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent)' : 'transparent', color: '#fff', fontSize: 13 }}>{on ? '✓' : ''}</span>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{t.name}</span>
                  </button>
                )
              })}
            </div>
            <button onClick={createGroup} disabled={groupPick.size === 0}
              style={{ width: '100%', padding: '13px 0', borderRadius: 11, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 800, background: groupPick.size ? 'var(--accent)' : 'var(--bg-card)', color: groupPick.size ? '#fff' : 'var(--text-muted)' }}>
              Create group{groupPick.size ? ` (${groupPick.size})` : ''}
            </button>
          </div>
        </div>
      )}

      {(saveState === 'saved' || saveState === 'error') && (
        <div onClick={() => setSaveState('idle')} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', padding: '24px 22px calc(20px + env(safe-area-inset-bottom))', textAlign: 'center' }}>
            {saveState === 'saved' ? (
              <>
                <div style={{ fontSize: 30, marginBottom: 4 }}>🎉</div>
                <h3 style={{ margin: '0 0 6px', fontSize: 16.5, fontWeight: 800 }}>Saved to your account</h3>
                <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{projectId ? 'Your changes are saved.' : 'Open it on a computer to keep producing — it’s in your projects.'}</p>
                <button onClick={() => { navigator.clipboard?.writeText('https://100lights.com/projects/' + savedId).catch(() => {}); setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 2200) }} style={{ ...bigBtn, background: 'var(--accent)', color: '#fff' }}>{linkCopied ? 'Desktop link copied ✓' : 'Copy the desktop link'}</button>
                <button onClick={() => setSaveState('idle')} style={{ ...bigBtn, background: 'transparent', color: 'var(--text-muted)' }}>Keep going</button>
              </>
            ) : (
              <>
                <h3 style={{ margin: '0 0 6px', fontSize: 16.5, fontWeight: 800 }}>Couldn&apos;t save</h3>
                <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-secondary)' }}>{saveMsg}</p>
                <button onClick={() => setSaveState('idle')} style={{ ...bigBtn, background: 'var(--accent)', color: '#fff' }}>OK</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sounds editor: pick a track, edit its instrument / FX / keys, full-screen ──

function SoundsEditor({ onDoneClip, focus }: { onDoneClip: () => void; focus?: { sub: 'sounds' | 'fx' | 'keys' | 'chords'; n: number } }) {
  const { project, selectedTrackId, setSelectedTrackId, expandedPianoRollClipId, expandedStepSeqClipId, setExpandedPianoRollClipId, setExpandedStepSeqClipId } = useDaw()
  const [sub, setSub] = useState<'sounds' | 'fx' | 'keys' | 'chords'>('sounds')
  // Groups are included so a reference/bus track's FX is editable here.
  const tracks = project.tracks

  // Track-head double-tap can request a specific sub-view (Effects / Sound / Keys).
  useEffect(() => { if (focus && focus.n > 0) setSub(focus.sub) }, [focus])

  useEffect(() => {
    if ((!selectedTrackId || !tracks.some(t => t.id === selectedTrackId)) && tracks[0]) setSelectedTrackId(tracks[0].id)
  }, [selectedTrackId, tracks, setSelectedTrackId])

  // Editing a clip (double-tapped in Song): show the piano roll / beat editor
  // full-screen with a Done button that returns to the timeline.
  const editingClip = expandedPianoRollClipId || expandedStepSeqClipId
  if (editingClip) {
    const isBeat = !!expandedStepSeqClipId
    const done = () => { setExpandedPianoRollClipId(null); setExpandedStepSeqClipId(null); onDoneClip() }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <strong style={{ fontSize: 13, flex: 1 }}>{isBeat ? 'Beat' : 'Piano roll'}</strong>
          <button onClick={done} style={{ padding: '7px 18px', borderRadius: 8, fontSize: 12.5, fontWeight: 800, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff' }}>Done</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {isBeat
            ? <StepSequencer clipId={expandedStepSeqClipId!} />
            : <PianoRoll clipId={expandedPianoRollClipId!} />}
        </div>
      </div>
    )
  }

  const track = tracks.find(t => t.id === selectedTrackId) ?? tracks[0]
  if (!track) return <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>Add a track, then edit its sound here.</div>
  const isGroup = track.kind === 'group'
  const childCount = isGroup ? project.tracks.filter(t => t.groupId === track.id).length : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* track chooser */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px', overflowX: 'auto', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        {tracks.map(t => (
          <button key={t.id} onClick={() => setSelectedTrackId(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${t.id === track.id ? 'var(--accent)' : 'var(--border)'}`, background: t.id === track.id ? 'rgba(139,92,246,0.14)' : 'var(--bg-card)', color: t.id === track.id ? 'var(--accent-light)' : 'var(--text-secondary)' }}>
            <span style={{ fontSize: 11 }}>{t.kind === 'group' ? '🎚' : null}</span>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color }} />{t.name}
          </button>
        ))}
      </div>
      {isGroup ? (
        // A group bus has no instrument/keyboard — only its shared FX chain.
        <>
          <div style={{ padding: '10px 14px', fontSize: 11.5, color: 'var(--text-muted)', flexShrink: 0 }}>
            🎚 <b style={{ color: 'var(--text-secondary)' }}>{track.name}</b> — effects here shape all {childCount} track{childCount === 1 ? '' : 's'} in this group.
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <DeviceChain trackId={track.id} />
          </div>
        </>
      ) : (<>
        {/* sub tabs */}
        <div style={{ display: 'flex', gap: 6, padding: '8px 12px', flexShrink: 0 }}>
          {(['sounds', 'fx', 'chords', 'keys'] as const).map(s => (
            <button key={s} onClick={() => setSub(s)} style={{ flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 12.5, fontWeight: 700, textTransform: 'capitalize', cursor: 'pointer', border: `1px solid ${sub === s ? 'var(--accent)' : 'var(--border)'}`, background: sub === s ? 'rgba(139,92,246,0.14)' : 'transparent', color: sub === s ? 'var(--accent-light)' : 'var(--text-secondary)' }}>{s}</button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {sub === 'sounds' && <InstrumentPicker trackId={track.id} />}
          {sub === 'fx' && <DeviceChain trackId={track.id} />}
          {sub === 'chords' && <ChordPad trackId={track.id} />}
          {sub === 'keys' && <PadInput trackId={track.id} onClose={() => { /* stays open */ }} />}
        </div>
      </>)}
    </div>
  )
}

// ── Side drawer: navigation + sound library + code ─────────────────────────────

function SideDrawer({ onClose, onOpenClips }: { onClose: () => void; onOpenClips: () => void }) {
  const [tab, setTab] = useState<'library' | 'code'>('library')
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.5)', display: 'flex' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(320px, 86vw)', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', paddingTop: 'env(safe-area-inset-top)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px' }}>
          <strong style={{ fontSize: 14, flex: 1 }}>Menu</strong>
          <button onClick={onClose} aria-label="Close menu" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', padding: '0 8px 8px', gap: 2 }}>
          <DrawerLink href="/" icon={<Home size={16} />} label="Home" />
          <DrawerLink href="/dashboard" icon={<FolderOpen size={16} />} label="My projects" />
          <DrawerLink href="/new" icon={<Plus size={16} />} label="New project" />
          <button onClick={onOpenClips} style={drawerBtn}><LayoutGrid size={16} /> Clips / Live</button>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
          {(['library', 'code'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${tab === t ? 'var(--accent)' : 'var(--border)'}`, background: tab === t ? 'rgba(139,92,246,0.14)' : 'transparent', color: tab === t ? 'var(--accent-light)' : 'var(--text-secondary)' }}>{t === 'library' ? 'Sound Library' : 'Code'}</button>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {tab === 'library' ? <SoundLibraryPanel embedded={true} /> : <PolyCodePanel onDone={onClose} />}
        </div>
      </div>
    </div>
  )
}

function DrawerLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return <Link href={href} style={{ ...drawerBtn, textDecoration: 'none' }}>{icon} {label}</Link>
}

const drawerBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 9, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-primary)', width: '100%', textAlign: 'left' }
const bigBtn: React.CSSProperties = { display: 'block', width: '100%', padding: 13, borderRadius: 12, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: 'pointer', marginTop: 8 }
const pickBtn: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '18px 0', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }
