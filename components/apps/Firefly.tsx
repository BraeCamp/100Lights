'use client'

// Firefly — the voice-first sketchpad, as a mobile app. Sing a melody, add a beat, then open the
// sketch in the full 100Lights studio. Composes the existing tuned surfaces (<VoiceMidi> hero +
// <BeatMaker>) inside a mobile app shell (app bar · segmented tabs · bottom action bar) and wires
// in the shared Workshop customization system (WorkshopThemeProvider + a mobile Customize sheet)
// so a user's theme follows them between here and the studio. Supersedes the paused Flutter app.
import { useCallback, useMemo, useState } from 'react'
import { Palette, X, RotateCcw } from 'lucide-react'
import VoiceMidi, { type RecNote } from '@/components/apps/VoiceMidi'
import BeatMaker from '@/components/apps/BeatMaker'
import { openSketchInStudio } from '@/lib/open-in-studio'
import type { MidiNote } from '@/lib/daw-types'
import { WorkshopThemeProvider, useWorkshopTheme } from '@/components/editor/WorkshopThemeProvider'
import { BUILTIN_PRESETS, PATTERN_TYPES, resolveColor } from '@/lib/workshop-theme'

type Tab = 'voice' | 'beat'

export default function Firefly() {
  // WorkshopThemeProvider supplies the shared theme + injects its <style> scoped to
  // [data-editor="true"] (the root below carries that attr, so the tokens + pattern land).
  return (
    <WorkshopThemeProvider>
      <FireflyApp />
    </WorkshopThemeProvider>
  )
}

function FireflyApp() {
  const [tab, setTab] = useState<Tab>('voice')
  const [melody, setMelody] = useState<RecNote[]>([])
  const [bpm, setBpm] = useState(100)
  const [beat, setBeat] = useState<MidiNote[]>([])
  const [customizing, setCustomizing] = useState(false)

  const onNotes = useCallback((notes: RecNote[], tempo: number) => { setMelody(notes); setBpm(tempo) }, [])
  const onPattern = useCallback((notes: MidiNote[]) => setBeat(notes), [])

  const hasContent = melody.length > 0 || beat.length > 0
  const summary = useMemo(() => {
    const parts: string[] = []
    if (melody.length) parts.push(`${melody.length} note${melody.length === 1 ? '' : 's'}`)
    if (beat.length) parts.push(`${beat.length} hit${beat.length === 1 ? '' : 's'}`)
    return parts.join(' · ')
  }, [melody.length, beat.length])

  const openInStudio = useCallback(() => {
    const melodyMidi: MidiNote[] = melody.map(m => ({
      id: crypto.randomUUID(), pitch: m.midi,
      startBeat: (m.startSec * bpm) / 60,
      durationBeats: Math.max(0.0625, (m.durSec * bpm) / 60),
      velocity: m.velocity <= 1 ? Math.max(1, Math.round(m.velocity * 127)) : Math.round(m.velocity),
    }))
    openSketchInStudio(melodyMidi, beat, { tempo: bpm, name: 'Firefly sketch' })
  }, [melody, beat, bpm])

  return (
    <div
      data-editor="true"
      style={{
        minHeight: '100dvh', background: 'var(--bg-base)',
        backgroundImage: 'var(--workshop-pattern, none)', backgroundSize: 'var(--workshop-pattern-size, auto)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* ── App bar ─────────────────────────────────────────────────────────── */}
      <header
        style={{
          position: 'sticky', top: 0, zIndex: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px calc(12px)', gap: 10,
          background: 'color-mix(in srgb, var(--bg-base) 82%, transparent)', backdropFilter: 'blur(10px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span aria-hidden style={{ fontSize: 18, filter: 'drop-shadow(0 0 6px var(--accent))' }}>🔆</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Firefly</span>
        </div>
        <button
          type="button" onClick={() => setCustomizing(true)} aria-label="Customize appearance"
          style={{
            display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10,
            background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer',
          }}
        >
          <Palette size={18} />
        </button>
      </header>

      {/* ── Segmented tabs ──────────────────────────────────────────────────── */}
      <nav style={{ display: 'flex', gap: 6, padding: '12px 16px 4px' }}>
        {(['voice', 'beat'] as Tab[]).map(t => {
          const active = tab === t
          return (
            <button
              key={t} type="button" onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '11px 0', borderRadius: 11, border: '1px solid var(--border)',
                fontSize: 14.5, fontWeight: 750, cursor: 'pointer', transition: 'background 120ms, color 120ms',
                background: active ? 'var(--accent)' : 'var(--bg-card)',
                color: active ? '#0e0d12' : 'var(--text-secondary)',
              }}
            >
              {t === 'voice' ? 'Sing a melody' : 'Add a beat'}
            </button>
          )
        })}
      </nav>

      {/* ── Content — both surfaces stay MOUNTED (display toggle) so a take survives a tab switch */}
      <main id="main" style={{ flex: 1, overflowX: 'hidden', padding: '10px 14px 96px' }}>
        <div style={{ display: tab === 'voice' ? 'block' : 'none' }}><VoiceMidi onNotes={onNotes} /></div>
        <div style={{ display: tab === 'beat' ? 'block' : 'none' }}><BeatMaker onPattern={onPattern} /></div>
      </main>

      {/* ── Bottom action bar ───────────────────────────────────────────────── */}
      <div
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 15,
          borderTop: '1px solid var(--border)', background: 'color-mix(in srgb, var(--bg-card) 92%, transparent)',
          backdropFilter: 'blur(10px)', padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hasContent ? `Sketch: ${summary}` : 'Sing or tap a beat to start'}
        </span>
        <button
          type="button" onClick={openInStudio} disabled={!hasContent}
          style={{
            flexShrink: 0, padding: '11px 18px', borderRadius: 11, border: 'none',
            fontSize: 14, fontWeight: 800, cursor: hasContent ? 'pointer' : 'not-allowed',
            background: hasContent ? 'var(--accent)' : 'var(--border)',
            color: hasContent ? '#0e0d12' : 'var(--text-muted, var(--text-secondary))',
          }}
        >
          Open in 100Lights →
        </button>
      </div>

      {customizing && <CustomizeSheet onClose={() => setCustomizing(false)} />}
    </div>
  )
}

// ── Mobile Customize sheet — the shared Workshop theme, on a bottom sheet ─────────────
// Reuses the real theme model + persistence (WorkshopThemeProvider.update/setTheme/reset →
// localStorage '100lights-workshop-theme' + account sync), so a theme set here follows the user
// into the studio and vice-versa. Mobile-appropriate controls (preset cards, native colour
// inputs, pattern chips) in place of the desktop AppearancePanel drawer.
function CustomizeSheet({ onClose }: { onClose: () => void }) {
  const { theme, update, setTheme, reset } = useWorkshopTheme()
  const accent = resolveColor(theme, 'accent')
  const bg = resolveColor(theme, 'bgBase')

  return (
    <div
      role="dialog" aria-label="Customize appearance" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxHeight: '82dvh', overflowY: 'auto',
          background: 'var(--bg-card)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          border: '1px solid var(--border)', borderBottom: 'none',
          padding: '10px 18px calc(24px + env(safe-area-inset-bottom))',
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 999, background: 'var(--border)', margin: '4px auto 14px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Customize</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <X size={17} />
          </button>
        </div>

        <Section label="Presets">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
            {BUILTIN_PRESETS.map(p => {
              const a = resolveColor(p, 'accent'), b = resolveColor(p, 'bgBase')
              return (
                <button
                  key={p.id} type="button" onClick={() => setTheme({ ...p, id: theme.id })}
                  style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 11, border: '1px solid var(--border)', background: b, cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ display: 'flex', gap: 4 }}>
                    <i style={{ width: 16, height: 16, borderRadius: 5, background: a }} />
                    <i style={{ width: 16, height: 16, borderRadius: 5, background: resolveColor(p, 'border') }} />
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: resolveColor(p, 'textPrimary') }}>{p.name}</span>
                </button>
              )
            })}
          </div>
        </Section>

        <Section label="Colors">
          <div style={{ display: 'flex', gap: 18 }}>
            <ColorField label="Accent" value={accent} onChange={v => update({ colors: { ...theme.colors, accent: v } })} />
            <ColorField label="Background" value={bg} onChange={v => update({ colors: { ...theme.colors, bgBase: v } })} />
          </div>
        </Section>

        <Section label="Pattern">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {PATTERN_TYPES.map(pt => {
              const active = (theme.pattern?.type ?? 'none') === pt.type
              return (
                <button
                  key={pt.type} type="button" onClick={() => update({ pattern: { ...theme.pattern, type: pt.type } })}
                  style={{ padding: '8px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: active ? 'var(--accent)' : 'var(--bg-base)', color: active ? '#0e0d12' : 'var(--text-secondary)' }}
                >
                  {pt.label}
                </button>
              )
            })}
          </div>
        </Section>

        <button
          type="button" onClick={reset}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 6, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          <RotateCcw size={14} /> Reset to default
        </button>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted, var(--text-secondary))', margin: '0 0 10px' }}>{label}</p>
      {children}
    </section>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
      {label}
      <input
        type="color" value={value} onChange={e => onChange(e.target.value)}
        style={{ width: 56, height: 40, padding: 0, border: '1px solid var(--border)', borderRadius: 9, background: 'none', cursor: 'pointer' }}
      />
    </label>
  )
}
