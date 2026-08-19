'use client'
// Shared pieces for the experimental Apollo shells (/apps/apollo/test1..3).
// Every shell renders the SAME panels against the SAME engine — only the
// chrome, layout, navigation, and theme differ.

import React, { useEffect } from 'react'
import { useApollo, Section } from '../ApolloContext'
import OscPanel from '../OscPanel'
import SubNoisePanel from '../SubNoisePanel'
import FilterPanel from '../FilterPanel'
import EnvPanel from '../EnvPanel'
import LfoPanel from '../LfoPanel'
import MacroPanel from '../MacroPanel'
import ModMatrixPanel from '../ModMatrixPanel'
import MixerPanel from '../MixerPanel'
import FxRack from '../FxRack'
import ArpPanel from '../ArpPanel'
import ClipPanel from '../ClipPanel'
import GlobalPanel from '../GlobalPanel'

export type PanelId =
  | 'osc' | 'subnoise' | 'filters' | 'env' | 'lfo' | 'macros'
  | 'matrix' | 'mixer' | 'fx' | 'arp' | 'clip' | 'global'

export const PANEL_LABEL: Record<PanelId, string> = {
  osc: 'Oscillators', subnoise: 'Sub + Noise', filters: 'Filters', env: 'Envelopes',
  lfo: 'LFOs', macros: 'Macros', matrix: 'Mod Matrix', mixer: 'Mixer', fx: 'Effects',
  arp: 'Arpeggiator', clip: 'Clips', global: 'Global',
}

export function renderPanel(id: PanelId): React.ReactNode {
  switch (id) {
    case 'osc': return <OscPanel />
    case 'subnoise': return <SubNoisePanel />
    case 'filters': return <FilterPanel />
    case 'env': return <EnvPanel />
    case 'lfo': return <Section title="LFO"><LfoPanel /></Section>
    case 'macros': return <Section title="Macros"><MacroPanel /></Section>
    case 'matrix': return <ModMatrixPanel />
    case 'mixer': return <MixerPanel />
    case 'fx': return <FxRack />
    case 'arp': return <ArpPanel />
    case 'clip': return <ClipPanel />
    case 'global': return <GlobalPanel />
  }
}

/** Cmd/Ctrl+Z undo, +Shift redo — shared across shells. */
export function useUndoKeys(): void {
  const ctx = useApollo()
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
}

export function StartOverlay({ title, subtitle, bg, color, accent }: {
  title: string; subtitle: string; bg: string; color: string; accent: string
}) {
  const ctx = useApollo()
  if (ctx.started) return null
  return (
    <div
      onClick={() => { void ctx.start() }}
      style={{
        position: 'fixed', inset: 0, background: bg, zIndex: 500, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12,
      }}
    >
      <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 8, color: accent }}>{title}</div>
      <div style={{ fontSize: 13, color }}>{subtitle} · click anywhere to start audio</div>
    </div>
  )
}

/** Inline CSS custom-property overrides so panels' var(--…) usages follow the shell theme. */
export function shellVars(v: {
  bgCard: string; bgSurface: string; border: string; borderLight: string
  text: string; textSecondary: string; textMuted: string; accent: string
}): React.CSSProperties {
  return {
    '--bg-base': v.bgCard,
    '--bg-card': v.bgCard,
    '--bg-card-hover': v.bgSurface,
    '--bg-surface': v.bgSurface,
    '--border': v.border,
    '--border-light': v.borderLight,
    '--text-primary': v.text,
    '--text-secondary': v.textSecondary,
    '--text-muted': v.textMuted,
    '--accent': v.accent,
    '--accent-hover': v.accent,
    '--accent-light': v.accent,
    '--accent-subtle': v.bgSurface,
  } as React.CSSProperties
}
