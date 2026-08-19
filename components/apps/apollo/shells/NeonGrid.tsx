'use client'
// Apollo test shell 3 — "NEON GRID": single-screen performance surface. No
// tabs, no scroll hunting — everything lives on one dense three-column
// mosaic with cyan/magenta neon glow. Macros ride up top as the main
// performance row.

import React from 'react'
import { ApolloProvider, useApollo, useMeters, applyApolloTheme, Knob, Section } from '../ApolloContext'
import { renderPanel, useUndoKeys, StartOverlay, shellVars } from './common'
import PresetBar from '../PresetBar'
import KeyboardStrip from '../KeyboardStrip'
import ModSourcesStrip from '../ModSourcesStrip'
import MacroPanel from '../MacroPanel'

const THEME = {
  bg: '#05060a',
  panel: '#0b0d16',
  header: '#111527',
  inset: '#04050a',
  border: '#1e2440',
  borderLight: '#303a66',
  green: '#2de2e6',   // viz: cyan
  greenDim: '#17707a',
  yellow: '#ff2e97',  // highlight: magenta
  blue: '#8a5cff',    // accent: violet
  blueDim: '#4b3390',
  text: '#e6e9ff',
  dim: '#6a71a3',
  knobHi: '#2a3055',
  knobMid: '#151a2e',
  knobLo: '#0a0c16',
  panelLo: '#080a13',
  headerLo: '#0d1020',
}

function Glow({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ borderRadius: 10, boxShadow: `0 0 18px ${color || THEME.blue}22, inset 0 0 0 1px ${color || THEME.blue}18` }}>
      {children}
    </div>
  )
}

function Inner() {
  applyApolloTheme(THEME)
  const ctx = useApollo()
  const meters = useMeters()
  useUndoKeys()

  return (
    <div
      data-editor="true"
      style={{
        minHeight: '100dvh', color: THEME.text,
        background: `radial-gradient(1200px 500px at 50% -140px, #141a3a 0%, ${THEME.bg} 58%)`,
        fontFamily: "'Avenir Next Condensed', 'Arial Narrow', system-ui, sans-serif",
        ...shellVars({
          bgCard: THEME.panel, bgSurface: '#10142a', border: THEME.border, borderLight: THEME.borderLight,
          text: THEME.text, textSecondary: '#c3c9f2', textMuted: THEME.dim, accent: THEME.blue,
        }),
      }}
    >
      <div style={{ maxWidth: 1560, margin: '0 auto', padding: '10px 12px 8px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: '100dvh' }}>
        {/* top strip: identity + presets + macros as THE performance row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          background: `linear-gradient(180deg, ${THEME.header}, ${THEME.panel})`,
          border: `1px solid ${THEME.border}`, borderRadius: 10, padding: '6px 12px',
          boxShadow: `0 0 26px ${THEME.blue}30`,
        }}>
          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 4 }}>
            <span style={{ color: THEME.green, textShadow: `0 0 12px ${THEME.green}` }}>APOLLO</span>
            <span style={{ color: THEME.yellow, textShadow: `0 0 12px ${THEME.yellow}` }}> GRID</span>
          </div>
          <PresetBar />
          <div style={{ flex: 1 }} />
          <button onClick={() => ctx.undo()} style={neonBtn}>↩</button>
          <button onClick={() => ctx.redo()} style={neonBtn}>↪</button>
          <Knob path="global.masterGain" label="Main" size={32} />
          <div style={{ width: 8, height: 32, background: THEME.inset, border: `1px solid ${THEME.border}`, borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${Math.min(100, meters.peak * 100)}%`, background: meters.peak > 1 ? THEME.yellow : THEME.green, boxShadow: `0 0 8px ${THEME.green}` }} />
          </div>
        </div>
        <Glow color={THEME.yellow}>
          <Section title="Performance Macros">
            <MacroPanel />
          </Section>
        </Glow>
        {/* the grid: everything at once */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(430px, 5fr) minmax(360px, 4fr) minmax(360px, 4fr)', gap: 8, alignItems: 'start' }}>
          <div style={colStyle}>
            <Glow color={THEME.green}>{renderPanel('osc')}</Glow>
            <Glow>{renderPanel('subnoise')}</Glow>
            <Glow>{renderPanel('filters')}</Glow>
            <Glow>{renderPanel('mixer')}</Glow>
          </div>
          <div style={colStyle}>
            <Glow>{renderPanel('env')}</Glow>
            <Glow>{renderPanel('lfo')}</Glow>
            <Glow color={THEME.yellow}>{renderPanel('matrix')}</Glow>
            <Glow>{renderPanel('global')}</Glow>
            <Glow color={THEME.green}>{renderPanel('scope')}</Glow>
          </div>
          <div style={colStyle}>
            <Glow color={THEME.yellow}>{renderPanel('fx')}</Glow>
            <Glow>{renderPanel('arp')}</Glow>
            <Glow>{renderPanel('clip')}</Glow>
          </div>
        </div>
        <div style={{ position: 'sticky', bottom: 8, zIndex: 40, display: 'flex', flexDirection: 'column', gap: 5, background: `linear-gradient(180deg, ${THEME.panel}ee, ${THEME.bg})`, border: `1px solid ${THEME.borderLight}`, borderRadius: 12, padding: 8, boxShadow: `0 0 30px ${THEME.blue}44` }}>
          <ModSourcesStrip />
          <KeyboardStrip />
        </div>
      </div>
      <StartOverlay title="APOLLO GRID" subtitle="single-screen performance shell — everything at once" bg="rgba(4,5,10,0.93)" color={THEME.dim} accent={THEME.green} />
    </div>
  )
}

const colStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }

const neonBtn: React.CSSProperties = {
  background: '#10142a', color: '#c3c9f2', border: '1px solid #303a66',
  borderRadius: 6, width: 26, height: 22, fontSize: 11, cursor: 'pointer',
}

export default function NeonGrid() {
  return (
    <ApolloProvider>
      <Inner />
    </ApolloProvider>
  )
}
