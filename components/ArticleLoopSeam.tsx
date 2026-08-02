'use client'

/**
 * Static visual for "How to loop a sample and mean it" — shows *why* one loop
 * clicks and the other doesn't, next to the A/B listening test.
 *
 * Two panels, each drawing the same wave looped twice so the seam sits in the
 * middle. Left: the cut lands on a zero-crossing, so the end meets the start at
 * the same point and the line is continuous — silent seam. Right: the cut lands
 * mid-waveform, so the loop jumps to a different level on every repeat; that
 * vertical step is the click, marked in red.
 */

import React from 'react'

const W = 300, H = 96, MID = H / 2, AMP = 30

// One "bar" of a decaying wiggle. `endLevel` is where the sample was cut: 0 for
// the clean version (back at the zero line) and a nonzero step for the clicky
// one, so the repeat visibly jumps.
function wavePath(x0: number, width: number, endLevel: number) {
  const pts: string[] = []
  const N = 60
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const x = x0 + u * width
    // A couple of cycles, tapering, plus a linear pull toward endLevel so the
    // clicky version genuinely ends off the zero line.
    const wig = Math.sin(u * Math.PI * 4) * AMP * (1 - u * 0.35)
    const y = MID - (wig + endLevel * u)
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return pts.join(' ')
}

function Panel({ clean }: { clean: boolean }) {
  const step = clean ? 0 : 22        // level the loop restarts at, relative to zero
  const seam = W / 2
  const color = clean ? '#34d399' : '#f59e0b'
  return (
    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color, marginBottom: 6 }}>
        {clean ? '✓ Trimmed to a zero-crossing' : '✗ Cut mid-waveform'}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border)' }}>
        {/* zero line */}
        <line x1={0} y1={MID} x2={W} y2={MID} stroke="var(--border)" strokeDasharray="3 4" />
        {/* the two loop repetitions */}
        <path d={wavePath(0, W / 2, step)} fill="none" stroke={color} strokeWidth={2} />
        <path d={wavePath(W / 2, W / 2, step)} fill="none" stroke={color} strokeWidth={2} />
        {/* seam marker */}
        <line x1={seam} y1={8} x2={seam} y2={H - 8} stroke={color} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 3" />
        {!clean && (
          <>
            {/* the discontinuity: a red vertical jump + a spark */}
            <line x1={seam} y1={MID - step} x2={seam} y2={MID} stroke="#ef4444" strokeWidth={2.5} />
            <circle cx={seam} cy={MID - step} r={3.5} fill="#ef4444" />
            <text x={seam + 6} y={MID - step - 4} fill="#ef4444" fontSize={11} fontWeight={700}>click!</text>
          </>
        )}
        {clean && <circle cx={seam} cy={MID} r={3.5} fill={color} />}
      </svg>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
        {clean
          ? 'End meets start at the same level — the seam is inaudible.'
          : 'The loop jumps to a new level every repeat. That step is the click.'}
      </div>
    </div>
  )
}

export default function ArticleLoopSeam({ caption }: { caption?: string }) {
  return (
    <figure style={{ margin: '24px 0' }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '16px 18px', borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
        <Panel clean />
        <Panel clean={false} />
      </div>
      {caption && <figcaption style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>{caption}</figcaption>}
    </figure>
  )
}
