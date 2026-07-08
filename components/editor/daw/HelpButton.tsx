'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle, Search, X } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'

// ── Feature highlight ──────────────────────────────────────────────────────────
// Buttons across the editor carry data-help-id attributes. Clicking a feature in
// the help panel finds those elements and runs a 7s fading glow on them.

const GLOW_MS = 7000

export function highlightHelpTargets(ids: string[]): boolean {
  if (typeof document === 'undefined') return false
  const els = ids.flatMap(id =>
    Array.from(document.querySelectorAll<HTMLElement>(`[data-help-id="${id}"]`))
  )
  if (els.length === 0) return false
  for (const el of els) {
    // Restart the animation if this target is already glowing
    el.classList.remove('daw-help-glow')
    void el.offsetWidth
    el.classList.add('daw-help-glow')
    window.setTimeout(() => el.classList.remove('daw-help-glow'), GLOW_MS + 100)
  }
  els[0].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  return true
}

// ── Data ───────────────────────────────────────────────────────────────────────

type Mode = 'music' | 'podcast'

interface Shortcut { keys: string; action: string }
interface ShortcutGroup { label: string; modes?: Mode[]; items: Shortcut[] }

// ⌘ is swapped for Ctrl at render time on non-Mac platforms
const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: 'Transport & Global',
    items: [
      { keys: 'Space', action: 'Play / Stop' },
      { keys: 'R', action: 'Start / stop recording' },
      { keys: 'M', action: 'Toggle metronome' },
      { keys: '← / →', action: 'Move playhead ±1 beat (no clips selected)' },
      { keys: '⌘Z', action: 'Undo' },
      { keys: '⌘S', action: 'Save project' },
      { keys: 'Delete', action: 'Delete selected clips' },
    ],
  },
  {
    label: 'Arrangement — selection & editing',
    items: [
      { keys: '← / →', action: 'Nudge selected clips by snap (⇧ = 1 beat)' },
      { keys: '↑ / ↓', action: 'Move selected clips to the track above / below' },
      { keys: '⌘C / ⌘V', action: 'Copy / paste clips or effects' },
      { keys: '⌘D', action: 'Duplicate selection after itself' },
      { keys: '⌘A', action: 'Select all clips' },
      { keys: 'Esc', action: 'Clear selection' },
      { keys: 'S', action: 'Split selected clip at playhead' },
      { keys: 'Delete', action: 'Delete selected effects' },
    ],
  },
  {
    label: 'Arrangement — view & playback',
    items: [
      { keys: 'Home', action: 'Jump playhead to start' },
      { keys: 'L', action: 'Toggle loop' },
      { keys: 'P', action: 'Set loop region to selected clips' },
      { keys: 'G', action: 'Toggle ripple edit' },
      { keys: 'F', action: 'Fit arrangement to window' },
      { keys: '1–5', action: 'Snap mode: Off / 1/16 / 1/8 / Beat / Bar' },
      { keys: '⌥ drag', action: 'Bypass snap while dragging' },
    ],
  },
  {
    label: 'Piano Roll',
    modes: ['music'],
    items: [
      { keys: 'Delete', action: 'Delete selected notes' },
      { keys: '⌘A', action: 'Select all notes' },
    ],
  },
]

interface Feature {
  name: string
  description: string
  helpIds: string[]
  modes?: Mode[]           // undefined = both
  hint?: string            // shown when the target isn't currently on screen
}

const ARR_HINT = 'Switch to the Arrangement view to see this control.'

const FEATURES: Feature[] = [
  // Transport
  { name: 'Play / Stop', description: 'Start and stop playback from the playhead.', helpIds: ['play'] },
  { name: 'Record', description: 'Record armed tracks (or the master bus) into new clips.', helpIds: ['record'] },
  { name: 'Rewind', description: 'Jump the playhead back to the start.', helpIds: ['rewind'] },
  { name: 'Loop', description: 'Repeat the loop region during playback.', helpIds: ['loop'] },
  { name: 'Jam Capture', description: 'Grab the last 30 seconds of playback from the jam buffer as a clip.', helpIds: ['jam'], modes: ['music'] },
  { name: 'Tempo & Tap', description: 'Click the BPM to type a tempo, or tap the TAP button in time.', helpIds: ['bpm'], modes: ['music'] },
  { name: 'Time Signature', description: 'Click to edit the project time signature.', helpIds: ['time-sig'], modes: ['music'] },
  { name: 'Metronome', description: 'Click track while recording or playing.', helpIds: ['metronome'], modes: ['music'] },
  { name: 'Swing', description: 'Push off-beat notes later for a swung groove.', helpIds: ['swing'], modes: ['music'] },
  { name: 'Varispeed', description: 'Tape-style speed control — pitch follows playback speed.', helpIds: ['varispeed'], modes: ['music'] },
  { name: 'Key & Scale', description: 'Set the project root note and scale used by instruments.', helpIds: ['key-scale'], modes: ['music'] },
  { name: 'Master Volume', description: 'Overall output level of the project.', helpIds: ['master-volume'] },
  { name: 'Tuner', description: 'Open the tuner panel to tune pads and instruments.', helpIds: ['tuner'], modes: ['music'] },
  { name: 'Masking Detector', description: 'See which tracks compete in the same frequency bands.', helpIds: ['masking'], modes: ['music'] },
  { name: 'Rec All Voice', description: 'Arm or disarm every voice track at once.', helpIds: ['rec-all-voice'], modes: ['podcast'] },
  // Sidebar / views
  { name: 'Sound Library', description: 'Browse and drag sounds into your project from the sidebar.', helpIds: ['sound-library'], modes: ['music'] },
  { name: 'Session View', description: 'Launch clips in a grid, scene by scene.', helpIds: ['view-session'], modes: ['music'] },
  { name: 'Arrangement View', description: 'Lay out clips on a timeline.', helpIds: ['view-arrangement'] },
  { name: 'Mixer', description: 'Volume, pan, sends and effects for every track.', helpIds: ['view-mixer'] },
  // Arrangement toolbar
  { name: 'Zoom', description: 'Zoom the arrangement timeline in and out.', helpIds: ['zoom-in', 'zoom-out'], hint: ARR_HINT },
  { name: 'Fit to Window', description: 'Fit the whole arrangement into the visible area.', helpIds: ['fit-window'], hint: ARR_HINT },
  { name: 'Snap', description: 'Grid resolution clips snap to when dragging (keys 1–5).', helpIds: ['snap'], hint: ARR_HINT },
  { name: 'Waveform Zoom', description: 'Vertical zoom of waveforms inside clips.', helpIds: ['wf-zoom'], hint: ARR_HINT },
  { name: 'Ripple Edit', description: 'Moving a clip shifts everything to its right along with it.', helpIds: ['ripple'], hint: ARR_HINT },
  { name: 'Split at Transients', description: 'Slice the selected audio clip at every detected hit.', helpIds: ['split-transients'], hint: ARR_HINT },
  { name: 'Spectral Morph', description: 'Blend two selected audio clips into a brand-new sound.', helpIds: ['morph'], hint: 'Select exactly two audio clips in the Arrangement view first.' },
  { name: 'Piano Roll', description: 'Open the MIDI editor for the selected track.', helpIds: ['piano-roll'], modes: ['music'], hint: ARR_HINT },
  { name: 'Export', description: 'Render the project to WAV or WebM audio.', helpIds: ['export'], hint: ARR_HINT },
  { name: 'Chapter Marker', description: 'Drop a chapter marker at the playhead.', helpIds: ['chapter'], modes: ['podcast'], hint: ARR_HINT },
  { name: 'Publish', description: 'Publish the episode to your podcast RSS feed.', helpIds: ['publish'], modes: ['podcast'], hint: ARR_HINT },
  { name: 'Save Project', description: 'Save your project (also ⌘S).', helpIds: ['save'], hint: ARR_HINT },
]

// ── Component ──────────────────────────────────────────────────────────────────

export default function HelpButton() {
  const { audioMode } = useDaw()
  const mode: Mode = audioMode === 'podcast' ? 'podcast' : 'music'
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'shortcuts' | 'features'>('shortcuts')
  const [hintFor, setHintFor] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Only rendered inside the modal, which opens post-hydration — no SSR mismatch
  const [isMac] = useState(() => typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac'))

  // Inject glow keyframes once per page: two attention blinks, then a slow fade
  useEffect(() => {
    const id = 'daw-help-styles'
    if (typeof document === 'undefined' || document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
@keyframes dawHelpGlow {
  0%   { box-shadow: 0 0 0 3px rgba(250,204,21,0.95), 0 0 18px 5px rgba(250,204,21,0.55); }
  5%   { box-shadow: 0 0 0 1px rgba(250,204,21,0.45), 0 0 6px 2px rgba(250,204,21,0.25); }
  10%  { box-shadow: 0 0 0 3px rgba(250,204,21,0.95), 0 0 18px 5px rgba(250,204,21,0.55); }
  15%  { box-shadow: 0 0 0 1px rgba(250,204,21,0.45), 0 0 6px 2px rgba(250,204,21,0.25); }
  20%  { box-shadow: 0 0 0 3px rgba(250,204,21,0.9), 0 0 16px 5px rgba(250,204,21,0.5); }
  100% { box-shadow: 0 0 0 3px rgba(250,204,21,0), 0 0 4px 1px rgba(250,204,21,0); }
}
.daw-help-glow { animation: dawHelpGlow ${GLOW_MS}ms ease-out both; border-radius: 4px; }
`
    document.head.appendChild(style)
  }, [])

  // Glow the help button itself when the editor opens so users learn where it is
  useEffect(() => {
    const t = window.setTimeout(() => highlightHelpTargets(['help']), 600)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        // First Esc clears an active search; second closes the modal
        if (query) setQuery('')
        else setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, query])

  function renderKeys(keys: string) {
    return isMac ? keys : keys.replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt ').replace(/⇧/g, 'Shift ')
  }

  function handleFeatureClick(f: Feature) {
    const found = highlightHelpTargets(f.helpIds)
    if (found) {
      setHintFor(null)
      setOpen(false)  // close so the glowing button is visible
    } else {
      setHintFor(f.name)
    }
  }

  const q = query.trim().toLowerCase()
  const matches = (...texts: string[]) => !q || texts.some(t => t.toLowerCase().includes(q))

  const visibleGroups = SHORTCUT_GROUPS
    .filter(g => !g.modes || g.modes.includes(mode))
    .map(g => ({ ...g, items: g.items.filter(sc => matches(sc.keys, renderKeys(sc.keys), sc.action)) }))
    .filter(g => g.items.length > 0)
  const visibleFeatures = FEATURES
    .filter(f => !f.modes || f.modes.includes(mode))
    .filter(f => matches(f.name, f.description))

  const tabBtn = (t: 'shortcuts' | 'features', label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        background: tab === t ? 'var(--bg-card)' : 'transparent',
        border: tab === t ? '1px solid var(--border)' : '1px solid transparent',
        borderRadius: 4,
        color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
        cursor: 'pointer', fontSize: 12, padding: '3px 12px', fontWeight: 600,
      }}
    >{label}</button>
  )

  return (
    <>
      <button
        onClick={() => { setQuery(''); setOpen(v => !v) }}
        title="Help — shortcuts & features"
        data-help-id="help"
        style={{
          width: 24, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer',
          background: open ? 'rgba(99,102,241,0.12)' : 'transparent',
          color: open ? 'var(--accent)' : 'var(--text-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <HelpCircle size={14} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 520, maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 80px)',
              display: 'flex', flexDirection: 'column',
              background: '#141414', border: '1px solid #2a2a2a', borderRadius: 10,
              boxShadow: '0 16px 50px rgba(0,0,0,0.7)', overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 14px', borderBottom: '1px solid #232323', background: '#171717',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginRight: 8 }}>Help</span>
              {tabBtn('shortcuts', 'Shortcuts')}
              {tabBtn('features', 'Features')}
              <button
                onClick={() => setOpen(false)}
                title="Close"
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#666', display: 'flex', padding: 2 }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Search */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '8px 14px', borderBottom: '1px solid #232323', background: '#161616',
              flexShrink: 0,
            }}>
              <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search ${tab === 'shortcuts' ? 'shortcuts' : 'features'}…`}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  color: 'var(--text-primary)', fontSize: 12,
                }}
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  title="Clear search"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', display: 'flex', padding: 2 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Body */}
            <div style={{ overflowY: 'auto', padding: '12px 14px' }}>
              {tab === 'shortcuts' && visibleGroups.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
                  No shortcuts match “{query.trim()}”.
                  {visibleFeatures.length > 0 && (
                    <button
                      onClick={() => setTab('features')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, padding: 0, marginLeft: 5, textDecoration: 'underline' }}
                    >{visibleFeatures.length} match{visibleFeatures.length === 1 ? '' : 'es'} in Features</button>
                  )}
                </div>
              )}
              {tab === 'features' && visibleFeatures.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
                  No features match “{query.trim()}”.
                  {visibleGroups.length > 0 && (
                    <button
                      onClick={() => setTab('shortcuts')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, padding: 0, marginLeft: 5, textDecoration: 'underline' }}
                    >{visibleGroups.reduce((n, g) => n + g.items.length, 0)} match{visibleGroups.reduce((n, g) => n + g.items.length, 0) === 1 ? '' : 'es'} in Shortcuts</button>
                  )}
                </div>
              )}
              {tab === 'shortcuts' ? (
                visibleGroups.map(group => (
                  <div key={group.label} style={{ marginBottom: 16 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                      letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6,
                    }}>{group.label}</div>
                    {group.items.map(sc => (
                      <div key={group.label + sc.keys + sc.action} style={{
                        display: 'flex', alignItems: 'baseline', gap: 10, padding: '3px 0',
                      }}>
                        <kbd style={{
                          fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
                          color: 'var(--text-primary)', background: '#1f1f1f',
                          border: '1px solid #2e2e2e', borderRadius: 4,
                          padding: '1px 7px', minWidth: 64, textAlign: 'center', flexShrink: 0,
                          whiteSpace: 'nowrap',
                        }}>{renderKeys(sc.keys)}</kbd>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sc.action}</span>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                <>
                  {visibleFeatures.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                      Click a feature to light up its button in the editor.
                    </div>
                  )}
                  {visibleFeatures.map(f => (
                    <div key={f.name}>
                      <button
                        onClick={() => handleFeatureClick(f)}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          background: 'transparent', border: '1px solid transparent',
                          borderRadius: 6, padding: '6px 8px', cursor: 'pointer',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{f.name}</span>
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{f.description}</span>
                      </button>
                      {hintFor === f.name && (
                        <div style={{
                          fontSize: 11, color: '#facc15', padding: '2px 8px 6px',
                        }}>{f.hint ?? 'This control isn’t visible right now.'}</div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
