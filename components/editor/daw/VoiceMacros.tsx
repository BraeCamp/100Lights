'use client'

import { useEffect, useState } from 'react'
import { listMacros, onMacros, renameMacro, forgetMacro, type Macro } from '@/lib/voice/macros'

/**
 * Every shape this studio has been taught, by name.
 *
 * Brae: "can we have a live list of these macros someplace?"
 *
 * ⚠️ THE LIST IS WHAT MAKES MACROS CHEAP, not a convenience. "Do the same thing
 * again" points at the selection, so the cache refuses to learn it — replaying
 * yesterday's target against today's selection is the one way any of this could
 * act on something nobody asked for. A NAME can be learned, and is then free
 * forever. So this is the surface that teaches the names, and renaming is part
 * of it: a name you would not say out loud is a name that costs you a paid turn
 * every time.
 */
export default function VoiceMacros({ C, onRun }: {
  C: Record<string, string>
  /** Say it, rather than run it directly — so it goes through the same reading,
   *  read-back and undo as it would if it had been spoken. */
  onRun?: (text: string) => void
}) {
  const [, bump] = useState(0)
  useEffect(() => onMacros(() => bump(n => n + 1)), [])
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const macros = listMacros()
  const muted = C.textMuted ?? '#8b8b8b'
  const primary = C.textPrimary ?? '#e8e8e8'
  const accent = C.accent ?? '#6ea8fe'
  const line = C.border ?? 'rgba(255,255,255,0.12)'

  if (!macros.length) {
    return (
      <div style={{ fontSize: 11, color: muted, lineHeight: 1.6 }}>
        No shapes yet. Describe a move over time — <em>&ldquo;give the bass descending
        reverb, an opening low-pass and falling volume&rdquo;</em> — and the studio will save
        it under a name you can say again. The same shape then fits any clip or
        stretch of bars, stretching to whatever it is given.
      </div>
    )
  }

  const commit = (m: Macro) => {
    const to = draft.trim()
    if (to && to.toLowerCase() !== m.label.toLowerCase()) renameMacro(m.name, to)
    setEditing(null)
    bump(n => n + 1)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 11 }}>
      <div style={{ color: muted, lineHeight: 1.6 }}>
        Say a name to run it — <em>&ldquo;{macros[0].label} on the bass&rdquo;</em>, or
        <em> &ldquo;{macros[0].label} from bar 9 to 25&rdquo;</em>. Saying the name costs
        nothing; asking for the same move again from scratch does not.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${line}` }}>
        {macros.map(m => (
          <div key={m.name} style={{
            display: 'flex', flexDirection: 'column', gap: 3,
            padding: '7px 0', borderBottom: `1px solid ${line}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              {editing === m.name ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onBlur={() => commit(m)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commit(m)
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  style={{
                    flex: 1, fontSize: 11, padding: '2px 4px', borderRadius: 3,
                    border: `1px solid ${accent}`, background: 'transparent', color: primary,
                  }}
                />
              ) : (
                <button
                  onClick={() => onRun?.(`${m.label} on the selected track`)}
                  disabled={!onRun}
                  title={onRun ? `Run "${m.label}"` : undefined}
                  style={{
                    flex: 1, textAlign: 'left', padding: 0, border: 'none', background: 'transparent',
                    color: primary, fontSize: 11, fontWeight: 600, cursor: onRun ? 'pointer' : 'default',
                  }}
                >{m.label}</button>
              )}
              <span style={{ color: muted, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {m.used === 0 ? 'unused' : `${m.used}×`}
              </span>
              {m.from === 'shared' && (
                <span style={{ color: muted, fontSize: 9, flexShrink: 0 }}>shared</span>
              )}
            </div>
            <div style={{ color: muted, lineHeight: 1.5 }}>{m.what}</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setEditing(m.name); setDraft(m.label) }}
                style={btn(muted, line)}
              >Rename</button>
              <button
                onClick={() => { forgetMacro(m.name); bump(n => n + 1) }}
                style={btn(muted, line)}
              >Forget</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const btn = (color: string, line: string): React.CSSProperties => ({
  fontSize: 10, padding: '2px 7px', cursor: 'pointer', borderRadius: 4,
  border: `1px solid ${line}`, background: 'transparent', color,
})
