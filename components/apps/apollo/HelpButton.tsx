'use client'
// Apollo's help card — the same "?" panel the DAW has (components/editor/daw/
// HelpButton.tsx): a searchable modal with Shortcuts and Features tabs, where
// clicking a feature switches to the right synth tab and runs a fading glow on
// the actual control so you can see exactly where it lives. Feature copy comes
// from the Learn-mode knowledge base (lib/apollo/learn-content.ts) so the two
// help systems never drift apart.

import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle, Search, X } from 'lucide-react'
import { UI } from './ApolloContext'
import { LEARN_ENTRIES } from '@/lib/apollo/learn-content'

const GLOW_MS = 7000

/** Glow every element whose data-learn label starts with one of the targets. */
export function highlightApolloTargets(targets: string[]): boolean {
  if (typeof document === 'undefined') return false
  const wanted = targets.map(t => t.toLowerCase())
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-learn]')).filter(el => {
    const l = (el.getAttribute('data-learn') || '').toLowerCase()
    return wanted.some(w => l === w || l.startsWith(w))
  })
  if (els.length === 0) return false
  for (const el of els) {
    el.classList.remove('apollo-help-glow')
    void el.offsetWidth
    el.classList.add('apollo-help-glow')
    window.setTimeout(() => el.classList.remove('apollo-help-glow'), GLOW_MS + 100)
  }
  els[0].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  return true
}

// ── Shortcuts ────────────────────────────────────────────────────────────────

interface Shortcut { keys: string; action: string }
const SHORTCUT_GROUPS: { label: string; items: Shortcut[] }[] = [
  {
    label: 'Playing',
    items: [
      { keys: 'A S D F G H J K', action: 'Play white keys (computer keyboard)' },
      { keys: 'W E T Y U', action: 'Play black keys' },
      { keys: 'Z / X', action: 'Octave down / up' },
      { keys: 'MIDI', action: 'Click MIDI in the header to play a connected keyboard' },
    ],
  },
  {
    label: 'Editing',
    items: [
      { keys: '⌘Z', action: 'Undo' },
      { keys: '⇧⌘Z', action: 'Redo' },
      { keys: '?', action: 'Open this help card' },
      { keys: 'Esc', action: 'Close dialogs / exit Learn mode' },
    ],
  },
  {
    label: 'Knobs & mouse',
    items: [
      { keys: 'Drag', action: 'Change a knob’s value (vertical drag)' },
      { keys: 'Double-click', action: 'Reset a knob to its default' },
      { keys: 'Right-click', action: 'MIDI Learn — map a hardware knob onto it' },
      { keys: 'Drag ring', action: 'On a modulated knob: edit the modulation amount' },
      { keys: 'Drag chip', action: 'Drop a MOD SOURCES chip on any knob to create modulation' },
      { keys: 'Drag ⠿', action: 'Rearrange panels (grip at each panel’s top-left)' },
      { keys: '🔍', action: 'Learn mode — hover/click anything to find out what it does' },
    ],
  },
]

// ── Features (copy from the Learn knowledge base) ────────────────────────────

type SynthTab = 'synth' | 'mix' | 'fx' | 'matrix' | 'seq' | 'global'
const TAB_NAME: Record<SynthTab, string> = { synth: 'OSC', mix: 'MIX', fx: 'FX', matrix: 'MATRIX', seq: 'SEQ', global: 'GLOBAL' }

interface Feature {
  name: string
  learnKey: string        // entry in LEARN_ENTRIES that supplies the copy
  targets: string[]       // data-learn prefixes to glow (empty = hint only)
  tab?: SynthTab          // switch here before glowing
  hint?: string           // shown when nothing could be glowed
  group: string
}

const FEATURES: Feature[] = [
  // Sound design
  { group: 'Sound design', name: 'Oscillators', learnKey: 'oscillator', targets: ['Oscillator'], tab: 'synth' },
  { group: 'Sound design', name: 'Wavetable Position', learnKey: 'wt-pos', targets: ['WT Pos'], tab: 'synth' },
  { group: 'Sound design', name: 'Unison', learnKey: 'unison', targets: ['Unison', 'Detune'], tab: 'synth',
    hint: 'On the OSC tab — the Unison stepper and Detune knob sit in each oscillator’s pitch row.' },
  { group: 'Sound design', name: 'Sub & Noise', learnKey: 'sub', targets: ['Sub', 'Noise'], tab: 'synth' },
  { group: 'Sound design', name: 'Filters', learnKey: 'filter', targets: ['Filters'], tab: 'synth' },
  { group: 'Sound design', name: 'Envelopes', learnKey: 'envelope', targets: ['Envelopes'], tab: 'synth' },
  { group: 'Sound design', name: 'LFOs', learnKey: 'lfo', targets: ['LFO'], tab: 'synth' },
  { group: 'Sound design', name: 'Scope', learnKey: 'scope', targets: ['Scope'], tab: 'synth' },

  // Modulation
  { group: 'Modulation', name: 'Mod Matrix', learnKey: 'matrix', targets: ['Matrix'], tab: 'matrix' },
  { group: 'Modulation', name: 'Macros', learnKey: 'macro', targets: ['Macros'], tab: 'synth' },
  { group: 'Modulation', name: 'Drag-and-drop modulation', learnKey: 'modulation', targets: [],
    hint: 'Drag any chip from the MOD SOURCES strip (above the keyboard) onto any knob.' },

  // Mixing & effects
  { group: 'Mixing & effects', name: 'Mixer', learnKey: 'tab-mix', targets: ['Mixer'], tab: 'mix' },
  { group: 'Mixing & effects', name: 'Effects Rack', learnKey: 'tab-fx', targets: ['Effects'], tab: 'fx' },
  { group: 'Mixing & effects', name: 'FX Busses', learnKey: 'bus', targets: [], tab: 'fx',
    hint: 'On the FX tab: Main, Bus 1 and Bus 2 are separate effect lanes — route sources to them on the MIX tab.' },

  // Performance
  { group: 'Performance', name: 'Arpeggiator', learnKey: 'arp', targets: ['Arpeggiator'], tab: 'seq' },
  { group: 'Performance', name: 'Clip Sequencer', learnKey: 'clip', targets: ['Clips'], tab: 'seq' },
  { group: 'Performance', name: 'Scale Lock', learnKey: 'scale-lock', targets: ['Global'], tab: 'global',
    hint: 'On the GLOBAL tab — pick a root and scale, then enable Scale Lock.' },
  { group: 'Performance', name: 'Glide', learnKey: 'glide', targets: ['Global'], tab: 'global' },
  { group: 'Performance', name: 'MPE', learnKey: 'mpe', targets: ['MPE'] },

  // Tools
  { group: 'Tools', name: 'Presets', learnKey: 'preset', targets: ['Save'] },
  { group: 'Tools', name: 'Randomize & Mutate', learnKey: 'randomize', targets: ['Random', 'Mutate'] },
  { group: 'Tools', name: 'A/B Compare', learnKey: 'ab', targets: ['A/B'] },
  { group: 'Tools', name: 'Bounce to audio', learnKey: 'bounce', targets: ['Bounce', '⭳ Bounce'] },
  { group: 'Tools', name: 'Share to Community', learnKey: 'share', targets: ['Share'] },
  { group: 'Tools', name: 'Wavetable Editor', learnKey: 'wt-editor', targets: ['WT Editor'] },
  { group: 'Tools', name: 'MIDI keyboards', learnKey: 'midi-btn', targets: ['MIDI'] },
  { group: 'Tools', name: 'Learn mode', learnKey: 'learn', targets: [],
    hint: 'The 🔍 button in the top-right corner — hover anything for a description, click for the full story.' },
  { group: 'Tools', name: 'Microtuning', learnKey: 'tuning', targets: ['Global'], tab: 'global' },
]

const entryByKey = new Map(LEARN_ENTRIES.map(e => [e.key, e]))
/** Strip [[term]] / [[term|shown]] markup down to plain text for the card. */
function plain(body: string): string {
  return body.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_, k: string) => entryByKey.get(k)?.title ?? k)
}

// ── Component ────────────────────────────────────────────────────────────────

export default function HelpButton({ onShowTab }: { onShowTab?: (tab: SynthTab) => void }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'shortcuts' | 'features'>('shortcuts')
  const [hintFor, setHintFor] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [isMac] = useState(() => typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac'))

  // glow keyframes, injected once
  useEffect(() => {
    const id = 'apollo-help-styles'
    if (typeof document === 'undefined' || document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
@keyframes apolloHelpGlow {
  0%   { box-shadow: 0 0 0 3px rgba(250,204,21,0.95), 0 0 18px 5px rgba(250,204,21,0.55); }
  5%   { box-shadow: 0 0 0 1px rgba(250,204,21,0.45), 0 0 6px 2px rgba(250,204,21,0.25); }
  10%  { box-shadow: 0 0 0 3px rgba(250,204,21,0.95), 0 0 18px 5px rgba(250,204,21,0.55); }
  15%  { box-shadow: 0 0 0 1px rgba(250,204,21,0.45), 0 0 6px 2px rgba(250,204,21,0.25); }
  20%  { box-shadow: 0 0 0 3px rgba(250,204,21,0.9), 0 0 16px 5px rgba(250,204,21,0.5); }
  100% { box-shadow: 0 0 0 3px rgba(250,204,21,0), 0 0 4px 1px rgba(250,204,21,0); }
}
.apollo-help-glow { animation: apolloHelpGlow ${GLOW_MS}ms ease-out both; border-radius: 5px; }
`
    document.head.appendChild(style)
  }, [])

  // '?' opens from anywhere (letters are note keys, so ? only)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '?') { e.preventDefault(); setQuery(''); setOpen(true) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (query) setQuery('')
        else setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, query])

  const renderKeys = (keys: string) =>
    isMac ? keys : keys.replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt ').replace(/⇧/g, 'Shift ')

  function handleFeatureClick(f: Feature) {
    if (f.tab && onShowTab) onShowTab(f.tab)
    const glow = () => {
      const found = f.targets.length > 0 && highlightApolloTargets(f.targets)
      if (found) { setHintFor(null); setOpen(false) }
      else setHintFor(f.name)
    }
    // let the tab switch render first
    if (f.tab && onShowTab) window.setTimeout(glow, 250)
    else glow()
  }

  const q = query.trim().toLowerCase()
  const matches = (...texts: string[]) => !q || texts.some(t => t.toLowerCase().includes(q))

  const visibleGroups = SHORTCUT_GROUPS
    .map(g => ({ ...g, items: g.items.filter(sc => matches(sc.keys, renderKeys(sc.keys), sc.action)) }))
    .filter(g => g.items.length > 0)

  const featuresWithCopy = useMemo(() => FEATURES.map(f => {
    const e = entryByKey.get(f.learnKey)
    return { ...f, description: e ? plain(e.body) : '' }
  }), [])
  const visibleFeatures = featuresWithCopy.filter(f => matches(f.name, f.description, f.group))
  const featureGroups: [string, typeof visibleFeatures][] = []
  for (const f of visibleFeatures) {
    const bucket = featureGroups.find(([g]) => g === f.group)
    if (bucket) bucket[1].push(f)
    else featureGroups.push([f.group, [f]])
  }

  const tabBtn = (t: 'shortcuts' | 'features', label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        background: tab === t ? UI.inset : 'transparent',
        border: tab === t ? `1px solid ${UI.borderLight}` : '1px solid transparent',
        borderRadius: 5, color: tab === t ? UI.text : UI.dim,
        cursor: 'pointer', fontSize: 11, padding: '3px 12px', fontWeight: 700,
      }}
    >{label}</button>
  )

  return (
    <>
      <button
        onClick={() => { setQuery(''); setOpen(v => !v) }}
        title="Help — shortcuts & features (?)"
        data-learn-ui=""
        style={{
          background: open ? `linear-gradient(180deg, ${UI.blue} 0%, ${UI.blue}cc 100%)` : `linear-gradient(180deg, ${UI.header} 0%, ${UI.panel} 100%)`,
          color: open ? '#0b0d10' : UI.dim,
          border: '1px solid ' + (open ? UI.blue : UI.border),
          borderRadius: 5, padding: '3px 7px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <HelpCircle size={13} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          data-learn-ui=""
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 600,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 540, maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 80px)',
              display: 'flex', flexDirection: 'column',
              background: `linear-gradient(180deg, ${UI.panel} 0%, ${UI.panelLo} 100%)`,
              border: `1px solid ${UI.borderLight}`, borderRadius: 10,
              boxShadow: '0 16px 50px rgba(0,0,0,0.7)', overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 14px', borderBottom: `1px solid ${UI.border}`,
              background: `linear-gradient(180deg, ${UI.header} 0%, ${UI.headerLo} 100%)`, flexShrink: 0,
            }}>
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, color: UI.text, textTransform: 'uppercase', marginRight: 8 }}>Help</span>
              {tabBtn('shortcuts', 'Shortcuts')}
              {tabBtn('features', 'Features')}
              <button
                onClick={() => setOpen(false)}
                title="Close"
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: UI.dim, display: 'flex', padding: 2 }}
              ><X size={15} /></button>
            </div>

            {/* Search */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 14px', borderBottom: `1px solid ${UI.border}`, flexShrink: 0,
            }}>
              <Search size={13} style={{ color: UI.dim, flexShrink: 0 }} />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search ${tab === 'shortcuts' ? 'shortcuts' : 'features'}…`}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: UI.text, fontSize: 12 }}
              />
              {query && (
                <button onClick={() => setQuery('')} title="Clear search"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.dim, display: 'flex', padding: 2 }}>
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Body */}
            <div style={{ overflowY: 'auto', padding: '12px 14px' }}>
              {tab === 'shortcuts' && visibleGroups.length === 0 && (
                <div style={{ fontSize: 12, color: UI.dim, padding: '8px 0' }}>
                  No shortcuts match “{query.trim()}”.
                  {visibleFeatures.length > 0 && (
                    <button onClick={() => setTab('features')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.blue, fontSize: 12, padding: 0, marginLeft: 5, textDecoration: 'underline' }}>
                      {visibleFeatures.length} match{visibleFeatures.length === 1 ? '' : 'es'} in Features
                    </button>
                  )}
                </div>
              )}
              {tab === 'features' && visibleFeatures.length === 0 && (
                <div style={{ fontSize: 12, color: UI.dim, padding: '8px 0' }}>No features match “{query.trim()}”.</div>
              )}

              {tab === 'shortcuts' ? (
                visibleGroups.map(group => (
                  <div key={group.label} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: UI.dim, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>{group.label}</div>
                    {group.items.map(sc => (
                      <div key={sc.keys + sc.action} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '3px 0' }}>
                        <kbd style={{
                          fontFamily: 'monospace', fontSize: 10.5, fontWeight: 700, color: UI.text,
                          background: UI.inset, border: `1px solid ${UI.border}`, borderRadius: 4,
                          padding: '1px 7px', minWidth: 70, textAlign: 'center', flexShrink: 0, whiteSpace: 'nowrap',
                        }}>{renderKeys(sc.keys)}</kbd>
                        <span style={{ fontSize: 12, color: UI.text, opacity: 0.85 }}>{sc.action}</span>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                <>
                  {visibleFeatures.length > 0 && (
                    <div style={{ fontSize: 11, color: UI.dim, marginBottom: 10 }}>
                      Click a feature to jump to its tab and light up the control.
                    </div>
                  )}
                  {featureGroups.map(([group, feats]) => (
                    <div key={group} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: UI.dim, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>{group}</div>
                      {feats.map(f => (
                        <div key={f.name}>
                          <button
                            onClick={() => handleFeatureClick(f)}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left',
                              background: 'transparent', border: '1px solid transparent',
                              borderRadius: 6, padding: '6px 8px', cursor: 'pointer',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: UI.text }}>{f.name}</span>
                              {f.tab && (
                                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.6, color: UI.dim, border: `1px solid ${UI.border}`, borderRadius: 4, padding: '1px 5px' }}>
                                  {TAB_NAME[f.tab]}
                                </span>
                              )}
                            </span>
                            <span style={{ display: 'block', fontSize: 11, color: UI.dim, marginTop: 1, lineHeight: 1.45 }}>{f.description}</span>
                          </button>
                          {hintFor === f.name && (
                            <div style={{ fontSize: 11, color: '#facc15', padding: '2px 8px 6px', lineHeight: 1.45 }}>
                              {f.hint ?? 'This control isn’t visible right now.'}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>

            <div style={{ borderTop: `1px solid ${UI.border}`, padding: '8px 14px', flexShrink: 0, display: 'flex', gap: 14 }}>
              <span style={{ fontSize: 11, color: UI.dim }}>Tip: the 🔍 button explains any control you point at.</span>
              <a href="/community?app=apollo" target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', fontSize: 11, color: UI.dim, textDecoration: 'none' }}>
                Community patches ↗
              </a>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
