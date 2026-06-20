'use client'

import { useEffect, useState, useCallback } from 'react'
import type { CorrectionEntry } from '@/lib/correction-store'
import { correctionsGetAll, correctionsClear } from '@/lib/correction-store'
import type { BeatType } from '@/lib/beat-analyzer'

// Key spectral features that drive the classifier thresholds
const THRESHOLD_FEATURES: Array<{ key: keyof CorrectionEntry['spectral']; label: string }> = [
  { key: 'sub',            label: 'Sub band'     },
  { key: 'lowMid',         label: 'Low-mid band' },
  { key: 'mid',            label: 'Mid band'     },
  { key: 'hiMid',          label: 'Hi-mid band'  },
  { key: 'hi',             label: 'Hi band'      },
  { key: 'attackTime',     label: 'Attack time'  },
  { key: 'releaseTime',    label: 'Release time' },
  { key: 'sustainLevel',   label: 'Sustain lvl'  },
  { key: 'harmonicRatio',  label: 'Harm. ratio'  },
  { key: 'roughness',      label: 'Roughness'    },
  { key: 'brightness',     label: 'Brightness'   },
  { key: 'zeroCrossingRate', label: 'ZCR'        },
]

function avg(vals: number[]): number {
  if (!vals.length) return 0
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

interface PairStats {
  pair:        string
  detectedAs:  BeatType
  correctedTo: BeatType
  count:       number
  features:    Record<string, number>  // averaged
}

function buildStats(entries: CorrectionEntry[]): PairStats[] {
  const groups = new Map<string, CorrectionEntry[]>()
  for (const e of entries) {
    const key = `${e.detectedAs}→${e.correctedTo}`
    const g = groups.get(key) ?? []
    g.push(e)
    groups.set(key, g)
  }
  return Array.from(groups.entries())
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([pair, list]) => ({
      pair,
      detectedAs:  list[0].detectedAs,
      correctedTo: list[0].correctedTo,
      count:       list.length,
      features:    Object.fromEntries(
        THRESHOLD_FEATURES.map(({ key }) => [
          key,
          avg(list.map(e => (e.spectral[key] as number) ?? 0)),
        ])
      ),
    }))
}

export default function CorrectionsPanel() {
  const [entries, setEntries]   = useState<CorrectionEntry[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)

  const load = useCallback(async () => {
    try {
      const all = await correctionsGetAll()
      all.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      setEntries(all)
    } catch {
      setEntries([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleClear() {
    if (!confirm('Delete all correction entries? This cannot be undone.')) return
    setClearing(true)
    await correctionsClear().catch(() => {})
    setClearing(false)
    setEntries([])
  }

  function handleExport() {
    if (!entries?.length) return
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `beatlab-corrections-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (entries === null) {
    return <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>Loading corrections…</p>
  }

  const stats = buildStats(entries)

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {entries.length} correction{entries.length !== 1 ? 's' : ''} stored
          </span>
          {entries.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
              (last: {new Date(entries[0].savedAt).toLocaleString()})
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleExport}
            disabled={!entries.length}
            style={{
              fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: entries.length ? 'pointer' : 'not-allowed',
              background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)',
            }}
          >
            Export JSON
          </button>
          <button
            onClick={handleClear}
            disabled={clearing || !entries.length}
            style={{
              fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: entries.length ? 'pointer' : 'not-allowed',
              background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)',
            }}
          >
            {clearing ? 'Clearing…' : 'Clear all'}
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div style={{
          padding: '24px', borderRadius: 10, textAlign: 'center',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
        }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            No corrections yet. Accept AI suggestions in Beat Lab to start building training data.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {stats.map(s => (
            <div
              key={s.pair}
              style={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', overflow: 'hidden' }}
            >
              {/* Pair row */}
              <button
                onClick={() => setExpanded(expanded === s.pair ? null : s.pair)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 5,
                    background: 'rgba(239,68,68,0.12)', color: '#ef4444',
                  }}>
                    {s.detectedAs}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>→</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 5,
                    background: 'rgba(34,197,94,0.12)', color: '#22c55e',
                  }}>
                    {s.correctedTo}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {s.count}×
                  </span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {expanded === s.pair ? '▲ hide' : '▼ avg features'}
                </span>
              </button>

              {/* Feature averages */}
              {expanded === s.pair && (
                <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border)' }}>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 6px' }}>
                    Average spectral values across {s.count} hit{s.count !== 1 ? 's' : ''} (use to tune thresholds):
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px 12px' }}>
                    {THRESHOLD_FEATURES.map(({ key, label }) => (
                      <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                        <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                          {s.features[key].toFixed(3)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
