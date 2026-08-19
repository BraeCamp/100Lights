'use client'
// Learn mode — the "what does this do?" magnifying glass.
//
// Toggle the 🔍 button (top-right of the header): the cursor becomes a lens,
// hovering any control shows a one-line description, and CLICKING a control
// opens a detail card instead of activating it (capture-phase listeners
// swallow the event before the control sees it). Detail cards contain
// highlighted terms; clicking a term opens ANOTHER card on top without
// closing the previous one, so users can chain through unfamiliar concepts.
// Esc or re-clicking the button exits.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { UI } from './ApolloContext'
import { resolveLearn, fallbackEntry, LEARN_ENTRIES, type LearnEntry } from '@/lib/apollo/learn-content'

// magnifying-glass cursor (SVG data URI, hotspot at the lens center)
const LENS_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26'%3E%3Ccircle cx='10' cy='10' r='7.5' fill='rgba(15,18,24,0.55)' stroke='black' stroke-opacity='0.6' stroke-width='4'/%3E%3Ccircle cx='10' cy='10' r='7.5' fill='none' stroke='white' stroke-width='2'/%3E%3Cline x1='16' y1='16' x2='23' y2='23' stroke='black' stroke-opacity='0.6' stroke-width='5' stroke-linecap='round'/%3E%3Cline x1='16' y1='16' x2='23' y2='23' stroke='white' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E") 10 10, help`

const entryByKey = new Map(LEARN_ENTRIES.map(e => [e.key, e]))

function resolveElement(el: Element): LearnEntry {
  const label = el.getAttribute('data-learn')
  const title = el.getAttribute('title')
  const text = (label || (el.textContent || '').slice(0, 40)).trim()
  return resolveLearn(label ?? text, title) ?? fallbackEntry(text || 'This control', title)
}

/** Body text with [[term]] / [[term|shown]] rendered as clickable highlights. */
function Body({ text, onOpen }: { text: string; onOpen: (key: string) => void }) {
  const parts: React.ReactNode[] = []
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const key = m[1]
    const shown = m[2] ?? (entryByKey.get(key)?.title ?? key)
    parts.push(
      <button
        key={i++}
        onClick={() => onOpen(key)}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: UI.blue, fontWeight: 700, fontSize: 'inherit', fontFamily: 'inherit',
          textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2,
        }}
      >{shown}</button>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <p style={{ margin: 0, fontSize: 12, lineHeight: 1.65, color: UI.text }}>{parts}</p>
}

export default function LearnMode() {
  const [on, setOn] = useState(false)
  const [hover, setHover] = useState<{ entry: LearnEntry; x: number; y: number } | null>(null)
  const [cards, setCards] = useState<LearnEntry[]>([])
  const [mounted, setMounted] = useState(false)
  const onRef = useRef(on)
  onRef.current = on
  useEffect(() => { setMounted(true) }, [])

  const openCard = useCallback((entry: LearnEntry) => {
    setCards(cs => {
      const without = cs.filter(c => c.key !== entry.key)
      return [...without, entry] // re-opening an open card brings it to the top
    })
  }, [])
  const openKey = useCallback((key: string) => {
    const e = entryByKey.get(key)
    if (e) openCard(e)
  }, [openCard])

  // capture-phase interception while active
  useEffect(() => {
    if (!on) return
    const find = (t: EventTarget | null): Element | null => {
      const el = t as Element | null
      if (!el || !(el instanceof Element)) return null
      if (el.closest('[data-learn-ui]')) return null // our own UI stays live
      return el.closest('[data-learn], button, select, [title], input[type="range"]')
    }
    const move = (e: PointerEvent) => {
      const el = find(e.target)
      setHover(el ? { entry: resolveElement(el), x: e.clientX, y: e.clientY } : null)
    }
    const block = (e: Event) => {
      const raw = e.target as Element | null
      if (raw && raw instanceof Element && raw.closest('[data-learn-ui]')) return
      e.preventDefault()
      e.stopPropagation()
      if (e.type === 'click') {
        const el = find(e.target)
        if (el) openCard(resolveElement(el))
      }
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOn(false) }
    document.addEventListener('pointermove', move, true)
    const blocked = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'dragstart'] as const
    for (const t of blocked) document.addEventListener(t, block, true)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointermove', move, true)
      for (const t of blocked) document.removeEventListener(t, block, true)
      window.removeEventListener('keydown', key)
      setHover(null)
    }
  }, [on, openCard])

  // lens cursor everywhere while active
  useEffect(() => {
    if (!on) return
    const style = document.createElement('style')
    style.textContent = `body, body * { cursor: ${LENS_CURSOR} !important; }`
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [on])

  const overlay = mounted ? createPortal(
    <div data-learn-ui="">
      {/* hover blurb */}
      {on && hover && (
        <div style={{
          position: 'fixed', zIndex: 500, pointerEvents: 'none',
          left: Math.min(hover.x + 18, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 280),
          top: hover.y + 20,
          maxWidth: 260, padding: '8px 11px', borderRadius: 8,
          background: 'rgba(12,15,20,0.96)', border: `1px solid ${UI.borderLight}`,
          boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: UI.green, marginBottom: 2 }}>{hover.entry.title}</div>
          <div style={{ fontSize: 10.5, lineHeight: 1.5, color: UI.text }}>{hover.entry.short}</div>
          <div style={{ fontSize: 8.5, color: UI.dim, marginTop: 4 }}>click for the full story</div>
        </div>
      )}

      {/* card stack */}
      {cards.length > 0 && (
        <div style={{
          position: 'fixed', zIndex: 480, right: 14, bottom: 14, width: 'min(360px, calc(100vw - 28px))',
          display: 'flex', flexDirection: 'column-reverse', gap: 8, maxHeight: 'calc(100vh - 90px)', overflowY: 'auto',
        }}>
          {cards.map((c, i) => (
            <div key={c.key} style={{
              background: `linear-gradient(180deg, ${UI.panel} 0%, ${UI.panelLo} 100%)`,
              border: `1px solid ${i === cards.length - 1 ? UI.blue : UI.border}`,
              borderRadius: 10, padding: '11px 13px 12px', boxShadow: '0 10px 32px rgba(0,0,0,0.5)',
              opacity: i === cards.length - 1 ? 1 : 0.92,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span aria-hidden="true" style={{ fontSize: 12 }}>🔍</span>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: UI.text, flex: 1, letterSpacing: 0.3 }}>{c.title}</div>
                <button
                  onClick={() => setCards(cs => cs.filter(x => x.key !== c.key))}
                  aria-label={`Close ${c.title}`}
                  style={{ background: 'none', border: 'none', color: UI.dim, cursor: 'pointer', fontSize: 13, padding: 2, lineHeight: 1 }}
                >✕</button>
              </div>
              <Body text={c.body} onOpen={openKey} />
            </div>
          ))}
          {cards.length > 1 && (
            <button
              onClick={() => setCards([])}
              style={{
                alignSelf: 'flex-end', background: UI.inset, color: UI.dim, border: `1px solid ${UI.border}`,
                borderRadius: 6, fontSize: 9.5, fontWeight: 800, padding: '4px 10px', cursor: 'pointer', letterSpacing: 0.5,
              }}
            >CLOSE ALL</button>
          )}
        </div>
      )}
    </div>,
    document.body,
  ) : null

  return (
    <>
      <button
        data-learn-ui=""
        onClick={() => { setOn(o => !o); if (on) setHover(null) }}
        title={on ? 'Exit learn mode (Esc)' : 'Learn mode — hover anything to see what it is; click it to read more (controls won’t activate)'}
        aria-pressed={on}
        style={{
          background: on ? `linear-gradient(180deg, ${UI.green} 0%, ${UI.green}cc 100%)` : `linear-gradient(180deg, ${UI.header} 0%, ${UI.panel} 100%)`,
          color: on ? '#0b0d10' : UI.dim,
          border: '1px solid ' + (on ? UI.green : UI.border),
          borderRadius: 5, padding: '3px 9px', fontSize: 10, fontWeight: 800, cursor: 'pointer',
          whiteSpace: 'nowrap', letterSpacing: 0.6,
          boxShadow: on ? `0 0 8px ${UI.green}55` : 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >🔍{on ? ' LEARNING' : ''}</button>
      {overlay}
    </>
  )
}
