'use client'
// Apollo test shell 2 — "PORCELAIN": light-chassis studio. Pale warm surfaces
// with dark instrument "screens", workflow-stepper navigation
// (Sound → Shape → Motion → Space → Perform), airy rounded cards.

import React, { useState } from 'react'
import { ApolloProvider, useApollo, useMeters, applyApolloTheme, Knob } from '../ApolloContext'
import { PanelId, renderPanel, useUndoKeys, StartOverlay, shellVars } from './common'
import PresetBar from '../PresetBar'
import KeyboardStrip from '../KeyboardStrip'
import ModSourcesStrip from '../ModSourcesStrip'

const THEME = {
  bg: '#e9e6df',
  panel: '#f7f5f0',
  header: '#dedacf',
  inset: '#171a20',    // screens stay dark on the light chassis
  border: '#c6c0b2',
  borderLight: '#a89f8c',
  green: '#39b269',
  greenDim: '#8fceaa',
  yellow: '#e08c0b',
  blue: '#2563c4',
  blueDim: '#7fa3dd',
  text: '#26282c',
  dim: '#787c86',
  knobHi: '#ffffff',
  knobMid: '#e4e0d6',
  knobLo: '#b9b3a4',
  panelLo: '#eeeae2',
  headerLo: '#d3cfc2',
}

const STAGES: { id: string; label: string; hint: string; panels: PanelId[] }[] = [
  { id: 'sound', label: '1 · Sound', hint: 'pick and shape your sources', panels: ['osc', 'subnoise'] },
  { id: 'shape', label: '2 · Shape', hint: 'filter and balance', panels: ['filters', 'mixer'] },
  { id: 'motion', label: '3 · Motion', hint: 'make it move', panels: ['env', 'lfo', 'macros', 'matrix'] },
  { id: 'space', label: '4 · Space', hint: 'effects and atmosphere', panels: ['fx'] },
  { id: 'perform', label: '5 · Perform', hint: 'sequence and play', panels: ['arp', 'clip', 'global'] },
]

function Inner() {
  applyApolloTheme(THEME)
  const ctx = useApollo()
  const meters = useMeters()
  useUndoKeys()
  const [stage, setStage] = useState(0)
  const cur = STAGES[stage]

  return (
    <div
      data-editor="true"
      style={{
        minHeight: '100dvh', background: THEME.bg, color: THEME.text,
        fontFamily: "'Avenir Next', 'Segoe UI', system-ui, sans-serif",
        ...shellVars({
          bgCard: THEME.panel, bgSurface: '#ffffff', border: THEME.border, borderLight: THEME.borderLight,
          text: THEME.text, textSecondary: '#43464d', textMuted: THEME.dim, accent: THEME.blue,
        }),
      }}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '18px 16px 180px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          background: '#ffffff', borderRadius: 16, padding: '10px 18px',
          boxShadow: '0 2px 14px rgba(90,80,60,0.12)', border: `1px solid ${THEME.border}`,
        }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1, color: THEME.text }}>
            apollo <span style={{ color: THEME.blue, fontWeight: 900 }}>porcelain</span>
          </div>
          <PresetBar />
          <div style={{ flex: 1 }} />
          <button onClick={() => ctx.undo()} style={softBtn}>Undo</button>
          <button onClick={() => ctx.redo()} style={softBtn}>Redo</button>
          <Knob path="global.masterGain" label="Main" size={34} />
          <div style={{ width: 60, height: 8, background: THEME.header, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, meters.peak * 100)}%`, background: meters.peak > 1 ? '#d64545' : THEME.green, transition: 'width 60ms linear' }} />
          </div>
        </div>
        {/* stepper */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {STAGES.map((s, k) => (
            <button
              key={s.id}
              onClick={() => setStage(k)}
              style={{
                flex: 1, minWidth: 140, textAlign: 'left', cursor: 'pointer',
                background: k === stage ? THEME.blue : '#ffffff',
                color: k === stage ? '#ffffff' : THEME.text,
                border: `1px solid ${k === stage ? THEME.blue : THEME.border}`,
                borderRadius: 14, padding: '10px 14px',
                boxShadow: k === stage ? '0 4px 16px rgba(37,99,196,0.35)' : '0 1px 6px rgba(90,80,60,0.08)',
                transition: 'all 160ms',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800 }}>{s.label}</div>
              <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>{s.hint}</div>
            </button>
          ))}
        </div>
        {/* stage content: airy two-column when 2+ panels */}
        <div style={cur.panels.length > 1
          ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(430px, 1fr))', gap: 14, alignItems: 'start' }
          : { display: 'flex', flexDirection: 'column', gap: 14 }}>
          {cur.panels.map(id => (
            <div key={id} style={{ borderRadius: 16, overflow: 'hidden', boxShadow: '0 3px 18px rgba(90,80,60,0.13)' }}>
              {renderPanel(id)}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button disabled={stage === 0} onClick={() => setStage(s => Math.max(0, s - 1))} style={{ ...softBtn, opacity: stage === 0 ? 0.4 : 1 }}>← {stage > 0 ? STAGES[stage - 1].label : ''}</button>
          <button disabled={stage === STAGES.length - 1} onClick={() => setStage(s => Math.min(STAGES.length - 1, s + 1))} style={{ ...softBtn, opacity: stage === STAGES.length - 1 ? 0.4 : 1 }}>{stage < STAGES.length - 1 ? STAGES[stage + 1].label : ''} →</button>
        </div>
      </div>
      {/* floating keyboard */}
      <div style={{
        position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 10, zIndex: 50,
        width: 'min(1160px, 96vw)', display: 'flex', flexDirection: 'column', gap: 5,
        background: '#ffffff', border: `1px solid ${THEME.border}`, borderRadius: 18, padding: 8,
        boxShadow: '0 10px 34px rgba(60,55,40,0.3)',
      }}>
        <ModSourcesStrip />
        <KeyboardStrip />
      </div>
      <StartOverlay title="apollo porcelain" subtitle="light studio shell — a guided five-stage workflow" bg="rgba(233,230,223,0.94)" color={THEME.dim} accent={THEME.blue} />
    </div>
  )
}

const softBtn: React.CSSProperties = {
  background: '#ffffff', color: '#43464d', border: '1px solid #c6c0b2',
  borderRadius: 10, padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
  boxShadow: '0 1px 5px rgba(90,80,60,0.1)',
}

export default function Porcelain() {
  return (
    <ApolloProvider>
      <Inner />
    </ApolloProvider>
  )
}
