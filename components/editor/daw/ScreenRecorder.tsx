'use client'

/**
 * Capture the studio, two ways:
 *  1. "Screen" — record what you're doing live (screen + the DAW's own audio).
 *  2. "History" — replay how this project was built (folding its recorded
 *     construction log step by step, playing the song at each milestone) and
 *     record that. Lets a project author a "watch it get made" video with no
 *     live performance.
 *
 * Audio is tapped from the engine's master bus rather than from system
 * capture, so what lands in the file is exactly what the studio played.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDaw, reducer } from '@/lib/daw-state'
import type { DawAction } from '@/lib/daw-state'
import { defaultProject, type DawProject } from '@/lib/daw-types'
import {
  ScreenRecorder as Recorder,
  formatDuration,
  formatSize,
  screenRecordingSupported,
  type RecordingResult,
} from '@/lib/screen-recorder'
import ClickHighlighter, { type ClickStyle } from './ClickHighlighter'
import { shareClip } from '@/lib/community'

const CLICK_STYLES: { id: ClickStyle; label: string }[] = [
  { id: 'ripple', label: 'Ripple' },
  { id: 'glow', label: 'Glow' },
  { id: 'burst', label: 'Burst' },
]

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// A starting point for replay: the project's transport settings (tempo, key,
// loop) but with no content — the history rebuilds the tracks/clips/notes.
function replayBase(p: DawProject): DawProject {
  return {
    ...defaultProject(),
    id: p.id, name: p.name, tempo: p.tempo,
    timeSignatureNum: p.timeSignatureNum, timeSignatureDen: p.timeSignatureDen,
    key: p.key, scale: p.scale, swing: p.swing,
    loopStart: p.loopStart, loopEnd: p.loopEnd, loopEnabled: p.loopEnabled,
    masterVolume: p.masterVolume,
  }
}

export default function ScreenRecorderPanel({ onClose }: { onClose: () => void }) {
  const { engine, project, dispatch } = useDaw()
  const recRef = useRef<Recorder | null>(null)
  const [mode, setMode] = useState<'screen' | 'history'>('screen')
  const [state, setState] = useState<'idle' | 'recording' | 'done'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [includeMic, setIncludeMic] = useState(false)
  const [captureCursor, setCaptureCursor] = useState(true)
  const [highlightClicks, setHighlightClicks] = useState(true)
  const [clickStyle, setClickStyle] = useState<ClickStyle>('ripple')
  const [result, setResult] = useState<RecordingResult | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [share, setShare] = useState<'idle' | 'sharing' | 'shared'>('idle')
  const [shareErr, setShareErr] = useState<string | null>(null)
  // History replay
  const [replaying, setReplaying] = useState(false)
  const [milestone, setMilestone] = useState<string | null>(null)
  const [buildProg, setBuildProg] = useState<{ i: number; total: number } | null>(null)
  const cancelRef = useRef(false)
  const supported = screenRecordingSupported()
  const historyLen = project.history?.length ?? 0

  async function shareToCommunity() {
    if (!result) return
    setShare('sharing'); setShareErr(null)
    try {
      await shareClip(result.blob, project.name || 'My session', '', { durationMs: result.durationMs })
      setShare('shared')
    } catch (e) {
      setShareErr(e instanceof Error ? e.message : 'Share failed'); setShare('idle')
    }
  }

  const finish = useCallback(async () => {
    const r = await recRef.current?.stop() ?? null
    setState(r ? 'done' : 'idle')
    if (r) {
      setResult(r)
      setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(r.blob) })
    }
  }, [])

  useEffect(() => {
    if (state !== 'recording') return
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [state])

  // Revoke the preview URL on unmount; cancel any running replay.
  useEffect(() => () => {
    cancelRef.current = true
    recRef.current?.cleanup()
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }, [])

  async function start() {
    setError(null)
    const rec = new Recorder()
    recRef.current = rec
    rec.onExternalStop = () => { void finish() }
    try {
      await rec.start({ masterNode: engine.masterCompressor, audioContext: engine.ctx, includeMic, captureCursor })
      setElapsed(0)
      setState('recording')
    } catch (e) {
      const msg = e instanceof Error && e.name === 'NotAllowedError'
        ? 'Screen sharing was cancelled.'
        : e instanceof Error ? e.message : 'Could not start recording.'
      setError(msg)
      rec.cleanup()
      setState('idle')
    }
  }

  // ── History replay ────────────────────────────────────────────────────────
  // Fold the recorded construction log from an empty base, dispatching each
  // folded state so the studio visibly rebuilds; pause at milestones to play
  // the song-so-far; finish with the full track. Optionally screen-record it.
  async function playHistory(record: boolean) {
    const hist = project.history ?? []
    if (!hist.length) {
      setError('This project has no recorded build history yet. Build a project in the studio (or open one authored with history) and try again.')
      return
    }
    setError(null)
    const saved = project             // final state, restored when done
    const tempo = saved.tempo || 120
    const beatSec = 60 / tempo
    cancelRef.current = false

    if (record) {
      if (!supported) { setError('This browser can’t record the screen.'); return }
      const rec = new Recorder()
      recRef.current = rec
      rec.onExternalStop = () => { cancelRef.current = true }
      try {
        await rec.start({ masterNode: engine.masterCompressor, audioContext: engine.ctx, includeMic, captureCursor })
        setElapsed(0); setState('recording')
      } catch (e) {
        setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Screen sharing was cancelled.' : 'Could not start recording.')
        rec.cleanup(); return
      }
    }

    setReplaying(true)
    // Pace the whole build into a watchable window; milestones get their own time.
    const nonMilestone = hist.filter(h => !h.label).length || 1
    const stepDelay = Math.min(450, Math.max(45, Math.round(14000 / nonMilestone)))
    try {
      let s = replayBase(saved)
      dispatch({ type: 'LOAD_PROJECT', project: s }); engine.updateProject(s)
      await wait(600)
      for (let i = 0; i < hist.length; i++) {
        if (cancelRef.current) break
        s = reducer(s, hist[i].action as unknown as DawAction)
        setBuildProg({ i: i + 1, total: hist.length })
        dispatch({ type: 'LOAD_PROJECT', project: s }); engine.updateProject(s)
        const label = hist[i].label
        if (label) {
          setMilestone(label)
          engine.updateProject(s); await engine.play(0)
          await wait(Math.min(4500, Math.max(2000, 4 * beatSec * 1000)))
          engine.stop(); setMilestone(null)
          await wait(350)
        } else {
          await wait(stepDelay)
        }
      }
      if (!cancelRef.current) {
        setMilestone('The finished track ♪')
        const contentBeats = s.arrangementClips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 0)
        engine.updateProject(s); await engine.play(0)
        await wait(Math.min(30000, Math.max(4000, contentBeats * beatSec * 1000)))
        engine.stop(); setMilestone(null)
      }
    } finally {
      engine.stop()
      dispatch({ type: 'LOAD_PROJECT', project: saved }); engine.updateProject(saved)
      setReplaying(false); setBuildProg(null); setMilestone(null)
      if (record) await finish()
    }
  }

  function download() {
    if (!result || !previewUrl) return
    const ext = result.mimeType.includes('mp4') ? 'mp4' : 'webm'
    const name = (project.name || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const a = Object.assign(document.createElement('a'), { href: previewUrl, download: `${name || 'session'}.${ext}` })
    document.body.appendChild(a); a.click(); a.remove()
  }

  function reset() {
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    setResult(null)
    setState('idle')
  }

  const inProgress = state === 'recording' || replaying

  return (
    <>
      {/* Milestone overlay — full-screen so it's captured in the recording. */}
      {milestone && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2147482000, pointerEvents: 'none',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '14vh',
        }}>
          <div style={{
            padding: '14px 30px', borderRadius: 999, fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em',
            color: '#fff', background: 'rgba(124,58,237,0.92)', boxShadow: '0 12px 40px rgba(124,58,237,0.5)',
            animation: 'msIn 0.4s ease',
          }}>{milestone}</div>
        </div>
      )}

      <div style={{
        position: 'fixed', right: 18, bottom: 84, zIndex: 60, width: 336,
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
        padding: '14px 16px', boxShadow: '0 18px 50px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text-primary)' }}>
            {mode === 'history' ? 'Replay the build' : 'Record session'}
          </span>
          <button onClick={onClose} aria-label="Close"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
        </div>

        {/* Mode toggle */}
        {state !== 'done' && !inProgress && (
          <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--bg-inset, rgba(0,0,0,0.2))', borderRadius: 9, marginBottom: 12 }}>
            {(['screen', 'history'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(null) }} style={{
                flex: 1, padding: '6px 0', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: 'none',
                background: mode === m ? 'var(--accent, #7c3aed)' : 'transparent',
                color: mode === m ? '#fff' : 'var(--text-muted)',
              }}>{m === 'screen' ? '● Screen' : '↺ History'}</button>
            ))}
          </div>
        )}

        {!supported && (
          <p style={{ fontSize: 11.5, color: '#f59e0b', lineHeight: 1.6, margin: 0 }}>
            This browser can&rsquo;t capture the screen. Chrome, Edge or Firefox on desktop can.
          </p>
        )}

        {/* ── SCREEN mode, idle ── */}
        {supported && mode === 'screen' && state === 'idle' && !replaying && (
          <>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.65, margin: '0 0 10px' }}>
              Captures your screen plus the studio&rsquo;s audio straight from the mixer — not system
              sound, so nothing else on your machine ends up in the take.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={includeMic} onChange={e => setIncludeMic(e.target.checked)} />
              Also record my microphone
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={captureCursor} onChange={e => setCaptureCursor(e.target.checked)} />
              Capture mouse activity (show the cursor &amp; clicks)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: highlightClicks ? 8 : 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={highlightClicks} onChange={e => setHighlightClicks(e.target.checked)} />
              ✨ Highlight my clicks (cinematic)
            </label>
            {highlightClicks && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {CLICK_STYLES.map(s => (
                  <button key={s.id} onClick={() => setClickStyle(s.id)} style={{
                    flex: 1, padding: '6px 0', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${clickStyle === s.id ? 'rgba(139,92,246,0.5)' : 'var(--border)'}`,
                    background: clickStyle === s.id ? 'rgba(139,92,246,0.18)' : 'transparent',
                    color: clickStyle === s.id ? 'var(--accent-light)' : 'var(--text-muted)',
                  }}>{s.label}</button>
                ))}
              </div>
            )}
            <button onClick={() => void start()}
              style={{ width: '100%', padding: '9px 0', borderRadius: 9, border: 'none', background: '#dc2626', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              ● Start recording
            </button>
          </>
        )}

        {/* ── HISTORY mode, idle ── */}
        {mode === 'history' && state === 'idle' && !replaying && (
          <>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.65, margin: '0 0 10px' }}>
              Replays how this project was built — tracks and notes appearing in order,
              playing the song at each milestone, then the finished track. Perfect for a
              &ldquo;watch it get made&rdquo; clip.
            </p>
            {historyLen === 0 ? (
              <p style={{ fontSize: 11.5, color: '#f59e0b', lineHeight: 1.6, margin: '0 0 10px' }}>
                No build history recorded for this project yet. It records as you build — make
                some edits and save, or open a project authored with a history.
              </p>
            ) : (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 10px' }}>
                {historyLen} steps recorded.
              </p>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={includeMic} onChange={e => setIncludeMic(e.target.checked)} />
              Also record my microphone
            </label>
            <button onClick={() => void playHistory(true)} disabled={historyLen === 0 || !supported}
              style={{ width: '100%', padding: '9px 0', borderRadius: 9, border: 'none', background: historyLen ? '#dc2626' : 'var(--border)', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: historyLen ? 'pointer' : 'not-allowed', marginBottom: 6, opacity: historyLen ? 1 : 0.6 }}>
              ● Record the build
            </button>
            <button onClick={() => void playHistory(false)} disabled={historyLen === 0}
              style={{ width: '100%', padding: '8px 0', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, cursor: historyLen ? 'pointer' : 'not-allowed', opacity: historyLen ? 1 : 0.6 }}>
              ▶ Preview (no recording)
            </button>
          </>
        )}

        {state === 'recording' && mode === 'screen' && highlightClicks && !replaying && <ClickHighlighter style={clickStyle} />}

        {/* ── In progress (recording and/or replaying) ── */}
        {inProgress && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ width: 9, height: 9, borderRadius: 5, background: '#dc2626', animation: 'pulse 1.2s infinite' }} />
              <span style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', fontWeight: 700 }}>
                {formatDuration(elapsed * 1000)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                {replaying ? 'replaying build' : includeMic ? 'screen + studio + mic' : 'screen + studio'}
              </span>
            </div>
            {replaying && buildProg && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ height: 5, borderRadius: 99, background: 'var(--border)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round(buildProg.i / buildProg.total * 100)}%`, background: 'var(--accent, #7c3aed)', transition: 'width 0.15s' }} />
                </div>
                <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '5px 0 0' }}>Building… step {buildProg.i} / {buildProg.total}</p>
              </div>
            )}
            <button onClick={() => { if (replaying) cancelRef.current = true; else void finish() }}
              style={{ width: '100%', padding: '9px 0', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              ■ Stop
            </button>
          </>
        )}

        {/* ── Done: preview (shared by both modes) ── */}
        {state === 'done' && result && previewUrl && (
          <>
            <video src={previewUrl} controls playsInline
              style={{ width: '100%', borderRadius: 9, border: '1px solid var(--border)', display: 'block', marginBottom: 8, background: '#000' }} />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 10px' }}>
              {formatDuration(result.durationMs)} · {formatSize(result.sizeBytes)}
            </p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button onClick={download}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Save video
              </button>
              <button onClick={reset}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>
                Record another
              </button>
            </div>
            {share === 'shared' ? (
              <p style={{ fontSize: 11.5, color: '#34d399', fontWeight: 600, margin: 0 }}>✓ Shared to the community</p>
            ) : (
              <button onClick={() => void shareToCommunity()} disabled={share === 'sharing'}
                style={{ width: '100%', padding: '8px 0', borderRadius: 8, border: '1px solid rgba(139,92,246,0.35)', background: 'rgba(139,92,246,0.14)', color: 'var(--accent-light)', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: share === 'sharing' ? 0.6 : 1 }}>
                {share === 'sharing' ? 'Sharing…' : '↑ Share to community'}
              </button>
            )}
            {shareErr && <p style={{ fontSize: 11, color: '#ef4444', margin: '6px 0 0' }}>{shareErr}</p>}
          </>
        )}

        {error && (
          <p style={{ fontSize: 11.5, color: '#ef4444', margin: '10px 0 0', lineHeight: 1.6 }}>{error}</p>
        )}

        <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } } @keyframes msIn { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }`}</style>
      </div>
    </>
  )
}
