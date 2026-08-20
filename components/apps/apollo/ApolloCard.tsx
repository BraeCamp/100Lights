'use client'
// ApolloCard — the synth opened ABOVE a host (the Beacon studio), the way
// Serum 2 opens as its own window over a DAW. One card, portal'd to <body>:
// the chrome (frame, backdrop, header) follows the app's theme tokens (the
// workshop customization vars), while the face inside is Apollo's own plate.
//
// `scope` picks what the card shows: 'all' = the whole instrument
// (collectively), or any single module (individually) — and the tabs in the
// card header switch between them without reopening.
//
// The card edits a patch OWNED BY THE HOST: ApolloProvider runs in embedded
// mode, so every tweak flows out through `onChange` (debounced) — in the DAW
// that dispatches SET_INSTRUMENT on the track — and none of the standalone
// app's autosave/session/deep-link machinery runs.

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApolloProvider, useApollo, UI, Section } from './ApolloContext'
import type { ApolloPatch } from '@/lib/apollo/patch'
import OscPanel from './OscPanel'
import SubNoisePanel from './SubNoisePanel'
import FilterPanel from './FilterPanel'
import EnvPanel from './EnvPanel'
import LfoPanel from './LfoPanel'
import FxRack from './FxRack'
import ArpPanel from './ArpPanel'
import ClipPanel from './ClipPanel'
import GlobalPanel from './GlobalPanel'
import ScopeView from './ScopeView'
import KeyboardStrip from './KeyboardStrip'
import { MacrosBlock } from '@/components/apps/Apollo2'

export type ApolloCardScope =
  | 'all' | 'osc' | 'subnoise' | 'filters' | 'env' | 'lfo' | 'macros'
  | 'fx' | 'arp' | 'clip' | 'global'

export const APOLLO_CARD_SCOPES: { id: ApolloCardScope; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'osc', label: 'Oscillators' },
  { id: 'subnoise', label: 'Sub / Noise' },
  { id: 'filters', label: 'Filters' },
  { id: 'env', label: 'Envelopes' },
  { id: 'lfo', label: 'LFOs' },
  { id: 'macros', label: 'Macros' },
  { id: 'fx', label: 'Effects' },
  { id: 'arp', label: 'Arp' },
  { id: 'clip', label: 'Clips' },
  { id: 'global', label: 'Global' },
]

// The full-instrument layout: same packed spans as the standalone SOUND tab,
// with effects + performance rows beneath (the card body scrolls).
const ALL_LAYOUT: { id: ApolloCardScope | 'scope'; cols: number }[] = [
  { id: 'osc', cols: 7 }, { id: 'env', cols: 5 },
  { id: 'filters', cols: 7 }, { id: 'lfo', cols: 5 },
  { id: 'subnoise', cols: 5 }, { id: 'macros', cols: 3 }, { id: 'scope', cols: 4 },
  { id: 'fx', cols: 12 },
  { id: 'arp', cols: 5 }, { id: 'clip', cols: 7 },
  { id: 'global', cols: 12 },
]

function CardBody({ scope }: { scope: ApolloCardScope }) {
  const ctx = useApollo()
  // inventories sized by use, like the standalone shell
  let envUsed = 1
  let lfoUsed = 1
  for (const r of ctx.patch.matrix) {
    const em = /^env([2-4])$/.exec(r.source)
    if (em) envUsed = Math.max(envUsed, Number(em[1]))
    const lm = /^lfo(\d+)y?$/.exec(r.source)
    if (lm) lfoUsed = Math.max(lfoUsed, Number(lm[1]))
  }
  const render = (id: ApolloCardScope | 'scope'): React.ReactNode => ({
    osc: <OscPanel />,
    subnoise: <SubNoisePanel />,
    filters: <FilterPanel />,
    env: <EnvPanel visible={envUsed} />,
    lfo: <Section title="LFO"><LfoPanel visible={lfoUsed} /></Section>,
    macros: <MacrosBlock />,
    scope: <ScopeView />,
    fx: <FxRack minimal />,
    arp: <ArpPanel />,
    clip: <ClipPanel />,
    global: <GlobalPanel />,
    all: null,
  } as Record<string, React.ReactNode>)[id]

  // Apollo's single-plate face: module chrome dissolves, header bars delineate
  const plate: React.CSSProperties = {
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    padding: 8,
    ['--ap-sec-bg' as string]: 'transparent',
    ['--ap-sec-border' as string]: 'transparent',
  } as React.CSSProperties
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {scope === 'all' ? (
        <div style={{
          ...plate,
          display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 8, alignItems: 'start',
        }}>
          {ALL_LAYOUT.map(m => (
            <div key={m.id} style={{ gridColumn: `span ${m.cols}`, minWidth: 0 }}>{render(m.id)}</div>
          ))}
        </div>
      ) : (
        <div style={plate}>{render(scope)}</div>
      )}
      <KeyboardStrip />
    </div>
  )
}

export default function ApolloCard({ patch, onChange, scope: initialScope = 'all', title, onClose }: {
  patch: ApolloPatch
  onChange: (p: ApolloPatch) => void
  scope?: ApolloCardScope
  title?: string
  onClose: () => void
}) {
  const [scope, setScope] = useState<ApolloCardScope>(initialScope)
  useEffect(() => {
    // Capture phase + stopPropagation: Esc closes ONLY the card — it must not
    // leak into the host's own Escape handling (the DAW deselects tracks on
    // Esc, which would also tear down the panel the card was opened from).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [onClose])
  if (typeof document === 'undefined') return null

  const wide = scope === 'all' || scope === 'fx' || scope === 'osc' || scope === 'clip'
  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: wide ? 'min(1280px, 96vw)' : 'min(760px, 96vw)',
          maxHeight: '92vh', overflowY: 'auto',
          background: 'var(--bg-card, #0a0c0f)',
          border: '1px solid var(--border, #262c35)',
          borderRadius: 14,
          boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* chrome header — the host app's theme, not Apollo's */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 14px', borderBottom: '1px solid var(--border, #262c35)',
          position: 'sticky', top: 0, background: 'var(--bg-card, #0a0c0f)', zIndex: 5, borderRadius: '14px 14px 0 0',
        }}>
          <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 3, color: 'var(--text-primary, #dbe1e8)' }}>
            APOLLO
            {title && <span style={{ fontWeight: 500, letterSpacing: 0.2, color: 'var(--text-muted, #8b93a0)', marginLeft: 10, fontSize: 12 }}>{title}</span>}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {APOLLO_CARD_SCOPES.map(s => (
              <button key={s.id} onClick={() => setScope(s.id)} style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: '4px 9px', borderRadius: 999, cursor: 'pointer',
                background: scope === s.id ? 'var(--accent, #4aa9ff)' : 'transparent',
                color: scope === s.id ? '#0b0d10' : 'var(--text-muted, #8b93a0)',
                border: `1px solid ${scope === s.id ? 'var(--accent, #4aa9ff)' : 'var(--border, #262c35)'}`,
              }}>{s.label}</button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} title="Close (Esc)" style={{ background: 'none', border: 'none', color: 'var(--text-muted, #8b93a0)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2 }}>✕</button>
        </div>
        <div style={{ padding: 12 }}>
          <ApolloProvider quickMod embed={{ patch, onChange }}>
            <CardBody scope={scope} />
          </ApolloProvider>
        </div>
      </div>
    </div>,
    document.body,
  )
}
