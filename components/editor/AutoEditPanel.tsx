'use client'

import { Crop, Wand2, Film, Users, Scissors, Zap, MicVocal, Sparkles, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

// The video editor's "Auto-Edit" sidebar — one home for every automated edit. Each action calls a
// handler the editor wires to its existing engines (reframe, beat montage, multicam, silence trim).
// Rows flagged `soon` are the next auto-edit features (hype pass, jump-cuts, best-section) — shown so
// the surface is discoverable, disabled until wired.
export interface AutoEditPanelProps {
  busy?: string | null                 // id of the action currently running (spinner)
  note?: string | null                 // last status line
  onReframe?: () => void               // active clip → vertical, subject-tracked
  onBeatMontage?: () => void           // footage pool + audio → beat-synced cuts
  onMulticam?: () => void              // cut across camera tracks to the loudest
  onSpeakerMulticam?: () => void       // cut to whoever's talking (mouth + audio)
  onTrimSilence?: () => void           // drop dead air from talking audio
  onHype?: () => void                  // punch-zoom on beats + drops
  onClearHype?: () => void             // remove the hype punches
  onJumpCut?: () => void               // ripple-remove silent gaps from raw footage
  onAutoPolish?: () => void            // one-click: reframe → vertical + hype punches
}

interface Action {
  id: string; label: string; desc: string; icon: ReactNode; onClick?: () => void; soon?: boolean
}

export default function AutoEditPanel(p: AutoEditPanelProps) {
  const groups: { name: string; actions: Action[] }[] = [
    {
      name: 'One-click',
      actions: [
        { id: 'polish', label: 'Auto-polish → short', desc: 'Reframe to vertical + punch-zoom the beats', icon: <Sparkles size={15} />, onClick: p.onAutoPolish },
      ],
    },
    {
      name: 'Reframe',
      actions: [
        { id: 'reframe', label: 'Auto-reframe to vertical', desc: 'Track the subject and crop 16:9 → 9:16', icon: <Crop size={15} />, onClick: p.onReframe },
      ],
    },
    {
      name: 'Cut & montage',
      actions: [
        { id: 'montage', label: 'Beat-synced montage', desc: 'Cut your footage to the music', icon: <Film size={15} />, onClick: p.onBeatMontage },
        { id: 'multicam', label: 'Multicam · cut to loudest', desc: 'Switch cameras on the loudest track', icon: <Users size={15} />, onClick: p.onMulticam },
        { id: 'speaker', label: 'Multicam · cut to speaker', desc: 'Cut to whoever is talking', icon: <MicVocal size={15} />, onClick: p.onSpeakerMulticam },
      ],
    },
    {
      name: 'Energy',
      actions: [
        { id: 'hype', label: 'Beat/drop hype pass', desc: 'Punch-zoom on every beat & drop', icon: <Zap size={15} />, onClick: p.onHype },
        ...(p.onClearHype ? [{ id: 'clearhype', label: 'Clear hype punches', desc: 'Remove the beat/drop punches', icon: <Scissors size={15} />, onClick: p.onClearHype }] : []),
      ],
    },
    {
      name: 'Cleanup',
      actions: [
        { id: 'jumpcut', label: 'Silence jump-cuts', desc: 'Ripple out dead air from talking footage', icon: <Scissors size={15} />, onClick: p.onJumpCut },
        { id: 'silence', label: 'Trim silence (captions)', desc: 'Cut gaps between caption lines', icon: <Scissors size={15} />, onClick: p.onTrimSilence },
      ],
    },
    {
      name: 'Coming soon',
      actions: [
        { id: 'best', label: 'Auto best-section + hook', desc: 'Find the best moments automatically', icon: <Sparkles size={15} />, soon: true },
      ],
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 10px', flexShrink: 0 }}>
        <Wand2 size={15} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>Auto-Edit</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {groups.map(g => (
          <div key={g.name}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '0 4px 6px' }}>{g.name}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {g.actions.map(a => {
                const running = p.busy === a.id
                const disabled = a.soon || running || !a.onClick
                return (
                  <button
                    key={a.id}
                    onClick={a.onClick}
                    disabled={disabled}
                    title={a.soon ? 'Coming soon' : a.desc}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', width: '100%',
                      padding: '9px 11px', borderRadius: 9, cursor: disabled ? 'default' : 'pointer',
                      border: '1px solid var(--border)',
                      background: a.soon ? 'transparent' : 'var(--bg-card)',
                      opacity: a.soon ? 0.55 : 1,
                      transition: 'background 0.12s, border-color 0.12s',
                    }}
                    onMouseEnter={e => { if (!disabled) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' } }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
                  >
                    <span style={{ color: 'var(--accent)', marginTop: 1, flexShrink: 0 }}>
                      {running ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : a.icon}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{a.label}</span>
                        {a.soon && <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 4px' }}>SOON</span>}
                      </span>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.3 }}>{a.desc}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {p.note && (
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.4 }}>
            {p.note}
          </div>
        )}
      </div>
    </div>
  )
}
