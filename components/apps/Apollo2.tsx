'use client'
// Apollo 2 — the approachability experiment (/apollo2). Same engine, same
// provider, same patches as /apollo — recomposed so a first-time user starts
// from VALUE instead of capability:
//
//   PLAY mode (default): pick a sound (cards, auditioned on click) → play it
//   (keyboard) → shape it (the patch's four NAMED macros, nothing else) →
//   "Surprise me" / "Variation" → Save. ~25 controls instead of 142.
//
//   DESIGN mode: the complete existing synth UI (ApolloFullUI), one click away
//   and one click back. Nothing is removed — it's re-sequenced.
//
// State (autosave, presets, MIDI map) is shared with /apollo via the same
// localStorage keys, so users can hop between the two freely.

import React, { useCallback, useEffect, useState } from 'react'
import {
  ApolloProvider, useApollo, useMeters, Knob, ToggleBtn, UI,
} from '@/components/apps/apollo/ApolloContext'
import { ApolloFullUI } from '@/components/apps/Apollo'
import KeyboardStrip from '@/components/apps/apollo/KeyboardStrip'
import ScopeView from '@/components/apps/apollo/ScopeView'
import LearnMode from '@/components/apps/apollo/LearnMode'
import HelpButton from '@/components/apps/apollo/HelpButton'
import { FACTORY_PRESETS } from '@/lib/apollo/presets'
import { initPatch, type ApolloPatch } from '@/lib/apollo/patch'

const MODE_KEY = 'apollo2_mode'
const LS_PRESETS = 'apollo_presets_v1'         // shared with /apollo's PresetBar
const AUTOSAVE_KEY = 'apollo_current_patch_v1' // shared autosave

// Card copy: instrument-shop words, not synthesis words.
const CARD_META: Record<string, { vibe: string; group: string }> = {
  'First Light': { vibe: 'warm · moving · a good place to start', group: 'Keys & Pads' },
  'Bell Keys': { vibe: 'glassy · ringing', group: 'Keys & Pads' },
  'Organ': { vibe: 'church-y · full', group: 'Keys & Pads' },
  'Vocal Pad': { vibe: 'airy · voice-like', group: 'Keys & Pads' },
  'PWM Strings': { vibe: 'lush · wide', group: 'Keys & Pads' },
  'Analog Bass': { vibe: 'fat · round', group: 'Bass' },
  'Sub Drone': { vibe: 'deep · slow', group: 'Bass' },
  'Hyper Saw': { vibe: 'huge · bright', group: 'Leads' },
  'FM Pluck': { vibe: 'snappy · metallic', group: 'Leads' },
  'Acid Line': { vibe: 'squelchy · plays itself', group: 'Leads' },
}

function PlayView({ toDesign }: { toDesign: () => void }) {
  const ctx = useApollo()
  const meters = useMeters()
  const [userPresets, setUserPresets] = useState<{ name: string; json: string }[]>([])
  const [saved, setSaved] = useState('')
  useEffect(() => {
    try { setUserPresets(JSON.parse(localStorage.getItem(LS_PRESETS) || '[]')) } catch { /* fresh */ }
  }, [])

  const applyPatch = useCallback((loaded: Partial<ApolloPatch>) => {
    const merged = { ...initPatch(), ...loaded } as ApolloPatch
    ctx.update(p => {
      for (const key of Object.keys(merged) as (keyof ApolloPatch)[]) {
        ;(p as unknown as Record<string, unknown>)[key] = merged[key]
      }
    })
  }, [ctx])

  const audition = useCallback(() => {
    void ctx.start().then(() => {
      ctx.engine.noteOn(60, 0.85)
      setTimeout(() => ctx.engine.noteOff(60), 700)
    })
  }, [ctx])

  const loadPreset = useCallback((patch: Partial<ApolloPatch>) => {
    applyPatch(structuredClone(patch))
    audition()
  }, [applyPatch, audition])

  // First run: never land on the Init sine — load First Light.
  useEffect(() => {
    const fresh = !localStorage.getItem(AUTOSAVE_KEY)
    if ((fresh || ctx.patch.name === 'Init')) {
      const fl = FACTORY_PRESETS.find(p => p.name === 'First Light')
      if (fl) applyPatch(structuredClone(fl.patch))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // "Surprise me": jump to a random factory sound with randomly-set macros —
  // always musical (unlike raw parameter dice), always different.
  const surprise = useCallback(() => {
    const pool = FACTORY_PRESETS.filter(p => p.name !== 'Init' && p.name !== ctx.patch.name && p.name !== 'Glitter Granules')
    const pick = pool[Math.floor(Math.random() * pool.length)]
    const patch = structuredClone(pick.patch)
    patch.macros = patch.macros.map((_, i) => (i < 4 ? Math.random() * 0.7 : 0))
    patch.name = pick.name
    applyPatch(patch)
    audition()
  }, [applyPatch, audition, ctx.patch.name])

  // "Variation": nudge the macros + a little detune — same sound, new mood.
  const variation = useCallback(() => {
    ctx.update(p => {
      for (let i = 0; i < 4; i++) {
        p.macros[i] = Math.max(0, Math.min(1, p.macros[i] + (Math.random() - 0.5) * 0.45))
        ctx.engine.setMacro(i, p.macros[i])
      }
      p.oscs[0].detune = Math.max(0, Math.min(0.5, p.oscs[0].detune + (Math.random() - 0.5) * 0.06))
    })
    audition()
  }, [ctx, audition])

  const save = useCallback(() => {
    const name = (ctx.patch.name?.trim() || 'My sound')
    const next = [...userPresets.filter(u => u.name !== name), { name, json: JSON.stringify(ctx.patch) }]
    setUserPresets(next)
    try { localStorage.setItem(LS_PRESETS, JSON.stringify(next)) } catch { /* quota */ }
    setSaved(name)
    setTimeout(() => setSaved(''), 2500)
  }, [ctx.patch, userPresets])

  // macros that are actually named (the standard four on every factory preset)
  const namedMacros = ctx.patch.macroNames
    .map((name, i) => ({ name, i }))
    .filter(m => m.name && m.name !== `Macro ${m.i + 1}`)

  const groups: [string, typeof FACTORY_PRESETS][] = []
  for (const fp of FACTORY_PRESETS) {
    if (fp.name === 'Init' || fp.name === 'Glitter Granules') continue // Init is a blank; Granules needs a sample
    const g = CARD_META[fp.name]?.group ?? 'More'
    const bucket = groups.find(([label]) => label === g)
    if (bucket) bucket[1].push(fp)
    else groups.push([g, [fp]])
  }

  const btn = (label: string, onClick: () => void, title?: string, accent?: string) => (
    <ToggleBtn on={false} label={label} onClick={onClick} title={title} accent={accent} />
  )

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '14px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ── Header: the whole toolset, in plain words ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        background: `linear-gradient(180deg, ${UI.panel} 0%, ${UI.panelLo} 100%)`,
        border: `1px solid ${UI.border}`, borderRadius: 8, padding: '8px 12px',
      }}>
        <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 4, color: UI.text }}>
          APOLLO<span style={{ color: UI.blue }}>2</span>
        </div>
        <div data-learn="Presets" style={{ fontSize: 12.5, fontWeight: 700, color: UI.green, padding: '0 4px' }} title="The sound you're playing — pick another below">
          {ctx.patch.name || 'Untitled'}
        </div>
        {btn('Surprise me', surprise, 'Jump to a random sound with fresh settings')}
        {btn('Variation', variation, 'Small random changes to this sound')}
        {btn(saved ? 'Saved ✓' : 'Save', save, 'Keep this sound in Your sounds')}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Knob path="global.masterGain" label="Volume" size={30} />
          <div title="Output level" style={{ width: 7, height: 30, background: UI.inset, border: `1px solid ${UI.border}`, borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${Math.min(100, meters.peak * 100)}%`, background: meters.peak > 1 ? '#e05555' : UI.green, transition: 'height 50ms linear' }} />
          </div>
        </div>
        <HelpButton />
        <LearnMode />
        <button
          onClick={toDesign}
          title="Open the full synthesizer — every oscillator, filter, and effect"
          style={{
            background: `linear-gradient(180deg, ${UI.blue} 0%, ${UI.blue}cc 100%)`, color: '#0b0d10',
            border: `1px solid ${UI.blue}`, borderRadius: 5, padding: '4px 12px',
            fontSize: 10, fontWeight: 800, letterSpacing: 0.6, cursor: 'pointer', textTransform: 'uppercase',
          }}
        >Design ↗</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(380px, 3fr) minmax(300px, 2fr)', gap: 10, alignItems: 'start' }}>
        {/* ── Sounds ── */}
        <div style={{ background: `linear-gradient(180deg, ${UI.panel} 0%, ${UI.panelLo} 100%)`, border: `1px solid ${UI.border}`, borderRadius: 8, padding: '10px 12px' }}>
          <div data-learn="Presets" style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: UI.text, textTransform: 'uppercase', marginBottom: 8 }}>Sounds</div>
          {groups.map(([label, presets]) => (
            <div key={label} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, color: UI.dim, textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {presets.map(fp => {
                  const active = ctx.patch.name === fp.name
                  return (
                    <button
                      key={fp.name}
                      onClick={() => loadPreset(fp.patch)}
                      data-learn="Presets"
                      title={`Load “${fp.name}” (plays a preview note)`}
                      style={{
                        textAlign: 'left', cursor: 'pointer', borderRadius: 7, padding: '7px 11px',
                        background: active ? `linear-gradient(180deg, ${UI.blue}33 0%, ${UI.panel} 100%)` : UI.inset,
                        border: `1px solid ${active ? UI.blue : UI.border}`,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 750, color: UI.text }}>{fp.name}</div>
                      <div style={{ fontSize: 9.5, color: UI.dim }}>{CARD_META[fp.name]?.vibe ?? ''}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          {userPresets.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, color: UI.dim, textTransform: 'uppercase', marginBottom: 5 }}>Your sounds</div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {userPresets.map(up => (
                  <button
                    key={up.name}
                    onClick={() => { try { loadPreset(JSON.parse(up.json)) } catch { /* bad json */ } }}
                    style={{
                      textAlign: 'left', cursor: 'pointer', borderRadius: 7, padding: '7px 11px',
                      background: UI.inset, border: `1px solid ${ctx.patch.name === up.name ? UI.green : UI.border}`,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 750, color: UI.text }}>{up.name}</div>
                    <div style={{ fontSize: 9.5, color: UI.dim }}>saved by you</div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <a
            href="/community?kind=patch"
            target="_blank" rel="noreferrer"
            style={{ display: 'inline-block', marginTop: 6, fontSize: 10.5, color: UI.dim, textDecoration: 'none' }}
          >More sounds from the community ↗</a>
        </div>

        {/* ── This sound's knobs + scope ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: `linear-gradient(180deg, ${UI.panel} 0%, ${UI.panelLo} 100%)`, border: `1px solid ${UI.border}`, borderRadius: 8, padding: '10px 12px' }}>
            <div data-learn="Macros" style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: UI.text, textTransform: 'uppercase', marginBottom: 8 }}>
              This sound’s knobs
            </div>
            {namedMacros.length > 0 ? (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', padding: '4px 0' }}>
                {namedMacros.map(m => (
                  <div key={m.i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <Knob
                      label={ctx.patch.macroNames[m.i]}
                      size={46}
                      min={0} max={1} def={0}
                      value={ctx.patch.macros[m.i]}
                      onChange={v => { ctx.setParam(`macro${m.i + 1}`, v); ctx.engine.setMacro(m.i, v) }}
                      onCommit={() => ctx.commit()}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: UI.dim, lineHeight: 1.6 }}>
                This sound has no performance knobs yet — open <b style={{ color: UI.text }}>Design</b> to
                shape it directly, or pick a sound above (they all come with four).
              </div>
            )}
          </div>
          <ScopeView />
        </div>
      </div>

      {/* ── Keyboard ── */}
      <KeyboardStrip />
      <div style={{ fontSize: 10, color: UI.dim, textAlign: 'center' }}>
        Play with your mouse or computer keys (A–K, Z/X for octaves) · the 🔍 button explains anything you point at
      </div>
    </div>
  )
}

function Apollo2Inner() {
  const ctx = useApollo()
  const [mode, setMode] = useState<'play' | 'design'>('play')
  useEffect(() => {
    const m = localStorage.getItem(MODE_KEY)
    if (m === 'design') setMode('design')
  }, [])
  const switchMode = (m: 'play' | 'design') => {
    setMode(m)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* quota */ }
  }

  if (mode === 'design') {
    return (
      <div>
        <div style={{ maxWidth: 1420, margin: '0 auto', padding: '8px 16px 0', display: 'flex' }}>
          <button
            onClick={() => switchMode('play')}
            title="Back to the simple view — sounds, knobs, keyboard"
            style={{
              background: `linear-gradient(180deg, ${UI.header} 0%, ${UI.panel} 100%)`, color: UI.dim,
              border: `1px solid ${UI.border}`, borderRadius: 5, padding: '4px 12px',
              fontSize: 10, fontWeight: 800, letterSpacing: 0.6, cursor: 'pointer', textTransform: 'uppercase',
            }}
          >◀ Play mode</button>
        </div>
        <ApolloFullUI />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: UI.bg, paddingBottom: 20 }}>
      <PlayView toDesign={() => switchMode('design')} />
      {!ctx.started && (
        <div
          onClick={() => { void ctx.start() }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(6,8,10,0.9)', zIndex: 500,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 8, color: UI.text }}>
            APOLLO<span style={{ color: UI.blue }}>2</span>
          </div>
          <div style={{ fontSize: 14, color: UI.text, opacity: 0.85 }}>Click anywhere, then just play.</div>
          <div style={{ fontSize: 11, color: UI.dim }}>Every sound in here is yours to bend.</div>
        </div>
      )}
    </div>
  )
}

export default function Apollo2() {
  return (
    <ApolloProvider>
      <Apollo2Inner />
    </ApolloProvider>
  )
}
