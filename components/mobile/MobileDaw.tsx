'use client'

// Mobile DAW — a touch front-end over the SAME DawProject + DawEngine as the
// desktop studio. A real arrangement (clips on a timeline), a real mixer, and
// clip editors (step grid / piano roll), all driven by the shared engine, so a
// phone project is a full project that opens on desktop.

import { useCallback, useState } from 'react'
import Link from 'next/link'
import posthog from 'posthog-js'
import { useUser } from '@clerk/nextjs'
import { useDawEngine } from './daw/engine-hook'
import { seedProject, drumInstrument, polyInstrument } from './daw/seed'
import { makeMidiClip } from '@/lib/daw-state'
import { beatToCfProj } from '@/lib/mobile-beat'
import { Timeline } from './daw/Timeline'
import { Mixer } from './daw/Mixer'
import { ClipEditor } from './daw/ClipEditor'
import type { TrackInstrument } from '@/lib/daw-types'

export default function MobileDaw() {
  const { isSignedIn } = useUser()
  const daw = useDawEngine(seedProject)
  const { project, dispatch } = daw

  const [view, setView] = useState<'song' | 'mix'>('song')
  const [editClipId, setEditClipId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)

  const loopOn = !!project.loopEnabled
  const bar = Math.floor(daw.position / 4) + 1
  const beat = Math.floor(daw.position % 4) + 1

  const addTrack = (kind: 'drum' | 'melody') => {
    const n = project.tracks.filter(t => (t.instrument?.type === 'drum') === (kind === 'drum')).length + 1
    const inst: TrackInstrument = kind === 'drum' ? drumInstrument('studio') : polyInstrument({ waveform: 'triangle', filterCutoff: 3000, attack: 0.005, decay: 0.4, sustain: 0.5, release: 0.3 })
    const name = kind === 'drum' ? (n > 1 ? `Drums ${n}` : 'Drums') : (n > 1 ? `Melody ${n}` : 'Melody')
    // ADD_TRACK takes an id, so we know it immediately and can drop in a starter
    // clip + open it — no waiting for the next render.
    const trackId = crypto.randomUUID()
    dispatch({ type: 'ADD_TRACK', id: trackId, name, instrument: inst })
    const clip = makeMidiClip(trackId, name, 0, 4, { isDrumClip: kind === 'drum' })
    dispatch({ type: 'ADD_CLIP', clip })
    setEditClipId(clip.id)
    setAdding(false)
  }

  const toggleLoop = () => {
    if (!loopOn) {
      const end = Math.max(4, ...project.arrangementClips.map(c => c.startBeat + c.durationBeats))
      dispatch({ type: 'SET_LOOP', start: 0, end })
    }
    dispatch({ type: 'SET_LOOP_ENABLED', enabled: !loopOn })
  }

  const save = useCallback(async () => {
    const cf = beatToCfProj(project)
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
  }, [project, isSignedIn])

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 16px', paddingTop: 'calc(10px + env(safe-area-inset-top))', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ width: 18, height: 18, borderRadius: 5, background: 'var(--accent)' }} />
        <strong style={{ fontSize: 13.5 }}>100Lights</strong>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· Studio</span>
        <Link href="/" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)', textDecoration: 'none' }}>Full studio ↗</Link>
      </header>

      {/* Transport */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button onClick={daw.toggle} aria-label={daw.playing ? 'Stop' : 'Play'} style={{ width: 44, height: 44, borderRadius: 22, border: 'none', flexShrink: 0, cursor: 'pointer', background: daw.playing ? '#ef4444' : 'var(--accent)', color: '#fff', fontSize: 18 }}>{daw.playing ? '■' : '▶'}</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => dispatch({ type: 'SET_TEMPO', tempo: project.tempo - 5 })} style={sBtn}>−</button>
          <div style={{ textAlign: 'center', minWidth: 46 }}><div style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{Math.round(project.tempo)}</div><div style={{ fontSize: 8, color: 'var(--text-muted)' }}>BPM</div></div>
          <button onClick={() => dispatch({ type: 'SET_TEMPO', tempo: project.tempo + 5 })} style={sBtn}>+</button>
        </div>
        <div style={{ textAlign: 'center', minWidth: 44 }}><div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{bar}:{beat}</div><div style={{ fontSize: 8, color: 'var(--text-muted)' }}>BAR</div></div>
        <button onClick={toggleLoop} aria-pressed={loopOn} style={{ ...sBtn, width: 'auto', padding: '0 10px', fontSize: 12, fontWeight: 800, background: loopOn ? 'rgba(139,92,246,0.16)' : 'var(--bg-card)', color: loopOn ? 'var(--accent-light)' : 'var(--text-muted)', border: `1px solid ${loopOn ? 'var(--accent)' : 'var(--border)'}` }}>↻</button>
        <button onClick={() => void save()} disabled={saveState === 'saving'} style={{ ...sBtn, marginLeft: 'auto', width: 'auto', padding: '0 14px', fontSize: 12.5, fontWeight: 800, background: 'var(--accent)', color: '#fff', border: 'none' }}>{saveState === 'saving' ? 'Saving…' : 'Save'}</button>
      </div>

      {/* Main view */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {view === 'song' ? <Timeline daw={daw} onEditClip={setEditClipId} /> : <Mixer daw={daw} />}
      </div>

      {/* Bottom bar: view switch + add track */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px calc(8px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        {(['song', 'mix'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{ flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 12.5, fontWeight: 700, textTransform: 'capitalize', cursor: 'pointer', border: `1px solid ${view === v ? 'var(--accent)' : 'var(--border)'}`, background: view === v ? 'rgba(139,92,246,0.14)' : 'transparent', color: view === v ? 'var(--accent-light)' : 'var(--text-secondary)' }}>{v === 'song' ? 'Song' : 'Mixer'}</button>
        ))}
        <button onClick={() => setAdding(true)} style={{ padding: '9px 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', border: '1px dashed var(--accent)', background: 'transparent', color: 'var(--accent-light)' }}>+ Track</button>
      </div>

      {/* Add-track sheet */}
      {adding && (
        <div onClick={() => setAdding(false)} style={{ position: 'fixed', inset: 0, zIndex: 160, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', padding: '18px 16px calc(18px + env(safe-area-inset-bottom))' }}>
            <p style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 800 }}>Add a track</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => addTrack('drum')} style={pickBtn}><span style={{ fontSize: 24 }}>🥁</span>Drums</button>
              <button onClick={() => addTrack('melody')} style={pickBtn}><span style={{ fontSize: 24 }}>🎹</span>Melody</button>
            </div>
            <p style={{ margin: '12px 0 0', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>Adds a track with a starter clip. Tap the clip on the timeline to edit its beat or notes.</p>
          </div>
        </div>
      )}

      {editClipId && <ClipEditor daw={daw} clipId={editClipId} onClose={() => setEditClipId(null)} />}

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

const sBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 16, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const bigBtn: React.CSSProperties = { display: 'block', width: '100%', padding: 13, borderRadius: 12, fontSize: 14.5, fontWeight: 800, border: 'none', cursor: 'pointer', marginTop: 8 }
const pickBtn: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '18px 0', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }
