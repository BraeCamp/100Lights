'use client'

import { useEffect, useState, useCallback } from 'react'
import { clusterCorrectionGetAll, clusterCorrectionClear, type ClusterCorrection } from '@/lib/cluster-corrections'
import { spectralDistance } from '@/lib/beat-analyzer'
import { CLUSTER_LETTERS } from '@/lib/beat-analyzer'

const DEDUP_DIST = 0.28

function dedup(all: ClusterCorrection[]): { rep: ClusterCorrection; count: number }[] {
  const sorted = [...all].sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  const groups: { rep: ClusterCorrection; members: ClusterCorrection[] }[] = []
  for (const c of sorted) {
    if (!c.spectral) continue
    const match = groups.find(g => spectralDistance(g.rep.spectral, c.spectral) < DEDUP_DIST)
    if (match) { match.members.push(c) }
    else groups.push({ rep: c, members: [c] })
    if (groups.length >= CLUSTER_LETTERS.length - 1) break
  }
  return groups.map(g => ({ rep: g.rep, count: g.members.length }))
}

const KEY_FEATURES = [
  { key: 'sub', label: 'Sub' }, { key: 'lowMid', label: 'Low-mid' },
  { key: 'mid', label: 'Mid' }, { key: 'hiMid', label: 'Hi-mid' },
  { key: 'hi', label: 'Hi' }, { key: 'attackTime', label: 'Attack' },
  { key: 'harmonicRatio', label: 'Harmonic' }, { key: 'roughness', label: 'Roughness' },
  { key: 'brightness', label: 'Brightness' }, { key: 'warmth', label: 'Warmth' },
] as const

export default function ClusterCorrectionsPanel() {
  const [all, setAll]           = useState<ClusterCorrection[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)

  const load = useCallback(async () => {
    try { setAll(await clusterCorrectionGetAll()) } catch { setAll([]) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleClear() {
    if (!confirm('Delete all learned distinct-sound fingerprints? The separation program will start fresh with no acoustic memory.')) return
    setClearing(true)
    await clusterCorrectionClear().catch(() => {})
    setClearing(false)
    setAll([])
  }

  if (all === null) return <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>Loading…</p>

  const groups = dedup(all)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {all.length} save{all.length !== 1 ? 's' : ''} → {groups.length} unique sound{groups.length !== 1 ? 's' : ''} learned
          {all.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
              (last: {new Date([...all].sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0].savedAt).toLocaleString()})
            </span>
          )}
        </div>
        <button
          onClick={handleClear}
          disabled={clearing || !all.length}
          style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: all.length ? 'pointer' : 'not-allowed', background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}
        >
          {clearing ? 'Clearing…' : 'Clear all'}
        </button>
      </div>

      {groups.length === 0 ? (
        <div style={{ padding: 24, borderRadius: 10, textAlign: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            No distinct sounds learned yet. Open a dot in the Audio Separation panel and click "✓ This is distinct".
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.map(({ rep, count }, i) => (
            <div key={rep.id} style={{ borderRadius: 10, border: '1px solid rgba(74,222,128,0.25)', background: 'rgba(34,197,94,0.04)', overflow: 'hidden' }}>
              <button
                onClick={() => setExpanded(expanded === rep.id ? null : rep.id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', gap: 12 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#4ade80' }}>Slot {CLUSTER_LETTERS[i]}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>anchors cluster {CLUSTER_LETTERS[i]} on next run</span>
                  {count > 1 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({count} saves merged)</span>}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{expanded === rep.id ? '▲ hide' : '▼ spectral'}</span>
              </button>
              {expanded === rep.id && (
                <div style={{ padding: '0 14px 12px', borderTop: '1px solid rgba(74,222,128,0.15)' }}>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 6px' }}>
                    Spectral fingerprint (saved {new Date(rep.savedAt).toLocaleString()}):
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px 12px' }}>
                    {KEY_FEATURES.map(({ key, label }) => {
                      const v = (rep.spectral as unknown as Record<string, unknown>)[key]
                      return (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                          <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {typeof v === 'number' ? v.toFixed(3) : '—'}
                          </span>
                        </div>
                      )
                    })}
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
