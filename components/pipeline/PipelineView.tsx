'use client'

import { Check, Loader2, Clock } from 'lucide-react'
import type { PipelineStep } from '@/lib/types'

interface Props {
  steps: PipelineStep[]
}

export default function PipelineView({ steps }: Props) {
  return (
    <div className="flex flex-col gap-0">
      {steps.map((step, i) => (
        <div key={step.id} className="flex gap-4">
          <div className="flex flex-col items-center">
            <StepIcon status={step.status} />
            {i < steps.length - 1 && (
              <div
                className="w-px flex-1 mt-1"
                style={{
                  background: step.status === 'completed' ? 'var(--accent)' : 'var(--border)',
                  minHeight: '2rem',
                }}
              />
            )}
          </div>
          <div className="pb-6 flex-1 min-w-0">
            <div className="flex items-center justify-between mb-0.5">
              <span
                className="text-sm font-medium"
                style={{
                  color: step.status === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)',
                }}
              >
                {step.label}
              </span>
              {step.status === 'running' && (
                <span className="text-xs" style={{ color: 'var(--accent-light)' }}>
                  {step.progress}%
                </span>
              )}
              {step.status === 'completed' && (
                <span className="text-xs" style={{ color: 'var(--success)' }}>Done</span>
              )}
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {step.status === 'pending' ? step.description : step.detail ?? step.description}
            </p>
            {step.status === 'running' && (
              <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${step.progress}%`, background: 'var(--accent)' }}
                />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function StepIcon({ status }: { status: PipelineStep['status'] }) {
  const base = 'w-7 h-7 rounded-full flex items-center justify-center shrink-0'

  if (status === 'completed') {
    return (
      <div className={base} style={{ background: 'var(--accent)' }}>
        <Check size={13} color="#fff" strokeWidth={3} />
      </div>
    )
  }
  if (status === 'running') {
    return (
      <div className={base} style={{ background: 'var(--accent-subtle)', border: '2px solid var(--accent)' }}>
        <Loader2 size={13} color="var(--accent-light)" className="animate-spin" />
      </div>
    )
  }
  return (
    <div className={base} style={{ background: 'var(--bg-card)', border: '2px solid var(--border)' }}>
      <Clock size={11} color="var(--text-muted)" />
    </div>
  )
}
