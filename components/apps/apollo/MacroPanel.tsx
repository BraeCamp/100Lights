'use client'
// 8 macro knobs with rename + drag-source chips.

import React, { useState } from 'react'
import { useApollo, Knob, SourceChip } from './ApolloContext'
import type { ModSource } from '@/lib/apollo/patch'

export default function MacroPanel() {
  const ctx = useApollo()
  const [editing, setEditing] = useState(-1)
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <Knob
            label=""
            size={40}
            min={0} max={1} def={0}
            value={ctx.patch.macros[i]}
            onChange={v => {
              ctx.setParam(`macro${i + 1}`, v)
              ctx.engine.setMacro(i, v)
            }}
            onCommit={() => ctx.commit()}
          />
          {editing === i ? (
            <input
              autoFocus
              defaultValue={ctx.patch.macroNames[i]}
              onBlur={e => { const nm = e.target.value.trim(); setEditing(-1); if (nm) ctx.update(p => { p.macroNames[i] = nm }) }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              style={{ width: 56, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--accent)', borderRadius: 4, fontSize: 9, padding: '1px 3px', textAlign: 'center' }}
            />
          ) : (
            <div
              onDoubleClick={() => setEditing(i)}
              title="Double-click to rename"
              style={{ fontSize: 9, color: 'var(--text-secondary)', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}
            >{ctx.patch.macroNames[i]}</div>
          )}
          <SourceChip
            source={`macro${i + 1}` as ModSource}
            label={`M${i + 1}`}
            active={ctx.patch.matrix.some(r => r.source === `macro${i + 1}`)}
          />
        </div>
      ))}
    </div>
  )
}
