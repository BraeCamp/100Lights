'use client'

import { useEffect, useState, type ReactNode } from 'react'
import CommandPalette from './CommandPalette'
import {
  Sunrise, LayoutDashboard, Users, TrendingUp, BarChart3, Eye, Megaphone, BookOpen, Ticket,
  MessageSquare, Flag, Activity, Webhook, HardDrive, ScrollText, Link as LinkIcon,
  Library, Music, Piano, Package, Drum, Film, Image as ImageIcon, Circle,
  type LucideIcon,
} from 'lucide-react'

export interface AdminSubtab {
  id: string
  label: string
  /** Optional section header this subtab lives under in the sidebar. */
  group?: string
  content: ReactNode
}

export interface AdminTab {
  id: string
  label: string
  color?: string
  subtabs: AdminSubtab[]
}

// One icon per panel, resolved by id — keeps page.tsx free of client imports.
const ICONS: Record<string, LucideIcon> = {
  brief: Sunrise, overview: LayoutDashboard, users: Users, revenue: TrendingUp, growth: BarChart3,
  visibility: Eye, announcements: Megaphone, articles: BookOpen, codes: Ticket,
  feedback: MessageSquare, 'community-moderation': Flag, status: Activity,
  webhooks: Webhook, storage: HardDrive, audit: ScrollText, links: LinkIcon,
  catalog: Library, 'sound-library': Music, 'midi-presets': Piano,
  'sample-packs': Package, 'beat-corrections': Drum,
}
function iconFor(tabId: string, subId: string): LucideIcon {
  if (ICONS[subId]) return ICONS[subId]
  if (tabId === 'video') return Film
  if (tabId === 'image') return ImageIcon
  return Circle
}

/**
 * Admin shell. A grouped left sidebar (module switcher + icon nav with live
 * attention badges) replaces the old wrapping pill rows so 15+ panels stay
 * scannable. Selection still syncs to the URL hash (#audio/sound-library) and
 * panels still mount lazily on first open, keeping their state thereafter.
 */
export default function AdminTabs({ tabs, badges = {} }: { tabs: AdminTab[]; badges?: Record<string, number> }) {
  const [tabId, setTabId] = useState(tabs[0].id)
  const [subId, setSubId] = useState(tabs[0].subtabs[0].id)
  const [seen, setSeen] = useState<Set<string>>(() => new Set([`${tabs[0].id}/${tabs[0].subtabs[0].id}`]))
  const markSeen = (t: string, s: string) => setSeen(prev => prev.has(`${t}/${s}`) ? prev : new Set(prev).add(`${t}/${s}`))

  useEffect(() => {
    function applyHash() {
      const [t, s] = window.location.hash.replace(/^#/, '').split('/')
      const tab = tabs.find(x => x.id === t)
      if (!tab) return
      setTabId(tab.id)
      const sub = tab.subtabs.find(x => x.id === s)
      const subResolved = sub ? sub.id : tab.subtabs[0].id
      setSubId(subResolved)
      markSeen(tab.id, subResolved)
    }
    applyHash()
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function select(nextTab: string, nextSub?: string) {
    const tab = tabs.find(x => x.id === nextTab)!
    const sub = nextSub && tab.subtabs.some(s => s.id === nextSub) ? nextSub : tab.subtabs[0].id
    setTabId(nextTab)
    setSubId(sub)
    markSeen(nextTab, sub)
    history.replaceState(null, '', `#${nextTab}/${sub}`)
  }

  const tab = tabs.find(x => x.id === tabId) ?? tabs[0]
  const sub = tab.subtabs.find(x => x.id === subId) ?? tab.subtabs[0]
  const accent = tab.color ?? 'var(--accent)'

  // Group the active module's subtabs, preserving first-seen group order.
  const groups: { name: string; items: AdminSubtab[] }[] = []
  for (const s of tab.subtabs) {
    const name = s.group ?? ''
    let g = groups.find(x => x.name === name)
    if (!g) { g = { name, items: [] }; groups.push(g) }
    g.items.push(s)
  }

  return (
    <div>
      <CommandPalette tabs={tabs} />
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <nav style={{ width: 208, flexShrink: 0, position: 'sticky', top: 8, alignSelf: 'flex-start' }}>
          {/* Module switcher */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
            {tabs.map(t => {
              const active = tabId === t.id
              const c = t.color ?? 'var(--accent)'
              return (
                <button key={t.id} onClick={() => select(t.id)}
                  style={{
                    fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${active ? c : 'var(--border)'}`,
                    background: active ? `color-mix(in srgb, ${c} 16%, transparent)` : 'transparent',
                    color: active ? c : 'var(--text-muted)',
                  }}>
                  {t.label}
                </button>
              )
            })}
          </div>

          {/* Grouped subtab nav */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {groups.map(g => (
              <div key={g.name || '_'}>
                {g.name && (
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '0 8px 5px' }}>{g.name}</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {g.items.map(s => {
                    const active = subId === s.id
                    const Icon = iconFor(tab.id, s.id)
                    const badge = badges[s.id] ?? 0
                    return (
                      <button key={s.id} onClick={() => select(tab.id, s.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                          padding: '6px 8px', borderRadius: 8, cursor: 'pointer', border: 'none',
                          background: active ? 'var(--bg-card)' : 'transparent',
                          color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                          boxShadow: active ? `inset 2px 0 0 ${accent}` : 'none',
                          fontSize: 12.5, fontWeight: active ? 700 : 500,
                        }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-surface)' }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
                        <Icon size={14} style={{ flexShrink: 0, color: active ? accent : 'var(--text-muted)' }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                        {badge > 0 && (
                          <span style={{ flexShrink: 0, minWidth: 17, height: 17, padding: '0 5px', borderRadius: 99, background: '#f59e0b', color: '#1a1205', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums' }}>{badge}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* ── Active panel ────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {tabs.map(t =>
            t.subtabs.map(s => {
              const key = `${t.id}/${s.id}`
              const isActive = t.id === tab.id && s.id === sub.id
              return (
                <div key={key} style={{ display: isActive ? 'block' : 'none' }}>
                  {seen.has(key) ? s.content : null}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
