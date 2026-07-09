'use client'

import { useEffect, useState, type ReactNode } from 'react'

export interface AdminSubtab {
  id: string
  label: string
  content: ReactNode
}

export interface AdminTab {
  id: string
  label: string
  color?: string
  subtabs: AdminSubtab[]
}

/**
 * Two-level tab shell for the admin page. Selection syncs to the URL hash
 * (#audio/sound-library) so a specific panel can be linked or refreshed into.
 */
export default function AdminTabs({ tabs }: { tabs: AdminTab[] }) {
  const [tabId, setTabId] = useState(tabs[0].id)
  const [subId, setSubId] = useState(tabs[0].subtabs[0].id)

  // Restore from the hash on mount
  useEffect(() => {
    const [t, s] = window.location.hash.replace(/^#/, '').split('/')
    const tab = tabs.find(x => x.id === t)
    if (!tab) return
    setTabId(tab.id)
    const sub = tab.subtabs.find(x => x.id === s)
    setSubId(sub ? sub.id : tab.subtabs[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function select(nextTab: string, nextSub?: string) {
    const tab = tabs.find(x => x.id === nextTab)!
    const sub = nextSub && tab.subtabs.some(s => s.id === nextSub) ? nextSub : tab.subtabs[0].id
    setTabId(nextTab)
    setSubId(sub)
    history.replaceState(null, '', `#${nextTab}/${sub}`)
  }

  const tab = tabs.find(x => x.id === tabId) ?? tabs[0]
  const sub = tab.subtabs.find(x => x.id === subId) ?? tab.subtabs[0]

  return (
    <div>
      {/* Top-level module tabs */}
      <div className="flex gap-1 mb-4" style={{ borderBottom: '1px solid var(--border)' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => select(t.id)}
            className="px-4 py-2 text-sm font-semibold transition-colors"
            style={{
              color: tabId === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: `2px solid ${tabId === t.id ? (t.color ?? 'var(--accent)') : 'transparent'}`,
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Subtabs */}
      <div className="flex gap-1.5 mb-6 flex-wrap">
        {tab.subtabs.map(s => (
          <button
            key={s.id}
            onClick={() => select(tab.id, s.id)}
            className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
            style={{
              background: subId === s.id ? 'var(--bg-card)' : 'transparent',
              border: `1px solid ${subId === s.id ? 'var(--border-light)' : 'var(--border)'}`,
              color: subId === s.id ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Active panel — all panels stay mounted so client panels keep their state */}
      {tabs.map(t =>
        t.subtabs.map(s => (
          <div
            key={`${t.id}/${s.id}`}
            style={{ display: t.id === tab.id && s.id === sub.id ? 'block' : 'none' }}
          >
            {s.content}
          </div>
        ))
      )}
    </div>
  )
}
