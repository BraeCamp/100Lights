'use client'

// Mobile DAW shell — a phone layout around the REAL desktop feature components
// (Transport, ArrangementView incl. inline piano roll + step sequencer, Mixer,
// SessionView, InstrumentPicker, DeviceChain, PadInput), all driven by the
// shared DawContext (see MobileDawProvider). We change the layout, not the
// functions — so mobile gets the full DAW.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import posthog from 'posthog-js'
import { useUser } from '@clerk/nextjs'
import { MobileDawProvider } from './MobileDawProvider'
import { useDaw, makeMidiClip, migrateProject } from '@/lib/daw-state'
import { projectToCfFile } from './daw/save-project'
import { drumInstrument, polyInstrument, seedProject } from './daw/seed'
import type { DawProject } from '@/lib/daw-types'
import { MobileTransport } from './daw/MobileTransport'
import ArrangementView from '@/components/editor/daw/ArrangementView'
import Mixer from '@/components/editor/daw/Mixer'
import SessionView from '@/components/editor/daw/SessionView'
import InstrumentPicker from '@/components/editor/daw/InstrumentPicker'
import DeviceChain from '@/components/editor/daw/DeviceChain'
import PadInput from '@/components/editor/daw/PadInput'
import type { DawView, TrackInstrument } from '@/lib/daw-types'

export default function MobileDaw({ projectId }: { projectId?: string }) {
  // With a projectId, load the SAME project the desktop opens (its dawProject),
  // so it sounds identical. Without one, start a fresh seeded session.
  const [loaded, setLoaded] = useState<DawProject | null>(projectId ? null : seedProject())
  const [error, setError] = useState(false)

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

  return (
    <MobileDawProvider key={projectId ?? 'new'} initialProject={loaded}>
      <Shell projectId={projectId} />
    </MobileDawProvider>
  )
}

function FullMsg({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>{children}</div>
}

const VIEW_TABS: { id: DawView; label: string; icon: string }[] = [
  { id: 'arrangement', label: 'Song', icon: '☰' },
  { id: 'session', label: 'Clips', icon: '⊞' },
  { id: 'mixer', label: 'Mix', icon: '🎚️' },
]

function Shell({ projectId }: { projectId?: string }) {
  const { project, dispatch, view, setView, selectedTrackId, setSelectedTrackId } = useDaw()
  const { isSignedIn } = useUser()
  const [panel, setPanel] = useState<'sounds' | 'fx' | 'keys'>('sounds')
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

  const save = useCallback(async () => {
    const cf = projectToCfFile(project)
    if (projectId) cf.id = projectId  // save back to the same project (POST upserts by id)
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

  const track = selectedTrackId ? project.tracks.find(t => t.id === selectedTrackId) : undefined

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px', paddingTop: 'calc(9px + env(safe-area-inset-top))', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ width: 17, height: 17, borderRadius: 5, background: 'var(--accent)' }} />
        <strong style={{ fontSize: 13 }}>100Lights</strong>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>· Studio</span>
        <button onClick={() => void save()} disabled={saveState === 'saving'} style={{ marginLeft: 'auto', padding: '5px 14px', borderRadius: 8, fontSize: 12, fontWeight: 800, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff' }}>{saveState === 'saving' ? 'Saving…' : 'Save'}</button>
        <Link href="/" style={{ fontSize: 11, color: 'var(--text-muted)', textDecoration: 'none' }}>Exit ↗</Link>
      </header>

      <MobileTransport />

      {/* Main view — the real feature components, full-screen */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
        {view === 'session' && <SessionView />}
        {view === 'arrangement' && <ArrangementView />}
        {view === 'mixer' && <Mixer />}
      </div>

      {/* Bottom nav: views + add track */}
      <nav style={{ display: 'flex', alignItems: 'stretch', gap: 6, padding: '7px 10px calc(7px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg-surface)' }}>
        {VIEW_TABS.map(t => (
          <button key={t.id} onClick={() => setView(t.id)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '7px 0', borderRadius: 10, cursor: 'pointer', border: 'none', background: view === t.id ? 'rgba(139,92,246,0.14)' : 'transparent', color: view === t.id ? 'var(--accent-light)' : 'var(--text-muted)' }}>
            <span style={{ fontSize: 17, lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: 10.5, fontWeight: 700 }}>{t.label}</span>
          </button>
        ))}
        <button onClick={() => setAdding(true)} aria-label="Add a track" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '7px 0', borderRadius: 10, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--accent-light)' }}>
          <span style={{ fontSize: 17, lineHeight: 1 }}>＋</span>
          <span style={{ fontSize: 10.5, fontWeight: 700 }}>Track</span>
        </button>
      </nav>

      {/* Selected-track panel as an overlay bottom sheet: Sounds / FX / Keys */}
      {track && (
        <div onClick={() => setSelectedTrackId(null)} style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '68vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 8px' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: track.color }} />
              <strong style={{ fontSize: 13.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</strong>
              <button onClick={() => setSelectedTrackId(null)} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: 'flex', gap: 6, padding: '0 14px 10px', borderBottom: '1px solid var(--border)' }}>
              {(['sounds', 'fx', 'keys'] as const).map(p => (
                <button key={p} onClick={() => setPanel(p)} style={{ flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 12.5, fontWeight: 700, textTransform: 'capitalize', cursor: 'pointer', border: `1px solid ${panel === p ? 'var(--accent)' : 'var(--border)'}`, background: panel === p ? 'rgba(139,92,246,0.14)' : 'transparent', color: panel === p ? 'var(--accent-light)' : 'var(--text-secondary)' }}>{p}</button>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {panel === 'sounds' && <InstrumentPicker trackId={track.id} />}
              {panel === 'fx' && <DeviceChain trackId={track.id} />}
              {panel === 'keys' && <PadInput trackId={track.id} onClose={() => setSelectedTrackId(null)} />}
            </div>
          </div>
        </div>
      )}

      {/* Add-track sheet */}
      {adding && (
        <div onClick={() => setAdding(false)} style={{ position: 'fixed', inset: 0, zIndex: 160, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', padding: '18px 16px calc(18px + env(safe-area-inset-bottom))' }}>
            <p style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 800 }}>Add a track</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => addTrack('drum')} style={pickBtn}><span style={{ fontSize: 24 }}>🥁</span>Drums</button>
              <button onClick={() => addTrack('melody')} style={pickBtn}><span style={{ fontSize: 24 }}>🎹</span>Melody</button>
            </div>
            <p style={{ margin: '12px 0 0', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>Tap a track to select it, then use Sounds / FX / Keys below.</p>
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
                <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>Open it on a computer to keep producing — it&apos;s in your projects.</p>
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

const bigBtn: React.CSSProperties = { display: 'block', width: '100%', padding: 13, borderRadius: 12, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: 'pointer', marginTop: 8 }
const pickBtn: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '18px 0', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }
