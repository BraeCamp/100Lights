'use client'
// Apollo — Serum-2-class hybrid synthesizer for sample mangling.
// Hidden page: /apps/apollo (noindex). All audio runs in one AudioWorklet.

import React, { useEffect, useState } from 'react'
import { ApolloProvider, useApollo, useMeters, Section } from '@/components/apps/apollo/ApolloContext'
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
import { startWebMidi, onMidiNote, onMidiCC, webMidiSupported, getMidiDeviceNames } from '@/lib/web-midi'

type Tab = 'synth' | 'mix' | 'fx' | 'matrix' | 'seq' | 'global'
const TABS: { id: Tab; label: string }[] = [
  { id: 'synth', label: 'SYNTH' }, { id: 'mix', label: 'MIX' }, { id: 'fx', label: 'FX' },
  { id: 'matrix', label: 'MATRIX' }, { id: 'seq', label: 'SEQ' }, { id: 'global', label: 'GLOBAL' },
]

function ApolloInner() {
  const ctx = useApollo()
  const meters = useMeters()
  const [tab, setTab] = useState<Tab>('synth')
  const [wtOpen, setWtOpen] = useState(false)
  const [midiOn, setMidiOn] = useState(false)
  const [midiName, setMidiName] = useState('')
  const [midiAvailable, setMidiAvailable] = useState(false)
  useEffect(() => { setMidiAvailable(webMidiSupported) }, [])

  // Web MIDI hookup
  useEffect(() => {
    if (!midiOn) return
    const offNote = onMidiNote(e => {
      if (e.type === 'on') { void ctx.start().then(() => ctx.engine.noteOn(e.pitch, e.velocity / 127)) }
      else ctx.engine.noteOff(e.pitch)
    })
    const offCC = onMidiCC(e => {
      if (e.cc === 1) ctx.engine.setWheel(null, e.value / 127)
      else if (e.cc === 64) ctx.engine.sustain(e.value >= 64)
    })
    return () => { offNote(); offCC() }
  }, [midiOn, ctx])

  const enableMidi = async () => {
    if (midiOn) { setMidiOn(false); return }
    const ok = await startWebMidi()
    if (ok) {
      setMidiOn(true)
      setMidiName(getMidiDeviceNames()[0] || 'MIDI ready')
    } else setMidiName('No MIDI access')
  }

  return (
    <div
      data-editor="true"
      style={{
        minHeight: '100dvh', background: 'var(--bg-base)', color: 'var(--text-primary)',
        display: 'flex', flexDirection: 'column', gap: 8, padding: 10,
        fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 1200, margin: '0 auto',
      }}
    >
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 3, color: 'var(--accent)' }}>APOLLO</div>
        <PresetBar />
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setWtOpen(true)}
          style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 9px', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
        >WT Editor</button>
        {midiAvailable && (
          <button
            onClick={() => { void enableMidi() }}
            title={midiName}
            style={{
              background: midiOn ? 'var(--success)' : 'var(--bg-surface)', color: midiOn ? '#0a0a0a' : 'var(--text-secondary)',
              border: '1px solid ' + (midiOn ? 'var(--success)' : 'var(--border)'), borderRadius: 6, padding: '3px 9px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
            }}
          >MIDI</button>
        )}
        <div title="Output level" style={{ width: 70, height: 8, background: '#101216', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, meters.peak * 100)}%`, background: meters.peak > 1 ? 'var(--error)' : 'var(--success)' }} />
        </div>
      </div>

      {/* tabs */}
      <div style={{ display: 'flex', gap: 4 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '5px 14px', borderRadius: 7, fontSize: 11, fontWeight: 800, letterSpacing: 1, cursor: 'pointer',
              background: tab === t.id ? 'var(--accent)' : 'var(--bg-card)',
              color: tab === t.id ? '#fff' : 'var(--text-secondary)',
              border: '1px solid ' + (tab === t.id ? 'var(--accent)' : 'var(--border)'),
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* body */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === 'synth' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(380px, 3fr) minmax(320px, 2fr)', gap: 8, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <OscPanel />
              <SubNoisePanel />
              <FilterPanel />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <EnvPanel />
              <Section title="LFO">
                <LfoPanel />
              </Section>
              <Section title="Macros">
                <MacroPanel />
              </Section>
            </div>
          </div>
        )}
        {tab === 'mix' && <MixerPanel />}
        {tab === 'fx' && <FxRack />}
        {tab === 'matrix' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ModMatrixPanel />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'start' }}>
              <EnvPanel />
              <Section title="LFO"><LfoPanel /></Section>
            </div>
            <Section title="Macros"><MacroPanel /></Section>
          </div>
        )}
        {tab === 'seq' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ArpPanel />
            <ClipPanel />
          </div>
        )}
        {tab === 'global' && <GlobalPanel />}
      </div>

      {/* footer */}
      <ModSourcesStrip />
      <KeyboardStrip />

      {wtOpen && <WavetableEditor onClose={() => setWtOpen(false)} />}

      {!ctx.started && (
        <div
          onClick={() => { void ctx.start() }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(8,9,11,0.82)', zIndex: 500,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: 'var(--accent)' }}>APOLLO</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Serum-class hybrid synthesizer · click anywhere to start audio</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>wavetable · sample · multisample · granular · spectral</div>
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
