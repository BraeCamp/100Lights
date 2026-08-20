'use client'
// Apollo — the merged shell (/apollo). Formerly the /apollo2 experiment; now
// the one UI. Flat theme, three tabs, and every module always visible as a
// RESIZABLE panel (drag its right edge for width, bottom edge for height,
// corner for both — sizes persist), so the space fills the way you want.
//
// Kept from the experiment: bare "+" inventories (envelopes / LFOs / macros /
// FX busses grow as used), knob-hover ⊕ quick-mod, Movement drawer, keyboard
// HOLD latch + 📌 pin, /apollo/new. Changed on Brae's direction: collapsed
// chain segments are gone (modules are plain panels again), knobs are flat
// solid color, File ▾ gathers Export/Import/Bounce/Share, and Random/Mutate
// live as 🎲 dice on the modules they affect.

import React, { useEffect, useRef, useState } from 'react'
import { ApolloProvider, useApollo, useMeters, Knob, UI, Section } from '@/components/apps/apollo/ApolloContext'
import PresetBar from '@/components/apps/apollo/PresetBar'
import OscPanel from '@/components/apps/apollo/OscPanel'
import SubNoisePanel from '@/components/apps/apollo/SubNoisePanel'
import FilterPanel from '@/components/apps/apollo/FilterPanel'
import EnvPanel from '@/components/apps/apollo/EnvPanel'
import LfoPanel from '@/components/apps/apollo/LfoPanel'
import ModMatrixPanel from '@/components/apps/apollo/ModMatrixPanel'
import ModSourcesStrip from '@/components/apps/apollo/ModSourcesStrip'
import FxRack from '@/components/apps/apollo/FxRack'
import ArpPanel from '@/components/apps/apollo/ArpPanel'
import ClipPanel from '@/components/apps/apollo/ClipPanel'
import GlobalPanel from '@/components/apps/apollo/GlobalPanel'
import KeyboardStrip from '@/components/apps/apollo/KeyboardStrip'
import WavetableEditor from '@/components/apps/apollo/WavetableEditor'
import ScopeView from '@/components/apps/apollo/ScopeView'
import LearnMode from '@/components/apps/apollo/LearnMode'
import HelpButton from '@/components/apps/apollo/HelpButton'
import { startWebMidi, onMidiNote, webMidiSupported, getMidiDeviceNames } from '@/lib/web-midi'
import { startMpe, stopMpe } from '@/lib/apollo/mpe'

type Tab = 'sound' | 'effects' | 'perform'
const TABS: { id: Tab; label: string }[] = [
  { id: 'sound', label: 'SOUND' }, { id: 'effects', label: 'EFFECTS' }, { id: 'perform', label: 'PERFORM' },
]

// ── Resizable module wrapper ────────────────────────────────────────────────
// Every panel sits in a Module that can be stretched in any direction: right
// edge = width, bottom edge = height, corner = both. Sizes persist per module.
const SIZES_KEY = 'apollo_mod_sizes_v2'
type ModSize = { w: number | null; h: number | null }
function loadSizes(): Record<string, ModSize> {
  try { return JSON.parse(localStorage.getItem(SIZES_KEY) || '{}') as Record<string, ModSize> } catch { return {} }
}
function saveSize(id: string, size: ModSize) {
  try {
    const all = loadSizes()
    all[id] = size
    localStorage.setItem(SIZES_KEY, JSON.stringify(all))
  } catch { /* quota */ }
}

function Module({ id, defaultW, minW = 260, children }: { id: string; defaultW: number; minW?: number; children: React.ReactNode }) {
  const [size, setSize] = useState<ModSize>({ w: null, h: null })
  const sizeRef = useRef(size)
  sizeRef.current = size
  const dragRef = useRef<{ mode: 'w' | 'h' | 'wh'; x: number; y: number; w: number; h: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setSize(loadSizes()[id] ?? { w: null, h: null }) }, [id])

  const startDrag = (mode: 'w' | 'h' | 'wh') => (e: React.PointerEvent) => {
    e.preventDefault()
    const box = boxRef.current
    if (!box) return
    dragRef.current = { mode, x: e.clientX, y: e.clientY, w: box.offsetWidth, h: box.offsetHeight }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* synthetic */ }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (e.buttons === 0) { dragRef.current = null; saveSize(id, sizeRef.current); return }
    const next: ModSize = { ...sizeRef.current }
    if (d.mode !== 'h') next.w = Math.max(minW, d.w + (e.clientX - d.x))
    if (d.mode !== 'w') next.h = Math.max(120, d.h + (e.clientY - d.y))
    setSize(next)
  }
  const endDrag = () => {
    if (!dragRef.current) return
    dragRef.current = null
    saveSize(id, sizeRef.current)
  }
  const handle = (mode: 'w' | 'h' | 'wh', style: React.CSSProperties) => (
    <div
      key={mode}
      onPointerDown={startDrag(mode)}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => { const reset = { w: null, h: null }; setSize(reset); saveSize(id, reset) }}
      title="Drag to resize this module (double-click resets)"
      style={{ position: 'absolute', zIndex: 4, touchAction: 'none', ...style }}
    />
  )

  return (
    <div
      ref={boxRef}
      style={{
        position: 'relative',
        width: size.w ?? defaultW,
        height: size.h ?? undefined,
        minWidth: minW,
        maxWidth: '100%',
        display: 'flex', flexDirection: 'column',
        overflow: size.h ? 'auto' : 'visible',
        flexGrow: 0, flexShrink: 0,
      }}
    >
      {children}
      {handle('w', { top: 0, bottom: 0, right: -3, width: 7, cursor: 'ew-resize' })}
      {handle('h', { left: 0, right: 0, bottom: -3, height: 7, cursor: 'ns-resize' })}
      {handle('wh', { right: -3, bottom: -3, width: 13, height: 13, cursor: 'nwse-resize' })}
    </div>
  )
}

// ── Macros: only named knobs exist; "+" names a new one ─────────────────────
function MacrosBlock() {
  const ctx = useApollo()
  const named = ctx.patch.macroNames.map((name, i) => ({ name, i })).filter(m => m.name && m.name !== `Macro ${m.i + 1}`)
  const free = ctx.patch.macroNames.findIndex((n, i) => !n || n === `Macro ${i + 1}`)
  return (
    <Section title="Knobs">
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {named.map(m => (
          <Knob
            key={m.i}
            label={m.name}
            size={42}
            min={0} max={1} def={0}
            value={ctx.patch.macros[m.i]}
            onChange={v => { ctx.setParam(`macro${m.i + 1}`, v); ctx.engine.setMacro(m.i, v) }}
            onCommit={() => ctx.commit()}
          />
        ))}
        {named.length === 0 && (
          <span style={{ fontSize: 10.5, color: UI.dim }}>No performance knobs yet — add one, then point it at anything via its ring or the Movement list.</span>
        )}
        {free >= 0 && (
          <button
            onClick={() => {
              const name = window.prompt('Name this knob', 'Custom')?.trim()
              if (name) ctx.update(p => { p.macroNames[free] = name })
            }}
            title="Another performance knob"
            style={{ width: 30, height: 30, borderRadius: '50%', border: `1px dashed ${UI.border}`, background: 'transparent', color: UI.dim, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}
          >+</button>
        )}
      </div>
    </Section>
  )
}

// ── Movement slide-over: the matrix as a drawer ─────────────────────────────
function MovementDrawer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.45)' }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(560px, 94vw)',
          background: UI.bg, borderLeft: `1px solid ${UI.borderLight}`, padding: 12, overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: UI.text, textTransform: 'uppercase' }}>Movement</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: UI.dim, cursor: 'pointer', fontSize: 15 }}>✕</button>
        </div>
        <div style={{ fontSize: 10.5, color: UI.dim, marginBottom: 8, lineHeight: 1.5 }}>
          Everything that moves by itself — created by knob “+”, ring drags, or chip drops — lives here.
        </div>
        <ModMatrixPanel />
      </div>
    </div>
  )
}

// ── Shell ───────────────────────────────────────────────────────────────────
function ApolloInner() {
  const ctx = useApollo()
  const meters = useMeters()
  const [tab, setTab] = useState<Tab>('sound')
  const [wtOpen, setWtOpen] = useState(false)
  const [movementOpen, setMovementOpen] = useState(false)
  const [midiOn, setMidiOn] = useState(false)
  const [midiName, setMidiName] = useState('')
  const [midiAvailable, setMidiAvailable] = useState(false)
  const [mpeOn, setMpeOn] = useState(false)
  const [kbdPinned, setKbdPinned] = useState(false)
  useEffect(() => {
    setMidiAvailable(webMidiSupported)
    setKbdPinned(localStorage.getItem('apollo2_kbd_pin') === '1')
  }, [])
  const togglePin = () => {
    setKbdPinned(v => {
      try { localStorage.setItem('apollo2_kbd_pin', v ? '0' : '1') } catch { /* quota */ }
      return !v
    })
  }

  useEffect(() => {
    if (!midiOn || mpeOn) return
    const off = onMidiNote(e => {
      if (e.type === 'on') { void ctx.start().then(() => ctx.engine.noteOn(e.pitch, e.velocity / 127)) }
      else ctx.engine.noteOff(e.pitch)
    })
    return () => { off() }
  }, [midiOn, mpeOn, ctx])

  const toggleMpe = async () => {
    if (mpeOn) { stopMpe(); setMpeOn(false); return }
    await ctx.start()
    const ok = await startMpe(ctx.engine)
    if (ok) setMpeOn(true)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      if (e.shiftKey) ctx.redo()
      else ctx.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctx])

  // "+"-grown inventories: derived from use + session clicks
  const [extraEnvs, setExtraEnvs] = useState(0)
  const [extraLfos, setExtraLfos] = useState(0)
  let envUsed = 1
  let lfoUsed = 1
  for (const r of ctx.patch.matrix) {
    const em = /^env([2-4])$/.exec(r.source)
    if (em) envUsed = Math.max(envUsed, Number(em[1]))
    const lm = /^lfo(\d+)y?$/.exec(r.source)
    if (lm) lfoUsed = Math.max(lfoUsed, Number(lm[1]))
  }
  const envVisible = Math.min(4, Math.max(envUsed, 1 + extraEnvs))
  const lfoVisible = Math.min(10, Math.max(lfoUsed, 1 + extraLfos))
  const routeCount = ctx.patch.matrix.length

  const headerBtn = (label: string, onClick: () => void, opts?: { on?: boolean; title?: string }) => (
    <button
      key={label}
      onClick={onClick}
      title={opts?.title}
      style={{
        background: opts?.on ? UI.blue : UI.header,
        color: opts?.on ? '#0b0d10' : UI.dim,
        border: '1px solid ' + (opts?.on ? UI.blue : UI.border),
        borderRadius: 5, padding: '4px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer',
        whiteSpace: 'nowrap', letterSpacing: 0.5, textTransform: 'uppercase',
      }}
    >{label}</button>
  )

  const enableMidi = async () => {
    if (midiOn) { setMidiOn(false); return }
    const ok = await startWebMidi()
    if (ok) { setMidiOn(true); setMidiName(getMidiDeviceNames()[0] || 'MIDI ready') }
    else setMidiName('No MIDI access')
  }

  const modules = (list: [string, number, React.ReactNode][]) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
      {list.map(([id, w, node]) => <Module key={id} id={id} defaultW={w}>{node}</Module>)}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: UI.bg, color: UI.text, padding: '10px 14px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        background: UI.panel,
        border: `1px solid ${UI.border}`, borderRadius: 8, padding: '7px 12px',
      }}>
        <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: 4 }}>
          APOLLO<span style={{ color: UI.blue }}>2</span>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '5px 13px', borderRadius: 5, fontSize: 10.5, fontWeight: 900, letterSpacing: 1.2, cursor: 'pointer',
              background: tab === t.id ? UI.header : 'transparent',
              color: tab === t.id ? UI.text : UI.dim,
              border: `1px solid ${tab === t.id ? UI.borderLight : 'transparent'}`,
            }}>{t.label}</button>
          ))}
        </div>
        <PresetBar />
        <div style={{ flex: 1 }} />
        {headerBtn('New', () => { window.location.href = '/apollo/new' }, { title: 'Start fresh — a clean patch and a clean slate' })}
        {headerBtn('↩', () => ctx.undo(), { title: 'Undo (Cmd+Z)' })}
        {headerBtn('↪', () => ctx.redo(), { title: 'Redo (Shift+Cmd+Z)' })}
        {headerBtn(`Movement · ${routeCount}`, () => setMovementOpen(true), { title: 'Everything that moves by itself (the mod matrix)' })}
        {headerBtn('WT', () => setWtOpen(true), { title: 'Wavetable editor' })}
        {midiAvailable && headerBtn('MIDI', () => { void enableMidi() }, { on: midiOn && !mpeOn, title: midiName || 'Connect a MIDI keyboard' })}
        {midiAvailable && headerBtn('MPE', () => { void toggleMpe() }, { on: mpeOn, title: 'MPE mode: per-note pitch bend + pressure (Seaboard, Linnstrument…)' })}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Knob path="global.masterGain" label="Main" size={30} />
          <div title="Output level" style={{ width: 7, height: 30, background: UI.inset, border: `1px solid ${UI.border}`, borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${Math.min(100, meters.peak * 100)}%`, background: meters.peak > 1 ? '#e05555' : UI.green, transition: 'height 50ms linear' }} />
          </div>
        </div>
        <HelpButton onShowTab={t => setTab(t === 'fx' ? 'effects' : t === 'seq' || t === 'global' ? 'perform' : 'sound')} />
        <LearnMode />
      </div>

      {/* body — resizable module grid per tab */}
      {tab === 'sound' && modules([
        ['osc', 860, <OscPanel key="osc" />],
        ['env', 560, <EnvPanel key="env" visible={envVisible} onAdd={() => setExtraEnvs(n => Math.min(3, Math.max(n + 1, envVisible)))} />],
        ['subnoise', 560, <SubNoisePanel key="sn" />],
        ['filters', 860, <FilterPanel key="f" />],
        ['lfo', 560, <Section key="l" title="LFO"><LfoPanel visible={lfoVisible} onAdd={() => setExtraLfos(n => Math.min(9, Math.max(n + 1, lfoVisible)))} /></Section>],
        ['macros', 380, <MacrosBlock key="m" />],
        ['scope', 380, <ScopeView key="s" />],
      ])}
      {tab === 'effects' && modules([
        ['fx', 900, <FxRack key="fx" minimal />],
      ])}
      {tab === 'perform' && modules([
        ['arp', 560, <ArpPanel key="a" />],
        ['clip', 720, <ClipPanel key="c" />],
        ['global', 560, <GlobalPanel key="g" />],
      ])}

      <ModSourcesStrip />
      <div style={kbdPinned
        ? { position: 'fixed', left: 10, right: 10, bottom: 8, zIndex: 350, borderRadius: 10 }
        : undefined}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={togglePin}
            title={kbdPinned ? 'Unpin the keyboard' : 'Pin the keyboard to the bottom of the window'}
            style={{
              position: 'absolute', top: 4, right: 6, zIndex: 5,
              width: 22, height: 22, borderRadius: 6, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0,
              background: kbdPinned ? UI.blue : UI.inset,
              color: kbdPinned ? '#0b0d10' : UI.dim,
              border: `1px solid ${kbdPinned ? UI.blue : UI.border}`,
            }}
          >📌</button>
          <KeyboardStrip holdOption />
        </div>
      </div>
      {kbdPinned && <div style={{ height: 120 }} />}

      {movementOpen && <MovementDrawer onClose={() => setMovementOpen(false)} />}
      {wtOpen && <WavetableEditor onClose={() => setWtOpen(false)} />}

      {!ctx.started && (
        <div
          onClick={() => { void ctx.start() }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(6,8,10,0.88)', zIndex: 500,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 8, color: UI.text }}>
            APOLLO<span style={{ color: UI.blue }}>2</span>
          </div>
          <div style={{ fontSize: 13, color: UI.dim }}>Hybrid synthesizer, powered by the Helios engine · click anywhere to start audio</div>
        </div>
      )}
    </div>
  )
}

export default function Apollo2() {
  return (
    <ApolloProvider quickMod>
      <ApolloInner />
    </ApolloProvider>
  )
}
