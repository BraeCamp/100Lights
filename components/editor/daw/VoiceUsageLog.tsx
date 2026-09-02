'use client'

import { useEffect, useState } from 'react'
import { ledger, ledgerSummary, clearLedger, onLedger, type AnsweredBy } from '@/lib/voice/voice-ledger'
import { learnedStats } from '@/lib/voice/learned'
import { LUMENS_NAME } from '@/lib/credit-tiers'

/**
 * What the voice control has cost, and what it has not.
 *
 * Brae: "Give an option in voice control settings to see a log with lumens and
 * macros used, amounts of calls, costs per call, stuff like that".
 *
 * ⚠️ THE FREE ROWS ARE THE HEADLINE. A log of only the paid commands shows a
 * bill going up and nothing else, which is backwards — most of the work here is
 * now done without asking anybody, and the number worth watching is how little
 * of the traffic reaches the model at all. So the summary leads with where
 * answers CAME FROM, and the money is a column rather than the subject.
 */

const PATH_LABEL: Record<AnsweredBy, string> = {
  rules: 'Built-in commands',
  learned: 'Learned here',
  shared: 'Learned by others',
  macro: 'Macros',
  assistant: 'The assistant',
}

const money = (n: number) => n >= 0.01 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : '—'
const when = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function VoiceUsageLog({ C }: { C: Record<string, string> }) {
  const [, bump] = useState(0)
  useEffect(() => onLedger(() => bump(n => n + 1)), [])

  const s = ledgerSummary()
  const rows = ledger()
  const learned = learnedStats()

  const muted = C.textMuted ?? '#8b8b8b'
  const primary = C.textPrimary ?? '#e8e8e8'
  const accent = C.accent ?? '#6ea8fe'
  const line = C.border ?? 'rgba(255,255,255,0.12)'

  if (!rows.length) {
    return (
      <div style={{ fontSize: 11, color: muted, lineHeight: 1.6 }}>
        Nothing logged yet. Every command you give is recorded here with how it was
        answered — and only the ones that reach the assistant cost anything.
      </div>
    )
  }

  const freeShare = s.total ? Math.round((s.free / s.total) * 100) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 11 }}>

      {/* ── The one line worth reading ──────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <Stat C={C} k="Commands" v={String(s.total)} />
        <Stat C={C} k="Answered free" v={`${s.free} · ${freeShare}%`} good />
        <Stat C={C} k="Reached the AI" v={String(s.paid)} />
        <Stat C={C} k="Spent" v={money(s.usd)} />
        {s.credits > 0 && <Stat C={C} k={LUMENS_NAME} v={String(Math.round(s.credits))} />}
      </div>

      {s.paid > 0 && (
        <div style={{ color: muted, lineHeight: 1.6 }}>
          {money(s.perPaid)} per AI command over {s.turns} turn{s.turns === 1 ? '' : 's'}
          {s.free > 0 && <> · the free paths saved about <strong style={{ color: accent }}>{money(s.saved)}</strong> at that rate</>}
        </div>
      )}

      {/* ── Where answers came from ─────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(Object.keys(PATH_LABEL) as AnsweredBy[])
          .filter(k => s.byPath[k] > 0)
          .map(k => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, color: k === 'assistant' ? primary : muted }}>{PATH_LABEL[k]}</div>
              <div style={{
                width: `${Math.max(4, Math.round((s.byPath[k] / s.total) * 100))}%`,
                height: 6, borderRadius: 3, background: k === 'assistant' ? accent : 'rgba(120,200,160,0.55)',
              }} />
              <div style={{ width: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: muted }}>
                {s.byPath[k]}
              </div>
            </div>
          ))}
      </div>

      <div style={{ color: muted, lineHeight: 1.6 }}>
        Knows {learned.entries} command{learned.entries === 1 ? '' : 's'} here
        {learned.templates > 0 && ` (${learned.templates} that generalise)`}
        {learned.shared > 0 && `, plus ${learned.shared} learned by other studios`}.
      </div>

      {/* ── The log ─────────────────────────────────────────────────────── */}
      <div style={{ maxHeight: 260, overflowY: 'auto', borderTop: `1px solid ${line}` }}>
        {rows.map((e, i) => (
          <div key={`${e.at}-${i}`} style={{
            display: 'flex', gap: 8, alignItems: 'baseline',
            padding: '5px 0', borderBottom: `1px solid ${line}`,
          }}>
            <span style={{ color: muted, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{when(e.at)}</span>
            <span style={{ flex: 1, color: e.problem ? '#f0a0a0' : primary, wordBreak: 'break-word' }}>
              {e.said || '—'}
            </span>
            <span style={{ color: e.by === 'assistant' ? accent : muted, flexShrink: 0 }}>
              {e.by === 'assistant' ? `${money(e.usd ?? 0)}` : 'free'}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ color: muted }}>
          Kept in this browser — the billed record lives on your account.
        </span>
        <button
          onClick={() => { clearLedger(); bump(n => n + 1) }}
          style={{
            fontSize: 10, padding: '3px 8px', cursor: 'pointer', borderRadius: 4,
            border: `1px solid ${line}`, background: 'transparent', color: muted,
          }}
        >Clear</button>
      </div>
    </div>
  )
}

function Stat({ C, k, v, good }: { C: Record<string, string>; k: string; v: string; good?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 74 }}>
      <span style={{ fontSize: 9, letterSpacing: '.06em', textTransform: 'uppercase', color: C.textMuted ?? '#8b8b8b' }}>{k}</span>
      <span style={{
        fontSize: 15, fontVariantNumeric: 'tabular-nums',
        color: good ? 'rgb(120,200,160)' : (C.textPrimary ?? '#e8e8e8'),
      }}>{v}</span>
    </div>
  )
}
