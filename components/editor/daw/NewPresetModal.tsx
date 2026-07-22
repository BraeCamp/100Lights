'use client'

// Full preset creator: source (soundfont/folder + range), the whole sound-
// shaping control set, per-effect pitch graphs, and an optional community
// share. Saving bundles fx + graphs onto the new preset (see PianoRoll's
// handleCreatePreset) so every note that uses the preset inherits its sound.

import { createPortal } from 'react-dom'
import type { RollFx, PitchGraph } from '@/lib/daw-types'
import FxControls, { cleanFx } from './FxControls'
import PitchGraphEditor from './PitchGraphEditor'

const midiName = (m: number) => `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12]}${Math.floor(m / 12) - 1}`

export default function NewPresetModal(props: {
  name: string; setName: (s: string) => void
  folder: string; setFolder: (s: string) => void
  lo: number; setLo: (n: number) => void
  hi: number; setHi: (n: number) => void
  sfText: string | null
  onSoundfontFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  sound: RollFx | undefined; setSound: (fx: RollFx | undefined) => void
  sustain: number; setSustain: (n: number) => void
  graphs: PitchGraph[]; setGraphs: (g: PitchGraph[]) => void
  share: boolean; setShare: (b: boolean) => void
  desc: string; setDesc: (s: string) => void
  loading: boolean
  onCreate: () => void
  onCancel: () => void
}) {
  const { name, setName, folder, setFolder, lo, setLo, hi, setHi, sfText, onSoundfontFile,
    sound, setSound, sustain, setSustain, graphs, setGraphs, share, setShare, desc, setDesc,
    loading, onCreate, onCancel } = props

  // Sustain lives inside the RollFx bag but is edited with its own slider.
  function commitFx(fx: RollFx | undefined) {
    const next: RollFx = { ...(fx ?? {}) }
    if (sustain > 0) next.sustain = Math.round(sustain * 100) / 100
    setSound(Object.keys(next).length ? next : undefined)
  }
  function onSustain(s: number) {
    setSustain(s)
    const next: RollFx = { ...(sound ?? {}) }
    if (s > 0) next.sustain = Math.round(s * 100) / 100; else delete next.sustain
    setSound(Object.keys(next).length ? next : undefined)
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 12, padding: '6px 8px', boxSizing: 'border-box' }
  const sectionLabel: React.CSSProperties = { fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '2px 0 6px' }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 380, maxHeight: '88vh', overflowY: 'auto',
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)', padding: 0,
      }}>
        <div style={{ position: 'sticky', top: 0, background: 'var(--bg-surface)', padding: '14px 16px 10px', borderBottom: '1px solid var(--border)', zIndex: 2 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>New preset</h3>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>Its sound + graphs apply to every note that uses it.</p>
        </div>

        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Source */}
          <div>
            <div style={sectionLabel}>NAME &amp; SOURCE</div>
            <input placeholder="Preset name" value={name} onChange={e => setName(e.target.value)} style={{ ...inp, marginBottom: 8 }} />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Upload soundfont (.js)</div>
            <input type="file" accept=".js" onChange={onSoundfontFile} style={{ fontSize: 10, color: 'var(--text-secondary)', width: '100%', marginBottom: 6 }} />
            {sfText ? (
              <div style={{ fontSize: 10, color: '#4ade80' }}>✓ Soundfont loaded — note range auto-detected</div>
            ) : (
              <>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Or a sound-library folder name</div>
                <input placeholder="Folder" value={folder} onChange={e => setFolder(e.target.value)} style={{ ...inp, marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Range</span>
                  <input type="number" min={0} max={127} value={lo} onChange={e => setLo(Number(e.target.value))} style={{ ...inp, width: 64 }} />
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{midiName(lo)} – {midiName(hi)}</span>
                  <input type="number" min={0} max={127} value={hi} onChange={e => setHi(Number(e.target.value))} style={{ ...inp, width: 64, marginLeft: 'auto' }} />
                </div>
              </>
            )}
          </div>

          {/* Sound */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={sectionLabel}>SOUND</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0 6px' }}>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 70 }}>Sustain</span>
              <input type="range" min={0} max={4} step={0.05} value={sustain} onChange={e => onSustain(Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--accent-light)' }} />
              <span style={{ fontSize: 9.5, color: 'var(--text-primary)', width: 48, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{sustain > 0 ? `${sustain.toFixed(2)}s` : 'Off'}</span>
            </div>
            <div style={{ margin: '0 -16px' }}>
              <FxControls value={sound} onCommit={commitFx} />
            </div>
          </div>

          {/* Pitch graphs */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={sectionLabel}>PITCH GRAPHS</div>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.5 }}>
              Make an effect vary by note pitch — e.g. tame brightness as notes are pitched up.
            </p>
            <PitchGraphEditor graphs={graphs} onChange={setGraphs} idGen={() => crypto.randomUUID()} />
          </div>

          {/* Share */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} />
              Share to the Community
            </label>
            {share && (
              <input placeholder="Short description (optional)" value={desc} onChange={e => setDesc(e.target.value)} style={{ ...inp, marginTop: 8 }} />
            )}
          </div>
        </div>

        <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg-surface)', display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <button onClick={onCreate} disabled={loading || !name.trim()} style={{
            flex: 1, padding: '9px 0', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none',
            background: 'var(--accent)', color: '#fff', cursor: loading || !name.trim() ? 'default' : 'pointer', opacity: loading || !name.trim() ? 0.55 : 1,
          }}>{loading ? 'Creating…' : share ? 'Create & share' : 'Create preset'}</button>
          <button onClick={onCancel} style={{ padding: '9px 16px', fontSize: 13, borderRadius: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
