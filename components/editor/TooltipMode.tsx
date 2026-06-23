'use client'

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'

// ── Context ───────────────────────────────────────────────────────────────────

interface TooltipModeCtx {
  active: boolean
  toggle: () => void
}

const Ctx = createContext<TooltipModeCtx>({ active: false, toggle: () => {} })

export function useTooltipMode() { return useContext(Ctx) }

// ── Floating card ─────────────────────────────────────────────────────────────

interface Card {
  text:    string
  title?:  string
  x:       number
  y:       number
  pinned:  boolean
  id:      number
}

let cardId = 0

function TooltipCard({ card, onDismiss }: { card: Card; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: card.x, y: card.y })
  const [dims, setDims] = useState({ w: 0, h: 0 })

  useEffect(() => {
    if (!ref.current) return
    const { offsetWidth: w, offsetHeight: h } = ref.current
    setDims({ w, h })
    const vw = window.innerWidth, vh = window.innerHeight
    const PAD = 14
    setPos({
      x: Math.min(card.x + 16, vw - w - PAD),
      y: card.y + h + 16 > vh ? card.y - h - 8 : card.y + 16,
    })
  }, [card.x, card.y])

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
        maxWidth: 320,
        background: 'linear-gradient(145deg, rgba(17,17,27,0.98) 0%, rgba(26,26,46,0.98) 100%)',
        border: '1px solid rgba(139,92,246,0.5)',
        borderRadius: 12,
        padding: '14px 16px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(139,92,246,0.1), inset 0 1px 0 rgba(255,255,255,0.05)',
        backdropFilter: 'blur(16px)',
        pointerEvents: card.pinned ? 'auto' : 'none',
        animation: 'tip-in 0.15s cubic-bezier(0.34,1.56,0.64,1) forwards',
        opacity: dims.w ? 1 : 0,
      }}
    >
      <style>{`
        @keyframes tip-in {
          from { opacity: 0; transform: scale(0.92) translateY(4px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: card.text ? 8 : 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(167,139,250,1)', flex: 1, lineHeight: 1.4 }}>
          {card.title ?? '💡 How this works'}
        </span>
        {card.pinned && (
          <button
            onClick={onDismiss}
            style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 14, lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        )}
      </div>

      {/* Body */}
      {card.text && (
        <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6 }}>
          {card.text}
        </p>
      )}

      {/* Pin hint */}
      {!card.pinned && (
        <p style={{ margin: '8px 0 0', fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.04em' }}>
          CLICK TO PIN
        </p>
      )}
    </div>
  )
}

// ── Overlay (mounted once, scans DOM for data-hint) ───────────────────────────

function TooltipOverlay({ active }: { active: boolean }) {
  const [hover,   setHover]   = useState<{ text: string; title?: string; x: number; y: number } | null>(null)
  const [pinned,  setPinned]  = useState<Card[]>([])
  const hoverRef = useRef(hover)
  hoverRef.current = hover

  const findHint = useCallback((target: EventTarget | null): { text: string; title?: string } | null => {
    let el = target as Element | null
    while (el) {
      const raw = el.getAttribute('data-hint')
      if (raw) {
        // Format: optional "Title||body" or just "body"
        const sep = raw.indexOf('||')
        if (sep !== -1) return { title: raw.slice(0, sep).trim(), text: raw.slice(sep + 2).trim() }
        return { text: raw }
      }
      el = el.parentElement
    }
    return null
  }, [])

  useEffect(() => {
    if (!active) { setHover(null); return }

    function onMove(e: MouseEvent) {
      const hint = findHint(e.target)
      if (hint) setHover({ ...hint, x: e.clientX, y: e.clientY })
      else      setHover(null)
    }

    function onClick(e: MouseEvent) {
      const hint = findHint(e.target)
      if (!hint) return
      setPinned(prev => [...prev, { ...hint, x: e.clientX, y: e.clientY, pinned: true, id: ++cardId }])
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('click',     onClick, true)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('click',     onClick, true)
      setHover(null)
    }
  }, [active, findHint])

  // Highlight ring on hovered element
  useEffect(() => {
    if (!active || !hover) return
    // Try to find the element at hover position and add highlight
    const el = document.elementFromPoint(hover.x, hover.y)
    if (!el) return
    // Walk up to find the data-hint element
    let target: Element | null = el
    while (target) {
      if (target.getAttribute('data-hint')) break
      target = target.parentElement
    }
    if (!target) return
    const prev = (target as HTMLElement).style.outline
    const prevOff = (target as HTMLElement).style.outlineOffset;
    (target as HTMLElement).style.outline = '2px solid rgba(139,92,246,0.7)';
    (target as HTMLElement).style.outlineOffset = '2px'
    return () => {
      (target as HTMLElement).style.outline = prev;
      (target as HTMLElement).style.outlineOffset = prevOff
    }
  }, [active, hover?.x, hover?.y])

  if (!active && pinned.length === 0) return null

  return (
    <>
      {hover && !pinned.length && (
        <TooltipCard
          card={{ ...hover, pinned: false, id: -1 }}
          onDismiss={() => {}}
        />
      )}
      {pinned.map(card => (
        <TooltipCard
          key={card.id}
          card={card}
          onDismiss={() => setPinned(prev => prev.filter(c => c.id !== card.id))}
        />
      ))}
    </>
  )
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function TooltipModeProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false)
  const toggle = useCallback(() => setActive(v => !v), [])

  return (
    <Ctx.Provider value={{ active, toggle }}>
      {children}
      <TooltipOverlay active={active} />
      {active && (
        <div style={{
          position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9998, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.4)',
          borderRadius: 20, padding: '5px 14px', fontSize: 10, fontWeight: 600,
          color: 'rgba(167,139,250,0.9)', letterSpacing: '0.06em', pointerEvents: 'none',
          backdropFilter: 'blur(8px)',
          animation: 'tip-in 0.2s ease forwards',
        }}>
          HELP MODE — hover anything for an explanation · click to pin
        </div>
      )}
    </Ctx.Provider>
  )
}

// ── Toggle button (drop in anywhere) ─────────────────────────────────────────

export function TooltipModeToggle() {
  const { active, toggle } = useTooltipMode()
  return (
    <button
      onClick={toggle}
      title={active ? 'Exit help mode' : 'Help mode — hover controls for explanations'}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
        background: active ? 'rgba(139,92,246,0.25)' : 'var(--bg-card)',
        border: `1px solid ${active ? 'rgba(139,92,246,0.6)' : 'var(--border)'}`,
        color: active ? 'rgba(167,139,250,1)' : 'var(--text-muted)',
        cursor: 'pointer',
        animation: active ? 'tip-pulse 2s ease infinite' : 'none',
      }}
    >
      <style>{`@keyframes tip-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(139,92,246,0.4)} 50%{box-shadow:0 0 0 4px rgba(139,92,246,0)} }`}</style>
      {active ? '✕ Help' : '? Help'}
    </button>
  )
}
