'use client'

import { useState } from 'react'
import type { PlatformFlags } from '@/lib/platform-flags'
import type { ModuleKey } from '@/lib/editor-types'
import { Loader2 } from 'lucide-react'

const MODULE_META: Record<ModuleKey, { label: string; color: string }> = {
  audio: { label: 'Audio',  color: '#8b5cf6' },
  video: { label: 'Video',  color: '#3b82f6' },
  image: { label: 'Image',  color: '#10b981' },
}

const ALL_MODULES:    ModuleKey[]             = ['audio', 'video', 'image']
const ALL_AUDIO_MODES: ('music'|'podcast')[] = ['music', 'podcast']

interface Props {
  initial: PlatformFlags
}

function Toggle({ on, onChange, label, color }: { on: boolean; onChange: (v: boolean) => void; label: string; color?: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
      <div
        onClick={() => onChange(!on)}
        style={{
          width: 36, height: 20, borderRadius: 10, flexShrink: 0,
          background: on ? (color ?? 'var(--accent)') : 'var(--border)',
          position: 'relative', transition: 'background 0.15s', cursor: 'pointer',
        }}
      >
        <div style={{
          position: 'absolute', top: 2, left: on ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%', background: '#fff',
          transition: 'left 0.15s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{label}</span>
    </label>
  )
}

export default function PlatformFlagsPanel({ initial }: Props) {
  const [flags, setFlags]   = useState<PlatformFlags>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  function toggleModule(key: ModuleKey, on: boolean) {
    setFlags(f => ({
      ...f,
      enabledModules: on ? [...f.enabledModules, key] : f.enabledModules.filter(m => m !== key),
    }))
    setSaved(false)
  }

  function toggleAudioMode(mode: 'music' | 'podcast', on: boolean) {
    setFlags(f => ({
      ...f,
      enabledAudioModes: on ? [...f.enabledAudioModes, mode] : f.enabledAudioModes.filter(m => m !== mode),
    }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    await fetch('/api/admin/platform-flags', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(flags),
    })
    setSaving(false)
    setSaved(true)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>

        {/* Modules */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Modules</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ALL_MODULES.map(key => (
              <Toggle
                key={key}
                on={flags.enabledModules.includes(key)}
                onChange={on => toggleModule(key, on)}
                label={MODULE_META[key].label}
                color={MODULE_META[key].color}
              />
            ))}
          </div>
        </div>

        {/* Audio sub-modes */}
        <div style={{ opacity: flags.enabledModules.includes('audio') ? 1 : 0.35 }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Audio modes</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ALL_AUDIO_MODES.map(mode => (
              <Toggle
                key={mode}
                on={flags.enabledAudioModes.includes(mode)}
                onChange={on => toggleAudioMode(mode, on)}
                label={mode === 'music' ? 'Music / DAW' : 'Podcast editor'}
                color="#8b5cf6"
              />
            ))}
          </div>
        </div>

      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => void save()}
          disabled={saving}
          style={{
            padding: '7px 18px', borderRadius: 7, border: 'none',
            background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {saving && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {saved && <span style={{ fontSize: 11, color: 'var(--success)' }}>Saved — takes effect within 60s</span>}
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Changes update the platform for all users within ~60 seconds. Disabled modules are hidden from the module picker and sidebar.
        Users with existing projects in a disabled module can still open those projects.
      </p>
    </div>
  )
}
