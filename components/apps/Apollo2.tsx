'use client'
// Apollo 2 (/apollo2) — the same synth, restructured to be minimal and
// self-explaining. Nothing is removed; the UI grows as the sound does:
//
//  · The VOICE CHAIN: Sub, Noise, Filters and Arp hang off the oscillator as
//    collapsed segments of one visible signal path. Closed segments are one
//    honest summary line; click to open in place. (idea #1 + #4)
//  · Bare "+" everywhere instead of fixed inventories: oscillator layers,
//    envelopes, LFOs, macros, FX busses appear only when added/used. (#3)
//  · Hover any knob → "+" → "move this with…" creates the modulation AND
//    reveals the panel of whatever source it used. (#5)
//  · Three tabs — SOUND / EFFECTS / PERFORM — with the mod-matrix as a
//    slide-over "Movement" list, since routes are created elsewhere. (#7)
//  · While audio plays, the chain segments glow in signal order. (#9)
//
// /apollo keeps the original six-tab UI; both share engine, patches and state.

import React, { useEffect, useRef, useState } from 'react'
import { ApolloProvider, useApollo, useMeters, Knob, ToggleBtn, UI } from '@/components/apps/apollo/ApolloContext'
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
import { FILTER_TYPES } from '@/lib/apollo/patch'

type Tab = 'sound' | 'effects' | 'perform'
const TABS: { id: Tab; label: string }[] = [
  { id: 'sound', label: 'SOUND' }, { id: 'effects', label: 'EFFECTS' }, { id: 'perform', label: 'PERFORM' },
]

// ── Chain segment: a slim bar (summary + toggle) that opens into the panel ──
function Seg({ title, summary, enabled, onToggle, open, onOpen, glowIndex, playing, children }: {
  title: string
  summary: string
  enabled: boolean | null   // null = no on/off concept (oscillator A)
  onToggle?: () => void
  open: boolean
  onOpen: () => void
  glowIndex: number
  playing: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        onClick={onOpen}
        data-learn={title}
        className={playing && enabled !== false ? 'ap2-flow' : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          background: `linear-gradient(180deg, ${UI.header} 0%, ${UI.panelLo} 100%)`,
          border: `1px solid ${open ? UI.borderLight : UI.border}`, borderRadius: 7,
          padding: '5px 10px', animationDelay: `${glowIndex * 90}ms`,
          opacity: enabled === false ? 0.55 : 1,
        }}
      >
        <span style={{ fontSize: 9, color: UI.dim }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: UI.text, textTransform: 'uppercase' }}>{title}</span>
        <span style={{ fontSize: 10, color: UI.dim, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        {enabled !== null && onToggle && (
          <span onClick={e => e.stopPropagation()}>
            <ToggleBtn on={enabled} label={enabled ? 'On' : 'Off'} onClick={onToggle} />
          </span>
        )}
      </div>
      {open && children}
    </div>
  )
}

function filterLabel(t: string): string {
  return FILTER_TYPES.find(f => f.id === t)?.label ?? t
}

// ── The voice chain (#1): OSC layers → Sub → Noise → Filters → Arp ─────────
function VoiceChain({ playing }: { playing: boolean }) {
  const ctx = useApollo()
  const p = ctx.patch
  const [open, setOpen] = useState<string>('oscA') // accordion: one open segment
  const toggleOpen = (id: string) => setOpen(o => (o === id ? '' : id))

  const oscSummary = (i: number) => {
    const o = p.oscs[i]
    if (!o.enabled) return 'off'
    const src = o.engine === 'wavetable' ? o.wt.tableId : o.engine
    return `${src} · ${o.unison > 1 ? `${o.unison} voices` : '1 voice'}`
  }
  const enabledOscs = p.oscs.map((o, i) => ({ o, i })).filter(x => x.i === 0 || x.o.enabled)
  const nextOsc = p.oscs.findIndex((o, i) => i > 0 && !o.enabled)

  const filterSummary = p.filters.filter(f => f.enabled).map(f => `${filterLabel(f.type)} · ${Math.round(f.cutoff * 100)}%`).join('  +  ') || 'off'

  let gi = 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {enabledOscs.map(({ o, i }) => (
        <Seg
          key={i}
          title={`Osc ${'ABC'[i]}`}
          summary={oscSummary(i)}
          enabled={i === 0 ? null : o.enabled}
          onToggle={i === 0 ? undefined : () => ctx.update(pp => { pp.oscs[i].enabled = !pp.oscs[i].enabled })}
          open={open === `osc${'ABC'[i]}`}
          onOpen={() => { ctx.setSelectedOsc(i); toggleOpen(`osc${'ABC'[i]}`) }}
          glowIndex={gi++}
          playing={playing}
        >
          <OscPanel />
        </Seg>
      ))}
      {nextOsc > 0 && (
        <button
          onClick={() => {
            ctx.update(pp => { pp.oscs[nextOsc].enabled = true })
            ctx.setSelectedOsc(nextOsc)
            setOpen(`osc${'ABC'[nextOsc]}`)
          }}
          title="Another oscillator layer"
          style={{
            border: `1px dashed ${UI.border}`, background: 'transparent', color: UI.dim,
            borderRadius: 7, padding: '4px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer', textAlign: 'left',
          }}
        >+</button>
      )}

      <Seg
        title="Sub" summary={p.sub.enabled ? `${p.sub.shape} · ${p.sub.octave} oct` : 'off'}
        enabled={p.sub.enabled}
        onToggle={() => ctx.update(pp => { pp.sub.enabled = !pp.sub.enabled })}
        open={open === 'sub'} onOpen={() => toggleOpen('sub')} glowIndex={gi++} playing={playing}
      >
        <SubNoisePanel only="sub" />
      </Seg>

      <Seg
        title="Noise" summary={p.noise.enabled ? (p.noise.sampleId ? (ctx.engine.samples.get(p.noise.sampleId)?.name ?? 'sample') : 'no sample yet') : 'off'}
        enabled={p.noise.enabled}
        onToggle={() => ctx.update(pp => { pp.noise.enabled = !pp.noise.enabled })}
        open={open === 'noise'} onOpen={() => toggleOpen('noise')} glowIndex={gi++} playing={playing}
      >
        <SubNoisePanel only="noise" />
      </Seg>

      <Seg
        title="Filter" summary={filterSummary}
        enabled={p.filters.some(f => f.enabled)}
        onToggle={() => ctx.update(pp => {
          const any = pp.filters.some(f => f.enabled)
          if (any) pp.filters.forEach(f => { f.enabled = false })
          else pp.filters[0].enabled = true
        })}
        open={open === 'filter'} onOpen={() => toggleOpen('filter')} glowIndex={gi++} playing={playing}
      >
        <FilterPanel />
      </Seg>

      <Seg
        title="Arp" summary={p.arp.on ? `${p.arp.mode} · ${p.arp.octaves} oct` : 'off'}
        enabled={p.arp.on}
        onToggle={() => ctx.update(pp => { pp.arp.on = !pp.arp.on })}
        open={open === 'arp'} onOpen={() => toggleOpen('arp')} glowIndex={gi++} playing={playing}
      >
        <ArpPanel />
      </Seg>
    </div>
  )
}

// ── Macros (#3): only named knobs exist; "+" names a new one ────────────────
function MacrosBlock() {
  const ctx = useApollo()
  const named = ctx.patch.macroNames.map((name, i) => ({ name, i })).filter(m => m.name && m.name !== `Macro ${m.i + 1}`)
  const free = ctx.patch.macroNames.findIndex((n, i) => !n || n === `Macro ${i + 1}`)
  return (
    <div style={{
      background: `linear-gradient(180deg, ${UI.panel} 0%, ${UI.panelLo} 100%)`,
      border: `1px solid ${UI.border}`, borderRadius: 8, padding: '8px 10px',
    }}>
      <div data-learn="Macros" style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: UI.text, textTransform: 'uppercase', marginBottom: 6 }}>Knobs</div>
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
    </div>
  )
}

// ── Movement slide-over (#7): the matrix, as a drawer ───────────────────────
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
          boxShadow: '-18px 0 50px rgba(0,0,0,0.55)',
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
function Apollo2Inner() {
  const ctx = useApollo()
  const meters = useMeters()
  const [tab, setTab] = useState<Tab>('sound')
  const [wtOpen, setWtOpen] = useState(false)
  const [movementOpen, setMovementOpen] = useState(false)
  const [midiOn, setMidiOn] = useState(false)
  const [midiName, setMidiName] = useState('')
  const [midiAvailable, setMidiAvailable] = useState(false)
  useEffect(() => { setMidiAvailable(webMidiSupported) }, [])
  const playing = meters.peak > 0.015

  // #9: signal-flow glow keyframes
  useEffect(() => {
    const id = 'ap2-styles'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
@keyframes ap2Flow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(111,208,140,0); }
  35% { box-shadow: 0 0 8px 1px rgba(111,208,140,0.35), inset 0 0 6px rgba(111,208,140,0.12); }
}
.ap2-flow { animation: ap2Flow 1.6s ease-in-out infinite; }
`
    document.head.appendChild(style)
  }, [])

  useEffect(() => {
    if (!midiOn) return
    const off = onMidiNote(e => {
      if (e.type === 'on') { void ctx.start().then(() => ctx.engine.noteOn(e.pitch, e.velocity / 127)) }
      else ctx.engine.noteOff(e.pitch)
    })
    return () => { off() }
  }, [midiOn, ctx])

  // undo/redo shortcuts (same as /apollo)
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

  // envelopes / LFOs visible-count (#3): derived from use + session "+" clicks
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
        background: opts?.on ? `linear-gradient(180deg, ${UI.blue} 0%, ${UI.blue}cc 100%)` : `linear-gradient(180deg, ${UI.header} 0%, ${UI.panel} 100%)`,
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

  return (
    <div style={{ minHeight: '100vh', background: UI.bg, color: UI.text, padding: '10px 14px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        background: `linear-gradient(180deg, ${UI.panel} 0%, ${UI.panelLo} 100%)`,
        border: `1px solid ${UI.border}`, borderRadius: 8, padding: '7px 12px',
      }}>
        <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: 4 }}>
          APOLLO<span style={{ color: UI.blue }}>2</span>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '5px 13px', borderRadius: 5, fontSize: 10.5, fontWeight: 900, letterSpacing: 1.2, cursor: 'pointer',
              background: tab === t.id ? `linear-gradient(180deg, #2a3442 0%, #1e2530 100%)` : 'transparent',
              color: tab === t.id ? UI.text : UI.dim,
              border: `1px solid ${tab === t.id ? UI.borderLight : 'transparent'}`,
            }}>{t.label}</button>
          ))}
        </div>
        <PresetBar />
        <div style={{ flex: 1 }} />
        {headerBtn('↩', () => ctx.undo(), { title: 'Undo (Cmd+Z)' })}
        {headerBtn('↪', () => ctx.redo(), { title: 'Redo (Shift+Cmd+Z)' })}
        {headerBtn(`Movement · ${routeCount}`, () => setMovementOpen(true), { title: 'Everything that moves by itself (the mod matrix)' })}
        {headerBtn('WT', () => setWtOpen(true), { title: 'Wavetable editor' })}
        {midiAvailable && headerBtn('MIDI', () => { void enableMidi() }, { on: midiOn, title: midiName || 'Connect a MIDI keyboard' })}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Knob path="global.masterGain" label="Main" size={30} />
          <div title="Output level" style={{ width: 7, height: 30, background: UI.inset, border: `1px solid ${UI.border}`, borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${Math.min(100, meters.peak * 100)}%`, background: meters.peak > 1 ? '#e05555' : UI.green, transition: 'height 50ms linear' }} />
          </div>
        </div>
        <HelpButton onShowTab={t => setTab(t === 'fx' ? 'effects' : t === 'seq' || t === 'global' ? 'perform' : 'sound')} />
        <LearnMode />
      </div>

      {/* body */}
      {tab === 'sound' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(390px, 3fr) minmax(330px, 2fr)', gap: 8, alignItems: 'start' }}>
          <VoiceChain playing={playing} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <EnvPanel visible={envVisible} onAdd={() => setExtraEnvs(n => Math.min(3, Math.max(n + 1, envVisible)))} />
            <LfoPanel visible={lfoVisible} onAdd={() => setExtraLfos(n => Math.min(9, Math.max(n + 1, lfoVisible)))} />
            <MacrosBlock />
            <ScopeView />
          </div>
        </div>
      )}
      {tab === 'effects' && <FxRack minimal />}
      {tab === 'perform' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'start' }}>
          <ClipPanel />
          <GlobalPanel />
        </div>
      )}

      <ModSourcesStrip />
      <KeyboardStrip />

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
      <Apollo2Inner />
    </ApolloProvider>
  )
}
