'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { GraduationCap, ArrowRight } from 'lucide-react'
import {
  subscribePracticeProgress,
  getPracticeSummarySnapshot,
  getPracticeSummaryServerSnapshot,
} from '@/lib/practice-progress'

/**
 * "You are getting better" on the dashboard.
 *
 * The product's pitch is that the work makes you better, but the logged-in home
 * page showed no evidence of that — it was a file list. Practice progress was
 * already being recorded in the studio; it just had nowhere to surface.
 *
 * Progress lives in localStorage — an external store — so it is read through
 * useSyncExternalStore. The server snapshot is null, which removes any hydration
 * mismatch, and subscribing to `storage` means progress made in the studio shows
 * up here without a refresh if the dashboard is open in another tab.
 */
export default function PracticeProgressCard({ resumeHref }: { resumeHref: string }) {
  const summary = useSyncExternalStore(
    subscribePracticeProgress,
    getPracticeSummarySnapshot,
    getPracticeSummaryServerSnapshot,
  )

  if (!summary || !summary.nextPath) return null

  const { stepsDone, stepsTotal, pathsComplete, nextPath, nextRemaining, fresh } = summary
  const pct = stepsTotal > 0 ? Math.round((stepsDone / stepsTotal) * 100) : 0

  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          {fresh ? 'Start here' : 'Your progress'}
        </h2>
        {!fresh && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {stepsDone} of {stepsTotal} steps
            {pathsComplete > 0 && ` · ${pathsComplete} path${pathsComplete === 1 ? '' : 's'} complete`}
          </span>
        )}
      </div>

      <div
        style={{
          padding: '18px 20px',
          borderRadius: 14,
          border: '1px solid rgba(167,139,250,0.28)',
          background: 'linear-gradient(135deg, rgba(167,139,250,0.10), rgba(59,130,246,0.06))',
        }}
      >
        {!fresh && (
          <div
            aria-hidden="true"
            style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.09)', marginBottom: 14, overflow: 'hidden' }}
          >
            <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #a78bfa, #60a5fa)' }} />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 3px' }}>
              {fresh ? nextPath.title : `Next: ${nextPath.title}`}
            </p>
            <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              {fresh
                ? nextPath.tagline
                : `${nextRemaining} step${nextRemaining === 1 ? '' : 's'} left — the studio checks them off as you work.`}
            </p>
          </div>

          <Link
            href={resumeHref}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
              padding: '9px 16px', borderRadius: 9,
              background: 'var(--accent)', color: '#fff',
              fontSize: 12, fontWeight: 600, textDecoration: 'none',
            }}
          >
            <GraduationCap size={13} />
            {fresh ? 'Start the first path' : 'Keep going'}
            <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </section>
  )
}
