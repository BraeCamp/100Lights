'use client'
// Apollo — the 100Lights hybrid synthesizer (Helios engine) for sound design
// and sample mangling.
// Hidden page: /apollo (noindex). All audio runs in one AudioWorklet.
//
// The UI is decoupled from the engine: every panel is a self-contained module
// registered in PANELS below, and the per-tab layout (two columns of panel
// ids) is data — drag a panel's grip bar to rearrange; layout persists.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ApolloProvider, useApollo, useMeters, Section, Knob, UI, applyApolloTheme } from '@/components/apps/apollo/ApolloContext'
import PresetBar from '@/components/apps/apollo/PresetBar'
import OscPanel from '@/components/apps/apollo/OscPanel'
import SubNoisePanel from '@/components/apps/apollo/SubNoisePanel'
import FilterPanel from '@/components/apps/apollo/FilterPanel'
import EnvPanel from '@/components/apps/apollo/EnvPanel'
import LfoPanel from '@/components/apps/apollo/LfoPanel'
import MacroPanel from '@/components/apps/apollo/MacroPanel'
import ModMatrixPanel from '@/components/apps/apollo/ModMatrixPanel'
import ModSourcesStrip from '@/components/apps/apollo/ModSourcesStrip'
import MixerPanel from '@/components/apps/apollo/MixerPanel'
import FxRack from '@/components/apps/apollo/FxRack'
import ArpPanel from '@/components/apps/apollo/ArpPanel'
import ClipPanel from '@/components/apps/apollo/ClipPanel'
import GlobalPanel from '@/components/apps/apollo/GlobalPanel'
import KeyboardStrip from '@/components/apps/apollo/KeyboardStrip'
import WavetableEditor from '@/components/apps/apollo/WavetableEditor'
import ScopeView from '@/components/apps/apollo/ScopeView'
import LearnMode from '@/components/apps/apollo/LearnMode'
import HelpButton from '@/components/apps/apollo/HelpButton'
import { startWebMidi, onMidiNote, onMidiCC, webMidiSupported, getMidiDeviceNames } from '@/lib/web-midi'
import { startMpe, stopMpe } from '@/lib/apollo/mpe'

type Tab = 'synth' | 'mix' | 'fx' | 'matrix' | 'seq' | 'global'
const TABS: { id: Tab; label: string }[] = [
  { id: 'synth', label: 'OSC' }, { id: 'mix', label: 'MIX' }, { id: 'fx', label: 'FX' },
  { id: 'matrix', label: 'MATRIX' }, { id: 'seq', label: 'SEQ' }, { id: 'global', label: 'GLOBAL' },
]

// ---------------------------------------------------------------------------
// Panel registry — the layout only refers to these ids.

const PANELS: Record<string, { render: () => React.ReactNode }> = {
  osc: { render: () => <OscPanel /> },
  subnoise: { render: () => <SubNoisePanel /> },
  filters: { render: () => <FilterPanel /> },
  env: { render: () => <EnvPanel /> },
  lfo: { render: () => <Section title="LFO"><LfoPanel /></Section> },
  macros: { render: () => <Section title="Macros"><MacroPanel /></Section> },
  matrix: { render: () => <ModMatrixPanel /> },
  mixer: { render: () => <MixerPanel /> },
  fx: { render: () => <FxRack /> },
  arp: { render: () => <ArpPanel /> },
  clip: { render: () => <ClipPanel /> },
  global: { render: () => <GlobalPanel /> },
  scope: { render: () => <ScopeView /> },
}

type TabLayout = [string[], string[]]
const DEFAULT_LAYOUT: Record<Tab, TabLayout> = {
  synth: [['osc', 'subnoise', 'filters'], ['env', 'lfo', 'macros', 'scope']],
  mix: [['mixer', 'scope'], []],
  fx: [['fx'], []],
  matrix: [['matrix', 'macros'], ['env', 'lfo']],
  seq: [['arp', 'clip'], []],
  global: [['global'], []],
}
const LAYOUT_KEY = 'apollo_layout_v1'

function loadLayout(): Record<Tab, TabLayout> {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<Tab, TabLayout>
      const out = structuredClone(DEFAULT_LAYOUT)
      for (const t of Object.keys(out) as Tab[]) {
        if (parsed[t]) out[t] = [parsed[t][0].filter(id => PANELS[id]), parsed[t][1].filter(id => PANELS[id])]
      }
      // any panel missing from a tab's saved layout falls back to its default spot
      for (const t of Object.keys(out) as Tab[]) {
        const present = new Set([...out[t][0], ...out[t][1]])
        for (const col of [0, 1] as const) {
          for (const id of DEFAULT_LAYOUT[t][col]) if (!present.has(id)) out[t][col].push(id)
        }
      }
      return out
    }
  } catch { /* corrupt layout */ }
  return structuredClone(DEFAULT_LAYOUT)
}

function ApolloInner() {
  applyApolloTheme({}) // default Apollo look (test shells set their own)
  const ctx = useApollo()
  const meters = useMeters()
  const [tab, setTab] = useState<Tab>('synth')
  const [wtOpen, setWtOpen] = useState(false)
  const [midiOn, setMidiOn] = useState(false)
  const [midiName, setMidiName] = useState('')
  const [midiAvailable, setMidiAvailable] = useState(false)
  const [mpeOn, setMpeOn] = useState(false)
  const [layout, setLayout] = useState<Record<Tab, TabLayout>>(DEFAULT_LAYOUT)
  const [layoutTick, setLayoutTick] = useState(0)
  const dragPanel = useRef<{ tab: Tab; col: 0 | 1; idx: number } | null>(null)
  useEffect(() => { setMidiAvailable(webMidiSupported); setLayout(loadLayout()) }, [])

  const saveLayout = useCallback((next: Record<Tab, TabLayout>) => {
    setLayout(next)
    setLayoutTick(t => t + 1)
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)) } catch { /* quota */ }
  }, [])

  const movePanel = useCallback((toCol: 0 | 1, toIdx: number) => {
    const from = dragPanel.current
    if (!from || from.tab !== tab) return
    const next = structuredClone(layout)
    const [id] = next[tab][from.col].splice(from.idx, 1)
    if (!id) return
    let insertAt = toIdx
    if (from.col === toCol && from.idx < toIdx) insertAt -= 1
    next[tab][toCol].splice(Math.max(0, Math.min(insertAt, next[tab][toCol].length)), 0, id)
    dragPanel.current = null
    saveLayout(next)
  }, [layout, tab, saveLayout])

  // Web MIDI hookup (plain mode — disabled while MPE mode owns the input)
  useEffect(() => {
    if (!midiOn || mpeOn) return
    const offNote = onMidiNote(e => {
      if (e.type === 'on') { void ctx.start().then(() => ctx.engine.noteOn(e.pitch, e.velocity / 127)) }
      else ctx.engine.noteOff(e.pitch)
    })
    const offCC = onMidiCC(e => {
      if (e.cc === 1) ctx.engine.setWheel(null, e.value / 127)
      else if (e.cc === 64) ctx.engine.sustain(e.value >= 64)
    })
    return () => { offNote(); offCC() }
  }, [midiOn, mpeOn, ctx])

  const toggleMpe = async () => {
    if (mpeOn) { stopMpe(); setMpeOn(false); return }
    await ctx.start()
    const ok = await startMpe(ctx.engine)
    if (ok) setMpeOn(true)
  }

  // undo / redo shortcuts
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

  const enableMidi = async () => {
    if (midiOn) { setMidiOn(false); return }
    const ok = await startWebMidi()
    if (ok) {
      setMidiOn(true)
      setMidiName(getMidiDeviceNames()[0] || 'MIDI ready')
    } else setMidiName('No MIDI access')
  }

  const renderColumn = (col: 0 | 1, ids: string[]) => (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); movePanel(col, ids.length) }}
    >
      {ids.map((id, idx) => {
        const def = PANELS[id]
        if (!def) return null
        return (
          <div
            key={id}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); movePanel(col, idx) }}
            style={{ position: 'relative' }}
          >
            <div
              draggable
              onDragStart={() => { dragPanel.current = { tab, col, idx } }}
              title="Drag to rearrange panels"
              style={{
                // left edge of the header bar: keeps clear of every panel's
                // header-right controls (tabs, +Add, toggles)
                position: 'absolute', top: 4, left: 2, zIndex: 5,
                width: 16, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: UI.dim, fontSize: 11, cursor: 'grab', opacity: 0.4, borderRadius: 4,
              }}
            >⠿</div>
            {def.render()}
          </div>
        )
      })}
    </div>
  )

  const [colA, colB] = layout[tab]
  const twoCol = colB.length > 0

  const headerBtn = (label: string, onClick: () => void, opts?: { on?: boolean; title?: string }) => (
    <button
      onClick={onClick}
      title={opts?.title}
      style={{
        background: opts?.on ? UI.blue : `linear-gradient(180deg, ${UI.header} 0%, ${UI.panel} 100%)`,
        color: opts?.on ? '#0b0d10' : UI.dim,
        border: `1px solid ${opts?.on ? UI.blue : UI.border}`,
        borderRadius: 5, padding: '4px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer',
        letterSpacing: 0.6, textTransform: 'uppercase', transition: 'all 120ms',
      }}
    >{label}</button>
  )

  return (
    <div
      data-editor="true"
      style={{
        minHeight: '100dvh', background: UI.bg, color: UI.text,
        fontFamily: "'Avenir Next Condensed', 'Arial Narrow', system-ui, sans-serif",
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, maxWidth: 1360, margin: '0 auto' }}>
        {/* header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: `linear-gradient(180deg, ${UI.header} 0%, #101318 100%)`,
          border: `1px solid ${UI.border}`, borderRadius: 8, padding: '7px 12px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: 4, color: UI.text }}>
            APOLLO<span style={{ color: UI.blue, marginLeft: 3 }}>2</span>
          </div>
          {/* tabs */}
          <div style={{ display: 'flex', gap: 3 }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '6px 13px', borderRadius: 5, fontSize: 10.5, fontWeight: 900, letterSpacing: 1.2, cursor: 'pointer',
                  background: tab === t.id ? `linear-gradient(180deg, #2a3442 0%, #1e2530 100%)` : 'transparent',
                  color: tab === t.id ? UI.text : UI.dim,
                  border: `1px solid ${tab === t.id ? UI.borderLight : 'transparent'}`,
                  transition: 'all 120ms', position: 'relative',
                }}
              >
                <span style={{
                  position: 'absolute', top: 3, left: '50%', transform: 'translateX(-50%)',
                  width: 4, height: 4, borderRadius: '50%',
                  background: tab === t.id ? UI.green : '#333a45',
                }} />
                <span style={{ display: 'inline-block', marginTop: 4 }}>{t.label}</span>
              </button>
            ))}
          </div>
          <PresetBar />
          <div style={{ flex: 1 }} />
          {headerBtn('↩', () => ctx.undo(), { title: 'Undo (Cmd+Z)' })}
          {headerBtn('↪', () => ctx.redo(), { title: 'Redo (Shift+Cmd+Z)' })}
          {headerBtn('WT Editor', () => setWtOpen(true))}
          {/* Skins — alternate UI shells over the same engine. Plain links, so
              removing a shell = delete its /apollo/test<N> page + one option. */}
          <select
            value=""
            onChange={e => { if (e.target.value) window.location.href = e.target.value }}
            data-learn="Skin"
            title="Try an alternate look (experimental shells)"
            style={{ background: UI.inset, color: UI.dim, border: `1px solid ${UI.border}`, borderRadius: 5, fontSize: 10, fontWeight: 800, padding: '5px 6px', cursor: 'pointer' }}
          >
            <option value="">SKIN</option>
            <option value="/apollo">Classic</option>
            <option value="/apollo/test1">Amber Console</option>
            <option value="/apollo/test2">Porcelain</option>
            <option value="/apollo/test3">Neon Grid</option>
          </select>
          {midiAvailable && headerBtn('MIDI', () => { void enableMidi() }, { on: midiOn && !mpeOn, title: midiName })}
          {midiAvailable && headerBtn('MPE', () => { void toggleMpe() }, { on: mpeOn, title: 'MPE mode: per-note pitch bend + pressure (Seaboard, Linnstrument…)' })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Knob path="global.masterGain" label="Main" size={32} />
            <div title="Output level" style={{ width: 8, height: 34, background: UI.inset, border: `1px solid ${UI.border}`, borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: `${Math.min(100, meters.peak * 100)}%`,
                background: meters.peak > 1 ? '#e05555' : UI.green,
                transition: 'height 50ms linear',
              }} />
            </div>
          </div>
          {/* Help + Learn mode — top-right corner */}
          <HelpButton onShowTab={t => setTab(t)} />
          <LearnMode />
        </div>

        {/* body: movable panel columns */}
        <div
          key={`${tab}-${layoutTick}`}
          style={twoCol
            ? { display: 'grid', gridTemplateColumns: 'minmax(390px, 3fr) minmax(330px, 2fr)', gap: 8, alignItems: 'start' }
            : { display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {renderColumn(0, colA)}
          {twoCol ? renderColumn(1, colB) : renderColumn(1, colB)}
        </div>

        {/* footer */}
        <ModSourcesStrip />
        <KeyboardStrip />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => saveLayout(structuredClone(DEFAULT_LAYOUT))}
            style={{ background: 'none', border: 'none', color: '#4a515c', fontSize: 9, cursor: 'pointer' }}
          >Reset panel layout</button>
        </div>
      </div>

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
          <div style={{ fontSize: 10, color: '#4a515c', letterSpacing: 1.5, textTransform: 'uppercase' }}>wavetable · sample · multisample · granular · spectral</div>
        </div>
      )}
    </div>
  )
}

export default function Apollo() {
  return (
    <ApolloProvider>
      <ApolloInner />
    </ApolloProvider>
  )
}
