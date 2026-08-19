'use client'
// Apollo test shell 1 — "AMBER CONSOLE": hardware-rack UI. One scrolling
// column of modules, sticky left rail with jump navigation + meter, warm
// amber-on-charcoal palette, mono type. Same engine, same panels.

import React, { useRef } from 'react'
import { ApolloProvider, useApollo, useMeters, applyApolloTheme, Knob } from '../ApolloContext'
import { PanelId, PANEL_LABEL, renderPanel, useUndoKeys, StartOverlay, shellVars } from './common'
import PresetBar from '../PresetBar'
import KeyboardStrip from '../KeyboardStrip'
import ModSourcesStrip from '../ModSourcesStrip'

const THEME = {
  bg: '#161210',
  panel: '#211b15',
  header: '#2b2219',
  inset: '#0e0b08',
  border: '#3d3122',
  borderLight: '#57452f',
  green: '#ffc46b',   // viz: warm amber
  greenDim: '#8a6c3c',
  yellow: '#ffefc4',  // highlight: hot cream
  blue: '#ff9f43',    // accent: orange
  blueDim: '#a8642a',
  text: '#f2e7d5',
  dim: '#a8916f',
  knobHi: '#4b3c29',
  knobMid: '#2b2219',
  knobLo: '#171310',
  panelLo: '#1a1511',
  headerLo: '#241d16',
}

const RACK_ORDER: PanelId[] = ['osc', 'subnoise', 'filters', 'mixer', 'env', 'lfo', 'macros', 'matrix', 'fx', 'arp', 'clip', 'global']

function Inner() {
  applyApolloTheme(THEME)
  const ctx = useApollo()
  const meters = useMeters()
  useUndoKeys()
  const refs = useRef<Partial<Record<PanelId, HTMLDivElement | null>>>({})

  return (
    <div
      data-editor="true"
      style={{
        minHeight: '100dvh', background: THEME.bg, color: THEME.text,
        fontFamily: "'SF Mono', ui-monospace, 'JetBrains Mono', Menlo, monospace",
        ...shellVars({
          bgCard: THEME.panel, bgSurface: '#181310', border: THEME.border, borderLight: THEME.borderLight,
          text: THEME.text, textSecondary: '#d8c6a8', textMuted: THEME.dim, accent: THEME.blue,
        }),
      }}
    >
      <div style={{ display: 'flex', gap: 12, maxWidth: 1280, margin: '0 auto', padding: 12 }}>
        {/* sticky rail */}
        <div style={{
          position: 'sticky', top: 12, alignSelf: 'flex-start', width: 148, flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 6,
          background: `linear-gradient(180deg, ${THEME.header}, ${THEME.panel})`,
          border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 10,
          maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto',
        }}>
          <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: 3, color: THEME.blue, textAlign: 'center', padding: '4px 0 8px', borderBottom: `1px solid ${THEME.border}` }}>
            APOLLO<br /><span style={{ fontSize: 8, letterSpacing: 5, color: THEME.dim }}>CONSOLE</span>
          </div>
          {RACK_ORDER.map(id => (
            <button
              key={id}
              onClick={() => refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              style={{
                textAlign: 'left', background: 'none', border: 'none', borderLeft: `2px solid ${THEME.border}`,
                color: THEME.dim, fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
                padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit',
              }}
              onMouseEnter={e => { (e.target as HTMLElement).style.color = THEME.blue }}
              onMouseLeave={e => { (e.target as HTMLElement).style.color = THEME.dim }}
            >{PANEL_LABEL[id]}</button>
          ))}
          <div style={{ borderTop: `1px solid ${THEME.border}`, paddingTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <Knob path="global.masterGain" label="Main" size={38} />
            <div style={{ width: '100%', height: 8, background: THEME.inset, border: `1px solid ${THEME.border}`, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, meters.peak * 100)}%`, background: meters.peak > 1 ? '#e05555' : THEME.green }} />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => ctx.undo()} title="Undo" style={railBtn}>↩</button>
              <button onClick={() => ctx.redo()} title="Redo" style={railBtn}>↪</button>
            </div>
            <span style={{ fontSize: 8, color: THEME.dim }}>{meters.voices} voices</span>
          </div>
        </div>
        {/* rack column */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 170 }}>
          <div style={{ background: `linear-gradient(180deg, ${THEME.header}, ${THEME.panel})`, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: '8px 12px' }}>
            <PresetBar />
          </div>
          {RACK_ORDER.map(id => (
            <div key={id} ref={el => { refs.current[id] = el }} style={{ scrollMarginTop: 12 }}>
              {renderPanel(id)}
            </div>
          ))}
        </div>
      </div>
      {/* fixed performance strip */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
        background: `linear-gradient(180deg, ${THEME.header}, ${THEME.bg})`,
        borderTop: `1px solid ${THEME.borderLight}`, padding: '6px 12px',
        display: 'flex', flexDirection: 'column', gap: 5,
        boxShadow: '0 -6px 24px rgba(0,0,0,0.5)',
      }}>
        <ModSourcesStrip />
        <KeyboardStrip />
      </div>
      <StartOverlay title="APOLLO CONSOLE" subtitle="hardware-rack shell — one column, every module" bg="rgba(14,10,7,0.92)" color={THEME.dim} accent={THEME.blue} />
    </div>
  )
}

const railBtn: React.CSSProperties = {
  background: '#181310', color: '#a8916f', border: '1px solid #3d3122',
  borderRadius: 5, width: 24, height: 20, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
}

export default function AmberConsole() {
  return (
    <ApolloProvider>
      <Inner />
    </ApolloProvider>
  )
}
