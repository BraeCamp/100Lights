'use client'

/**
 * SamplerEditor — full sampler instrument UI for BeatLab.
 * Renders as a fixed overlay modal (~600px wide).
 * Handles sample loading, key group mapping, ADSR, filter, and keyboard preview.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import type { SamplerPatch, SamplerKeyGroup } from '@/lib/sampler-engine'
import { loadSampleBuffer, playSamplerNote, DEFAULT_SAMPLER_PATCH } from '@/lib/sampler-engine'
import { SAMPLER_PRESETS, generatePresetBuffers } from '@/lib/sampler-presets'

export type { SamplerPatch, SamplerKeyGroup }

// ── Constants ─────────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const BLACK_KEY_OFFSETS = new Set([1, 3, 6, 8, 10]) // semitone % 12

// 2-octave display: C3 (48) to C5 (72)
const KB_LO = 48
const KB_HI = 72
const WHITE_KEY_W = 26
const WHITE_KEY_H = 72
const BLACK_KEY_W = 16
const BLACK_KEY_H = 44

const ACCENT = '#7c3aed'
const KEY_GROUP_COLORS = [
  '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626',
  '#db2777', '#9333ea', '#2563eb', '#16a34a', '#ca8a04',
]

function midiName(note: number): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ── Mini keyboard layout helpers ──────────────────────────────────────────────

interface KeyInfo {
  note: number
  isBlack: boolean
  x: number  // px from keyboard left edge
}

function buildKeyboard(loNote: number, hiNote: number): KeyInfo[] {
  const keys: KeyInfo[] = []
  let whiteCount = 0

  for (let note = loNote; note <= hiNote; note++) {
    const isBlack = BLACK_KEY_OFFSETS.has(note % 12)
    if (isBlack) {
      // Black key sits between the previous and next white keys
      keys.push({ note, isBlack: true, x: (whiteCount - 1) * WHITE_KEY_W + WHITE_KEY_W - BLACK_KEY_W / 2 })
    } else {
      keys.push({ note, isBlack: false, x: whiteCount * WHITE_KEY_W })
      whiteCount++
    }
  }
  return keys
}

const KEYBOARD = buildKeyboard(KB_LO, KB_HI)
const KEYBOARD_WIDTH = KEYBOARD.filter(k => !k.isBlack).length * WHITE_KEY_W

// ── Slider helper ─────────────────────────────────────────────────────────────

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (v: number) => void
  accentColor?: string
}

function Slider({ label, value, min, max, step, display, onChange, accentColor = ACCENT }: SliderProps) {
  return (
    <div style={{ flex: 1, minWidth: 80 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{display}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor, cursor: 'pointer' }}
      />
    </div>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: '0.08em',
      marginBottom: 10,
    }}>
      {children}
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface SamplerEditorProps {
  patch: SamplerPatch
  onPatchChange: (patch: SamplerPatch) => void
  onClose: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SamplerEditor({ patch, onPatchChange, onClose }: SamplerEditorProps) {
  const [buffers, setBuffers] = useState<Map<string, AudioBuffer>>(new Map())
  const [loadingPreset, setLoadingPreset] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(patch.name)
  const [activeKey, setActiveKey] = useState<number | null>(null)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [fileNames, setFileNames] = useState<Map<string, string>>(new Map())

  const audioCtxRef = useRef<AudioContext | null>(null)
  const stopFnRef = useRef<(() => void) | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Focus name input when editing
  useEffect(() => {
    if (editingName) nameInputRef.current?.select()
  }, [editingName])

  // Lazy AudioContext
  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    if (audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopFnRef.current?.()
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        void audioCtxRef.current.close()
      }
    }
  }, [])

  // ── Patch helpers ──────────────────────────────────────────────────────────

  const updatePatch = useCallback((updates: Partial<SamplerPatch>) => {
    onPatchChange({ ...patch, ...updates })
  }, [patch, onPatchChange])

  const updateKeyGroup = useCallback((id: string, updates: Partial<SamplerKeyGroup>) => {
    onPatchChange({
      ...patch,
      keyGroups: patch.keyGroups.map(g => g.id === id ? { ...g, ...updates } : g),
    })
  }, [patch, onPatchChange])

  const deleteKeyGroup = useCallback((id: string) => {
    setBuffers(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    setFileNames(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    onPatchChange({ ...patch, keyGroups: patch.keyGroups.filter(g => g.id !== id) })
  }, [patch, onPatchChange])

  // ── File loading ───────────────────────────────────────────────────────────

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const buffer = await loadSampleBuffer(file)
      const id = newId()
      const url = URL.createObjectURL(file)
      const newGroup: SamplerKeyGroup = {
        id,
        sampleUrl: url,
        rootNote: 60,
        loNote: 0,
        hiNote: 127,
        loVel: 0,
        hiVel: 127,
        loopStart: 0,
        loopEnd: 0,
        tune: 0,
        gain: 1,
      }
      setBuffers(prev => new Map(prev).set(id, buffer))
      setFileNames(prev => new Map(prev).set(id, file.name))
      onPatchChange({ ...patch, keyGroups: [...patch.keyGroups, newGroup] })
    } catch {
      // Failed to decode — ignore silently
    }
    // Reset so same file can be re-selected
    e.target.value = ''
  }

  // ── Preset loading ─────────────────────────────────────────────────────────

  async function loadPreset(preset: SamplerPatch) {
    setLoadingPreset(true)
    setPresetsOpen(false)
    try {
      const generatedBuffers = await generatePresetBuffers(preset)
      setBuffers(generatedBuffers)
      setFileNames(new Map())
      setNameInput(preset.name)
      onPatchChange({ ...preset, id: newId() })
    } finally {
      setLoadingPreset(false)
    }
  }

  // ── Preview keyboard ───────────────────────────────────────────────────────

  function previewNote(note: number) {
    stopFnRef.current?.()
    const ctx = getAudioCtx()
    const stop = playSamplerNote(ctx, patch, buffers, note, 0.8, ctx.currentTime)
    stopFnRef.current = stop
    setActiveKey(note)
  }

  function stopPreview() {
    stopFnRef.current?.()
    stopFnRef.current = null
    setActiveKey(null)
  }

  // ── Zone color for a key ───────────────────────────────────────────────────

  function getKeyZoneColor(note: number): string | null {
    const idx = patch.keyGroups.findIndex(g => note >= g.loNote && note <= g.hiNote)
    if (idx < 0) return null
    return KEY_GROUP_COLORS[idx % KEY_GROUP_COLORS.length]
  }

  function isRootNote(note: number): boolean {
    return patch.keyGroups.some(g => g.rootNote === note)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 499, background: 'rgba(0,0,0,0.65)' }}
        onClick={onClose}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 500,
        width: 620,
        maxHeight: '90vh',
        overflowY: 'auto',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        fontFamily: 'inherit',
      }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '13px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-card)',
          borderRadius: '12px 12px 0 0',
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: ACCENT, flexShrink: 0 }} />

          {editingName ? (
            <input
              ref={nameInputRef}
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onBlur={() => {
                setEditingName(false)
                if (nameInput.trim()) updatePatch({ name: nameInput.trim() })
                else setNameInput(patch.name)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.currentTarget.blur() }
                if (e.key === 'Escape') { setEditingName(false); setNameInput(patch.name) }
              }}
              style={{
                flex: 1, background: 'transparent', border: 'none',
                outline: '1px solid var(--accent)', borderRadius: 4,
                color: 'var(--text-primary)', fontSize: 14, fontWeight: 700,
                padding: '2px 6px',
              }}
            />
          ) : (
            <button
              onClick={() => setEditingName(true)}
              title="Click to rename"
              style={{
                flex: 1, background: 'none', border: 'none', cursor: 'text',
                color: 'var(--text-primary)', fontSize: 14, fontWeight: 700,
                textAlign: 'left', padding: '2px 4px', borderRadius: 4,
              }}
            >
              {patch.name}
            </button>
          )}

          {/* Presets */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setPresetsOpen(v => !v)}
              style={{
                padding: '5px 10px', borderRadius: 6,
                background: presetsOpen ? `${ACCENT}22` : 'var(--bg-surface)',
                border: `1px solid ${presetsOpen ? ACCENT : 'var(--border)'}`,
                color: presetsOpen ? ACCENT : 'var(--text-secondary)',
                fontSize: 11, cursor: 'pointer', fontWeight: 600,
              }}
            >
              Presets ▾
            </button>
            {presetsOpen && (
              <div style={{
                position: 'absolute', top: '110%', right: 0,
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
                zIndex: 10, minWidth: 160, overflow: 'hidden',
              }}>
                {SAMPLER_PRESETS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => void loadPreset(p)}
                    disabled={loadingPreset}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '9px 14px', background: 'none', border: 'none',
                      color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${ACCENT}18` }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Load sample */}
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '5px 10px', borderRadius: 6,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer',
            }}
          >
            + Load Sample
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            style={{ display: 'none' }}
            onChange={e => void handleFileSelected(e)}
          />

          {/* Close */}
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, marginLeft: 4 }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* ── Loading indicator ── */}
          {loadingPreset && (
            <div style={{
              padding: '10px 14px', background: `${ACCENT}15`, border: `1px solid ${ACCENT}40`,
              borderRadius: 8, color: 'var(--text-secondary)', fontSize: 12, textAlign: 'center',
            }}>
              Generating preset samples…
            </div>
          )}

          {/* ── Mini keyboard ── */}
          <div>
            <SectionLabel>Keyboard Preview · C3–C5</SectionLabel>
            <div style={{
              position: 'relative',
              height: WHITE_KEY_H + 2,
              width: KEYBOARD_WIDTH,
              userSelect: 'none',
            }}>
              {/* White keys first */}
              {KEYBOARD.filter(k => !k.isBlack).map(k => {
                const zoneColor = getKeyZoneColor(k.note)
                const isRoot = isRootNote(k.note)
                const isActive = activeKey === k.note
                return (
                  <div
                    key={k.note}
                    onMouseDown={() => previewNote(k.note)}
                    onMouseUp={stopPreview}
                    onMouseLeave={() => { if (activeKey === k.note) stopPreview() }}
                    title={midiName(k.note)}
                    style={{
                      position: 'absolute',
                      left: k.x,
                      top: 0,
                      width: WHITE_KEY_W - 1,
                      height: WHITE_KEY_H,
                      background: isActive ? '#d0c4f7' : '#e8e8e8',
                      border: '1px solid #555',
                      borderRadius: '0 0 4px 4px',
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                    }}
                  >
                    {/* Zone color strip at bottom */}
                    {zoneColor && (
                      <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        height: 8, background: zoneColor, borderRadius: '0 0 3px 3px',
                        opacity: 0.75,
                      }} />
                    )}
                    {/* Root note dot */}
                    {isRoot && (
                      <div style={{
                        position: 'absolute', bottom: 11, left: '50%', transform: 'translateX(-50%)',
                        width: 5, height: 5, borderRadius: '50%', background: '#fff',
                        boxShadow: `0 0 0 1.5px ${zoneColor ?? ACCENT}`,
                      }} />
                    )}
                    {/* C note label */}
                    {k.note % 12 === 0 && (
                      <div style={{
                        position: 'absolute', bottom: 2, left: 0, right: 0,
                        fontSize: 8, color: '#777', textAlign: 'center', lineHeight: 1,
                        pointerEvents: 'none',
                      }}>
                        {midiName(k.note)}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Black keys on top */}
              {KEYBOARD.filter(k => k.isBlack).map(k => {
                const zoneColor = getKeyZoneColor(k.note)
                const isActive = activeKey === k.note
                return (
                  <div
                    key={k.note}
                    onMouseDown={e => { e.stopPropagation(); previewNote(k.note) }}
                    onMouseUp={stopPreview}
                    onMouseLeave={() => { if (activeKey === k.note) stopPreview() }}
                    title={midiName(k.note)}
                    style={{
                      position: 'absolute',
                      left: k.x,
                      top: 0,
                      width: BLACK_KEY_W,
                      height: BLACK_KEY_H,
                      background: isActive ? '#5b2d9e' : '#1a1a1a',
                      border: '1px solid #000',
                      borderRadius: '0 0 3px 3px',
                      zIndex: 2,
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                    }}
                  >
                    {zoneColor && (
                      <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        height: 6, background: zoneColor, borderRadius: '0 0 2px 2px',
                        opacity: 0.8,
                      }} />
                    )}
                  </div>
                )
              })}
            </div>

            {/* Zone legend */}
            {patch.keyGroups.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {patch.keyGroups.map((g, i) => (
                  <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: KEY_GROUP_COLORS[i % KEY_GROUP_COLORS.length] }} />
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {fileNames.get(g.id)?.replace(/\.[^.]+$/, '') ?? g.sampleUrl.replace('builtin:', '').replace(/-/g, ' ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Key Groups ── */}
          <div>
            <SectionLabel>Key Groups ({patch.keyGroups.length})</SectionLabel>

            {patch.keyGroups.length === 0 && (
              <div style={{
                padding: '20px', textAlign: 'center', color: 'var(--text-muted)',
                fontSize: 12, background: 'var(--bg-card)', borderRadius: 8,
                border: '1px dashed var(--border)',
              }}>
                No samples loaded. Click "Load Sample" or choose a preset.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {patch.keyGroups.map((g, i) => {
                const color = KEY_GROUP_COLORS[i % KEY_GROUP_COLORS.length]
                const hasBuffer = buffers.has(g.id)
                const displayName = fileNames.get(g.id)?.replace(/\.[^.]+$/, '')
                  ?? g.sampleUrl.replace('builtin:', '').replace(/-/g, ' ')

                return (
                  <div key={g.id} style={{
                    background: 'var(--bg-card)',
                    border: `1px solid var(--border)`,
                    borderLeft: `3px solid ${color}`,
                    borderRadius: 8,
                    padding: '11px 12px',
                  }}>
                    {/* Row 1: name + root + delete */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        color: hasBuffer ? 'var(--text-primary)' : 'var(--text-muted)',
                        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {displayName}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>Root</span>
                      <select
                        value={g.rootNote}
                        onChange={e => updateKeyGroup(g.id, { rootNote: Number(e.target.value) })}
                        style={{
                          padding: '3px 6px', borderRadius: 5,
                          background: 'var(--bg-surface)', border: '1px solid var(--border)',
                          color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer',
                        }}
                      >
                        {Array.from({ length: 128 }, (_, n) => (
                          <option key={n} value={n}>{midiName(n)}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => deleteKeyGroup(g.id)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--text-muted)', fontSize: 14, padding: '2px 4px',
                          borderRadius: 4,
                        }}
                        title="Remove key group"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Row 2: range sliders */}
                    <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Lo Note</span>
                          <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{midiName(g.loNote)}</span>
                        </div>
                        <input type="range" min={0} max={127} step={1} value={g.loNote}
                          onChange={e => updateKeyGroup(g.id, { loNote: Math.min(Number(e.target.value), g.hiNote) })}
                          style={{ width: '100%', accentColor: color }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Hi Note</span>
                          <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{midiName(g.hiNote)}</span>
                        </div>
                        <input type="range" min={0} max={127} step={1} value={g.hiNote}
                          onChange={e => updateKeyGroup(g.id, { hiNote: Math.max(Number(e.target.value), g.loNote) })}
                          style={{ width: '100%', accentColor: color }}
                        />
                      </div>
                    </div>

                    {/* Row 3: gain + tune */}
                    <div style={{ display: 'flex', gap: 12 }}>
                      <Slider
                        label="Gain" value={g.gain} min={0} max={2} step={0.01}
                        display={`${Math.round(g.gain * 100)}%`}
                        onChange={v => updateKeyGroup(g.id, { gain: v })}
                        accentColor={color}
                      />
                      <Slider
                        label="Tune" value={g.tune} min={-100} max={100} step={1}
                        display={`${g.tune > 0 ? '+' : ''}${g.tune}¢`}
                        onChange={v => updateKeyGroup(g.id, { tune: v })}
                        accentColor={color}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Envelope + Filter (side by side) ── */}
          <div style={{ display: 'flex', gap: 14 }}>

            {/* ADSR */}
            <div style={{
              flex: 1, padding: '13px 14px',
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
            }}>
              <SectionLabel>Envelope</SectionLabel>
              <div style={{ display: 'flex', gap: 10 }}>
                <Slider
                  label="A" value={patch.attack} min={0} max={2} step={0.001}
                  display={`${patch.attack < 0.1 ? (patch.attack * 1000).toFixed(0) + 'ms' : patch.attack.toFixed(2) + 's'}`}
                  onChange={v => updatePatch({ attack: v })}
                />
                <Slider
                  label="D" value={patch.decay} min={0} max={2} step={0.001}
                  display={`${patch.decay < 0.1 ? (patch.decay * 1000).toFixed(0) + 'ms' : patch.decay.toFixed(2) + 's'}`}
                  onChange={v => updatePatch({ decay: v })}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <Slider
                  label="S" value={patch.sustain} min={0} max={1} step={0.01}
                  display={`${Math.round(patch.sustain * 100)}%`}
                  onChange={v => updatePatch({ sustain: v })}
                />
                <Slider
                  label="R" value={patch.release} min={0} max={4} step={0.01}
                  display={`${patch.release < 0.1 ? (patch.release * 1000).toFixed(0) + 'ms' : patch.release.toFixed(2) + 's'}`}
                  onChange={v => updatePatch({ release: v })}
                />
              </div>

              {/* ADSR visualizer */}
              <AdsrVisualizer
                attack={patch.attack} decay={patch.decay}
                sustain={patch.sustain} release={patch.release}
              />
            </div>

            {/* Filter */}
            <div style={{
              flex: 1, padding: '13px 14px',
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
            }}>
              <SectionLabel>Filter</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Slider
                  label="Cutoff" value={patch.filterCutoff} min={20} max={20000} step={10}
                  display={patch.filterCutoff >= 1000
                    ? `${(patch.filterCutoff / 1000).toFixed(1)}kHz`
                    : `${patch.filterCutoff}Hz`}
                  onChange={v => updatePatch({ filterCutoff: v })}
                />
                <Slider
                  label="Resonance" value={patch.filterResonance} min={0} max={30} step={0.1}
                  display={patch.filterResonance.toFixed(1)}
                  onChange={v => updatePatch({ filterResonance: v })}
                />
              </div>

              {/* Filter visualizer */}
              <FilterVisualizer cutoff={patch.filterCutoff} resonance={patch.filterResonance} />
            </div>
          </div>

          {/* ── Footer ── */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              onClick={() => onPatchChange({ ...DEFAULT_SAMPLER_PATCH, id: newId(), name: patch.name })}
              style={{
                padding: '7px 14px', borderRadius: 6, fontSize: 11,
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              Reset Patch
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '7px 18px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: ACCENT, border: 'none', color: '#fff', cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>

        </div>
      </div>
    </>
  )
}

// ── ADSR Visualizer ───────────────────────────────────────────────────────────

function AdsrVisualizer({ attack, decay, sustain, release }: {
  attack: number; decay: number; sustain: number; release: number
}) {
  const W = 180, H = 48
  const pad = 4

  // Map 0-4s total into the display width
  const total = Math.max(0.3, attack + decay + 0.4 + release)
  const toX = (t: number) => pad + (t / total) * (W - pad * 2)
  const toY = (v: number) => pad + (1 - v) * (H - pad * 2)

  const x0 = toX(0)
  const x1 = toX(attack)
  const x2 = toX(attack + decay)
  const x3 = toX(attack + decay + 0.4)
  const x4 = toX(attack + decay + 0.4 + release)

  const path = `M${x0},${toY(0)} L${x1},${toY(1)} L${x2},${toY(sustain)} L${x3},${toY(sustain)} L${x4},${toY(0)}`

  return (
    <svg width={W} height={H} style={{ marginTop: 10, display: 'block' }}>
      <path d={path} fill="none" stroke={ACCENT} strokeWidth={1.5} strokeLinejoin="round" />
      <path d={`${path} L${x4},${toY(0)} L${x0},${toY(0)} Z`} fill={`${ACCENT}18`} />
    </svg>
  )
}

// ── Filter Visualizer ─────────────────────────────────────────────────────────

function FilterVisualizer({ cutoff, resonance }: { cutoff: number; resonance: number }) {
  const W = 180, H = 48
  const pad = 4

  // Log scale x: 20 Hz to 20000 Hz
  const freqToX = (f: number) =>
    pad + (Math.log10(f / 20) / Math.log10(1000)) * (W - pad * 2)
  const gainToY = (g: number) =>
    pad + (1 - Math.max(0, Math.min(1, (g + 6) / 30)) ) * (H - pad * 2)

  // Rough LP frequency response
  const points: string[] = []
  const steps = 60
  for (let i = 0; i <= steps; i++) {
    const f = 20 * Math.pow(1000, i / steps)
    const ratio = f / cutoff
    // Simplified 2nd order lowpass + resonance peak
    const peak = 1 + resonance * 0.08 * Math.exp(-Math.pow(Math.log(ratio), 2) * 8)
    const roll = 1 / Math.sqrt(1 + Math.pow(ratio, 4))
    const gainDb = 20 * Math.log10(roll * peak)
    const x = freqToX(f)
    const y = gainToY(Math.max(-24, Math.min(6, gainDb)))
    points.push(`${i === 0 ? 'M' : 'L'}${x},${y}`)
  }
  const pathD = points.join(' ')
  const fillD = `${pathD} L${freqToX(20000)},${H} L${freqToX(20)},${H} Z`

  return (
    <svg width={W} height={H} style={{ marginTop: 10, display: 'block' }}>
      <path d={fillD} fill={`${ACCENT}14`} />
      <path d={pathD} fill="none" stroke={ACCENT} strokeWidth={1.5} />
      {/* Cutoff marker */}
      <line
        x1={freqToX(cutoff)} y1={pad} x2={freqToX(cutoff)} y2={H - pad}
        stroke={`${ACCENT}50`} strokeWidth={1} strokeDasharray="3,2"
      />
    </svg>
  )
}
