'use client'

/**
 * A month calendar for the article schedule. Shows where queued posts land,
 * and lets you place any unscheduled draft on a day (per-article scheduling,
 * which the bulk drip couldn't do). Arm a draft, pick a time, click a day.
 */

import { useMemo, useState } from 'react'

interface Row { slug: string; title: string; draft: boolean; scheduledFor?: string }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

export default function ArticleScheduleCalendar({ rows, onSchedule, onClose }: {
  rows: Row[]
  onSchedule: (slug: string, publishAt: string | null) => Promise<void>
  onClose: () => void
}) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [armed, setArmed] = useState<string | null>(null)
  const [time, setTime] = useState('09:00')
  const [busy, setBusy] = useState(false)

  const scheduled = useMemo(() => rows.filter(r => r.scheduledFor), [rows])
  const unscheduled = useMemo(() => rows.filter(r => r.draft && !r.scheduledFor).sort((a, b) => a.title.localeCompare(b.title)), [rows])

  const byDay = useMemo(() => {
    const m = new Map<string, Array<{ row: Row; date: Date }>>()
    for (const r of scheduled) {
      const d = new Date(r.scheduledFor!)
      const k = dayKey(d)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push({ row: r, date: d })
    }
    for (const list of m.values()) list.sort((a, b) => a.date.getTime() - b.date.getTime())
    return m
  }, [scheduled])

  const armedTitle = armed ? rows.find(r => r.slug === armed)?.title : null

  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  const isPast = (day: number) => {
    const d = new Date(year, month, day, 23, 59, 59)
    return d.getTime() < today.getTime()
  }
  const isToday = (day: number) => year === today.getFullYear() && month === today.getMonth() && day === today.getDate()

  function shiftMonth(delta: number) {
    let m = month + delta, y = year
    if (m < 0) { m = 11; y-- } else if (m > 11) { m = 0; y++ }
    setMonth(m); setYear(y)
  }

  async function placeOn(day: number) {
    if (!armed || busy || isPast(day)) return
    const [h, mm] = time.split(':').map(Number)
    const d = new Date(year, month, day, h || 9, mm || 0, 0, 0)
    if (d.getTime() < Date.now()) return
    setBusy(true)
    await onSchedule(armed, d.toISOString())
    setArmed(null)
    setBusy(false)
  }

  async function unschedule(slug: string) {
    setBusy(true)
    await onSchedule(slug, null)
    setBusy(false)
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto' }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 860, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 16, padding: '18px 20px 22px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Publishing schedule</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
            <button onClick={() => shiftMonth(-1)} style={navBtn}>‹</button>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', minWidth: 130, textAlign: 'center' }}>{MONTHS[month]} {year}</span>
            <button onClick={() => shiftMonth(1)} style={navBtn}>›</button>
            <button onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()) }} style={{ ...navBtn, width: 'auto', padding: '0 10px', fontSize: 11, fontWeight: 700 }}>Today</button>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* Arm banner */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12, padding: '9px 12px', borderRadius: 10, background: armed ? 'rgba(124,58,237,0.12)' : 'var(--bg-card)', border: `1px solid ${armed ? 'var(--accent)' : 'var(--border)'}` }}>
          {armed ? (
            <>
              <span style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>Placing <strong>{armedTitle}</strong> — pick a day.</span>
              <label style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
                at <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...inputStyle, width: 96 }} />
              </label>
              <button onClick={() => setArmed(null)} style={{ fontSize: 11.5, background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
            </>
          ) : (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Pick an unscheduled draft below, then click a day to schedule it. Click a scheduled post to move or remove it.</span>
          )}
        </div>

        {/* Calendar grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 16 }}>
          {WEEKDAYS.map(w => (
            <div key={w} style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'center', padding: '2px 0', letterSpacing: '0.04em' }}>{w}</div>
          ))}
          {cells.map((day, i) => {
            if (day == null) return <div key={`b${i}`} />
            const k = `${year}-${month}-${day}`
            const items = byDay.get(k) ?? []
            const past = isPast(day)
            const placeable = !!armed && !past
            return (
              <div
                key={day}
                onClick={() => placeOn(day)}
                style={{
                  minHeight: 76, borderRadius: 8, padding: '4px 5px', position: 'relative',
                  border: `1px solid ${isToday(day) ? 'var(--accent)' : 'var(--border)'}`,
                  background: past ? 'transparent' : 'var(--bg-card)',
                  opacity: past ? 0.5 : 1,
                  cursor: placeable ? 'copy' : 'default',
                  outline: placeable ? '1px dashed rgba(124,58,237,0.5)' : 'none',
                }}
              >
                <div style={{ fontSize: 10.5, fontWeight: 700, color: isToday(day) ? 'var(--accent-light)' : 'var(--text-muted)', marginBottom: 2 }}>{day}</div>
                {items.slice(0, 3).map(({ row, date }) => (
                  <div key={row.slug} onClick={e => { e.stopPropagation(); setArmed(row.slug) }} title={`${row.title} — click to move`}
                    style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9.5, lineHeight: 1.25, marginBottom: 2, padding: '2px 4px', borderRadius: 4, background: 'rgba(52,211,153,0.16)', border: '1px solid rgba(52,211,153,0.35)', cursor: 'pointer' }}>
                    <span style={{ color: '#34d399', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                    <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</span>
                    <button onClick={e => { e.stopPropagation(); void unschedule(row.slug) }} aria-label="Unschedule" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
                  </div>
                ))}
                {items.length > 3 && <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>+{items.length - 3} more</div>}
              </div>
            )
          })}
        </div>

        {/* Unscheduled drafts */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>
            Unscheduled drafts ({unscheduled.length})
          </div>
          {unscheduled.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Every draft is scheduled or published.</p>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {unscheduled.map(r => (
                <button key={r.slug} onClick={() => setArmed(armed === r.slug ? null : r.slug)} style={{
                  fontSize: 11.5, fontWeight: 600, padding: '6px 11px', borderRadius: 8, cursor: 'pointer', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  border: `1px solid ${armed === r.slug ? 'var(--accent)' : 'var(--border)'}`,
                  background: armed === r.slug ? 'rgba(124,58,237,0.18)' : 'var(--bg-card)',
                  color: armed === r.slug ? 'var(--accent-light)' : 'var(--text-secondary)',
                }}>{r.title}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const navBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent',
  color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const inputStyle: React.CSSProperties = {
  fontSize: 12, padding: '3px 6px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none',
}
