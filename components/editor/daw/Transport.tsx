'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Play, Square, Circle, SkipBack, Repeat, Music2, Volume2 } from 'lucide-react'
import { useDaw, formatBeat } from '@/lib/daw-state'
import dynamic from 'next/dynamic'

const PadTuner = dynamic(() => import('./PadTuner'), { ssr: false })

export default function Transport() {
  const { project, dispatch, engine, playing, recording, setPosition, metronome, setMetronome } = useDaw()

  const posRef = useRef<HTMLSpanElement>(null)
  const rafRef = useRef<number | undefined>(undefined)

  const [editingBpm, setEditingBpm] = useState(false)
  const [bpmDraft, setBpmDraft] = useState('')
  const [editingTimeSig, setEditingTimeSig] = useState(false)
  const [showTuner, setShowTuner] = useState(false)
  const [tsDraft, setTsDraft] = useState({ num: project.timeSignatureNum, den: project.timeSignatureDen })

  // Direct DOM mutation every frame — keeps position display smooth without React re-renders
  useEffect(() => {
    const num = project.timeSignatureNum
    function frame() {
      if (posRef.current) {
        posRef.current.textContent = formatBeat(engine.currentBeat, num)
      }
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current) }
  }, [engine, project.timeSignatureNum])

  function handlePlayStop() {
    if (playing) {
      engine.stop()
    } else {
      engine.play()
    }
  }

  function handleRecord() {
    if (recording) {
      if (playing) engine.stop()   // pause at current position, not rewind
      engine.stopRecording()
    } else {
      if (!playing) engine.play()
      engine.startRecording()
    }
  }

  function handleRewind() {
    engine.seek(0)
    setPosition(0)
  }

  function handleLoopToggle() {
    dispatch({ type: 'SET_LOOP_ENABLED', enabled: !project.loopEnabled })
  }

  function handleBpmCommit(value: string) {
    const n = parseFloat(value)
    if (!isNaN(n) && n > 0) dispatch({ type: 'SET_TEMPO', tempo: n })
    setEditingBpm(false)
  }

  function handleTap() {
    const bpm = engine.tap()
    if (bpm !== null) dispatch({ type: 'SET_TEMPO', tempo: bpm })
  }

  function handleMetronomeToggle() {
    const next = !metronome
    setMetronome(next)
    engine.setMetronome(next)
  }

  function handleTimeSigCommit() {
    dispatch({ type: 'SET_TIME_SIG', num: tsDraft.num, den: tsDraft.den })
    setEditingTimeSig(false)
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    dispatch({ type: 'SET_MASTER_VOLUME', volume: parseFloat(e.target.value) })
    engine.setMasterVolume(parseFloat(e.target.value))
  }

  const base: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#1e1e1e',
    border: '1px solid var(--border)',
    borderRadius: 4,
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    width: 28,
    height: 28,
    flexShrink: 0,
    padding: 0,
  }

  const active: React.CSSProperties = {
    ...base,
    background: 'var(--accent)',
    border: '1px solid var(--accent)',
    color: '#fff',
  }

  const divider: React.CSSProperties = {
    width: 1,
    height: 28,
    background: 'var(--border)',
    flexShrink: 0,
    margin: '0 2px',
  }

  const monoDisplay: React.CSSProperties = {
    background: '#111',
    border: '1px solid var(--border)',
    borderRadius: 4,
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 12,
    padding: '3px 8px',
    lineHeight: 1.4,
  }

  const inputStyle: React.CSSProperties = {
    background: '#111',
    border: '1px solid var(--accent)',
    borderRadius: 3,
    color: 'var(--text-primary)',
    fontSize: 12,
    fontFamily: 'monospace',
    outline: 'none',
    textAlign: 'center',
    padding: '2px 4px',
  }

  return (
    <div style={{
      height: 48,
      background: '#1a1a1a',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '0 10px',
      flexShrink: 0,
    }}>
      {/* Transport controls */}
      <button style={base} onClick={handleRewind} title="Rewind to start">
        <SkipBack size={13} />
      </button>

      <button
        style={playing ? active : base}
        onClick={handlePlayStop}
        title="Play / Stop (Space)"
      >
        {playing
          ? <Square size={11} fill="currentColor" />
          : <Play size={13} fill="currentColor" />
        }
      </button>

      <button
        style={{
          ...base,
          color: recording ? '#ff3b3b' : 'var(--text-secondary)',
          border: recording ? '1px solid #ff3b3b' : '1px solid var(--border)',
          background: recording ? 'rgba(255,59,59,0.14)' : '#1e1e1e',
        }}
        onClick={handleRecord}
        title="Record"
      >
        <Circle size={11} fill={recording ? '#ff3b3b' : 'transparent'} color={recording ? '#ff3b3b' : 'currentColor'} />
      </button>

      <button
        style={project.loopEnabled ? active : base}
        onClick={handleLoopToggle}
        title="Toggle loop"
      >
        <Repeat size={13} />
      </button>

      <div style={divider} />

      {/* Position */}
      <div style={{
        ...monoDisplay,
        cursor: 'default',
        fontSize: 14,
        letterSpacing: '0.04em',
        minWidth: 78,
        textAlign: 'center',
        padding: '3px 8px',
        userSelect: 'none',
      }}>
        <span ref={posRef}>1.1.1</span>
      </div>

      <div style={divider} />

      {/* BPM */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {editingBpm ? (
          <input
            autoFocus
            type="number"
            min={40}
            max={300}
            value={bpmDraft}
            onChange={e => setBpmDraft(e.target.value)}
            onBlur={() => handleBpmCommit(bpmDraft)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleBpmCommit(bpmDraft)
              if (e.key === 'Escape') setEditingBpm(false)
              e.stopPropagation()
            }}
            style={{ ...inputStyle, width: 52 }}
          />
        ) : (
          <button
            onClick={() => { setBpmDraft(String(project.tempo)); setEditingBpm(true) }}
            style={{ ...monoDisplay, minWidth: 52, textAlign: 'center' }}
            title="Click to edit BPM"
          >
            {project.tempo}
          </button>
        )}
        <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', userSelect: 'none' }}>BPM</span>
        <button
          onClick={handleTap}
          style={{ ...base, width: 'auto', padding: '0 7px', fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.06em' }}
          title="Tap tempo"
        >
          TAP
        </button>
      </div>

      {/* Time signature */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {editingTimeSig ? (
          <>
            <input
              autoFocus
              type="number"
              min={1}
              max={16}
              value={tsDraft.num}
              onChange={e => setTsDraft(d => ({ ...d, num: Math.max(1, parseInt(e.target.value) || d.num) }))}
              onBlur={handleTimeSigCommit}
              onKeyDown={e => { if (e.key === 'Enter') handleTimeSigCommit(); e.stopPropagation() }}
              style={{ ...inputStyle, width: 28 }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>/</span>
            <input
              type="number"
              min={1}
              max={16}
              value={tsDraft.den}
              onChange={e => setTsDraft(d => ({ ...d, den: Math.max(1, parseInt(e.target.value) || d.den) }))}
              onBlur={handleTimeSigCommit}
              onKeyDown={e => { if (e.key === 'Enter') handleTimeSigCommit(); e.stopPropagation() }}
              style={{ ...inputStyle, width: 28 }}
            />
          </>
        ) : (
          <button
            onClick={() => {
              setTsDraft({ num: project.timeSignatureNum, den: project.timeSignatureDen })
              setEditingTimeSig(true)
            }}
            style={{ ...monoDisplay, fontSize: 12, padding: '3px 8px' }}
            title="Click to edit time signature"
          >
            {project.timeSignatureNum}/{project.timeSignatureDen}
          </button>
        )}
      </div>

      <div style={divider} />

      {/* Metronome */}
      <button
        style={metronome ? active : base}
        onClick={handleMetronomeToggle}
        title="Toggle metronome (M)"
      >
        <Music2 size={13} />
      </button>

      <div style={divider} />

      {/* Master volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Volume2 size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={project.masterVolume}
          onChange={handleVolumeChange}
          className="cf-slider"
          style={{ width: 68, accentColor: 'var(--accent)' }}
        />
      </div>

      <div style={divider} />

      {/* Tuner toggle */}
      <button
        onClick={() => setShowTuner(v => !v)}
        title="Open tuner"
        style={{
          ...base,
          width: 'auto', padding: '0 9px',
          fontSize: 12,
          background: showTuner ? 'var(--accent)' : '#1e1e1e',
          border: showTuner ? '1px solid var(--accent)' : '1px solid var(--border)',
          color: showTuner ? '#fff' : 'var(--text-secondary)',
        }}
      >
        ♩
      </button>

      {/* Floating tuner panel */}
      {showTuner && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', top: 56, right: 12, zIndex: 9998,
          width: 290, background: '#111', border: '1px solid #2a2a2a',
          borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 12px', borderBottom: '1px solid #1e1e1e', background: '#171717',
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>♩ Tuner</span>
            <button onClick={() => setShowTuner(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
          <PadTuner />
        </div>,
        document.body
      )}
    </div>
  )
}
