'use client'
// The "Save for offline" right-click item, shared by every place that lists
// projects: /projects ("All Projects"), the dashboard, and each app's home.
//
// Brae: "Wire it to a right click menu button so that users can connect from
// their project pages. This means 'All Projects' and individual app
// dashboards."
//
// One component rather than three copies, because it is not a link — it starts
// a real job, reports progress, and can partly succeed, and three versions of
// that would drift into three different answers to "did it work?".
//
// ⚠️ The work is deliberately NOT tied to this component's lifetime. If the
// menu closes mid-save the promise keeps running and the renders still land in
// the cache; only the progress display goes away. Cancelling a half-finished
// save would waste the renders already paid for.

import { useCallback, useRef, useState } from 'react'
import { CloudDownload, Check, Loader2, AlertCircle } from 'lucide-react'

type State =
  | { k: 'idle' }
  | { k: 'working'; done: number; total: number }
  | { k: 'done'; note?: string }
  | { k: 'failed'; why: string }

export function SaveOfflineItem({
  projectId,
  style,
  onStart,
}: {
  projectId: string
  /** The host menu's own item styling — each surface styles its menu slightly
   *  differently, and this should look like the items around it, not like a
   *  component that arrived from somewhere else. */
  style?: React.CSSProperties
  /** Called once the job is under way, for menus that want to note it. */
  onStart?: () => void
}) {
  const [state, setState] = useState<State>({ k: 'idle' })
  const running = useRef(false)

  const start = useCallback(() => {
    if (running.current) return
    running.current = true
    setState({ k: 'working', done: 0, total: 0 })
    onStart?.()
    void (async () => {
      try {
        const { saveProjectForOffline } = await import('@/lib/apollo/offline-save')
        const out = await saveProjectForOffline(projectId, p =>
          setState({ k: 'working', done: p.done, total: p.total }))
        setState({ k: 'done', note: out.note })
      } catch (err) {
        setState({
          k: 'failed',
          why: err instanceof Error ? err.message : 'Could not save this project.',
        })
      } finally {
        running.current = false
      }
    })()
  }, [projectId, onStart])

  const base: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    padding: '7px 12px', fontSize: 12, color: 'var(--text-primary)',
    background: 'transparent', border: 'none', cursor: 'pointer',
    ...style,
  }

  if (state.k === 'working') {
    return (
      <div style={{ ...base, cursor: 'default', color: 'var(--text-muted)' }} aria-live="polite">
        <Loader2 size={12} className="animate-spin" />
        {state.total ? `Saving ${state.done}/${state.total}…` : 'Reading project…'}
      </div>
    )
  }

  if (state.k === 'done') {
    return (
      <div style={{ ...base, cursor: 'default', display: 'block' }} aria-live="polite">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-light, #4ade80)' }}>
          <Check size={12} /> Saved for offline
        </span>
        {state.note && (
          <span style={{ display: 'block', marginTop: 4, fontSize: 11, lineHeight: 1.4, color: 'var(--text-muted)' }}>
            {state.note}
          </span>
        )}
      </div>
    )
  }

  if (state.k === 'failed') {
    return (
      <button style={{ ...base, display: 'block' }} onClick={start}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444' }}>
          <AlertCircle size={12} /> Try saving again
        </span>
        <span style={{ display: 'block', marginTop: 4, fontSize: 11, lineHeight: 1.4, color: 'var(--text-muted)' }}>
          {state.why}
        </span>
      </button>
    )
  }

  return (
    <button
      style={base}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      onClick={start}
      title="Render this project's audio on the server and keep it on this device"
    >
      <CloudDownload size={12} /> Save for offline
    </button>
  )
}
