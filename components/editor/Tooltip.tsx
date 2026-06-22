'use client'

import { useState, useRef, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: string
  children: ReactNode
  delay?: number       // ms before showing, default 700
  placement?: 'top' | 'bottom' | 'left' | 'right'
  disabled?: boolean
}

export default function Tooltip({ content, children, delay = 700, placement = 'top', disabled = false }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos]         = useState({ x: 0, y: 0 })
  const timerRef              = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef             = useRef<HTMLDivElement>(null)

  const show = useCallback(() => {
    if (disabled || !content) return
    timerRef.current = setTimeout(() => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      let x = 0, y = 0
      if (placement === 'top')    { x = r.left + r.width / 2; y = r.top - 6 }
      if (placement === 'bottom') { x = r.left + r.width / 2; y = r.bottom + 6 }
      if (placement === 'left')   { x = r.left - 6;           y = r.top + r.height / 2 }
      if (placement === 'right')  { x = r.right + 6;          y = r.top + r.height / 2 }
      setPos({ x, y })
      setVisible(true)
    }, delay)
  }, [content, delay, disabled, placement])

  const hide = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setVisible(false)
  }, [])

  const xform = {
    top:    'translateX(-50%) translateY(-100%)',
    bottom: 'translateX(-50%) translateY(0%)',
    left:   'translateX(-100%) translateY(-50%)',
    right:  'translateX(0%)   translateY(-50%)',
  }[placement]

  return (
    <>
      <div ref={anchorRef} onMouseEnter={show} onMouseLeave={hide} onMouseDown={hide} style={{ display: 'contents' }}>
        {children}
      </div>
      {visible && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', left: pos.x, top: pos.y, transform: xform,
          zIndex: 9999, pointerEvents: 'none',
          background: 'rgba(15,20,32,0.95)', color: '#e2e8f0',
          fontSize: 11, fontWeight: 500, lineHeight: 1.3,
          padding: '4px 8px', borderRadius: 5,
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          whiteSpace: 'pre-line', maxWidth: 240,
          animation: 'tooltipIn 0.1s ease',
        }}>
          {content}
        </div>,
        document.body,
      )}
    </>
  )
}
