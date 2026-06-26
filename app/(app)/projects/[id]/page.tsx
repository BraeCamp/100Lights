'use client'

import { use, useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ProjectEditor from '@/components/editor/ProjectEditor'
import PipelineView from '@/components/pipeline/PipelineView'
import { createDemoPipeline, MOCK_CAPTIONS, MOCK_OUTPUTS, MOCK_CLIPS } from '@/lib/mock'
import type { PipelineStep, Caption, Output, Clip } from '@/lib/types'

const STEP_TIMING = [
  { stepIndex: 0, duration: 1800 },
  { stepIndex: 1, duration: 3500 },
  { stepIndex: 2, duration: 2200 },
  { stepIndex: 3, duration: 3000 },
]

const STEP_DETAILS = [
  'File transferred — 142 MB',
  `${MOCK_CAPTIONS.length} captions generated`,
  '3 key moments identified for clips',
  '5 outputs generated',
]

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const isDemo = id === 'demo'

  // Demo state
  const [pipeline, setPipeline] = useState<PipelineStep[]>(isDemo ? createDemoPipeline() : [])
  const [demoReady, setDemoReady] = useState(false)
  const [demoCaptions, setDemoCaptions] = useState<Caption[]>([])

  // Demo pipeline simulation
  useEffect(() => {
    if (!isDemo) return
    let cancelled = false

    async function run() {
      for (let i = 0; i < STEP_TIMING.length; i++) {
        const { stepIndex, duration } = STEP_TIMING[i]
        setPipeline((p) => p.map((s, idx) => idx === stepIndex ? { ...s, status: 'running', progress: 0 } : s))
        const ticks = Math.floor(duration / 60)
        for (let t = 1; t <= ticks; t++) {
          await delay(60)
          if (cancelled) return
          setPipeline((p) => p.map((s, idx) =>
            idx === stepIndex ? { ...s, progress: Math.min(Math.round((t / ticks) * 100), 99) } : s
          ))
        }
        if (cancelled) return
        setPipeline((p) => p.map((s, idx) =>
          idx === stepIndex ? { ...s, status: 'completed', progress: 100, detail: STEP_DETAILS[stepIndex] } : s
        ))
        if (stepIndex === 1) setDemoCaptions(MOCK_CAPTIONS)
        if (stepIndex === 3) setDemoReady(true)
      }
    }

    run()
    return () => { cancelled = true }
  }, [isDemo])

  // Demo pipeline view
  if (isDemo && !demoReady) {
    return (
      <div className="p-8 max-w-xl">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft size={14} /> Back
        </Link>
        <div className="mb-6">
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>The Creator Mindset — Demo</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>AI is processing your content…</p>
        </div>
        <div className="p-5 rounded-xl border mb-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
          <PipelineView steps={pipeline} />
        </div>
        {demoCaptions.length > 0 && (
          <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Captions appearing…</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {demoCaptions.slice(0, 3).map((c) => c.text).join(' ')}…
            </p>
          </div>
        )}
      </div>
    )
  }

  const demoProps = isDemo ? {
    captions: MOCK_CAPTIONS as Caption[],
    clips: MOCK_CLIPS as Clip[],
    outputs: MOCK_OUTPUTS as Output[],
  } : {
    captions: [] as Caption[],
    clips: [] as Clip[],
    outputs: [] as Output[],
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ProjectEditor
        projectId={isDemo ? undefined : id}
        projectName={isDemo ? 'The Creator Mindset — Demo' : '…'}
        modules={isDemo ? ['video', 'audio', 'transcript', 'content', 'storyboard'] : undefined}
        allowImport={!isDemo}
      />
    </div>
  )
}
