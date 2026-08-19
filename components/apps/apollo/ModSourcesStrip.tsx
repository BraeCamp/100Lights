'use client'
// Horizontal strip of draggable mod-source chips.

import React from 'react'
import { useApollo, SourceChip } from './ApolloContext'
import { MOD_SOURCES } from '@/lib/apollo/patch'

export default function ModSourcesStrip() {
  const ctx = useApollo()
  const used = new Set(ctx.patch.matrix.map(r => r.source))
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: 1 }}>DRAG →</span>
      {MOD_SOURCES.filter(s => !s.id.startsWith('macro')).map(s => (
        <SourceChip key={s.id} source={s.id} label={s.label} active={used.has(s.id)} />
      ))}
    </div>
  )
}
